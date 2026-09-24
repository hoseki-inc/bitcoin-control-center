import Transport from '@ledgerhq/hw-transport'
import pino from 'pino'
import { expect, it, vi } from 'vitest'
import { createLedgerStore } from './device-store'

vi.mock('@ledgerhq/hw-app-btc', () => ({ default: class LedgerBtcApp {} }))

function fakeTransport() {
  return Object.assign(new Transport(), {
    close: vi.fn<Transport['close']>(async () => undefined),
    deviceModel: { productName: 'Ledger Flex', id: 'flex' },
  })
}

it('assigns a new scan identity when reconnecting even to an identical Ledger model', async () => {
  const store = createLedgerStore(pino({ level: 'silent' }))
  await store.getState().init(async () => fakeTransport())
  const firstConnection = store.getState().connectionId
  await store.getState().reset()
  await store.getState().init(async () => fakeTransport())
  expect(store.getState().connectionId).not.toBe(firstConnection)
  expect(store.getState().deviceModel?.productName).toBe('Ledger Flex')
})

it('a connection cancelled while opening cannot initialize the store', async () => {
  const store = createLedgerStore(pino({ level: 'silent' }))
  const abort = new AbortController()
  const transport = fakeTransport()
  await expect(
    store.getState().init(async () => {
      abort.abort()
      return transport
    }, abort.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(transport.close).toHaveBeenCalledOnce()
  expect(store.getState().isInitialized).toBe(false)
})

it('reset waits for the previous USB handle to close before a retry can proceed', async () => {
  const store = createLedgerStore(pino({ level: 'silent' }))
  const transport = fakeTransport()
  let finishClose!: () => void
  transport.close.mockImplementation(
    async () =>
      new Promise((resolve) => {
        finishClose = resolve
      }),
  )
  await store.getState().init(async () => transport)
  let finished = false
  const reset = store
    .getState()
    .reset(async (device) => device.close())
    .then(() => {
      finished = true
    })
  await Promise.resolve()
  expect(finished).toBe(false)
  expect(store.getState().isInitialized).toBe(false)
  finishClose()
  await reset
  expect(finished).toBe(true)
})
