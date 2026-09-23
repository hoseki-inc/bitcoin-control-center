import { contextBridge, ipcRenderer, shell } from 'electron'
import type { LedgerHidApi, LedgerHidUpdate } from './ledger-hid-api'

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

contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url: string): void => {
    shell.openExternal(url).catch(() => {
      console.error('Unable to open the external link')
    })
  },
  platform: process.platform,
  ledger,
})
