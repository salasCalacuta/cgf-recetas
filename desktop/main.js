const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron')
const http = require('http')
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

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.webmanifest':
      return 'application/manifest+json; charset=utf-8'
    default:
      return 'application/octet-stream'
  }
}

/** Must match vite.config.ts `base` (leading slash, no trailing slash). */
const WEB_BASE = '/cgf-recetas'

function urlToDistRelative(urlPath) {
  let p = (urlPath || '/').split('?')[0].replace(/\\/g, '/')
  if (!p.startsWith('/')) p = `/${p}`

  if (p === '/' || p === '/index.html') return 'index.html'
  if (p === `${WEB_BASE}/` || p === WEB_BASE) return 'index.html'

  const prefix = `${WEB_BASE}/`
  if (p.startsWith(prefix)) {
    const rest = p.slice(prefix.length)
    return rest || 'index.html'
  }

  return p.replace(/^\//, '') || 'index.html'
}

function createStaticServer(distDir, port) {
  return http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    const relPath = urlToDistRelative(urlPath)

    const filePath = path.join(distDir, relPath)
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403).end('Forbidden')
      return
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        // SPA fallback: serve index.html for unknown routes
        const indexPath = path.join(distDir, 'index.html')
        fs.readFile(indexPath, (indexErr, indexData) => {
          if (indexErr) {
            res.writeHead(404).end('Not found')
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(indexData)
        })
        return
      }
      res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) })
      res.end(data)
    })
  })
}

function createWindow({ port }) {
  const preloadPath = path.join(__dirname, 'preload.js')
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
    },
  })

  win.loadURL(`http://localhost:${port}/`)
  return win
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // In packaged app, dist is copied to "<app>/dist"
  const distDir = path.join(__dirname, 'dist')
  const port = 3123 + Math.floor(Math.random() * 1000)

  const server = createStaticServer(distDir, port)
  server.listen(port, () => {
    createWindow({ port })
  })

  app.on('window-all-closed', () => {
    server.close(() => {
      app.quit()
    })
  })
})

