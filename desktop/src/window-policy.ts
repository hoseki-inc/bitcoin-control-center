import type { BrowserWindow, WebContents } from 'electron'

export const TREZOR_ORIGIN = 'https://connect.trezor.io'

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.username || url.password ? null : url
  } catch {
    return null
  }
}

export function isAppUrl(value: string, origin: string): boolean {
  return parseUrl(value)?.origin === origin
}

export function isTrezorPopup(value: string): boolean {
  const url = parseUrl(value)
  return url?.origin === TREZOR_ORIGIN && url.pathname === '/9/popup.html'
}

export function isExternalUrl(value: string): boolean {
  const url = parseUrl(value)
  return url !== null && ['https:', 'http:', 'mailto:'].includes(url.protocol)
}

export function isTrezorDevice(device: { vendorId: number; productId: number }): boolean {
  // The device filters used by the installed Trezor Connect SDK.
  return (
    (device.vendorId === 0x534c && device.productId === 0x0001) ||
    (device.vendorId === 0x1209 && [0x53c0, 0x53c1].includes(device.productId))
  )
}

export function setupWindowPolicy(
  window: BrowserWindow,
  origin: string,
  trezorWindows: Set<WebContents>,
  openExternal: (url: string) => void,
): void {
  const openLink = (url: string): void => {
    if (isExternalUrl(url)) {
      openExternal(url)
    }
  }
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
    openLink(url)
    return { action: 'deny' }
  })
  window.webContents.on('did-create-window', (popup) => {
    const contents = popup.webContents
    trezorWindows.add(contents)
    popup.on('closed', () => {
      trezorWindows.delete(contents)
    })
    popup.webContents.setWindowOpenHandler(({ url }) => {
      openLink(url)
      return { action: 'deny' }
    })
    popup.webContents.on('will-navigate', (event, url) => {
      if (!isTrezorPopup(url)) {
        event.preventDefault()
        openLink(url)
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
      openLink(url)
    }
  })
  window.webContents.on('will-redirect', (event, url) => {
    if (!isAppUrl(url, origin)) {
      event.preventDefault()
    }
  })
}
