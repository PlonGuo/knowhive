// Platform abstraction layer.
//
// During the Electron → Tauri migration both shells coexist. This module exposes the
// exact same surface the renderer used via `window.api`, and dispatches at runtime:
//   - Electron: delegate to the preload-exposed `window.api`.
//   - Tauri:    use `invoke()` for Rust commands and the dialog plugin for file pickers.
// Components import from here instead of touching `window.api` directly.

import { invoke } from '@tauri-apps/api/core'

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:18200'

function hasElectronApi(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window).api)
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getBackendUrl(): Promise<string> {
  if (hasElectronApi()) return window.api!.getBackendUrl()
  if (isTauri()) return invoke<string>('get_backend_url')
  return DEFAULT_BACKEND_URL
}

export async function getSidecarStatus(): Promise<string> {
  if (hasElectronApi()) return window.api!.getSidecarStatus()
  if (isTauri()) return invoke<string>('get_sidecar_status')
  return 'stopped'
}

export async function selectFiles(): Promise<string[]> {
  if (hasElectronApi()) return window.api!.selectFiles()
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      multiple: true,
      filters: [{ name: 'Documents', extensions: ['md', 'pdf'] }],
    })
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  }
  return []
}

export async function saveFile(defaultName: string): Promise<string | null> {
  if (hasElectronApi()) return window.api!.saveFile(defaultName)
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    return (await save({ defaultPath: defaultName })) ?? null
  }
  return null
}
