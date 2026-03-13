import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  /** Get the backend URL (set by main process after sidecar starts) */
  getBackendUrl: (): Promise<string> => ipcRenderer.invoke('get-backend-url'),

  /** Get the current sidecar status */
  getSidecarStatus: (): Promise<string> =>
    ipcRenderer.invoke('get-sidecar-status'),

  /** Open file picker dialog and return selected file paths */
  selectFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('select-files'),

  /** Open save dialog and return selected file path, or null if canceled */
  saveFile: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('save-file', defaultName),
})
