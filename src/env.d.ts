/// <reference types="vite/client" />

interface Window {
  api: {
    getBackendUrl: () => Promise<string>
    getSidecarStatus: () => Promise<string>
    selectFiles: () => Promise<string[]>
    saveFile: (defaultName: string) => Promise<string | null>
    checkSetup: () => Promise<{ uv_ok: boolean }>
  }
}
