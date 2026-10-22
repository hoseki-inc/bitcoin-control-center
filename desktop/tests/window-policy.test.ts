import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { chromeUserAgent, setupWindowPolicy } from '../src/window-policy'
import { createWindowFixture, electronUserAgent } from './window-fixture'

const origin = 'http://localhost:49172'
const popupUrl = 'https://suite.trezor.io/web/connect-popup/?connect-popup-req=abc123'
const bootstrapUrl = 'https://suite.trezor.io/web/connect-popup/bootstrap.html?connect-popup-req=abc123'
const chromeAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.167 Safari/537.36'
const externalUrl = 'https://example.com/help'

function createHarness() {
  const main = createWindowFixture(origin)
  const popup = createWindowFixture(popupUrl)
  const registered = new Set<WebContents>()
  const openExternal = vi.fn<(url: string) => void>()
  setupWindowPolicy(main.window, origin, registered, openExternal)
  return { main, popup, registered, openExternal }
}

describe('installed window handlers', () => {
  it.each(['about:blank', bootstrapUrl])('opens the Suite Web window as an isolated, parented popup: %s', (url) => {
    const { main, openExternal } = createHarness()
    expect(main.open(url)).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: main.window,
        width: 480,
        height: 720,
        autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      },
    })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('refuses an SDK popup when the opener is no longer the local app', () => {
    const { main, openExternal } = createHarness()
    main.setUrl('https://untrusted.example')
    expect(main.open(popupUrl)).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(popupUrl)
  })

  it.each([
    externalUrl,
    'mailto:support@example.com',
    'https://connect.trezor.io/9/popup.html',
    'https://suite.trezor.io/web/',
    'https://suite.trezor.io.evil.example/web/connect-popup/',
  ])('opens ordinary links externally instead of creating an app window: %s', (url) => {
    const { main, openExternal } = createHarness()
    expect(main.open(url)).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(url)
  })

  it.each(['file:///tmp/test', 'javascript:alert(1)', 'trezorsuite://test', 'https://user@example.com', 'invalid'])(
    'never forwards an unsafe destination to the operating system: %s',
    (url) => {
      const { main, openExternal } = createHarness()
      expect(main.open(url)).toEqual({ action: 'deny' })
      expect(openExternal).not.toHaveBeenCalled()
    },
  )

  it('registers the created popup, denies nested windows, and unregisters it on close', () => {
    const { main, popup, registered, openExternal } = createHarness()
    main.contents.emit('did-create-window', popup.window)
    expect(registered.has(popup.contents)).toBe(true)
    expect(popup.setUserAgent).toHaveBeenCalledExactlyOnceWith(chromeAgent)
    expect(popup.open(popupUrl)).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith(popupUrl)
    expect(popup.open('file:///tmp/test')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledTimes(1)
    popup.window.emit('closed')
    expect(registered.has(popup.contents)).toBe(false)
  })

  it.each([
    ['main', 'will-navigate', `${origin}/settings`],
    ['main', 'will-redirect', `${origin}/accounts`],
    ['popup', 'will-navigate', popupUrl],
    ['popup', 'will-redirect', popupUrl],
  ] as const)('permits the intended destination for %s %s', (target, eventName, url) => {
    const harness = createHarness()
    harness.main.contents.emit('did-create-window', harness.popup.window)
    const event = { preventDefault: vi.fn<() => void>() }
    harness[target].contents.emit(eventName, event, url)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(harness.openExternal).not.toHaveBeenCalled()
  })

  it.each([
    ['main', 'will-navigate', externalUrl, [[externalUrl]]],
    ['main', 'will-redirect', externalUrl, []],
    ['popup', 'will-navigate', externalUrl, [[externalUrl]]],
    ['popup', 'will-redirect', externalUrl, []],
    ['main', 'will-navigate', 'file:///tmp/test', []],
    ['main', 'will-redirect', 'file:///tmp/test', []],
    ['popup', 'will-navigate', 'file:///tmp/test', []],
    ['popup', 'will-redirect', 'file:///tmp/test', []],
  ] as const)('blocks unauthorized navigation for %s %s to %s', (target, eventName, url, forwarded) => {
    const harness = createHarness()
    harness.main.contents.emit('did-create-window', harness.popup.window)
    const event = { preventDefault: vi.fn<() => void>() }
    harness[target].contents.emit(eventName, event, url)
    expect(event.preventDefault).toHaveBeenCalledExactlyOnceWith()
    expect(harness.openExternal.mock.calls).toEqual(forwarded)
  })
})

describe('Suite Web window', () => {
  it('loads Suite Web from the main process when the blank window is first sent there', () => {
    const { main, openExternal } = createHarness()
    const blank = createWindowFixture('about:blank')
    main.contents.emit('did-create-window', blank.window)
    const first = { preventDefault: vi.fn<() => void>() }
    blank.contents.emit('will-navigate', first, bootstrapUrl)
    expect(first.preventDefault).toHaveBeenCalledExactlyOnceWith()
    expect(blank.loadURL).toHaveBeenCalledExactlyOnceWith(bootstrapUrl)

    blank.setUrl(bootstrapUrl)
    const next = { preventDefault: vi.fn<() => void>() }
    blank.contents.emit('will-navigate', next, popupUrl)
    expect(next.preventDefault).not.toHaveBeenCalled()
    expect(blank.loadURL).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('reports the plain Chrome user agent', () => {
    expect(chromeUserAgent(electronUserAgent)).toBe(chromeAgent)
    expect(
      chromeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Bitcoin Control Center/1.0.0 Chrome/152.0.7977.167 Electron/44.9.1 Safari/537.36',
      ),
    ).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.167 Safari/537.36',
    )
    expect(chromeUserAgent(chromeAgent)).toBe(chromeAgent)
  })
})
