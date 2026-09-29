import * as path from 'node:path'
import type { BrowserWindow, BrowserWindowConstructorOptions, IpcMain, IpcMainEvent } from 'electron'

export interface ChooserDevice {
  deviceId: string
  productName: string
}

export interface DeviceChooser {
  update: (devices: ChooserDevice[]) => void
  cancel: () => void
}

function isDeviceId(value: unknown): value is string {
  return typeof value === 'string'
}

export function showDeviceChooser(
  parent: BrowserWindow,
  name: string,
  selected: (id: string) => void,
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow,
  ipc: Pick<IpcMain, 'on' | 'off'>,
): DeviceChooser {
  const window = createWindow({
    parent,
    modal: true,
    width: 440,
    height: 360,
    resizable: false,
    show: false,
    title: `Connect ${name}`,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'chooser-preload.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  let devices: ChooserDevice[] = []
  let finished = false
  const finish = (id: string): void => {
    if (finished) {
      return
    }
    finished = true
    ipc.off('wallet-chooser:select', onSelection)
    selected(id)
    if (!window.isDestroyed()) {
      window.destroy()
    }
  }
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The IPC payload is untrusted; validate its type and membership before selecting a device.
  const onSelection = (event: IpcMainEvent, id: unknown): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
      return
    }
    if (id === '' || (isDeviceId(id) && devices.some((device) => device.deviceId === id))) {
      finish(id)
    }
  }
  const update = (next: ChooserDevice[]): void => {
    devices = next
    if (!finished) {
      window.webContents.send('wallet-chooser:devices', { name, devices })
    }
  }
  ipc.on('wallet-chooser:select', onSelection)
  window.on('closed', () => {
    finish('')
  })
  window.webContents.once('render-process-gone', () => {
    finish('')
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
  window.webContents.on('will-redirect', (event) => {
    event.preventDefault()
  })
  window.webContents.once('did-finish-load', () => {
    update(devices)
    window.show()
  })
  void window.loadFile(path.join(__dirname, 'chooser.html')).catch(() => {
    finish('')
  })
  return {
    update,
    cancel: () => {
      finish('')
    },
  }
}
