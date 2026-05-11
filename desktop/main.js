const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const fs = require('fs')
const path = require('path')

ipcMain.handle('save-export-file', async (_event, { folderPath, fileName, contents }) => {
  try {
    const dir = path.normalize(String(folderPath || ''))
    const safeName = path.basename(String(fileName || ''))
    if (!dir || !safeName) {
      return { ok: false, error: 'Ruta o nombre de archivo inválido.' }
    }
    const fp = path.join(dir, safeName)
    await fs.promises.mkdir(dir, { recursive: true })
    await fs.promises.writeFile(fp, String(contents ?? ''), 'utf8')
    return { ok: true, path: fp }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
})

ipcMain.handle('pick-export-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  return r.filePaths[0]
})

function distRoot() {
  // Empaquetado: dist junto a main.js dentro del app.asar / carpeta app
  if (app.isPackaged) return path.join(__dirname, 'dist')
  // Desarrollo: ejecutar desde /desktop con build previo en raíz del repo
  return path.join(__dirname, '..', 'dist')
}

function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.js')
  const indexHtml = path.join(distRoot(), 'index.html')

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  })

  win.loadFile(indexHtml).catch((err) => {
    console.error('No se pudo cargar la app:', err)
  })
  return win
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  createWindow()

  app.on('window-all-closed', () => {
    app.quit()
  })
})
