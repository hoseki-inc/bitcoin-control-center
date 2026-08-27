import { contextBridge, shell } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  openExternal: (url: string): void => {
    shell.openExternal(url)
  },
  platform: process.platform,
})
