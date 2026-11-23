// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { type Operation, TRPCClientError } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { ConnectCoinbase } from './coinbase/connect-coinbase'
import { ConnectKraken } from './kraken/connect-kraken'
import { ConnectRobinhood } from './robinhood/connect-robinhood'

const ReconnectInputSchema = z.object({
  replaceAccountId: z.string().optional(),
})

function hasReplaceAccountId(op: Operation): boolean {
  const parsed = parseUnknown(ReconnectInputSchema, op.input)
  return parsed.isOk() && parsed.unwrap().replaceAccountId !== undefined
}

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

function trpcConflict(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message, code: -32009, data: { code: 'CONFLICT', httpStatus: 409 } },
  })
}

function trpcBadRequest(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message, code: -32600, data: { code: 'BAD_REQUEST', httpStatus: 400 } },
  })
}

async function mountConnectForm(args: {
  element: JSX.Element
  route: string
  state?: { returnTo: string; replaceAccountId: string; displayName?: string }
  handle: (operation: Operation) => Promise<object | null>
}) {
  const dom = browser.acquire()
  Object.defineProperty(dom.window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    return args.handle(operation)
  })
  const client = new QueryClient({ logger: { log: console.log, warn: console.warn, error: () => undefined } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })

  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={[{ pathname: args.route, state: args.state }]}>
            <Routes>
              <Route path={args.route} element={args.element} />
              <Route path="/accounts" element={<p>Accounts list</p>} />
              <Route path="/accounts/coinbase/cb-a" element={<p>Coinbase A detail</p>} />
              <Route path="/accounts/*" element={<p>Account detail</p>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })

  const fill = async (element: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> => {
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const clickButton = async (label: string): Promise<void> => {
    const button = Array.from(container.querySelectorAll('button')).find((b) => b.textContent.trim() === label)
    assert(button !== undefined, `Expected button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  const hasButton = (label: string): boolean =>
    Array.from(container.querySelectorAll('button')).some((b) => b.textContent.trim() === label)

  return {
    container,
    requests,
    fill,
    clickButton,
    hasButton,
    text: () => container.textContent,
  }
}

it('Coinbase: shows Reconnected screen and navigates to returnTo on successful reconnect', async () => {
  const view = await mountConnectForm({
    element: <ConnectCoinbase />,
    route: '/accounts/verify/coinbase',
    state: { returnTo: '/accounts/coinbase/cb-a', replaceAccountId: 'cb-a' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.coinbase.connect') {
        return {
          id: 'cb-a',
          exchange: 'coinbase',
          displayName: 'Coinbase A',
          balanceSats: '150000000',
          balanceAsOf: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          connectionStatus: 'connected',
        }
      }
      return null
    },
  })

  const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
  assert.exists(apiKeyInput)
  assert.exists(secretInput)

  await view.fill(apiKeyInput, 'cb-key-a-new')
  await view.fill(secretInput, 'cb-secret-a-new')
  await view.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(view.text()).toContain('Coinbase Reconnected!')
  })
  expect(view.text()).toContain('Its balance and history are updating again.')
  expect(view.hasButton('Connect Another Account')).toBe(false)
  expect(view.hasButton('View Coinbase')).toBe(true)

  const connectCalls = view.requests.filter((r) => r.path === 'portalProve.exchanges.coinbase.connect')
  expect(connectCalls).toHaveLength(1)
  expect(connectCalls[0]?.input).toEqual({
    apiKey: 'cb-key-a-new',
    secretKey: 'cb-secret-a-new',
    replaceAccountId: 'cb-a',
  })

  await view.clickButton('View Coinbase')
  await vi.waitFor(() => {
    expect(view.text()).toContain('Coinbase A detail')
  })
})

it('Coinbase: shows mismatch message and runs normal new-connection flow when clicking "Connect as a new account instead"', async () => {
  const view = await mountConnectForm({
    element: <ConnectCoinbase />,
    route: '/accounts/verify/coinbase',
    state: { returnTo: '/accounts/coinbase/cb-a', replaceAccountId: 'cb-a' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.coinbase.connect') {
        if (hasReplaceAccountId(op)) {
          throw trpcConflict('This key belongs to a different Coinbase account.')
        }
        return {
          id: 'cb-b-new',
          exchange: 'coinbase',
          displayName: 'Coinbase B',
          balanceSats: '250000000',
          balanceAsOf: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          connectionStatus: 'connected',
        }
      }
      return null
    },
  })

  const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
  assert.exists(apiKeyInput)
  assert.exists(secretInput)

  await view.fill(apiKeyInput, 'cb-key-b')
  await view.fill(secretInput, 'cb-secret-b')
  await view.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(view.text()).toContain('This key belongs to a different Coinbase account.')
  })
  expect(view.hasButton('Connect as a new account instead')).toBe(true)

  const preservedApiKey = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const preservedSecret = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
  expect(preservedApiKey?.value).toBe('cb-key-b')
  expect(preservedSecret?.value).toBe('cb-secret-b')

  await view.clickButton('Connect as a new account instead')
  await vi.waitFor(() => {
    expect(view.text()).toContain('Coinbase Connected!')
  })
  expect(view.text()).not.toContain('Coinbase Reconnected!')
  expect(view.hasButton('Connect Another Account')).toBe(true)

  const connectCalls = view.requests.filter((r) => r.path === 'portalProve.exchanges.coinbase.connect')
  expect(connectCalls).toHaveLength(2)
  expect(connectCalls[0]?.input).toEqual({
    apiKey: 'cb-key-b',
    secretKey: 'cb-secret-b',
    replaceAccountId: 'cb-a',
  })
  expect(connectCalls[1]?.input).toEqual({
    apiKey: 'cb-key-b',
    secretKey: 'cb-secret-b',
    replaceAccountId: undefined,
  })
})

it('Coinbase: shows non-CONFLICT errors inline without the new-account action', async () => {
  const view = await mountConnectForm({
    element: <ConnectCoinbase />,
    route: '/accounts/verify/coinbase',
    state: { returnTo: '/accounts/coinbase/cb-a', replaceAccountId: 'cb-a' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.coinbase.connect') {
        throw trpcBadRequest('Invalid Coinbase credentials')
      }
      return null
    },
  })

  const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const secretInput = view.container.querySelector<HTMLTextAreaElement>('textarea[name="secretKey"]')
  assert.exists(apiKeyInput)
  assert.exists(secretInput)

  await view.fill(apiKeyInput, 'bad-key')
  await view.fill(secretInput, 'bad-secret')
  await view.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(view.text()).toContain('Invalid Coinbase credentials')
  })
  expect(view.hasButton('Connect as a new account instead')).toBe(false)
})

it('Kraken: shows mismatch message and connects as a new account when requested', async () => {
  const view = await mountConnectForm({
    element: <ConnectKraken />,
    route: '/accounts/verify/kraken',
    state: { returnTo: '/accounts/kraken/kr-a', replaceAccountId: 'kr-a' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.kraken.connect') {
        if (hasReplaceAccountId(op)) {
          throw trpcConflict('This key belongs to a different Kraken account.')
        }
        return {
          id: 'kr-b-new',
          exchange: 'kraken',
          displayName: 'Kraken',
          balanceSats: '100000000',
          balanceAsOf: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          connectionStatus: 'connected',
        }
      }
      return null
    },
  })

  const apiKeyInput = view.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const secretInput = view.container.querySelector<HTMLInputElement>('input[name="secretKey"]')
  assert.exists(apiKeyInput)
  assert.exists(secretInput)

  await view.fill(apiKeyInput, 'kr-key-b')
  await view.fill(secretInput, 'kr-secret-b')
  await view.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(view.text()).toContain('This key belongs to a different Kraken account.')
  })
  expect(view.hasButton('Connect as a new account instead')).toBe(true)

  await view.clickButton('Connect as a new account instead')
  await vi.waitFor(() => {
    expect(view.text()).toContain('Kraken Connected!')
  })

  const connectCalls = view.requests.filter((r) => r.path === 'portalProve.exchanges.kraken.connect')
  expect(connectCalls).toHaveLength(2)
  expect(connectCalls[1]?.input).toEqual({
    apiKey: 'kr-key-b',
    secretKey: 'kr-secret-b',
    replaceAccountId: undefined,
  })
})

it('Robinhood: names required permission checkboxes in guide and supports mismatch connect-as-new flow', async () => {
  const mismatchView = await mountConnectForm({
    element: <ConnectRobinhood />,
    route: '/accounts/verify/robinhood',
    state: { returnTo: '/accounts/robinhood/rh-a', replaceAccountId: 'rh-a', displayName: 'Robinhood A' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.robinhood.connect') {
        if (hasReplaceAccountId(op)) {
          throw trpcConflict('This key belongs to a different Robinhood account.')
        }
        return {
          id: 'rh-b-new',
          exchange: 'robinhood',
          displayName: 'Robinhood A',
          balanceSats: '50000000',
          balanceAsOf: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          connectionStatus: 'connected',
        }
      }
      return null
    },
  })

  expect(mismatchView.text()).toContain('Read crypto accounts')
  expect(mismatchView.text()).toContain('Read crypto holdings')
  expect(mismatchView.text()).toContain('Read crypto orders')

  const apiKeyInput = mismatchView.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const privateKeyInput = mismatchView.container.querySelector<HTMLInputElement>('input[name="privateKey"]')
  assert.exists(apiKeyInput)
  assert.exists(privateKeyInput)

  await mismatchView.fill(apiKeyInput, 'rh-key-b')
  await mismatchView.fill(privateKeyInput, 'rh-priv-b')
  await mismatchView.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(mismatchView.text()).toContain('This key belongs to a different Robinhood account.')
  })
  expect(mismatchView.hasButton('Connect as a new account instead')).toBe(true)

  await mismatchView.clickButton('Connect as a new account instead')
  await vi.waitFor(() => {
    expect(mismatchView.text()).toContain('Robinhood Connected!')
  })

  const connectCalls = mismatchView.requests.filter((r) => r.path === 'portalProve.exchanges.robinhood.connect')
  expect(connectCalls).toHaveLength(2)
  expect(connectCalls[1]?.input).toEqual({
    apiKey: 'rh-key-b',
    privateKeyBase64: 'rh-priv-b',
    displayName: 'Robinhood A',
    replaceAccountId: undefined,
  })
})

it('Robinhood: shows unverifiable refusal message inline without the new-account button', async () => {
  const unverifiableMessage =
    "We couldn't confirm which Robinhood account this key belongs to. Turn on 'Read crypto accounts' for the key (or create a new key with it on) and try again."
  const unverifiableView = await mountConnectForm({
    element: <ConnectRobinhood />,
    route: '/accounts/verify/robinhood',
    state: { returnTo: '/accounts/robinhood/rh-a', replaceAccountId: 'rh-a', displayName: 'Robinhood A' },
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.robinhood.connect') {
        throw trpcBadRequest(unverifiableMessage)
      }
      return null
    },
  })

  const apiKeyInput = unverifiableView.container.querySelector<HTMLInputElement>('input[name="apiKey"]')
  const privateKeyInput = unverifiableView.container.querySelector<HTMLInputElement>('input[name="privateKey"]')
  assert.exists(apiKeyInput)
  assert.exists(privateKeyInput)

  await unverifiableView.fill(apiKeyInput, 'rh-key-unverifiable')
  await unverifiableView.fill(privateKeyInput, 'rh-priv-unverifiable')
  await unverifiableView.clickButton('Reconnect Account')

  await vi.waitFor(() => {
    expect(unverifiableView.text()).toContain(unverifiableMessage)
  })
  expect(unverifiableView.hasButton('Connect as a new account instead')).toBe(false)
})
