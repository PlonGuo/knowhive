import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ChildProcess, spawn } from 'node:child_process'
import { EventEmitter, Readable } from 'node:stream'
import net from 'node:net'
import http from 'node:http'

// Mock electron app module
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => process.cwd(),
    getPath: (name: string) => `/tmp/knowhive-test/${name}`
  }
}))

// Mock port module to return a predictable port
let mockPort = 18234
vi.mock('../../electron/port', () => ({
  findSidecarPort: vi.fn(async () => mockPort)
}))

import { SidecarManager } from '../../electron/sidecar'

/** Create a simple HTTP server that responds to /health */
function createMockBackend(port: number): http.Server {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  server.listen(port, '127.0.0.1')
  return server
}

/** Find a free port for test mock backends */
async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close(() => resolve(port))
    })
  })
}

describe('SidecarManager', () => {
  describe('constructor and state', () => {
    it('starts with stopped status', () => {
      const mgr = new SidecarManager()
      expect(mgr.state.status).toBe('stopped')
      expect(mgr.state.port).toBeNull()
      expect(mgr.state.process).toBeNull()
      expect(mgr.state.restartCount).toBe(0)
    })

    it('accepts custom options', () => {
      const mgr = new SidecarManager({
        maxRestarts: 5,
        healthPollInterval: 100,
        healthPollTimeout: 5000
      })
      expect(mgr.state.status).toBe('stopped')
    })
  })

  describe('start with real subprocess', () => {
    let mgr: SidecarManager
    let freePort: number

    beforeEach(async () => {
      freePort = await getFreePort()
      mockPort = freePort
    })

    afterEach(async () => {
      try {
        await mgr?.stop()
      } catch {
        // ignore cleanup errors
      }
    })

    it('starts the sidecar and reports running status', async () => {
      mgr = new SidecarManager({
        backendDir: process.cwd() + '/backend',
        healthPollInterval: 100,
        healthPollTimeout: 20000
      })

      const port = await mgr.start()
      expect(port).toBe(freePort)
      expect(mgr.state.status).toBe('running')
      expect(mgr.state.port).toBe(freePort)
    }, 25000)

    it('stop transitions to stopped status', async () => {
      mgr = new SidecarManager({
        backendDir: process.cwd() + '/backend',
        healthPollInterval: 100,
        healthPollTimeout: 20000
      })

      await mgr.start()
      await mgr.stop()
      expect(mgr.state.status).toBe('stopped')
      expect(mgr.state.process).toBeNull()
    }, 30000)

    it('throws when health check times out', async () => {
      // Use a port where nothing is listening
      const emptyPort = await getFreePort()
      mockPort = emptyPort

      mgr = new SidecarManager({
        pythonPath: '/nonexistent/python',
        backendDir: process.cwd(),
        healthPollInterval: 50,
        healthPollTimeout: 500
      })

      await expect(mgr.start()).rejects.toThrow('failed to become healthy')
    }, 5000)
  })
})
