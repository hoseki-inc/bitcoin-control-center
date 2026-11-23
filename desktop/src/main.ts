import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, type Tray, type WebContents, app, dialog, ipcMain, shell } from 'electron'
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
import { type DesktopVerifyConfig, VERIFY_CONFIG_ENV, loadDesktopVerifyConfig } from './verify-config'
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

let verifyConfig: DesktopVerifyConfig | null = null
try {
  verifyConfig = loadDesktopVerifyConfig(process.env[VERIFY_CONFIG_ENV], app.getPath('appData'))
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Refusing to start with invalid ${VERIFY_CONFIG_ENV}: ${message}`)
  app.exit(1)
}

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
    if (verifyConfig) {
      console.error('Could not open external link in verify mode')
      return
    }
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
  const electrumEnv = verifyConfig
    ? {
        ELECTRUM_HOST: verifyConfig.electrum.host,
        ELECTRUM_PORT: String(verifyConfig.electrum.port),
        ELECTRUM_PROTOCOL: verifyConfig.electrum.protocol,
        MEMPOOL_API_URL: verifyConfig.mempoolApiUrl,
      }
    : {
        ELECTRUM_HOST: 'electrum.blockstream.info',
        ELECTRUM_PORT: '50002',
        ELECTRUM_PROTOCOL: 'ssl',
        MEMPOOL_API_URL: 'https://mempool.space',
      }
  Object.assign(process.env, {
    DATA_DIR: dataDir,
    APP_DIR: serverDir,
    // Bind one explicit loopback address. With "localhost", Fastify ignores a failed
    // second address, so another service could answer the window on this port.
    HOST: LOOPBACK_HOST,
    ...electrumEnv,
    BITCOIN_NETWORK: 'mainnet',
    NODE_ENV: 'production',
  })
  const serverModule = pathToFileURL(path.join(serverDir, 'main.js')).href
  const tor = torManager
  const packagedVersion = app.isPackaged
    ? (readReleaseVersion(path.join(app.getAppPath(), 'package.json')) ?? '')
    : undefined
  const releaseVersion =
    verifyConfig !== null
      ? verifyConfig.disableReleaseCheck || verifyConfig.releaseCheckUrl === undefined
        ? undefined
        : packagedVersion
      : packagedVersion
  // Keep the development ports free; reuse this app's own port across launches.
  server = await startOnPreferredPort(path.join(app.getPath('userData'), 'port'), async (listenPort) =>
    startServer(serverModule, {
      waitForElectrum: false,
      tor,
      listenPort,
      connectionProfiles: true,
      statementSourceSetting: true,
      // The PIN is set in the app; a computer administrator can reset a forgotten one, keeping the data.
      pin: 'desktop',
      // A packaged build without a valid version passes an empty one, so Sentinel logs that checks are off.
      releaseVersion,
      releaseCheckUrl: verifyConfig?.releaseCheckUrl,
      registerSignalHandlers: false,
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
  if (verifyConfig !== null) {
    // In verify mode, SIGUSR2 requests a normal BrowserWindow.close() so automated CDP checks can exercise
    // the real close-to-hide and pin:lock handlers without macOS Accessibility permissions.
    const onVerifyClose = (): void => {
      if (mainWindow !== null && !mainWindow.isDestroyed()) {
        mainWindow.close()
      }
    }
    process.on('SIGUSR2', onVerifyClose)
    window.once('closed', () => {
      process.off('SIGUSR2', onVerifyClose)
    })
  }
  const downloadsDir = verifyConfig?.downloadsDir
  if (downloadsDir !== undefined) {
    fs.mkdirSync(downloadsDir, { recursive: true })
    window.webContents.session.on('will-download', (_event, item) => {
      const fileName = path.basename(item.getFilename()) || 'download.bin'
      const savePath = path.join(downloadsDir, fileName)
      item.setSavePath(savePath)
      item.once('done', (_doneEvent, state) => {
        console.log(`verify-download:${state}:${fileName}`)
      })
    })
  }
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
    dataDir,
    confirmAdmin: async () => confirmComputerAdmin(process.platform, runProgram),
    restart: async () => {
      quitting = true
      try {
        await torManager?.stop()
        await server?.shutdown()
      } finally {
        app.relaunch()
        app.exit(0)
      }
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
const userData = verifyConfig ? verifyConfig.userDataDir : userDataPath(app.getPath('appData'), app.isPackaged)
fs.mkdirSync(userData, { recursive: true })
app.setPath('userData', userData)
app.setName(APP_DISPLAY_NAME)

if (verifyConfig !== null) {
  process.on('uncaughtException', (error) => {
    console.error(`Desktop verify uncaughtException: ${error.stack ?? error.message}`)
  })
  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)
    console.error(`Desktop verify unhandledRejection: ${message}`)
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const onSignal = (): void => {
    app.quit()
  }
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)
  app.on('second-instance', showMainWindow)
  app.on('activate', showMainWindow)
  let shutdownFailed = false
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
      shutdownFailed = true
      if (verifyConfig) {
        console.error('Desktop verify shutdown failed')
        return
      }
      dialog.showErrorBox('Unable to finish shutting down', 'Bitcoin Control Center will now close.')
    },
    quit: () => {
      if (verifyConfig && !shutdownFailed) {
        console.log('verify-shutdown:clean')
      }
      app.quit()
    },
    forceQuit: () => {
      if (verifyConfig) {
        console.error('Desktop verify shutdown forced')
      }
      app.exit(1)
    },
  })
  app.on('before-quit', (event) => {
    quitting = true
    quit(event)
  })
  async function startSafely(): Promise<void> {
    try {
      await start()
    } catch (error) {
      if (!quitting) {
        if (verifyConfig) {
          const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
          console.error(`Desktop verify startup failed: ${message}`)
          app.exit(1)
          return
        }
        dialog.showErrorBox(
          'Control Center could not start',
          'The app could not finish starting. Close it and try again.',
        )
        app.quit()
      }
    }
  }
  void app.whenReady().then(() => {
    if (quitting) {
      return
    }
    startup = startSafely()
  })
}
