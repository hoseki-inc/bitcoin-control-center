// @vitest-environment node
import Transport from '@ledgerhq/hw-transport'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { toast } from 'sonner'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closeDesktopLedger } from '../lib/open-desktop-ledger'
import { useLedgerStore, useToastOnLedgerDisconnect } from './use-ledger-store'

await vi.hoisted(async () => {
  // Keep Node's byte-array globals for the Bitcoin SDK while rendering the hook in a DOM.
  const { JSDOM } = await import('jsdom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', window.navigator)
})

vi.mock('@ledgerhq/hw-app-btc', () => ({ default: class LedgerBtcApp {} }))
vi.mock('@hoseki/packages/ui/wallet-ui', async () => ({
  createLedgerStore: (await import('@hoseki/packages/ui/wallet-ui/ledger/device-store')).createLedgerStore,
}))
vi.mock('../logger', () => ({ browserLogger: { debug: vi.fn(), error: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

let root: Root
let host: HTMLDivElement

function DisconnectNotifications(): null {
  useToastOnLedgerDisconnect()
  return null
}

function fakeTransport() {
  return Object.assign(new Transport(), {
    close: vi.fn<Transport['close']>(async () => undefined),
    deviceModel: { productName: 'Ledger Flex', id: 'flex' },
  })
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(DisconnectNotifications))
  })
})

afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  await useLedgerStore.getState().reset()
  host.remove()
})

it.each([
  { name: 'desktop', close: closeDesktopLedger },
  { name: 'browser', close: undefined },
])('does not show a disconnect error when reconnecting after leaving the $name flow', async ({ close }) => {
  const previous = fakeTransport()
  await useLedgerStore.getState().init(async () => previous)

  // Cancel/back leaves a valid transport in the store; returning mounts the listener again.
  await act(async () => {
    root.render(null)
  })
  await act(async () => {
    root.render(createElement(DisconnectNotifications))
  })
  await useLedgerStore.getState().reset(close)
  await useLedgerStore.getState().init(async () => fakeTransport())

  expect(previous.close).toHaveBeenCalledOnce()
  expect(useLedgerStore.getState().isConnected).toBe(true)
  expect(toast.error).not.toHaveBeenCalled()
})

it('still warns once for a real disconnect after reconnecting and ignores the old device', async () => {
  const previous = fakeTransport()
  const current = fakeTransport()
  await useLedgerStore.getState().init(async () => previous)
  await useLedgerStore.getState().reset(closeDesktopLedger)
  await useLedgerStore.getState().init(async () => current)

  previous.emit('disconnect')
  expect(toast.error).not.toHaveBeenCalled()
  current.emit('disconnect')
  current.emit('disconnect')
  expect(toast.error).toHaveBeenCalledOnce()
  expect(toast.error).toHaveBeenCalledWith('Ledger device disconnected', expect.any(Object))
  expect(useLedgerStore.getState().isConnected).toBe(false)
})

it('removes the disconnect notification listener when leaving the flow', async () => {
  const transport = fakeTransport()
  await useLedgerStore.getState().init(async () => transport)
  await act(async () => {
    root.render(null)
  })
  transport.emit('disconnect')
  expect(toast.error).not.toHaveBeenCalled()
})
