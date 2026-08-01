// Platform abstraction layer.
//
// Components call these instead of touching Tauri APIs directly:
//   - Tauri:        `invoke()` for Rust commands, dialog plugin for file pickers.
//   - Browser dev:  sensible fallbacks (fixed backend URL, no native pickers).

import { invoke } from '@tauri-apps/api/core'

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:18200'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getBackendUrl(): Promise<string> {
  if (isTauri()) return invoke<string>('get_backend_url')
  return DEFAULT_BACKEND_URL
}

export async function getSidecarStatus(): Promise<string> {
  if (isTauri()) return invoke<string>('get_sidecar_status')
  return 'stopped'
}

export async function selectFiles(): Promise<string[]> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      multiple: true,
      filters: [{ name: 'Documents', extensions: ['md', 'txt', 'docx', 'pdf'] }],
    })
    if (!result) return []
    return Array.isArray(result) ? result : [result]
  }
  return []
}

export async function saveFile(defaultName: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    return (await save({ defaultPath: defaultName })) ?? null
  }
  return null
}
