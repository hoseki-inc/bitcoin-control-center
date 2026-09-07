import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { showDeviceChooser } from '../src/device-chooser'
import { setupWalletAccess } from '../src/wallet-access'
import { isAppUrl, isExternalUrl, isTrezorPopup } from '../src/window-policy'

vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: (contents: unknown) => ({ webContents: contents }) } }))
vi.mock('../src/device-chooser', () => ({ showDeviceChooser: vi.fn() }))
const origin = 'http://localhost:3400'
const popupUrl = 'https://connect.trezor.io/9/popup.html?version=9.7.3&env=web'
const ledger = { deviceId: 'ledger', name: 'Nano', vendorId: 0x2c97, productId: 1 }
const trezor = { deviceId: 'trezor', productName: 'Trezor', vendorId: 0x1209, productId: 0x53c1 }
let session: EventEmitter & {
  setPermissionCheckHandler: ReturnType<typeof vi.fn>
  setPermissionRequestHandler: ReturnType<typeof vi.fn>
}
let main: EventEmitter & {
  session: typeof session
  mainFrame: { origin: string }
  getURL: () => string
  isDestroyed: () => boolean
}
let popup: typeof main
let selected: (id: string) => void
let update: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  session = Object.assign(new EventEmitter(), {
    setPermissionCheckHandler: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
  })
  main = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin },
    getURL: () => origin,
    isDestroyed: () => false,
  })
  popup = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin: 'https://connect.trezor.io' },
    getURL: () => popupUrl,
    isDestroyed: () => false,
  })
  update = vi.fn()
  cancel = vi.fn(() => selected(''))
  vi.mocked(showDeviceChooser).mockImplementation((_parent, _name, callback) => {
    selected = callback
    return { update, cancel }
  })
  setupWalletAccess(
    { webContents: main } as unknown as BrowserWindow,
    origin,
    new Set([popup as unknown as WebContents]),
  )
})

describe('wallet permissions and chooser lifecycle', () => {
  it('limits Ledger to the local main frame and Trezor USB to registered approval windows', () => {
    const check = session.setPermissionCheckHandler.mock.calls[0]![0]
    expect(check(main, 'hid', origin, { isMainFrame: true })).toBe(true)
    expect(check(main, 'hid', 'http://localhost:3401', { isMainFrame: true })).toBe(false)
    expect(check(null, 'hid', `${origin}/`, { isMainFrame: false })).toBe(true)
    expect(check(popup, 'hid', 'https://connect.trezor.io', { isMainFrame: true })).toBe(false)
    expect(check(popup, 'usb', 'https://connect.trezor.io', { isMainFrame: true })).toBe(true)
    expect(check(main, 'usb', origin, { isMainFrame: true })).toBe(false)
    expect(check(null, 'usb', 'https://connect.trezor.io/', { isMainFrame: false })).toBe(true)
    expect(check(null, 'hid', 'https://evil.example', { isMainFrame: false })).toBe(false)
  })

  it('filters unrelated devices and updates the Ledger chooser as devices are plugged in or removed', () => {
    const callback = vi.fn()
    session.emit(
      'select-hid-device',
      { preventDefault: vi.fn() },
      { frame: main.mainFrame, deviceList: [{ ...ledger, vendorId: 1 }] },
      callback,
    )
    expect(update).toHaveBeenLastCalledWith([])
    session.emit('hid-device-added', {}, { frame: main.mainFrame, device: ledger })
    expect(update).toHaveBeenLastCalledWith([{ deviceId: 'ledger', productName: 'Nano' }])
    session.emit('hid-device-removed', {}, { frame: main.mainFrame, device: ledger })
    selected('ledger')
    expect(callback).toHaveBeenCalledWith('')
    expect(session.listenerCount('hid-device-added')).toBe(0)
  })

  it('uses Electron 41 USB event arguments and grants only a device still present', () => {
    const callback = vi.fn()
    session.emit('select-usb-device', { preventDefault: vi.fn() }, { frame: popup.mainFrame, deviceList: [] }, callback)
    session.emit('usb-device-added', {}, trezor, main)
    expect(update).toHaveBeenLastCalledWith([])
    session.emit('usb-device-added', {}, trezor, popup)
    expect(update).toHaveBeenLastCalledWith([{ deviceId: 'trezor', productName: 'Trezor' }])
    selected('trezor')
    expect(callback).toHaveBeenCalledWith('trezor')
    expect(session.listenerCount('usb-device-added')).toBe(0)
  })

  it('cancels and releases listeners when the requesting page navigates away', () => {
    const callback = vi.fn()
    session.emit(
      'select-hid-device',
      { preventDefault: vi.fn() },
      { frame: main.mainFrame, deviceList: [ledger] },
      callback,
    )
    main.emit('did-start-navigation')
    expect(callback).toHaveBeenCalledWith('')
    expect(session.listenerCount('hid-device-removed')).toBe(0)
  })

  it('denies a request from an unrelated frame without opening a chooser', () => {
    const callback = vi.fn()
    session.emit(
      'select-hid-device',
      { preventDefault: vi.fn() },
      { frame: { origin }, deviceList: [ledger] },
      callback,
    )
    expect(callback).toHaveBeenCalledWith('')
    expect(showDeviceChooser).not.toHaveBeenCalled()
  })
})

describe('window destinations', () => {
  it('keeps the SDK popup in-app while excluding other hosts, versions, paths, and credential URLs', () => {
    expect(isTrezorPopup(popupUrl)).toBe(true)
    for (const url of [
      'https://connect.trezor.io.evil.test/9/popup.html',
      'https://connect.trezor.io/9/webusb.html',
      'https://connect.trezor.io/10/popup.html',
      'https://user@connect.trezor.io/9/popup.html',
      'http://connect.trezor.io/9/popup.html',
    ])
      expect(isTrezorPopup(url)).toBe(false)
  })
  it('allows ordinary web/email links but excludes OS commands and other local origins', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('mailto:support@example.com')).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'trezorsuite://test', 'invalid'])
      expect(isExternalUrl(url)).toBe(false)
    expect(isAppUrl(`${origin}/settings`, origin)).toBe(true)
    expect(isAppUrl('http://localhost:3401', origin)).toBe(false)
  })
})
