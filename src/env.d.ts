/// <reference types="vite/client" />

interface Window {
  // Present only under Electron (exposed by preload). Absent under Tauri — the
  // platform adapter in src/lib/platform.ts dispatches accordingly.
  api?: {
    getBackendUrl: () => Promise<string>
    getSidecarStatus: () => Promise<string>
    selectFiles: () => Promise<string[]>
    saveFile: (defaultName: string) => Promise<string | null>
  }
}
