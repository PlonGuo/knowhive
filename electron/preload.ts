import { contextBridge } from 'electron'

// Backend URL will be set by main process once sidecar is ready.
// For POC, expose a getter that reads from a global set by main process.
let _backendUrl = 'http://127.0.0.1:8000'

contextBridge.exposeInMainWorld('api', {
  getBackendUrl: () => _backendUrl
})
