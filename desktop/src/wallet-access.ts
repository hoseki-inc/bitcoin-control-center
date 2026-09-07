import { BrowserWindow, type HIDDevice, type USBDevice, type WebContents, type WebFrameMain } from 'electron'
import { showDeviceChooser } from './device-chooser'
import { TREZOR_ORIGIN, isAppUrl, isTrezorPopup, isWalletDevice } from './window-policy'

export function setupWalletAccess(mainWindow: BrowserWindow, origin: string, trezorWindows: Set<WebContents>): void {
  const session = mainWindow.webContents.session
  const allowed = (contents: WebContents | null, type: string, requestingOrigin: string): boolean => {
    if (!contents) return false
    if (type === 'hid') return contents === mainWindow.webContents && isAppUrl(requestingOrigin, origin)
    return (
      type === 'usb' &&
      trezorWindows.has(contents) &&
      isTrezorPopup(contents.getURL()) &&
      isAppUrl(requestingOrigin, TREZOR_ORIGIN)
    )
  }
  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    // Chromium also performs device checks with null WebContents and
    // isMainFrame=false. Enforce the exact requesting frame in the chooser below.
    if (permission === 'hid')
      return isAppUrl(requestingOrigin, origin) && (!contents || contents === mainWindow.webContents)
    if (permission === 'usb')
      return (
        isAppUrl(requestingOrigin, TREZOR_ORIGIN) &&
        (contents
          ? allowed(contents, permission, requestingOrigin)
          : [...trezorWindows].some((popup) => !popup.isDestroyed() && isTrezorPopup(popup.getURL())))
      )
    return (
      contents === mainWindow.webContents &&
      details.isMainFrame &&
      isAppUrl(requestingOrigin, origin) &&
      ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)
    )
  })
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const local = contents === mainWindow.webContents && details.isMainFrame && isAppUrl(details.requestingUrl, origin)
    callback(local && ['media', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
  })
  // Keep Electron's in-memory grants from explicit selection. Do not automatically
  // grant all devices of a vendor through setDevicePermissionHandler.
  const choose = (
    type: 'hid' | 'usb',
    frame: WebFrameMain | null,
    initial: (HIDDevice | USBDevice)[],
    callback: (id: string) => void,
  ): void => {
    const parent = frame ? BrowserWindow.fromWebContents(mainWindow.webContents) : null
    const owner = frame && [mainWindow.webContents, ...trezorWindows].find((contents) => contents.mainFrame === frame)
    if (!frame || !parent || !owner || !allowed(owner, type, frame.origin)) {
      callback('')
      return
    }
    let devices = initial.filter((device) => isWalletDevice(type, device))
    const chooser = showDeviceChooser(
      BrowserWindow.fromWebContents(owner) ?? parent,
      type === 'hid' ? 'Ledger' : 'Trezor',
      (id) => {
        if (type === 'hid') {
          session.off('hid-device-added', added)
          session.off('hid-device-removed', removed)
        } else {
          session.off('usb-device-added', usbAdded)
          session.off('usb-device-removed', usbRemoved)
        }
        owner.off('destroyed', cancel)
        owner.off('did-start-navigation', cancel)
        callback(id && devices.some((device) => device.deviceId === id) ? id : '')
      },
    )
    const cancel = (): void => chooser.cancel()
    const update = (): void =>
      chooser.update(
        devices.map((device) => ({
          deviceId: device.deviceId,
          productName: ('name' in device ? device.name : device.productName) ?? '',
        })),
      )
    const added = (
      _event: Electron.Event,
      details: { frame: WebFrameMain | null; device: HIDDevice | USBDevice },
    ): void => {
      if (details.frame !== frame || !isWalletDevice(type, details.device)) return
      devices = [...devices.filter((device) => device.deviceId !== details.device.deviceId), details.device]
      update()
    }
    const removed = (
      _event: Electron.Event,
      details: { frame: WebFrameMain | null; device: HIDDevice | USBDevice },
    ): void => {
      if (details.frame !== frame) return
      devices = devices.filter((device) => device.deviceId !== details.device.deviceId)
      update()
    }
    const usbAdded = (event: Electron.Event, device: USBDevice, contents: WebContents): void => {
      if (contents === owner) added(event, { device, frame })
    }
    const usbRemoved = (event: Electron.Event, device: USBDevice, contents: WebContents): void => {
      if (contents === owner) removed(event, { device, frame })
    }
    if (type === 'hid') {
      session.on('hid-device-added', added)
      session.on('hid-device-removed', removed)
    } else {
      session.on('usb-device-added', usbAdded)
      session.on('usb-device-removed', usbRemoved)
    }
    owner.once('destroyed', cancel)
    owner.on('did-start-navigation', cancel)
    update()
  }
  session.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    choose('hid', details.frame, details.deviceList, callback)
  })
  session.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    choose('usb', details.frame, details.deviceList, callback)
  })
}
