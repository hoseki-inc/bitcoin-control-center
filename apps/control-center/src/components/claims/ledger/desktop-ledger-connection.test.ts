// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { createLedgerStore } from '@hoseki/packages/ui/wallet-ui/ledger/device-store'
import Transport from '@ledgerhq/hw-transport'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import pino from 'pino'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { LedgerHidApi, LedgerHidUpdate } from '../../../../../../desktop/src/ledger-hid-api'
import { openDesktopLedger } from '../../../lib/open-desktop-ledger'
import { DesktopLedgerConnection } from './desktop-ledger-connection'

const browser = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  let initialDom: ReturnType<typeof createBrowserDom> | undefined = createBrowserDom()
  installBrowserDom(initialDom)
  return {
    acquire: () => {
      const dom = initialDom ?? createBrowserDom()
      initialDom = undefined
      installBrowserDom(dom)
      return dom
    },
  }
})

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  app: vi.fn(),
  reset: vi.fn(),
  connected: true,
  init: vi.fn(),
}))
const ledgerStore = createLedgerStore(pino({ level: 'silent' }))
const adapter = { request: mocks.request, getAppAndVersion: mocks.app }
const openTransport = async (signal: AbortSignal): Promise<TransportWebHID> => openDesktopLedger(signal, adapter)

let root: Root
let host: HTMLDivElement
let listener: (update: LedgerHidUpdate) => void
let bridge: LedgerHidApi
let queryClient: QueryClient
let resolveRequest: (value: typeof transport) => void
let rejectRequest: ((error: Error) => void) | undefined
let requestId: string
const transport = {
  close: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  onInputReport: vi.fn(),
  device: { close: vi.fn(), removeEventListener: vi.fn() },
}
const onContinue = vi.fn<() => void>()

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  const lifecycle = { finished: false }
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    lifecycle.finished = true

    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    host.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.clearAllMocks()
  rejectRequest = undefined
  Object.setPrototypeOf(transport, TransportWebHID.prototype)
  transport.close.mockResolvedValue(undefined)
  transport.device.close.mockResolvedValue(undefined)
  ledgerStore.setState(ledgerStore.getInitialState(), true)
  await ledgerStore.getState().init(async () => new Transport())
  ledgerStore.setState({
    init: mocks.init,
    reset: mocks.reset,
    deviceModel: { productName: 'Ledger Flex', id: 'flex' },
  })
  mocks.reset.mockResolvedValue(undefined)
  mocks.app.mockResolvedValue({ name: 'Bitcoin' })
  mocks.request.mockImplementation(
    async () =>
      new Promise((resolve, reject) => {
        resolveRequest = resolve
        rejectRequest = reject
      }),
  )
  mocks.init.mockImplementation(async (open: () => Promise<TransportWebHID>) => {
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
    end: vi.fn<() => void>(),
    subscribe: vi.fn<LedgerHidApi['subscribe']>((callback) => {
      listener = callback
      return vi.fn<() => void>()
    }),
  }
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await render()
  if (lifecycle.finished) {
    return
  }

  await run()
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(DesktopLedgerConnection, {
            bridge,
            ledgerStore,
            openTransport,
            onContinue,
            onBack: vi.fn<() => void>(),
          }),
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
  await withTestSetup(async () => {
    queryClient.setQueryData(['ledger-wallets', 1], [{ displayName: 'Previous Ledger account' }])
    expect(bridge.begin).not.toHaveBeenCalled()
    await click('Connect Ledger')
    expect(bridge.begin).toHaveBeenCalledOnce()
    expect(mocks.reset).toHaveBeenCalledOnce()
    expect(queryClient.getQueryData(['ledger-wallets', 1])).toBeUndefined()
    expect(host.textContent).toContain('Looking for your Ledger')
  })
})

