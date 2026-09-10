import { EventEmitter } from 'node:events'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { closeDesktopLedger, openDesktopLedger } from './open-desktop-ledger'

const mocks = vi.hoisted(() => ({ request: vi.fn(), app: vi.fn() }))
vi.mock('@ledgerhq/hw-transport-webhid', async () => {
  const { EventEmitter } = await import('node:events')
  return {
    default: class WebHID extends EventEmitter {
      static request = mocks.request
    },
  }
})
vi.mock('@ledgerhq/hw-app-btc/lib/getAppAndVersion', () => ({ getAppAndVersion: mocks.app }))

let transport: TransportWebHID & EventEmitter
beforeEach(() => {
  vi.clearAllMocks()
  transport = Object.assign(new EventEmitter(), {
    device: { close: vi.fn(async () => undefined), removeEventListener: vi.fn() },
    onInputReport: vi.fn(),
    close: vi.fn(() => new Promise<void>(() => undefined)),
  }) as unknown as TransportWebHID & EventEmitter
  Object.setPrototypeOf(transport, TransportWebHID.prototype)
  mocks.request.mockResolvedValue(transport)
  mocks.app.mockResolvedValue({ name: 'Bitcoin' })
})
afterEach(() => vi.useRealTimers())

it('checks the active app and returns a transport with no leftover connection listeners', async () => {
  expect(await openDesktopLedger(new AbortController().signal)).toBe(transport)
  expect(transport.listenerCount('disconnect')).toBe(0)
  expect(transport.device.close).not.toHaveBeenCalled()
})

it('cancellation releases the HID handle even when the SDK operation never settles', async () => {
  mocks.app.mockImplementation(() => new Promise(() => undefined))
  const abort = new AbortController()
  const connection = openDesktopLedger(abort.signal)
  const result = expect(connection).rejects.toMatchObject({ name: 'AbortError' })
  await Promise.resolve()
  abort.abort()
  await result
  expect(transport.device.close).toHaveBeenCalledOnce()
  expect(transport.close).not.toHaveBeenCalled()
  expect(transport.device.removeEventListener).toHaveBeenCalledWith('inputreport', transport.onInputReport)
})

it('disconnecting during the app check releases the handle and reports disconnection', async () => {
  mocks.app.mockImplementation(() => new Promise(() => undefined))
  const result = expect(openDesktopLedger(new AbortController().signal)).rejects.toMatchObject({
    name: 'DisconnectedDevice',
  })
  await Promise.resolve()
  transport.emit('disconnect')
  await result
  expect(transport.device.close).toHaveBeenCalledOnce()
})

it('an unresponsive device times out instead of leaving the connection spinner running', async () => {
  vi.useFakeTimers()
  mocks.app.mockImplementation(() => new Promise(() => undefined))
  const result = expect(openDesktopLedger(new AbortController().signal)).rejects.toMatchObject({
    name: 'LedgerConnectionTimeout',
  })
  await vi.advanceTimersByTimeAsync(10_000)
  await result
  expect(transport.device.close).toHaveBeenCalledOnce()
})

it('a cancelled request does not send any command to the device', async () => {
  const abort = new AbortController()
  abort.abort()
  await expect(openDesktopLedger(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(mocks.app).not.toHaveBeenCalled()
  expect(transport.device.close).toHaveBeenCalledOnce()
})

it('retry cleanup bypasses a stuck SDK close and releases the previous USB handle', async () => {
  await closeDesktopLedger(transport)
  expect(transport.close).not.toHaveBeenCalled()
  expect(transport.device.close).toHaveBeenCalledOnce()
})
