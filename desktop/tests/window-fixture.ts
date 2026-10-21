import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { BrowserWindow, WebContents, WindowOpenHandlerResponse } from 'electron'
import { type Mock, vi } from 'vitest'
import type { ChooserDevice } from '../src/device-chooser'

interface ChooserMessage {
  name: string
  devices: ChooserDevice[]
}

interface WindowFixture {
  window: BrowserWindow
  contents: WebContents
  open: (url: string) => WindowOpenHandlerResponse
  setUrl: (url: string) => void
  send: Mock<(channel: string, message: ChooserMessage) => void>
  show: Mock<() => void>
  destroy: Mock<() => void>
  loadFile: Mock<(file: string) => Promise<void>>
  loadURL: Mock<(url: string) => Promise<void>>
  setUserAgent: Mock<(userAgent: string) => void>
}

export const electronUserAgent =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) BitcoinControlCenter/44.9.1 Chrome/152.0.7977.167 Electron/44.9.1 Safari/537.36'

export function createWindowFixture(initialUrl = 'http://localhost:49172'): WindowFixture {
  let url = initialUrl
  let destroyed = false
  let openHandler: Parameters<WebContents['setWindowOpenHandler']>[0] | undefined
  const send = vi.fn<(channel: string, message: ChooserMessage) => void>()
  const show = vi.fn<() => void>()
  const destroy = vi.fn<() => void>()
  const loadFile = vi.fn<(file: string) => Promise<void>>().mockResolvedValue(undefined)
  const loadURL = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined)
  const setUserAgent = vi.fn<(userAgent: string) => void>()
  const contents = Object.assign(new EventEmitter(), {
    mainFrame: { origin: new URL(initialUrl).origin },
    getURL: (): string => url,
    getUserAgent: (): string => electronUserAgent,
    setUserAgent(userAgent: string): void {
      setUserAgent(userAgent)
    },
    async loadURL(destination: string): Promise<void> {
      await loadURL(destination)
    },
    isDestroyed: (): boolean => destroyed,
    setWindowOpenHandler(handler: Parameters<WebContents['setWindowOpenHandler']>[0]): void {
      openHandler = handler
    },
    send(channel: string, message: ChooserMessage): void {
      send(channel, message)
    },
  })
  // SAFETY: the fixture implements the members read by the window policy and device chooser.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Native Electron supplies the remaining WebContents members.
  const webContents = contents as WebContents
  const window = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: (): boolean => destroyed,
    show(): void {
      show()
    },
    destroy(): void {
      destroyed = true
      destroy()
      window.emit('closed')
    },
    async loadFile(file: string): Promise<void> {
      await loadFile(file)
    },
  })
  // SAFETY: the fixture supplies every BrowserWindow operation used by these handlers.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The tests deliberately avoid constructing native windows in Node.
  const browserWindow = window as BrowserWindow
  return {
    window: browserWindow,
    contents: webContents,
    open: (destination) => {
      assert.ok(openHandler, 'Expected the window-open handler to be installed')
      return openHandler({
        url: destination,
        frameName: '',
        features: '',
        disposition: 'new-window',
        referrer: { url: '', policy: 'default' },
      })
    },
    setUrl: (destination) => {
      url = destination
    },
    send,
    show,
    destroy,
    loadFile,
    loadURL,
    setUserAgent,
  }
}
