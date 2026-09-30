import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type Tray, type WebContents, app, dialog, ipcMain, shell } from 'electron'
import { showDeviceChooser } from './device-chooser'
import { setupLedgerHidAccess } from './ledger-hid'
import { startOnPreferredPort } from './preferred-port'
import { startServer } from './server'
import { createQuitHandler } from './shutdown'
import { configureDesktopTlsTrust } from './tls-trust'
import { TorManager } from './tor'
import { setupTray } from './tray'
import { setupWalletAccess } from './wallet-access'
import { setupWindowPolicy } from './window-policy'

const LOOPBACK_HOST = '127.0.0.1'

interface LocalServer {
  port: number
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
  )

  const serverDir = path.join(__dirname, '..', 'server')
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    APP_DIR: serverDir,
    // Bind one explicit loopback address. With "localhost", Fastify ignores a failed
    // second address, so another service could answer the window on this port.
    HOST: LOOPBACK_HOST,
    ELECTRUM_HOST: 'electrum.blockstream.info',
    ELECTRUM_PORT: '50002',
    ELECTRUM_PROTOCOL: 'ssl',
    BITCOIN_NETWORK: 'mainnet',
    MEMPOOL_API_URL: 'https://mempool.space',
    NODE_ENV: 'production',
  })
  const serverModule = pathToFileURL(path.join(serverDir, 'main.js')).href
  const tor = torManager
  // Keep the development ports free; reuse this app's own port across launches.
  server = await startOnPreferredPort(path.join(app.getPath('userData'), 'port'), async (listenPort) =>
    startServer(serverModule, { waitForElectrum: false, tor, listenPort }),
  )
  const origin = `http://${LOOPBACK_HOST}:${server.port}`
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
    showDeviceChooser(
      BrowserWindow.fromWebContents(owner) ?? window,
      name,
      selected,
      (options) => new BrowserWindow(options),
      ipcMain,
    ),
  )
  setupLedgerHidAccess(window, origin, ipcMain, async (parent, options) => dialog.showMessageBox(parent, options))

  setupWindowPolicy(window, origin, trezorWindows, openExternal)
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
      await torManager?.stop()
      await server?.shutdown()
    },
    stopTor: () => {
      void torManager?.stop()
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
