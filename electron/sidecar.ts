import { ChildProcess, spawn } from 'node:child_process'
import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { findSidecarPort } from './port'

export interface SidecarOptions {
  /** Max restart attempts before giving up */
  maxRestarts?: number
  /** Health poll interval in ms */
  healthPollInterval?: number
  /** Health poll timeout in ms (total time to wait for health) */
  healthPollTimeout?: number
  /** Override python binary path */
  pythonPath?: string
  /** Override backend directory path */
  backendDir?: string
}

export interface SidecarState {
  port: number | null
  process: ChildProcess | null
  restartCount: number
  status: 'stopped' | 'starting' | 'running' | 'failed'
}

const DEFAULT_MAX_RESTARTS = 3
const DEFAULT_HEALTH_POLL_INTERVAL = 200
const DEFAULT_HEALTH_POLL_TIMEOUT = 15_000

export class SidecarManager {
  private proc: ChildProcess | null = null
  private _port: number | null = null
  private _restartCount = 0
  private _status: SidecarState['status'] = 'stopped'
  private _stopping = false
  private logStream: fs.WriteStream | null = null

  private readonly maxRestarts: number
  private readonly healthPollInterval: number
  private readonly healthPollTimeout: number
  private readonly pythonPath: string | undefined
  private readonly backendDir: string | undefined

  constructor(opts: SidecarOptions = {}) {
    this.maxRestarts = opts.maxRestarts ?? DEFAULT_MAX_RESTARTS
    this.healthPollInterval = opts.healthPollInterval ?? DEFAULT_HEALTH_POLL_INTERVAL
    this.healthPollTimeout = opts.healthPollTimeout ?? DEFAULT_HEALTH_POLL_TIMEOUT
    this.pythonPath = opts.pythonPath
    this.backendDir = opts.backendDir
  }

  get state(): SidecarState {
    return {
      port: this._port,
      process: this.proc,
      restartCount: this._restartCount,
      status: this._status
    }
  }

  /** Start the sidecar process */
  async start(): Promise<number> {
    this._stopping = false
    this._status = 'starting'
    this._port = await findSidecarPort()

    this.ensureLogDir()
    await this.spawnProcess()
    await this.waitForHealth()

    this._status = 'running'
    console.log(`FastAPI sidecar ready on port ${this._port}`)
    return this._port
  }

  /** Gracefully stop the sidecar process */
  async stop(): Promise<void> {
    this._stopping = true
    if (!this.proc) {
      this._status = 'stopped'
      return
    }

    // Try SIGTERM first
    this.proc.kill('SIGTERM')

    // Wait up to 5 seconds for graceful shutdown
    const exited = await this.waitForExit(5000)
    if (!exited && this.proc) {
      // Force kill
      this.proc.kill('SIGKILL')
      await this.waitForExit(2000)
    }

    this.cleanup()
    this._status = 'stopped'
  }

  private resolvePythonPath(): string {
    if (this.pythonPath) return this.pythonPath

    if (app.isPackaged) {
      // In packaged mode, use python from extraResources
      return path.join(process.resourcesPath, 'python', 'bin', 'python3.11')
    }

    // Dev mode: use uv run
    return 'uv'
  }

  private resolveBackendDir(): string {
    if (this.backendDir) return this.backendDir

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'backend')
    }

    return path.join(app.getAppPath(), 'backend')
  }

  private buildArgs(): string[] {
    const pythonCmd = this.resolvePythonPath()
    if (pythonCmd === 'uv') {
      return ['run', 'python', '-m', 'app.main', '--port', String(this._port)]
    }
    return ['-m', 'app.main', '--port', String(this._port)]
  }

  private ensureLogDir(): void {
    const logsDir = path.join(app.getAppPath(), 'logs')
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true })
    }
    this.logStream = fs.createWriteStream(
      path.join(logsDir, 'electron.log'),
      { flags: 'a' }
    )
  }

  private async spawnProcess(): Promise<void> {
    const cmd = this.resolvePythonPath()
    const args = this.buildArgs()
    const cwd = this.resolveBackendDir()

    this.proc = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    // Pipe stdout/stderr to log file
    if (this.logStream) {
      this.proc.stdout?.on('data', (data: Buffer) => {
        const line = `[sidecar stdout] ${data.toString()}`
        this.logStream?.write(line)
        if (!app.isPackaged) process.stdout.write(line)
      })
      this.proc.stderr?.on('data', (data: Buffer) => {
        const line = `[sidecar stderr] ${data.toString()}`
        this.logStream?.write(line)
        if (!app.isPackaged) process.stderr.write(line)
      })
    }

    // Handle spawn errors (e.g. binary not found)
    this.proc.on('error', (err) => {
      const msg = `[sidecar] spawn error: ${err.message}\n`
      this.logStream?.write(msg)
      if (!app.isPackaged) process.stderr.write(msg)
    })

    // Handle unexpected exit → auto-restart
    this.proc.on('exit', (code, signal) => {
      const msg = `[sidecar] exited code=${code} signal=${signal}\n`
      this.logStream?.write(msg)
      if (!app.isPackaged) process.stderr.write(msg)

      if (!this._stopping && this._status === 'running') {
        this.handleCrash()
      }
    })
  }

  private async waitForHealth(): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < this.healthPollTimeout) {
      try {
        const res = await fetch(`http://127.0.0.1:${this._port}/health`)
        if (res.ok) return
      } catch {
        // Not ready yet
      }
      await sleep(this.healthPollInterval)
    }
    throw new Error(`Sidecar failed to become healthy within ${this.healthPollTimeout}ms`)
  }

  private async handleCrash(): Promise<void> {
    this._restartCount++
    if (this._restartCount > this.maxRestarts) {
      this._status = 'failed'
      console.error(`FastAPI sidecar exceeded max restarts (${this.maxRestarts})`)
      return
    }

    console.log(`FastAPI sidecar crashed, restarting (attempt ${this._restartCount}/${this.maxRestarts})...`)
    this._status = 'starting'

    try {
      await this.spawnProcess()
      await this.waitForHealth()
      this._status = 'running'
      console.log(`FastAPI sidecar restarted on port ${this._port}`)
    } catch (err) {
      console.error('Sidecar restart failed:', err)
      this._status = 'failed'
    }
  }

  private waitForExit(timeout: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.proc) return resolve(true)

      const timer = setTimeout(() => resolve(false), timeout)
      this.proc.once('exit', () => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  private cleanup(): void {
    this.proc = null
    this.logStream?.end()
    this.logStream = null
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
