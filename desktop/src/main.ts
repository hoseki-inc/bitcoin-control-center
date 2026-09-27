import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type Tray, type WebContents, app, dialog, ipcMain, shell } from 'electron'
import { showDeviceChooser } from './device-chooser'
import { setupLedgerHidAccess } from './ledger-hid'
import { startServer } from './server'
import { createQuitHandler } from './shutdown'
import { TorManager } from './tor'
import { setupTray } from './tray'
import { setupWalletAccess } from './wallet-access'
import { isAppUrl, isExternalUrl, isTrezorPopup } from './window-policy'

interface LocalServer {
  shutdown: () => Promise<void>
}

let mainWindow: BrowserWindow | null = null
let torManager: TorManager | null = null
let server: LocalServer | null = null
let tray: Tray | null = null
let quitting = false
let startup: Promise<void> | null = null

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }
  mainWindow.show()
  mainWindow.focus()
}

function openExternal(url: string): void {
  if (isExternalUrl(url)) {
    void shell.openExternal(url).catch(() => {
      dialog.showErrorBox('Could not open link', 'Open your browser and try the link again.')
    })
  }
}

async function start(): Promise<void> {
  const dataDir = path.join(app.getPath('userData'), 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  torManager = new TorManager(app.getPath('userData'))
  void torManager.start().catch(() => undefined)

  const serverDir = path.join(__dirname, '..', 'server')
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    APP_DIR: serverDir,
    HOST: 'localhost',
    PORT: '3400',
    ELECTRUM_HOST: 'electrum.blockstream.info',
    ELECTRUM_PORT: '50002',
    ELECTRUM_PROTOCOL: 'ssl',
    BITCOIN_NETWORK: 'mainnet',
    MEMPOOL_API_URL: 'https://mempool.space',
    NODE_ENV: 'production',
    SOCKS_PROXY_HOST: '127.0.0.1',
    SOCKS_PROXY_PORT: String(torManager.socksPort),
  })
  server = await startServer(pathToFileURL(path.join(serverDir, 'main.js')).href)
  const origin = 'http://localhost:3400'
  if (quitting) {
    return
  }

  const window = new BrowserWindow({
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
  mainWindow = window
  const trezorWindows = new Set<WebContents>()
  setupWalletAccess(window, origin, trezorWindows, (owner, name, selected) =>
    showDeviceChooser(BrowserWindow.fromWebContents(owner) ?? window, name, selected),
  )
  setupLedgerHidAccess(window, origin, ipcMain, async (parent, options) => dialog.showMessageBox(parent, options))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrezorPopup(url) && isAppUrl(window.webContents.getURL(), origin)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          parent: window,
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
  window.webContents.on('did-create-window', (popup) => {
    const contents = popup.webContents
    trezorWindows.add(contents)
    popup.on('closed', () => {
      trezorWindows.delete(contents)
    })
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
      if (!isTrezorPopup(url)) {
        event.preventDefault()
      }
    })
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault()
      openExternal(url)
    }
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault()
    }
  })
  window.on('close', (event) => {
    if (!quitting) {
      event.preventDefault()
      window.hide()
    }
  })
  tray = setupTray(window)
  await window.loadURL(origin)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  app.on('activate', showMainWindow)
  const quit = createQuitHandler({
    shutdownServer: async () => {
      await startup
      // Stop Tor before draining requests; the final cleanup also covers forced exit.
      torManager?.stop()
      await server?.shutdown()
    },
    stopTor: () => {
      torManager?.stop()
    },
    destroyTray: () => {
      tray?.destroy()
    },
    reportError: () => {
      dialog.showErrorBox('Unable to finish shutting down', 'Bitcoin Control Center will now close.')
    },
    quit: () => {
      app.quit()
    },
    forceQuit: () => {
      app.exit(1)
    },
  })
  app.on('before-quit', (event) => {
    quitting = true
    quit(event)
  })
  void app.whenReady().then(() => {
    if (quitting) {
      return
    }
    startup = start().catch(() => {
      if (!quitting) {
        dialog.showErrorBox(
          'Control Center could not start',
          'The app could not finish starting. Close it and try again.',
        )
        app.quit()
      }
    })
  })
}
