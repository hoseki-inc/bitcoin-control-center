import { contextBridge, ipcRenderer } from 'electron'
import type { LedgerHidApi, LedgerHidUpdate } from './ledger-hid-api'
import type { DesktopPinApi } from './pin-api'

const ledger: LedgerHidApi = {
  begin: async (requestId) => (await ipcRenderer.invoke('ledger-hid:begin', requestId)) === true,
  choose: async (requestId, deviceId) => (await ipcRenderer.invoke('ledger-hid:choose', requestId, deviceId)) === true,
  cancel: (requestId) => {
    ipcRenderer.send('ledger-hid:cancel', requestId)
  },
  end: (requestId) => {
    ipcRenderer.send('ledger-hid:end', requestId)
  },
  subscribe: (listener) => {
    const onUpdate = (_event: Electron.IpcRendererEvent, update: LedgerHidUpdate): void => {
      listener(update)
    }
    ipcRenderer.on('ledger-hid:update', onUpdate)
    return () => {
      ipcRenderer.off('ledger-hid:update', onUpdate)
    }
  },
}

const pin: DesktopPinApi = {
  resetPin: async () => (await ipcRenderer.invoke('pin:reset')) === true,
  onResetting: (listener) => {
    const onResetting = (): void => {
      listener()
    }
    ipcRenderer.on('pin:resetting', onResetting)
    return () => {
      ipcRenderer.off('pin:resetting', onResetting)
    }
  },
  onLock: (listener) => {
    const onLock = (): void => {
      listener()
    }
    ipcRenderer.on('pin:lock', onLock)
    return () => {
      ipcRenderer.off('pin:lock', onLock)
    }
  },
}

contextBridge.exposeInMainWorld('desktop', {
  platform: process.platform,
  ledger,
  pin,
})