it('shows missing devices inline and cancellation returns to a quiet, retryable screen', async () => {
  await withTestSetup(async () => {
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
})

it('requires a choice for multiple Ledgers and forgets a removed selection', async () => {
  await withTestSetup(async () => {
    await click('Connect Ledger')
    const devices = [
      { id: 'one', name: 'Ledger Flex' },
      { id: 'two', name: 'Ledger Nano X' },
    ]
    await update('choosing', devices)
    expect(button('Connect selected Ledger').disabled).toBe(true)
    await act(async () => {
      const input = host.querySelector('input[value="two"]')
      assert(input instanceof HTMLInputElement, 'Expected a Ledger radio input')
      input.click()
    })
    await click('Connect selected Ledger')
    expect(bridge.choose).toHaveBeenCalledWith(requestId, 'two')
    await update('choosing', [])
    expect(host.querySelectorAll('input[type="radio"]')).toHaveLength(0)
    expect(host.textContent).toContain('No Ledger detected')
  })
})

it('does not ask users to distinguish identical device labels', async () => {
  await withTestSetup(async () => {
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
})

it('checks the Bitcoin app before continuing and handles a locked device with an inline retry', async () => {
  await withTestSetup(async () => {
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
})

it('asks for the Bitcoin app when a different app is open', async () => {
  await withTestSetup(async () => {
    mocks.app.mockResolvedValueOnce({ name: 'BOLOS' })
    await click('Connect Ledger')
    await act(async () => {
      resolveRequest(transport)
    })
    expect(host.textContent).toContain('Open the Bitcoin app')
    expect(transport.device.close).toHaveBeenCalled()
  })
})

it('does not replace timeout guidance with a generic transport error', async () => {
  await withTestSetup(async () => {
    await click('Connect Ledger')
    await update('expired')
    await act(async () => {
      assert.exists(rejectRequest, 'Expected an active Ledger request')
      rejectRequest(new Error('Access denied'))
    })
    expect(host.textContent).toContain('Connection timed out')
    expect(host.textContent).not.toContain('Access denied')
  })
})

it('ignores old request updates after cancellation and retry', async () => {
  await withTestSetup(async () => {
    await click('Connect Ledger')
    const oldId = requestId
    await click('Cancel')
    await click('Connect Ledger')
    await act(async () => {
      listener({ requestId: oldId, status: 'choosing', devices: [] })
    })
    expect(host.textContent).not.toContain('No Ledger detected')
  })
})

it('requires reconnecting when a ready Ledger is unplugged', async () => {
  await withTestSetup(async () => {
    await click('Connect Ledger')
    await act(async () => {
      resolveRequest(transport)
    })
    await act(async () => {
      ledgerStore.setState({ isConnected: false })
    })
    await render()
    expect(host.textContent).toContain('Your Ledger was disconnected')
    expect(host.querySelector('button')?.textContent).not.toBe('Continue')
  })
})

it('releases a reservation cancelled before requestDevice was called', async () => {
  await withTestSetup(async () => {
    let accept = (_value: boolean): void => {}
    vi.mocked(bridge.begin).mockImplementationOnce(
      async (id) =>
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
})

it('keeps a cancelled reservation until the late browser request settles', async () => {
  await withTestSetup(async () => {
    vi.mocked(bridge.cancel).mockImplementation(() => undefined)
    await click('Connect Ledger')
    await click('Cancel')
    expect(host.textContent).toContain('Cancelling connection')
    expect(bridge.end).not.toHaveBeenCalled()
    expect(button('Connect Ledger').disabled).toBe(true)
    await act(async () => {
      assert.exists(rejectRequest, 'Expected an active Ledger request')
      rejectRequest(new Error('Cancelled by the main process'))
    })
    expect(bridge.end).toHaveBeenCalledWith(requestId)
    expect(button('Connect Ledger').disabled).toBe(false)
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })
})

it('cancels scans before closing the previous USB connection', async () => {
  await withTestSetup(async () => {
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
})
