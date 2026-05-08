const { app, BrowserWindow } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')

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

function createStaticServer(distDir, port) {
  return http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0]
    const safeUrlPath = urlPath.replace(/\\/g, '/')
    const relPath = safeUrlPath === '/' ? 'index.html' : safeUrlPath.replace(/^\//, '')

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
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  })

  win.loadURL(`http://localhost:${port}/`)
  return win
}

app.whenReady().then(() => {
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

