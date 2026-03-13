/**
 * Task 78: sidecar.ts path resolution for packaged mode + --data-dir arg.
 * Tests private methods via (instance as any) for targeted unit coverage.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockIsPackaged = { value: false }
const mockAppPath = '/fake/app'
const mockResourcesPath = '/fake/Resources'
const mockUserData = '/fake/Library/Application Support/knowhive'

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return mockIsPackaged.value },
    getAppPath: () => mockAppPath,
    getPath: (name: string) => {
      if (name === 'userData') return mockUserData
      return `/fake/${name}`
    },
  }
}))

vi.mock('../../electron/port', () => ({
  findSidecarPort: vi.fn(async () => 19999)
}))

// Expose process.resourcesPath for test
;(process as any).resourcesPath = mockResourcesPath

import { SidecarManager } from '../../electron/sidecar'

describe('SidecarManager path resolution', () => {
  beforeEach(() => {
    mockIsPackaged.value = false
  })

  describe('resolveBackendDir', () => {
    it('dev mode: uses app.getAppPath() + /backend', () => {
      mockIsPackaged.value = false
      const mgr = new SidecarManager()
      const dir = (mgr as any).resolveBackendDir()
      expect(dir).toBe(`${mockAppPath}/backend`)
    })

    it('packaged mode: uses process.resourcesPath + /app.unpacked/backend', () => {
      mockIsPackaged.value = true
      const mgr = new SidecarManager()
      const dir = (mgr as any).resolveBackendDir()
      expect(dir).toBe(`${mockResourcesPath}/app.unpacked/backend`)
    })

    it('backendDir option overrides both modes', () => {
      mockIsPackaged.value = true
      const mgr = new SidecarManager({ backendDir: '/custom/backend' })
      const dir = (mgr as any).resolveBackendDir()
      expect(dir).toBe('/custom/backend')
    })
  })

  describe('buildArgs', () => {
    it('includes --port and --data-dir args', () => {
      const mgr = new SidecarManager()
      ;(mgr as any)._port = 18234
      const args = (mgr as any).buildArgs()
      expect(args).toContain('--port')
      expect(args).toContain('18234')
      expect(args).toContain('--data-dir')
      expect(args).toContain(mockUserData)
    })

    it('--data-dir value is app.getPath("userData")', () => {
      const mgr = new SidecarManager()
      ;(mgr as any)._port = 18200
      const args = (mgr as any).buildArgs()
      const dataDirIdx = args.indexOf('--data-dir')
      expect(dataDirIdx).toBeGreaterThan(-1)
      expect(args[dataDirIdx + 1]).toBe(mockUserData)
    })

    it('always starts with ["run", "python", "-m", "app.main"]', () => {
      const mgr = new SidecarManager()
      ;(mgr as any)._port = 18200
      const args = (mgr as any).buildArgs()
      expect(args.slice(0, 4)).toEqual(['run', 'python', '-m', 'app.main'])
    })
  })
})
