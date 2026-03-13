/// <reference types="vite/client" />

interface Window {
  api: {
    getBackendUrl: () => Promise<string>
    getSidecarStatus: () => Promise<string>
    selectFiles: () => Promise<string[]>
  }
}
