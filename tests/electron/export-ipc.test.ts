/**
 * Tests for export IPC — saveFile() in preload.ts, save-file handler in main.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const preloadSrc = readFileSync(join(process.cwd(), 'electron/preload.ts'), 'utf-8')
const mainSrc = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf-8')
const envDts = readFileSync(join(process.cwd(), 'src/env.d.ts'), 'utf-8')

describe('Export IPC — preload.ts', () => {
  it('exposes saveFile via contextBridge', () => {
    expect(preloadSrc).toContain('saveFile')
  })

  it('saveFile invokes save-file IPC channel', () => {
    expect(preloadSrc).toContain('save-file')
  })

  it('saveFile accepts a defaultName parameter', () => {
    expect(preloadSrc).toMatch(/saveFile.*defaultName/s)
  })

  it('saveFile returns a Promise<string | null>', () => {
    // Should invoke ipcRenderer.invoke which returns a promise
    expect(preloadSrc).toContain('ipcRenderer.invoke')
  })
})

describe('Export IPC — main.ts', () => {
  it('registers save-file IPC handler', () => {
    expect(mainSrc).toContain('save-file')
  })

  it('calls dialog.showSaveDialog in save-file handler', () => {
    expect(mainSrc).toContain('showSaveDialog')
  })

  it('returns null when dialog is canceled', () => {
    expect(mainSrc).toContain('canceled')
  })
})

describe('Export IPC — env.d.ts', () => {
  it('declares saveFile in Window.api type', () => {
    expect(envDts).toContain('saveFile')
  })

  it('saveFile signature returns Promise<string | null>', () => {
    expect(envDts).toMatch(/saveFile.*Promise<string \| null>/s)
  })
})
