import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BrowserWindow, Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { setupWalletAccess } from '../src/wallet-access'
import { isAppUrl, isExternalUrl, isTrezorPopup } from '../src/window-policy'

const origin = 'http://localhost:49172'
const popupUrl = 'https://connect.trezor.io/9/popup.html?version=9.7.3&env=web'
const ledger = { deviceId: 'ledger', name: 'Nano', vendorId: 0x2c97, productId: 1 }
const trezor = { deviceId: 'trezor', productName: 'Trezor', vendorId: 0x1209, productId: 0x53c1 }

function createHarness(handleLedgerSelection = true) {
  const session = Object.assign(new EventEmitter(), {
    setPermissionCheckHandler: vi.fn<Session['setPermissionCheckHandler']>(),
    setPermissionRequestHandler: vi.fn<Session['setPermissionRequestHandler']>(),
  })
  const main = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin },
    getURL: () => origin,
    isDestroyed: () => false,
  })
  const popup = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin: 'https://connect.trezor.io' },
    getURL: () => popupUrl,
    isDestroyed: () => false,
  })
  // SAFETY: these test doubles implement every WebContents member used by wallet permissions and selection.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Electron supplies the full object in production; the test exercises only these members.
  const mainContents = main as WebContents
  // SAFETY: the registered popup has the same tested WebContents contract as the main window above.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The popup double contains every member read by setupWalletAccess.
  const popupContents = popup as WebContents
  // SAFETY: setupWalletAccess reads only webContents from the BrowserWindow boundary.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- A real BrowserWindow cannot be constructed in a Node test.
  const window = { webContents: mainContents } as BrowserWindow
  let selected: ((id: string) => void) | undefined
  const select = (id: string): void => {
    assert.ok(selected, 'Expected an open device chooser')
    selected(id)
  }
  const update = vi.fn<(devices: { deviceId: string; productName: string }[]) => void>()
  const cancel = vi.fn(() => {
    select('')
  })
  const showChooser = vi.fn<Parameters<typeof setupWalletAccess>[3]>((_owner, _name, callback) => {
    selected = callback
    return { update, cancel }
  })
  setupWalletAccess(window, origin, new Set([popupContents]), showChooser, { handleLedgerSelection })
  const check = session.setPermissionCheckHandler.mock.calls.at(-1)?.[0]
  assert.ok(check, 'Expected a permission check handler')
  return { session, main: mainContents, popup: popupContents, select, update, showChooser, check }
}

describe('wallet permissions and chooser lifecycle', () => {
  it('keeps wallet permissions and Trezor selection while the inline Ledger flow owns HID selection', () => {
    const { session, main, popup, check } = createHarness(false)
    expect(session.listenerCount('select-hid-device')).toBe(0)
    expect(session.listenerCount('select-usb-device')).toBe(1)
    expect(check(main, 'hid', origin, { isMainFrame: true, requestingUrl: origin, securityOrigin: origin })).toBe(true)
    expect(
      check(popup, 'usb', 'https://connect.trezor.io', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(true)
    expect(
      check(main, 'hid', 'https://untrusted.example', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(false)
  })

  it('limits Ledger to the local main frame and Trezor USB to registered approval windows', () => {
    const { main, popup, check } = createHarness()
    expect(check(main, 'hid', origin, { isMainFrame: true, requestingUrl: origin, securityOrigin: origin })).toBe(true)
    expect(
      check(main, 'hid', 'http://localhost:3400', { isMainFrame: true, requestingUrl: origin, securityOrigin: origin }),
    ).toBe(false)
    expect(
      check(null, 'hid', `${origin}/`, { isMainFrame: false, requestingUrl: origin, securityOrigin: origin }),
    ).toBe(true)
    expect(
      check(popup, 'hid', 'https://connect.trezor.io', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(false)
    expect(
      check(popup, 'usb', 'https://connect.trezor.io', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(true)
    expect(check(main, 'usb', origin, { isMainFrame: true, requestingUrl: origin, securityOrigin: origin })).toBe(false)
    expect(
      check(null, 'usb', 'https://connect.trezor.io/', {
        isMainFrame: false,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(true)
    expect(
      check(null, 'hid', 'https://evil.example', { isMainFrame: false, requestingUrl: origin, securityOrigin: origin }),
    ).toBe(false)
  })

  it('filters unrelated devices and updates the Ledger chooser as devices are plugged in or removed', () => {
    const { session, main, select, update } = createHarness()
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
    select('ledger')
    expect(callback).toHaveBeenCalledWith('')
    expect(session.listenerCount('hid-device-added')).toBe(0)
  })

  it('uses Electron USB event arguments and grants only a device still present', () => {
    const { session, main, popup, select, update } = createHarness()
    const callback = vi.fn()
    session.emit('select-usb-device', { preventDefault: vi.fn() }, { frame: popup.mainFrame, deviceList: [] }, callback)
    session.emit('usb-device-added', {}, trezor, main)
    expect(update).toHaveBeenLastCalledWith([])
    session.emit('usb-device-added', {}, trezor, popup)
    expect(update).toHaveBeenLastCalledWith([{ deviceId: 'trezor', productName: 'Trezor' }])
    select('trezor')
    expect(callback).toHaveBeenCalledWith('trezor')
    expect(session.listenerCount('usb-device-added')).toBe(0)
  })

  it('cancels and releases listeners when the requesting page navigates away', () => {
    const { session, main } = createHarness()
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

  it('rejects a Trezor device removed before selection and releases popup listeners', () => {
    const { session, popup, select, update } = createHarness(false)
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      callback,
    )
    session.emit('usb-device-removed', {}, trezor, popup)
    expect(update).toHaveBeenLastCalledWith([])
    select('trezor')
    expect(callback).toHaveBeenCalledWith('')
    expect(session.listenerCount('usb-device-removed')).toBe(0)
    expect(popup.listenerCount('destroyed')).toBe(0)
    expect(popup.listenerCount('did-start-navigation')).toBe(0)
  })

  it('cancels Trezor selection when the approval window closes', () => {
    const { session, popup } = createHarness(false)
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      callback,
    )
    popup.emit('destroyed')
    expect(callback).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(session.listenerCount('usb-device-removed')).toBe(0)
  })

  it('denies USB selection from the app or an unregistered Trezor frame', () => {
    const { session, main, showChooser } = createHarness(false)
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: main.mainFrame, deviceList: [trezor] },
      callback,
    )
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: { origin: 'https://connect.trezor.io' }, deviceList: [trezor] },
      callback,
    )
    expect(callback.mock.calls).toEqual([[''], ['']])
    expect(showChooser).not.toHaveBeenCalled()
  })

  it('denies a request from an unrelated frame without opening a chooser', () => {
    const { session, showChooser } = createHarness()
    const callback = vi.fn()
    session.emit(
      'select-hid-device',
      { preventDefault: vi.fn() },
      { frame: { origin }, deviceList: [ledger] },
      callback,
    )
    expect(callback).toHaveBeenCalledWith('')
    expect(showChooser).not.toHaveBeenCalled()
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
    ]) {
      expect(isTrezorPopup(url)).toBe(false)
    }
  })
  it('allows ordinary web/email links but excludes OS commands and other local origins', () => {
    expect(isExternalUrl('https://example.com')).toBe(true)
    expect(isExternalUrl('mailto:support@example.com')).toBe(true)
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'trezorsuite://test', 'invalid']) {
      expect(isExternalUrl(url)).toBe(false)
    }
    expect(isAppUrl(`${origin}/settings`, origin)).toBe(true)
    expect(isAppUrl('http://localhost:3401', origin)).toBe(false)
  })
})
