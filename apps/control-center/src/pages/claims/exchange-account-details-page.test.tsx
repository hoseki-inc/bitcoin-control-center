// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { type Operation, TRPCClientError } from '@trpc/client'
import { MotionGlobalConfig } from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { INITIAL_GATE, useGate } from '../../pin/gate'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { CoinbaseAccountDetailsPage } from './coinbase/[id]'
import { StrikeAccountDetailsPage } from './strike/[id]'

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

function ReconnectTargetProbe(): JSX.Element {
  const location = useLocation()
  return (
    <div data-testid="reconnect-target">
      {location.pathname}:{JSON.stringify(location.state)}
    </div>
  )
}

function trpcPreconditionFailed(message: string): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message, code: -32012, data: { code: 'PRECONDITION_FAILED', httpStatus: 412 } },
  })
}

async function mountDetailsPage(args: {
  initialPath: string
  routePattern: string
  element: JSX.Element
  verifyPath: string
  handle: (operation: Operation) => Promise<object | null>
}) {
  const dom = browser.acquire()
  MotionGlobalConfig.skipAnimations = true
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
  useGate.setState({ ...INITIAL_GATE, phase: 'open' }, true)

  const toastErrorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '')
  const rpc = createTestTrpcClient(args.handle)
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
    useGate.setState(INITIAL_GATE, true)
    MotionGlobalConfig.skipAnimations = false
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })

  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={[args.initialPath]}>
            <Routes>
              <Route path={args.routePattern} element={args.element} />
              <Route path={args.verifyPath} element={<ReconnectTargetProbe />} />
              <Route path="/accounts" element={<div data-testid="accounts-list">Accounts</div>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })

  const clickButton = async (label: string): Promise<void> => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
    assert(button !== undefined, `Expected button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  const dialog = (): Element | null => document.body.querySelector('[role="dialog"]')

  const clickDialogButton = async (label: string): Promise<void> => {
    const activeDialog = dialog()
    assert(activeDialog !== null, 'Expected confirmation dialog to be open')
    const button = [...activeDialog.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
    assert(button !== undefined, `Expected dialog button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  return {
    container,
    toastErrorSpy,
    clickButton,
    dialog,
    clickDialogButton,
    text: () => container.textContent,
  }
}

it('Coinbase: live Refresh Balance revocation transitions to Expired + Reconnect without locking the PIN gate', async () => {
  let connectionStatus: 'connected' | 'needs_reconnect' = 'connected'

  const view = await mountDetailsPage({
    initialPath: '/accounts/coinbase/cb-1',
    routePattern: '/accounts/coinbase/:accountId',
    element: <CoinbaseAccountDetailsPage />,
    verifyPath: '/accounts/verify/coinbase',
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.coinbase.list') {
        return [
          {
            id: 'cb-1',
            exchange: 'coinbase',
            displayName: 'Personal BTC Wallet',
            currency: 'BTC',
            balance: connectionStatus === 'connected' ? '50000000' : null,
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus,
          },
        ]
      }
      if (op.path === 'portalProve.exchanges.refreshBalance') {
        connectionStatus = 'needs_reconnect'
        throw trpcPreconditionFailed('Your Coinbase API key was rejected. Reconnect your account.')
      }
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.text()).toContain('Personal BTC Wallet')
    expect(view.text()).toContain('Refresh Balance')
  })
  expect(view.text()).toContain('Connected')

  await view.clickButton('Refresh Balance')

  await vi.waitFor(() => {
    expect(view.text()).toContain('Expired')
    expect(view.text()).toContain('Reconnect Account')
  })
  expect(view.text()).not.toContain('Refresh Balance')
  expect(view.toastErrorSpy).toHaveBeenCalledWith('Your Coinbase API key was rejected. Reconnect your account.')
  expect(useGate.getState()).toMatchObject({ epoch: 0, phase: 'open' })

  await view.clickButton('Reconnect Account')
  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="reconnect-target"]')?.textContent).toBe(
      '/accounts/verify/coinbase:{"returnTo":"/accounts/coinbase/cb-1","replaceAccountId":"cb-1"}',
    )
  })
})

