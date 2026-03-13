import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('dev:all script configuration', () => {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
  )
  const devAll: string = pkg.scripts['dev:all']

  it('dev:all script exists in package.json', () => {
    expect(devAll).toBeDefined()
    expect(typeof devAll).toBe('string')
  })

  it('uses concurrently with kill-others flag', () => {
    expect(devAll).toContain('concurrently -k')
  })

  it('starts uvicorn with --reload for hot-reload', () => {
    expect(devAll).toContain('uvicorn app.main:app --reload')
  })

  it('binds uvicorn to 127.0.0.1', () => {
    expect(devAll).toContain('--host 127.0.0.1')
  })

  it('sets BACKEND_URL env var for electron-vite', () => {
    expect(devAll).toMatch(/BACKEND_URL=http:\/\/127\.0\.0\.1:\d+/)
  })

  it('uses electron-vite dev (not plain vite + electron)', () => {
    expect(devAll).toContain('electron-vite dev')
  })

  it('waits for backend health before starting electron', () => {
    expect(devAll).toMatch(/wait-on http:\/\/127\.0\.0\.1:\d+\/health/)
  })

  it('uses matching port between uvicorn and BACKEND_URL', () => {
    const portMatches = devAll.match(/--port (\d+)/)
    const urlMatches = devAll.match(/BACKEND_URL=http:\/\/127\.0\.0\.1:(\d+)/)
    expect(portMatches).not.toBeNull()
    expect(urlMatches).not.toBeNull()
    expect(portMatches![1]).toBe(urlMatches![1])
  })
})

describe('main.ts BACKEND_URL support', () => {
  it('electron/main.ts reads BACKEND_URL from env', () => {
    const mainSrc = readFileSync(
      join(process.cwd(), 'electron', 'main.ts'),
      'utf-8'
    )
    expect(mainSrc).toContain("process.env['BACKEND_URL']")
  })

  it('electron/main.ts skips sidecar when BACKEND_URL is set', () => {
    const mainSrc = readFileSync(
      join(process.cwd(), 'electron', 'main.ts'),
      'utf-8'
    )
    // Should check backendUrl and return early
    expect(mainSrc).toContain('if (backendUrl)')
    expect(mainSrc).toContain('sidecar disabled')
  })
})
