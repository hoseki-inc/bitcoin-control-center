import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { type Mock, type MockInstance, expect, it, onTestFinished, vi } from 'vitest'
import { closeDesktopLedger, openDesktopLedger } from './open-desktop-ledger'

const mocks = vi.hoisted(() => ({ request: vi.fn<typeof TransportWebHID.request>(), app: vi.fn() }))
vi.spyOn(TransportWebHID, 'request').mockImplementation(mocks.request)
vi.mock(import('@ledgerhq/hw-app-btc/lib/getAppAndVersion'), () => ({ getAppAndVersion: mocks.app }))

let transport: TransportWebHID
let closeTransport: MockInstance<TransportWebHID['close']>
let closeDevice: Mock<HIDDevice['close']>
let removeDeviceListener: Mock<() => void>
async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.useRealTimers()
  })
  vi.clearAllMocks()
  closeDevice = vi.fn(async () => undefined)
  removeDeviceListener = vi.fn<() => void>()
  const device: HIDDevice = {
    opened: true,
    vendorId: 0x2c97,
    productId: 0,
    productName: 'Test Ledger',
    collections: [],
    oninputreport: null,
    addEventListener: vi.fn<() => void>(),
    removeEventListener: removeDeviceListener,
    dispatchEvent: vi.fn(() => true),
    open: vi.fn(async () => undefined),
    close: closeDevice,
    forget: vi.fn(async () => undefined),
    sendReport: vi.fn(async () => undefined),
    sendFeatureReport: vi.fn(async () => undefined),
    receiveFeatureReport: vi.fn(async () => new DataView(new ArrayBuffer(0))),
  }
  transport = new TransportWebHID(device)
  closeTransport = vi.spyOn(transport, 'close').mockImplementation(async () => new Promise<void>(() => undefined))
  mocks.request.mockResolvedValue(transport)
  mocks.app.mockResolvedValue({ name: 'Bitcoin' })

  await run()
}

it('checks the active app and returns a transport with no leftover connection listeners', async () => {
  await withTestSetup(async () => {
    await expect(openDesktopLedger(new AbortController().signal)).resolves.toBe(transport)
    expect(transport._events.listenerCount('disconnect')).toBe(0)
    expect(closeDevice).not.toHaveBeenCalled()
  })
})

it('cancellation releases the HID handle even when the SDK operation never settles', async () => {
  await withTestSetup(async () => {
    mocks.app.mockImplementation(async () => new Promise(() => undefined))
    const abort = new AbortController()
    const connection = openDesktopLedger(abort.signal)
    const result = expect(connection).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    abort.abort()
    await result
    expect(closeDevice).toHaveBeenCalledOnce()
    expect(closeTransport).not.toHaveBeenCalled()
    expect(removeDeviceListener).toHaveBeenCalledWith('inputreport', transport.onInputReport)
  })
})

it('disconnecting during the app check releases the handle and reports disconnection', async () => {
  await withTestSetup(async () => {
    mocks.app.mockImplementation(async () => new Promise(() => undefined))
    const result = expect(openDesktopLedger(new AbortController().signal)).rejects.toMatchObject({
      name: 'DisconnectedDevice',
    })
    await Promise.resolve()
    transport.emit('disconnect')
    await result
    expect(closeDevice).toHaveBeenCalledOnce()
  })
})

it('an unresponsive device times out instead of leaving the connection spinner running', async () => {
  await withTestSetup(async () => {
    vi.useFakeTimers()
    mocks.app.mockImplementation(async () => new Promise(() => undefined))
    const result = expect(openDesktopLedger(new AbortController().signal)).rejects.toMatchObject({
      name: 'LedgerConnectionTimeout',
    })
    await vi.advanceTimersByTimeAsync(10_000)
    await result
    expect(closeDevice).toHaveBeenCalledOnce()
  })
})

it('a cancelled request does not send any command to the device', async () => {
  await withTestSetup(async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(openDesktopLedger(abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.app).not.toHaveBeenCalled()
    expect(closeDevice).toHaveBeenCalledOnce()
  })
})

it('retry cleanup bypasses a stuck SDK close and releases the previous USB handle', async () => {
  await withTestSetup(async () => {
    await closeDesktopLedger(transport)
    expect(closeTransport).not.toHaveBeenCalled()
    expect(closeDevice).toHaveBeenCalledOnce()
  })
})
