import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { SidecarManager } from './sidecar'

let sidecar: SidecarManager | null = null
let backendUrl = process.env['BACKEND_URL'] ?? ''

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
  ipcMain.handle('select-files', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['md', 'pdf'] }],
    })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('save-file', async (_event, defaultName: string) => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showSaveDialog(win!, {
      defaultPath: defaultName,
    })
    return result.canceled ? null : result.filePath ?? null
  })
}

async function startSidecar(): Promise<void> {
  // If BACKEND_URL is set (e.g. by dev:all script), skip sidecar management
  if (backendUrl) {
    console.log(`Using external backend at ${backendUrl} (sidecar disabled)`)
    return
  }

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
