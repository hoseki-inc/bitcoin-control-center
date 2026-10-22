import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BrowserWindow, Session, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { setupWalletAccess } from '../src/wallet-access'
import { isAppUrl, isExternalUrl, isTrezorPopup } from '../src/window-policy'
import { createWindowFixture } from './window-fixture'

const origin = 'http://localhost:49172'
const popupUrl = 'https://suite.trezor.io/web/connect-popup/?connect-popup-req=abc123'
const trezor = { deviceId: 'trezor', productName: 'Trezor', vendorId: 0x1209, productId: 0x53c1 }

function createHarness() {
  let check: Parameters<Session['setPermissionCheckHandler']>[0] | undefined
  let request: Parameters<Session['setPermissionRequestHandler']>[0] | undefined
  const session = Object.assign(new EventEmitter(), {
    setPermissionCheckHandler(handler: Parameters<Session['setPermissionCheckHandler']>[0]): void {
      check = handler
    },
    setPermissionRequestHandler(handler: Parameters<Session['setPermissionRequestHandler']>[0]): void {
      request = handler
    },
  })
  const main = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin },
    getURL: (): string => origin,
    isDestroyed: (): boolean => false,
  })
  const popup = Object.assign(new EventEmitter(), {
    session,
    mainFrame: { origin: 'https://suite.trezor.io' },
    getURL: (): string => popupUrl,
    isDestroyed: (): boolean => false,
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
  const showChooser = vi.fn<Parameters<typeof setupWalletAccess>[3]>((_owner, _name, callback) => {
    let finished = false
    const choose = (id: string): void => {
      if (!finished) {
        finished = true
        callback(id)
      }
    }
    selected = choose
    return {
      update,
      cancel: vi.fn(() => {
        choose('')
      }),
    }
  })
  const registered = new Set([popupContents])
  setupWalletAccess(window, origin, registered, showChooser)
  assert.ok(check, 'Expected a permission check handler')
  assert.ok(request, 'Expected a permission request handler')
  return { session, main: mainContents, popup: popupContents, select, update, showChooser, check, request, registered }
}

describe('wallet permissions and chooser lifecycle', () => {
  it('keeps wallet permissions and Trezor selection while the inline Ledger flow owns HID selection', () => {
    const { session, main, popup, check } = createHarness()
    expect(session.listenerCount('select-hid-device')).toBe(0)
    expect(session.listenerCount('select-usb-device')).toBe(1)
    expect(check(main, 'hid', origin, { isMainFrame: true, requestingUrl: origin, securityOrigin: origin })).toBe(true)
    expect(
      check(popup, 'usb', 'https://suite.trezor.io', {
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
      check(popup, 'hid', 'https://suite.trezor.io', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(false)
    expect(
      check(popup, 'usb', 'https://suite.trezor.io', {
        isMainFrame: true,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(true)
    expect(check(main, 'usb', origin, { isMainFrame: true, requestingUrl: origin, securityOrigin: origin })).toBe(false)
    expect(
      check(null, 'usb', 'https://suite.trezor.io/', {
        isMainFrame: false,
        requestingUrl: origin,
        securityOrigin: origin,
      }),
    ).toBe(true)
    expect(
      check(null, 'hid', 'https://evil.example', { isMainFrame: false, requestingUrl: origin, securityOrigin: origin }),
    ).toBe(false)
  })

  it('filters unrelated USB devices and tracks Trezor hotplug/removal', () => {
    const { session, popup, select, update } = createHarness()
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [{ ...trezor, vendorId: 1 }] },
      callback,
    )
    expect(update).toHaveBeenLastCalledWith([])
    session.emit('usb-device-added', {}, { ...trezor, productId: 1 }, popup)
    expect(update).toHaveBeenLastCalledWith([])
    session.emit('usb-device-added', {}, trezor, popup)
    expect(update).toHaveBeenLastCalledWith([{ deviceId: 'trezor', productName: 'Trezor' }])
    session.emit('usb-device-removed', {}, trezor, popup)
    select('trezor')
    expect(callback).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-added')).toBe(0)
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

  it.each([
    { isMainFrame: true, isSameDocument: true },
    { isMainFrame: false, isSameDocument: false },
    { isMainFrame: false, isSameDocument: true },
  ])('keeps selection open for navigation within the document or a subframe: %j', (event) => {
    const { session, popup, select } = createHarness()
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      callback,
    )
    popup.emit('did-start-navigation', event)
    expect(callback).not.toHaveBeenCalled()
    expect(session.listenerCount('usb-device-added')).toBe(1)
    select('trezor')
    expect(callback).toHaveBeenCalledExactlyOnceWith('trezor')
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(popup.listenerCount('did-start-navigation')).toBe(0)
    expect(popup.listenerCount('render-process-gone')).toBe(0)
  })

  it('cancels and releases listeners when the requesting document navigates away', () => {
    const { session, popup } = createHarness()
    const callback = vi.fn()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      callback,
    )
    popup.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false })
    expect(callback).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(session.listenerCount('usb-device-removed')).toBe(0)
    expect(popup.listenerCount('did-start-navigation')).toBe(0)
    expect(popup.listenerCount('render-process-gone')).toBe(0)
    expect(popup.listenerCount('destroyed')).toBe(0)
  })

  it('rejects a Trezor device removed before selection and releases popup listeners', () => {
    const { session, popup, select, update } = createHarness()
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
    expect(popup.listenerCount('render-process-gone')).toBe(0)
  })

  it('cancels Trezor selection when the approval window closes', () => {
    const { session, popup } = createHarness()
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

  it('cancels a crashed approval renderer, releases its listeners, and allows a retry', () => {
    const { session, popup, select } = createHarness()
    const first = vi.fn<(id: string) => void>()
    const retry = vi.fn<(id: string) => void>()
    const details = { frame: popup.mainFrame, deviceList: [trezor] }
    session.emit('select-usb-device', { preventDefault: vi.fn() }, details, first)
    popup.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
    expect(first).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(session.listenerCount('usb-device-removed')).toBe(0)
    expect(popup.listenerCount('render-process-gone')).toBe(0)
    expect(popup.listenerCount('did-start-navigation')).toBe(0)
    expect(popup.listenerCount('destroyed')).toBe(0)
    select('trezor')
    expect(first).toHaveBeenCalledTimes(1)
    session.emit('select-usb-device', { preventDefault: vi.fn() }, details, retry)
    expect(retry).not.toHaveBeenCalled()
    expect(popup.listenerCount('render-process-gone')).toBe(1)
    select('trezor')
    expect(retry).toHaveBeenCalledExactlyOnceWith('trezor')
    expect(popup.listenerCount('render-process-gone')).toBe(0)
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(session.listenerCount('usb-device-removed')).toBe(0)
  })

  it('denies USB selection from the app or an unregistered Trezor frame', () => {
    const { session, main, showChooser } = createHarness()
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
      { frame: { origin: 'https://suite.trezor.io' }, deviceList: [trezor] },
      callback,
    )
    expect(callback.mock.calls).toEqual([[''], ['']])
    expect(showChooser).not.toHaveBeenCalled()
  })

  it('replaces an unfinished chooser for the same popup and cleans up both requests', () => {
    const { session, popup, select, showChooser } = createHarness()
    const first = vi.fn<(id: string) => void>()
    const second = vi.fn<(id: string) => void>()
    const details = { frame: popup.mainFrame, deviceList: [trezor] }
    session.emit('select-usb-device', { preventDefault: vi.fn() }, details, first)
    session.emit('select-usb-device', { preventDefault: vi.fn() }, details, second)
    expect(showChooser).toHaveBeenCalledTimes(2)
    expect(first).toHaveBeenCalledExactlyOnceWith('')
    expect(second).not.toHaveBeenCalled()
    expect(session.listenerCount('usb-device-added')).toBe(1)
    expect(session.listenerCount('usb-device-removed')).toBe(1)
    expect(popup.listenerCount('did-start-navigation')).toBe(1)
    expect(popup.listenerCount('render-process-gone')).toBe(1)
    select('trezor')
    expect(second).toHaveBeenCalledExactlyOnceWith('trezor')
    expect(session.listenerCount('usb-device-added')).toBe(0)
    expect(popup.listenerCount('destroyed')).toBe(0)
    const retry = vi.fn<(id: string) => void>()
    session.emit('select-usb-device', { preventDefault: vi.fn() }, details, retry)
    popup.emit('destroyed')
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-removed')).toBe(0)
  })

  it('does not let an unauthorized request cancel a valid chooser', () => {
    const { session, popup, select } = createHarness()
    const valid = vi.fn<(id: string) => void>()
    const invalid = vi.fn<(id: string) => void>()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      valid,
    )
    session.emit('select-usb-device', { preventDefault: vi.fn() }, { frame: null, deviceList: [trezor] }, invalid)
    expect(invalid).toHaveBeenCalledExactlyOnceWith('')
    expect(valid).not.toHaveBeenCalled()
    expect(session.listenerCount('usb-device-added')).toBe(1)
    select('trezor')
    expect(valid).toHaveBeenCalledExactlyOnceWith('trezor')
  })

  it('keeps requests in different registered popups independent', () => {
    const { session, popup, registered, select } = createHarness()
    const other = createWindowFixture(popupUrl).contents
    registered.add(other)
    const first = vi.fn<(id: string) => void>()
    const second = vi.fn<(id: string) => void>()
    const replacement = vi.fn<(id: string) => void>()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      first,
    )
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: other.mainFrame, deviceList: [trezor] },
      second,
    )
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    session.emit(
      'select-usb-device',
      { preventDefault: vi.fn() },
      { frame: popup.mainFrame, deviceList: [trezor] },
      replacement,
    )
    expect(first).toHaveBeenCalledExactlyOnceWith('')
    expect(second).not.toHaveBeenCalled()
    expect(session.listenerCount('usb-device-added')).toBe(2)
    other.emit('destroyed')
    expect(second).toHaveBeenCalledExactlyOnceWith('')
    expect(session.listenerCount('usb-device-added')).toBe(1)
    select('trezor')
    expect(replacement).toHaveBeenCalledExactlyOnceWith('trezor')
    expect(session.listenerCount('usb-device-added')).toBe(0)
  })

  it('grants ordinary permissions only to the local main frame', () => {
    const { main, popup, check, request } = createHarness()
    const callback = vi.fn<(granted: boolean) => void>()
    const details = { isMainFrame: true, requestingUrl: origin, securityOrigin: origin }
    expect(check(main, 'media', origin, details)).toBe(true)
    expect(check(main, 'media', origin, { ...details, isMainFrame: false })).toBe(false)
    expect(check(popup, 'media', 'https://suite.trezor.io', details)).toBe(false)
    expect(check(main, 'geolocation', origin, details)).toBe(false)
    request(main, 'clipboard-sanitized-write', callback, details)
    request(popup, 'clipboard-sanitized-write', callback, details)
    expect(callback.mock.calls).toEqual([[true], [false]])
  })

  it('grants storage access only to the Suite Web frame inside the app', () => {
    const { main, popup, request } = createHarness()
    const callback = vi.fn<(granted: boolean) => void>()
    const bootstrapUrl = 'https://suite.trezor.io/web/connect-popup/bootstrap.html?connect-popup-req=abc123'
    const frame = { isMainFrame: false, requestingUrl: bootstrapUrl, securityOrigin: 'https://suite.trezor.io' }
    request(main, 'storage-access', callback, frame)
    request(main, 'storage-access', callback, { ...frame, isMainFrame: true })
    request(main, 'storage-access', callback, { ...frame, requestingUrl: 'https://evil.example/web/connect-popup/' })
    request(popup, 'storage-access', callback, frame)
    expect(callback.mock.calls).toEqual([[true], [false], [false], [false]])
  })
})

describe('window destinations', () => {
  it('keeps the Suite Web window in-app while excluding other hosts, paths, and credential URLs', () => {
    expect(isTrezorPopup(popupUrl)).toBe(true)
    expect(isTrezorPopup('https://suite.trezor.io/web/connect-popup/bootstrap.html?connect-popup-req=abc123')).toBe(
      true,
    )
    for (const url of [
      'https://suite.trezor.io.evil.test/web/connect-popup/',
      'https://suite.trezor.io/web/',
      'https://suite.trezor.io/web/connect-popup',
      'https://connect.trezor.io/9/popup.html',
      'https://user@suite.trezor.io/web/connect-popup/',
      'http://suite.trezor.io/web/connect-popup/',
      'about:blank',
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
