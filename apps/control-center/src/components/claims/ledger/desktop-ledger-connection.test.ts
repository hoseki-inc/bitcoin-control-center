// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LedgerHidApi, LedgerHidUpdate } from '../../../../../../desktop/src/ledger-hid-api'
import { DesktopLedgerConnection } from './desktop-ledger-connection'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  app: vi.fn(),
  reset: vi.fn(),
  connected: true,
  init: vi.fn(),
}))
vi.mock('@ledgerhq/hw-transport-webhid', () => ({
  default: class WebHID {
    public static request = mocks.request
  },
}))
vi.mock('@ledgerhq/hw-app-btc/lib/getAppAndVersion', () => ({ getAppAndVersion: mocks.app }))
vi.mock('../../../hooks/use-ledger-store', () => ({
  useLedgerStore: (select: (value: unknown) => unknown) =>
    select({
      init: mocks.init,
      reset: mocks.reset,
      isConnected: mocks.connected,
      deviceModel: { productName: 'Ledger Flex' },
    }),
}))
vi.mock('@hoseki/packages/ui/wallet-ui', () => ({
  WalletAnimation: () => null,
  WizardFooter: ({ leftButton, rightButton }: { leftButton: React.ReactNode; rightButton: React.ReactNode }) =>
    createElement('footer', null, leftButton, rightButton),
}))

let root: Root
let host: HTMLDivElement
let listener: (update: LedgerHidUpdate) => void
let bridge: LedgerHidApi
let queryClient: QueryClient
let resolveRequest: (value: typeof transport) => void
let rejectRequest: (error: Error) => void
let requestId: string
const transport = {
  close: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  onInputReport: vi.fn(),
  device: { close: vi.fn(), removeEventListener: vi.fn() },
}
const onContinue = vi.fn()

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  Object.setPrototypeOf(transport, TransportWebHID.prototype)
  transport.close.mockResolvedValue(undefined)
  transport.device.close.mockResolvedValue(undefined)
  mocks.connected = true
  mocks.reset.mockResolvedValue(undefined)
  mocks.app.mockResolvedValue({ name: 'Bitcoin' })
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        resolveRequest = resolve
        rejectRequest = reject
      }),
  )
  mocks.init.mockImplementation(async (open: () => Promise<unknown>) => {
    await open()
  })
  bridge = {
    begin: vi.fn(async (id: string) => {
      requestId = id
      return true
    }),
    choose: vi.fn(async () => true),
    cancel: vi.fn(() => {
      rejectRequest?.(new Error('Cancelled'))
    }),
    end: vi.fn(),
    subscribe: vi.fn((callback) => {
      listener = callback
      return vi.fn()
    }),
  }
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await render()
})
afterEach(async () => {
  await act(async () => {
    root.unmount()
  })
  queryClient.clear()
  host.remove()
})
async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DesktopLedgerConnection, { bridge, onContinue, onBack: vi.fn() }),
        ),
      ),
    )
  })
}
function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label)
  if (!found) {
    throw new Error(`Button not found: ${label}`)
  }
  return found
}
async function click(label: string): Promise<void> {
  await act(async () => {
    button(label).click()
  })
}
async function update(status: LedgerHidUpdate['status'], devices: LedgerHidUpdate['devices'] = []): Promise<void> {
  await act(async () => {
    listener({ requestId, status, devices })
  })
}

it('starts only on Connect and clears cached accounts from earlier connections', async () => {
  queryClient.setQueryData(['ledger-wallets', 1], [{ displayName: 'Previous Ledger account' }])
  expect(bridge.begin).not.toHaveBeenCalled()
  await click('Connect Ledger')
  expect(bridge.begin).toHaveBeenCalledOnce()
  expect(mocks.reset).toHaveBeenCalledOnce()
  expect(queryClient.getQueryData(['ledger-wallets', 1])).toBeUndefined()
  expect(host.textContent).toContain('Looking for your Ledger')
})

it('shows missing devices inline and cancellation returns to a quiet, retryable screen', async () => {
  await click('Connect Ledger')
  await update('choosing')
  expect(host.textContent).toContain('No Ledger detected')
  expect(host.textContent).not.toContain('Access denied')
  await click('Cancel')
  expect(host.querySelector('[role="alert"]')).toBeNull()
  expect(button('Connect Ledger').disabled).toBe(false)
  await click('Connect Ledger')
  expect(bridge.begin).toHaveBeenCalledTimes(2)
})

it('requires a choice for multiple Ledgers and forgets a removed selection', async () => {
  await click('Connect Ledger')
  const devices = [
    { id: 'one', name: 'Ledger Flex' },
    { id: 'two', name: 'Ledger Nano X' },
  ]
  await update('choosing', devices)
  expect(button('Connect selected Ledger').disabled).toBe(true)
  await act(async () => {
    ;(host.querySelector('input[value="two"]') as HTMLInputElement).click()
  })
  await click('Connect selected Ledger')
  expect(bridge.choose).toHaveBeenCalledWith(requestId, 'two')
  await update('choosing', [])
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  expect(host.textContent).toContain('No Ledger detected')
})

