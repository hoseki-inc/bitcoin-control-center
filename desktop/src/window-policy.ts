import type { BrowserWindow, WebContents } from 'electron'

export const TREZOR_SUITE_ORIGIN = 'https://suite.trezor.io'

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

// Trezor Connect 10 opens Trezor Suite Web here when Suite desktop isn't running.
export function isTrezorPopup(value: string): boolean {
  const url = parseUrl(value)
  return url?.origin === TREZOR_SUITE_ORIGIN && url.pathname.startsWith('/web/connect-popup/')
}

// Connect opens a blank window first, so the click still counts, then sends it to Suite Web.
function isTrezorPopupOpen(value: string): boolean {
  return value === 'about:blank' || isTrezorPopup(value)
}

// Removes the app and Electron product tokens, leaving the standard Chrome user agent.
export function chromeUserAgent(userAgent: string): string {
  return userAgent.replace(/(\(KHTML, like Gecko\)) .*?(Chrome\/\S+) .*?(Safari\/\S+)$/, '$1 $2 $3')
}

export function isExternalUrl(value: string): boolean {
  const url = parseUrl(value)
  return url !== null && ['https:', 'http:', 'mailto:'].includes(url.protocol)
}

export function isTrezorDevice(device: { vendorId: number; productId: number }): boolean {
  // The device filters Trezor Suite Web uses.
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
    if (isTrezorPopupOpen(url) && isAppUrl(window.webContents.getURL(), origin)) {
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
    // Suite Web refuses browsers it doesn't recognize, so its window reports the Chromium it runs on.
    contents.setUserAgent(chromeUserAgent(contents.getUserAgent()))
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
      } else if (!isTrezorPopup(contents.getURL())) {
        // The app sends the blank window to Suite Web, and navigations it starts skip this window's
        // user agent. Loading Suite Web from here applies it, and later Suite Web pages keep it.
        event.preventDefault()
        void contents.loadURL(url)
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
