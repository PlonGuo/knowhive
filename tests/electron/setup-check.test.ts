/**
 * Task 80: check-setup IPC handler — verifies uv is in PATH.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '..', '..')

describe('check-setup IPC channel', () => {
  it('main.ts registers check-setup ipc handler', () => {
    const src = readFileSync(resolve(ROOT, 'electron/main.ts'), 'utf-8')
    expect(src).toContain("'check-setup'")
    expect(src).toContain('check-setup')
  })

  it('main.ts has checkCommand helper that spawns a process', () => {
    const src = readFileSync(resolve(ROOT, 'electron/main.ts'), 'utf-8')
    expect(src).toContain('checkCommand')
    expect(src).toContain('spawn')
  })

  it('check-setup handler returns uv_ok field', () => {
    const src = readFileSync(resolve(ROOT, 'electron/main.ts'), 'utf-8')
    expect(src).toContain('uv_ok')
    expect(src).toContain("'uv'")
  })

  it('preload.ts exposes checkSetup method', () => {
    const src = readFileSync(resolve(ROOT, 'electron/preload.ts'), 'utf-8')
    expect(src).toContain('checkSetup')
    expect(src).toContain("'check-setup'")
  })

  it('env.d.ts declares checkSetup with correct return type', () => {
    const src = readFileSync(resolve(ROOT, 'src/env.d.ts'), 'utf-8')
    expect(src).toContain('checkSetup')
    expect(src).toContain('uv_ok')
  })
})