it('does not ask users to distinguish identical device labels', async () => {
  await click('Connect Ledger')
  await update('choosing', [
    { id: 'one', name: 'Ledger Flex' },
    { id: 'two', name: 'Ledger Flex' },
  ])
  expect(host.textContent).toContain('Unplug the Ledger you don’t want')
  expect(Array.from(host.querySelectorAll('input')).every((input) => input.disabled)).toBe(true)
  await update('choosing', [{ id: 'one', name: 'Ledger Flex' }])
  expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
  expect(button('Connect selected Ledger').disabled).toBe(false)
})

it('checks the Bitcoin app before continuing and handles a locked device with an inline retry', async () => {
  mocks.app.mockRejectedValueOnce({ name: 'LockedDeviceError' })
  await click('Connect Ledger')
  await act(async () => {
    resolveRequest(transport)
  })
  expect(host.textContent).toContain('Unlock your Ledger')
  expect(transport.device.close).toHaveBeenCalled()
  expect(onContinue).not.toHaveBeenCalled()
  await click('Try again')
  await act(async () => {
    resolveRequest(transport)
  })
  expect(host.textContent).toContain('Ledger Flex is connected')
  expect(onContinue).not.toHaveBeenCalled()
  await click('Continue')
  expect(onContinue).toHaveBeenCalledOnce()
})

it('asks for the Bitcoin app when a different app is open', async () => {
  mocks.app.mockResolvedValueOnce({ name: 'BOLOS' })
  await click('Connect Ledger')
  await act(async () => {
    resolveRequest(transport)
  })
  expect(host.textContent).toContain('Open the Bitcoin app')
  expect(transport.device.close).toHaveBeenCalled()
})

it('does not replace timeout guidance with a generic transport error', async () => {
  await click('Connect Ledger')
  await update('expired')
  await act(async () => {
    rejectRequest(new Error('Access denied'))
  })
  expect(host.textContent).toContain('Connection timed out')
  expect(host.textContent).not.toContain('Access denied')
})

it('ignores old request updates after cancellation and retry', async () => {
  await click('Connect Ledger')
  const oldId = requestId
  await click('Cancel')
  await click('Connect Ledger')
  await act(async () => {
    listener({ requestId: oldId, status: 'choosing', devices: [] })
  })
  expect(host.textContent).not.toContain('No Ledger detected')
})

it('requires reconnecting when a ready Ledger is unplugged', async () => {
  await click('Connect Ledger')
  await act(async () => {
    resolveRequest(transport)
  })
  mocks.connected = false
  await render()
  expect(host.textContent).toContain('Your Ledger was disconnected')
  expect(host.querySelector('button')?.textContent).not.toBe('Continue')
})

it('releases a reservation cancelled before requestDevice was called', async () => {
  let accept = (_value: boolean): void => {}
  vi.mocked(bridge.begin).mockImplementationOnce(
    (id) =>
      new Promise((resolve) => {
        requestId = id
        accept = resolve
      }),
  )
  await click('Connect Ledger')
  await click('Cancel')
  expect(mocks.request).not.toHaveBeenCalled()
  expect(bridge.end).not.toHaveBeenCalled()
  await act(async () => {
    accept(true)
  })
  expect(bridge.end).toHaveBeenCalledWith(requestId)
  expect(mocks.request).not.toHaveBeenCalled()
  expect(button('Connect Ledger').disabled).toBe(false)
  await click('Connect Ledger')
  expect(mocks.request).toHaveBeenCalledOnce()
})

it('keeps a cancelled reservation until the late browser request settles', async () => {
  vi.mocked(bridge.cancel).mockImplementation(() => undefined)
  await click('Connect Ledger')
  await click('Cancel')
  expect(host.textContent).toContain('Cancelling connection')
  expect(bridge.end).not.toHaveBeenCalled()
  expect(button('Connect Ledger').disabled).toBe(true)
  await act(async () => {
    rejectRequest(new Error('Cancelled by the main process'))
  })
  expect(bridge.end).toHaveBeenCalledWith(requestId)
  expect(button('Connect Ledger').disabled).toBe(false)
  expect(host.querySelector('[role="alert"]')).toBeNull()
})

it('cancels scans before closing the previous USB connection', async () => {
  const order: string[] = []
  vi.spyOn(queryClient, 'cancelQueries').mockImplementation(async () => {
    order.push('cancel')
  })
  mocks.reset.mockImplementation(async () => {
    order.push('reset')
  })
  await click('Connect Ledger')
  expect(order).toEqual(['cancel', 'reset'])
})
