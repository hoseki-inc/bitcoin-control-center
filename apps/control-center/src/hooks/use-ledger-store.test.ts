// @vitest-environment node
import type { PartialModuleMock } from '@hoseki/packages/testing/partial-module-mock'
import type * as LedgerBtcModule from '@ledgerhq/hw-app-btc'
import Transport from '@ledgerhq/hw-transport'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import type * as Sonner from 'sonner'
import { toast } from 'sonner'
import { expect, it, onTestFinished, vi } from 'vitest'
import { closeDesktopLedger } from '../lib/open-desktop-ledger'
import type * as LoggerModule from '../logger'
import { useLedgerStore, useToastOnLedgerDisconnect } from './use-ledger-store'

await vi.hoisted(async () => {
  // Keep Node's byte-array globals for the Bitcoin SDK while rendering the hook in a DOM.
  const { JSDOM } = await import('jsdom')
  const { window } = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', window.document)
  vi.stubGlobal('navigator', window.navigator)
})

vi.mock<PartialModuleMock<typeof LedgerBtcModule>>(import('@ledgerhq/hw-app-btc'), () => ({
  default: class LedgerBtcApp {},
}))
vi.mock(import('@hoseki/packages/ui/wallet-ui'), async () => ({
  createLedgerStore: (await import('@hoseki/packages/ui/wallet-ui/ledger/device-store')).createLedgerStore,
}))
vi.mock<PartialModuleMock<typeof LoggerModule>>(import('../logger'), () => ({
  browserLogger: { debug: vi.fn<() => void>(), error: vi.fn<() => void>() },
}))
vi.mock<PartialModuleMock<typeof Sonner>>(import('sonner'), () => ({
  toast: Object.assign(vi.fn<typeof Sonner.toast>(), { error: vi.fn() }),
}))

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

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const lifecycle = { finished: false }
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    lifecycle.finished = true

    await act(async () => {
      root.unmount()
    })
    await useLedgerStore.getState().reset()
    host.remove()
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root.render(createElement(DisconnectNotifications))
  })
  if (lifecycle.finished) {
    return
  }

  await run()
}

it.each([
  { name: 'desktop', close: closeDesktopLedger },
  { name: 'browser', close: undefined },
])('does not show a disconnect error when reconnecting after leaving the $name flow', async ({ close }) => {
  await withTestSetup(async () => {
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
})

it('still warns once for a real disconnect after reconnecting and ignores the old device', async () => {
  await withTestSetup(async () => {
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
})

it('removes the disconnect notification listener when leaving the flow', async () => {
  await withTestSetup(async () => {
    const transport = fakeTransport()
    await useLedgerStore.getState().init(async () => transport)
    await act(async () => {
      root.render(null)
    })
    transport.emit('disconnect')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
