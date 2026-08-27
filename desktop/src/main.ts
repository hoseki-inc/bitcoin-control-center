import * as fs from 'node:fs'
import * as path from 'node:path'
import { BrowserWindow, app, shell } from 'electron'
import { TorManager } from './tor'
import { setupTray } from './tray'

const DATA_DIR = path.join(app.getPath('userData'), 'data')
const PORT = 3400

// Prevent multiple instances (SQLite + port conflicts)
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

let mainWindow: BrowserWindow | null = null
let torManager: TorManager | null = null

app.whenReady().then(async () => {
  // Ensure data directory exists
  fs.mkdirSync(DATA_DIR, { recursive: true })

  // Start bundled Tor daemon in the background (don't block app startup)
  torManager = new TorManager(app.getPath('userData'))
  torManager.start().catch(() => {
    // Tor failed to start — not critical, .onion connections will fail but clearnet works fine
  })

  // Set env vars that api-sentinel reads (mirrors start9/docker_entrypoint.sh)
  const serverDir = path.join(__dirname, '..', 'server')
  process.env['DATA_DIR'] = DATA_DIR
  process.env['APP_DIR'] = serverDir
  process.env['HOST'] = 'localhost'
  process.env['PORT'] = String(PORT)
  process.env['ELECTRUM_HOST'] = 'electrum.blockstream.info'
  process.env['ELECTRUM_PORT'] = '50002'
  process.env['ELECTRUM_PROTOCOL'] = 'ssl'
  process.env['BITCOIN_NETWORK'] = 'mainnet'
  process.env['MEMPOOL_API_URL'] = 'https://mempool.space'
  process.env['NODE_ENV'] = 'production'

  // Tor SOCKS proxy will be available on port 9050 once bootstrapped
  process.env['SOCKS_PROXY_HOST'] = '127.0.0.1'
  process.env['SOCKS_PROXY_PORT'] = String(torManager.socksPort)

  // Start api-sentinel — imports the self-starting bundle
  const serverMain = path.join(serverDir, 'main.js')
  const { main } = await import(serverMain)
  const server = await main()

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  mainWindow.loadURL(`http://localhost:${PORT}`)

  // Open external links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Setup system tray
  const tray = setupTray(mainWindow)

  // Close to tray instead of quitting
  let isQuitting = false
  app.on('before-quit', () => {
    isQuitting = true
  })

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  // Second instance: show the existing window
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })

  // macOS: re-show window when dock icon is clicked
  app.on('activate', () => {
    mainWindow?.show()
  })

  // Graceful shutdown
  app.on('before-quit', async () => {
    await server.shutdown()
    torManager?.stop()
    tray.destroy()
  })
})
