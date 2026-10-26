import type { BrowserWindow, USBDevice, WebContents, WebFrameMain } from 'electron'
import type { DeviceChooser } from './device-chooser'
import { TREZOR_SUITE_ORIGIN, isAppUrl, isTrezorDevice, isTrezorPopup } from './window-policy'

export function setupWalletAccess(
  mainWindow: BrowserWindow,
  origin: string,
  trezorWindows: Set<WebContents>,
  showChooser: (owner: WebContents, name: string, selected: (id: string) => void) => DeviceChooser,
): void {
  const session = mainWindow.webContents.session
  const activeChoosers = new Map<WebContents, DeviceChooser>()
  const allowedUsb = (contents: WebContents, requestingOrigin: string): boolean => {
    return (
      trezorWindows.has(contents) && isTrezorPopup(contents.getURL()) && isAppUrl(requestingOrigin, TREZOR_SUITE_ORIGIN)
    )
  }
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    // Chromium also performs device checks with null WebContents and
    // isMainFrame=false. The USB chooser and inline Ledger flow validate the exact frame.
    if (permission === 'hid') {
      return isAppUrl(requestingOrigin, origin) && (!contents || contents === mainWindow.webContents)
    }
    if (permission === 'usb') {
      return (
        isAppUrl(requestingOrigin, TREZOR_SUITE_ORIGIN) &&
        (contents
          ? allowedUsb(contents, requestingOrigin)
          : [...trezorWindows].some((popup) => !popup.isDestroyed() && isTrezorPopup(popup.getURL())))
      )
    }
    return (
      contents === mainWindow.webContents &&
      details.isMainFrame &&
      isAppUrl(requestingOrigin, origin) &&
      ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
    )
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'storage-access') {
      // Trezor Connect's hidden Suite Web frame needs its unpartitioned storage to reach the Suite Web window.
      callback(
        contents === mainWindow.webContents &&
          !details.isMainFrame &&
          isAppUrl(contents.getURL(), origin) &&
          isTrezorPopup(details.requestingUrl),
      )
      return
    }
    const local = contents === mainWindow.webContents && details.isMainFrame && isAppUrl(details.requestingUrl, origin)
    callback(local && ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  })
  // Keep Electron's in-memory grants from explicit selection. Do not automatically
  // grant all devices of a vendor through setDevicePermissionHandler.
  const choose = (frame: WebFrameMain | null, initial: USBDevice[], callback: (id: string) => void): void => {
    const owner = frame && [...trezorWindows].find((contents) => contents.mainFrame === frame)
    if (!frame || !owner || !allowedUsb(owner, frame.origin)) {
      callback('')
      return
    }
    // Electron replaces the previous USB request for this frame. Close its stale
    // chooser as well, including when its page has not finished loading yet.
    activeChoosers.get(owner)?.cancel()
    let devices = initial.filter(isTrezorDevice)
    const chooser = showChooser(owner, 'Trezor', (id) => {
      if (activeChoosers.get(owner) === chooser) {
        activeChoosers.delete(owner)
      }
      session.off('usb-device-added', added)
      session.off('usb-device-removed', removed)
      owner.off('destroyed', cancel)
      owner.off('render-process-gone', cancel)
      owner.off('did-start-navigation', onNavigation)
      callback(id && devices.some((device) => device.deviceId === id) ? id : '')
    })
    activeChoosers.set(owner, chooser)
    const cancel = (): void => {
      chooser.cancel()
    }
    const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
      if (event.isMainFrame && !event.isSameDocument) {
        cancel()
      }
    }
    const update = (): void => {
      chooser.update(
        devices.map((device) => ({
          deviceId: device.deviceId,
          productName: device.productName ?? '',
        })),
      )
    }
    const added = (_event: Electron.Event, device: USBDevice, contents: WebContents): void => {
      if (contents !== owner || !isTrezorDevice(device)) {
        return
      }
      devices = [...devices.filter((present) => present.deviceId !== device.deviceId), device]
      update()
    }
    const removed = (_event: Electron.Event, device: USBDevice, contents: WebContents): void => {
      if (contents !== owner) {
        return
      }
      devices = devices.filter((present) => present.deviceId !== device.deviceId)
      update()
    }
    session.on('usb-device-added', added)
    session.on('usb-device-removed', removed)
    owner.once('destroyed', cancel)
    owner.once('render-process-gone', cancel)
    owner.on('did-start-navigation', onNavigation)
    update()
  }
  session.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    choose(details.frame, details.deviceList, callback)
  })
}
