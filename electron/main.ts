import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { SidecarManager } from './sidecar'

let sidecar: SidecarManager | null = null
let backendUrl = ''

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'KnowHive',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('get-backend-url', () => backendUrl)
  ipcMain.handle('get-sidecar-status', () => sidecar?.state.status ?? 'stopped')
}

async function startSidecar(): Promise<void> {
  sidecar = new SidecarManager()
  try {
    const port = await sidecar.start()
    backendUrl = `http://127.0.0.1:${port}`
  } catch (err) {
    console.error('Failed to start FastAPI sidecar:', err)
  }
}

app.whenReady().then(async () => {
  registerIpcHandlers()
  await startSidecar()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async () => {
  await sidecar?.stop()
})
