import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type Tray, type WebContents, app, dialog, ipcMain, shell } from 'electron'
import { setupLedgerHidAccess } from './ledger-hid'
import { findAvailablePort } from './ports'
import { startOnPreferredPort } from './preferred-port'
import { shutdownWithDeadline } from './shutdown'
import { configureDesktopTlsTrust } from './tls-trust'
import { TorManager } from './tor'
import { setupTray } from './tray'
import { setupWalletAccess } from './wallet-access'
import { isAppUrl, isExternalUrl, isTrezorPopup } from './window-policy'

interface LocalServer {
  port: number
  shutdown: () => Promise<void>
}

let mainWindow: BrowserWindow | null = null
let torManager: TorManager | null = null
let server: LocalServer | null = null
let tray: Tray | null = null
let quitting = false
let cleanedUp = false
let startup: Promise<void> | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function openExternal(url: string): void {
  if (isExternalUrl(url))
    void shell.openExternal(url).catch(() => {
      dialog.showErrorBox('Could not open link', 'Open your browser and try the link again.')
    })
}

async function start(): Promise<void> {
  // Configure trust before Sentinel creates Electrum or other outbound TLS clients.
  configureDesktopTlsTrust()
  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  const torPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tor')
    : path.join(__dirname, '..', '..', 'tor', process.platform === 'win32' ? 'win' : 'mac')
  torManager = new TorManager(
    app.getPath('userData'),
    path.join(torPath, process.platform === 'win32' ? 'tor.exe' : 'tor'),
    await findAvailablePort(),
  )

  const serverDir = path.join(__dirname, '..', 'server')
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    APP_DIR: serverDir,
    HOST: 'localhost',
    ELECTRUM_HOST: 'electrum.blockstream.info',
    ELECTRUM_PORT: '50002',
    ELECTRUM_PROTOCOL: 'ssl',
    BITCOIN_NETWORK: 'mainnet',
    MEMPOOL_API_URL: 'https://mempool.space',
    NODE_ENV: 'production',
    SOCKS_PROXY_HOST: '127.0.0.1',
    SOCKS_PROXY_PORT: String(torManager.socksPort),
  })
  const { main } = await import(pathToFileURL(path.join(serverDir, 'main.js')).href)
  const options = { waitForElectrum: false, tor: torManager, connectionProfiles: true }
  const portFile = path.join(app.getPath('userData'), 'port')
  const localServer = await startOnPreferredPort<LocalServer>(portFile, (listenPort) =>
    main({ ...options, listenPort }),
  )
  server = localServer
  const origin = `http://localhost:${localServer.port}`
  if (quitting) return

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const trezorWindows = new Set<WebContents>()
  setupWalletAccess(mainWindow, origin, trezorWindows, { handleLedgerSelection: false })
  setupLedgerHidAccess(mainWindow, origin, ipcMain, (window, options) => dialog.showMessageBox(window, options))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrezorPopup(url) && isAppUrl(mainWindow!.webContents.getURL(), origin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: mainWindow!,
          width: 480,
          height: 720,
          autoHideMenuBar: true,
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        },
      }
    }
    openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('did-create-window', (popup) => {
    const contents = popup.webContents
    trezorWindows.add(contents)
    popup.on('closed', () => trezorWindows.delete(contents))
    popup.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url)
      return { action: 'deny' }
    })
    popup.webContents.on('will-navigate', (event, url) => {
      if (!isTrezorPopup(url)) {
        event.preventDefault()
        openExternal(url)
      }
    })
    popup.webContents.on('will-redirect', (event, url) => {
      if (!isTrezorPopup(url)) event.preventDefault()
    })
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault()
      openExternal(url)
    }
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, origin)) event.preventDefault()
  })
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })
  tray = setupTray(mainWindow)
  await mainWindow.loadURL(origin)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  app.on('activate', showMainWindow)
  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    void shutdownWithDeadline(
      async () => {
        await startup
        // Stop Tor first to release any requests waiting for bootstrap before
        // draining the HTTP server and closing SQLite.
        await torManager?.stop()
        await server?.shutdown()
        tray?.destroy()
        cleanedUp = true
        app.quit()
      },
      () => app.exit(0),
    ).catch(() => {
      dialog.showErrorBox(
        'Could not finish quitting',
        'Control Center could not close its local services. Try quitting again.',
      )
      quitting = false
    })
  })
  void app.whenReady().then(() => {
    startup = start().catch(() => {
      if (!quitting) {
        dialog.showErrorBox(
          'Control Center could not start',
          'The local service could not open. Check that your data folder is writable, then reopen Control Center.',
        )
        app.quit()
      }
    })
  })
}
