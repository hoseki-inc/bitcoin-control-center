import * as path from 'node:path'
import { BrowserWindow, type IpcMainEvent, ipcMain } from 'electron'

export interface ChooserDevice {
  deviceId: string
  productName: string
}

export interface DeviceChooser {
  update: (devices: ChooserDevice[]) => void
  cancel: () => void
}

export function showDeviceChooser(parent: BrowserWindow, name: string, selected: (id: string) => void): DeviceChooser {
  const window = new BrowserWindow({
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
    if (finished) return
    finished = true
    ipcMain.off('wallet-chooser:select', onSelection)
    selected(id)
    if (!window.isDestroyed()) window.destroy()
  }
  const onSelection = (event: IpcMainEvent, id: unknown): void => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return
    if (id === '' || (typeof id === 'string' && devices.some((device) => device.deviceId === id))) {
      finish(id)
    }
  }
  const update = (next: ChooserDevice[]): void => {
    devices = next
    if (!finished) window.webContents.send('wallet-chooser:devices', { name, devices })
  }
  ipcMain.on('wallet-chooser:select', onSelection)
  window.on('closed', () => finish(''))
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-redirect', (event) => event.preventDefault())
  window.webContents.once('did-finish-load', () => {
    update(devices)
    window.show()
  })
  void window.loadFile(path.join(__dirname, 'chooser.html')).catch(() => finish(''))
  return { update, cancel: () => finish('') }
}