it('Strike: live Refresh Balance revocation transitions to Expired + Reconnect while preserving Account Statements', async () => {
  let connectionStatus: 'connected' | 'needs_reconnect' = 'connected'

  const view = await mountDetailsPage({
    initialPath: '/accounts/strike/st-1',
    routePattern: '/accounts/strike/:accountId',
    element: <StrikeAccountDetailsPage />,
    verifyPath: '/accounts/verify/strike',
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.strike.list') {
        return [
          {
            id: 'st-1',
            exchange: 'strike',
            displayName: 'My Strike',
            currency: 'BTC',
            balance: connectionStatus === 'connected' ? '25000000' : null,
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus,
          },
        ]
      }
      if (op.path === 'portalProve.exchanges.strike.listStatementMonths') {
        return ['2026-01']
      }
      if (op.path === 'portalProve.exchanges.refreshBalance') {
        connectionStatus = 'needs_reconnect'
        throw trpcPreconditionFailed('Your Strike API key was rejected. Reconnect your account.')
      }
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.text()).toContain('My Strike')
    expect(view.text()).toContain('Refresh Balance')
    expect(view.text()).toContain('Account Statements')
  })

  await view.clickButton('Refresh Balance')

  await vi.waitFor(() => {
    expect(view.text()).toContain('Expired')
    expect(view.text()).toContain('Reconnect Account')
  })
  expect(view.text()).not.toContain('Refresh Balance')
  expect(view.text()).toContain('Account Statements')
  expect(view.toastErrorSpy).toHaveBeenCalledWith('Your Strike API key was rejected. Reconnect your account.')
  expect(useGate.getState()).toMatchObject({ epoch: 0, phase: 'open' })

  await view.clickButton('Reconnect Account')
  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="reconnect-target"]')?.textContent).toBe(
      '/accounts/verify/strike:{"returnTo":"/accounts/strike/st-1","replaceAccountId":"st-1","displayName":"My Strike"}',
    )
  })
})

it('Coinbase: Remove Account confirms first — Cancel keeps the account, Remove deletes it', async () => {
  const deleteCalls: unknown[] = []

  const view = await mountDetailsPage({
    initialPath: '/accounts/coinbase/cb-1',
    routePattern: '/accounts/coinbase/:accountId',
    element: <CoinbaseAccountDetailsPage />,
    verifyPath: '/accounts/verify/coinbase',
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.coinbase.list') {
        return [
          {
            id: 'cb-1',
            exchange: 'coinbase',
            displayName: 'Personal BTC Wallet',
            currency: 'BTC',
            balance: '50000000',
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus: 'connected',
          },
        ]
      }
      if (op.path === 'portalProve.exchanges.delete') {
        deleteCalls.push(op.input)
        return null
      }
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.text()).toContain('Personal BTC Wallet')
  })

  await view.clickButton('Remove Account')
  expect(deleteCalls).toEqual([])
  expect(view.dialog()?.textContent).toContain('Remove Personal BTC Wallet?')
  expect(view.dialog()?.textContent).toContain('Coinbase account')

  await view.clickDialogButton('Cancel')
  await vi.waitFor(() => {
    expect(view.dialog()).toBeNull()
  })
  expect(deleteCalls).toEqual([])
  expect(view.text()).toContain('Personal BTC Wallet')

  await view.clickButton('Remove Account')
  await view.clickDialogButton('Remove')

  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="accounts-list"]')).not.toBeNull()
  })
  expect(deleteCalls).toEqual([{ accountId: 'cb-1' }])
})

it('Strike: Remove Account warns about imported statements — Cancel keeps it, Remove deletes it', async () => {
  const deleteCalls: unknown[] = []

  const view = await mountDetailsPage({
    initialPath: '/accounts/strike/st-1',
    routePattern: '/accounts/strike/:accountId',
    element: <StrikeAccountDetailsPage />,
    verifyPath: '/accounts/verify/strike',
    handle: async (op) => {
      if (op.path === 'portalProve.exchanges.strike.list') {
        return [
          {
            id: 'st-1',
            exchange: 'strike',
            displayName: 'My Strike',
            currency: 'BTC',
            balance: '25000000',
            balanceAsOf: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            connectionStatus: 'connected',
          },
        ]
      }
      if (op.path === 'portalProve.exchanges.strike.listStatementMonths') {
        return ['2026-01']
      }
      if (op.path === 'portalProve.exchanges.delete') {
        deleteCalls.push(op.input)
        return null
      }
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.text()).toContain('My Strike')
  })

  await view.clickButton('Remove Account')
  expect(deleteCalls).toEqual([])
  expect(view.dialog()?.textContent).toContain('Remove My Strike?')
  expect(view.dialog()?.textContent).toContain('imported statements')

  await view.clickDialogButton('Cancel')
  await vi.waitFor(() => {
    expect(view.dialog()).toBeNull()
  })
  expect(deleteCalls).toEqual([])
  expect(view.text()).toContain('My Strike')

  await view.clickButton('Remove Account')
  await view.clickDialogButton('Remove')

  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="accounts-list"]')).not.toBeNull()
  })
  expect(deleteCalls).toEqual([{ accountId: 'st-1' }])
})
