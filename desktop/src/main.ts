import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type Tray, type WebContents, app, dialog, ipcMain, powerMonitor, shell } from 'electron'
import { APP_DISPLAY_NAME, readReleaseVersion, userDataPath } from './app-identity'
import { confirmComputerAdmin, runProgram } from './computer-admin'
import { showDeviceChooser } from './device-chooser'
import { setupLedgerHidAccess } from './ledger-hid'
import { setupPinAccess } from './pin'
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
    startServer(serverModule, {
      waitForElectrum: false,
      tor,
      listenPort,
      connectionProfiles: true,
      statementSourceSetting: true,
      // The PIN is set in the app; a computer administrator can reset a forgotten one, keeping the data.
      pin: { required: true, inAppSetup: true, httpsOnly: false, recovery: 'admin' },
      // A packaged build without a valid version passes an empty one, so Sentinel logs that checks are off.
      releaseVersion: app.isPackaged
        ? (readReleaseVersion(path.join(app.getAppPath(), 'package.json')) ?? '')
        : undefined,
    }),
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

  setupPinAccess(window, origin, ipcMain, {
    confirmAdmin: async () => confirmComputerAdmin(process.platform, runProgram),
    resetAndRestart: async () => {
      // Sentinel clears the PIN when it next starts and finds this request (see its auth/platform.ts). Written
      // first, so a failure leaves the app running as it was.
      fs.writeFileSync(path.join(dataDir, 'reset-pin'), 'reset\n', { mode: 0o600 })
      quitting = true
      try {
        await torManager?.stop()
        await server?.shutdown()
      } finally {
        app.relaunch()
        app.exit(0)
      }
    },
    onComputerLock: (listener) => {
      powerMonitor.on('suspend', listener)
      powerMonitor.on('lock-screen', listener)
    },
  })
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

// Before anything reads the data folder (the single-instance lock does): keep it where it has
// always been, then give the menus the product's name. Electron documents setPath as failing for
// a folder that doesn't exist yet, as on a fresh install, so create it first.
const userData = userDataPath(app.getPath('appData'), app.isPackaged)
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setName(APP_DISPLAY_NAME)

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
