// @vitest-environment node
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { TRPCClientError } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../testing/trpc'
import { trpc } from '../trpc'
import { exchangeListChanged, useAutoRefreshExchanges } from './use-auto-refresh-exchanges'

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

function AutoRefreshHarness(): JSX.Element {
  const exchanges = trpc.portalProve.exchanges.list.useQuery()
  useAutoRefreshExchanges(exchanges.data)
  const coinbase = trpc.portalProve.exchanges.coinbase.list.useQuery()
  trpc.portalProve.portfolio.getData.useQuery()
  return (
    <div>
      <span data-testid="all-status">{exchanges.data?.[0]?.connectionStatus ?? 'none'}</span>
      <span data-testid="cb-status">{coinbase.data?.[0]?.connectionStatus ?? 'none'}</span>
    </div>
  )
}

let clockMs = 1_800_000_000_000

async function mountHarness(args: {
  onRefreshAll: () => Promise<null>
  getAccounts: () => Array<{
    id: string
    exchange: 'coinbase'
    displayName: string
    currency: 'BTC'
    balance: string | null
    balanceAsOf: string | null
    createdAt: string
    connectionStatus: 'connected' | 'needs_reconnect'
  }>
  failListAfterRefresh?: () => boolean
  advanceClockMs?: number
}) {
  clockMs += args.advanceClockMs ?? 120_000
  vi.spyOn(Date, 'now').mockReturnValue(clockMs)

  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const requests: string[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation.path)
    if (operation.path === 'portalProve.exchanges.refreshAllBalances') {
      return args.onRefreshAll()
    }
    if (operation.path === 'portalProve.exchanges.list' || operation.path === 'portalProve.exchanges.coinbase.list') {
      if (operation.path === 'portalProve.exchanges.list' && args.failListAfterRefresh?.() === true) {
        throw new Error('Exchange list failed')
      }
      return args.getAccounts()
    }
    return null
  })

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  let unmounted = false

  onTestFinished(async () => {
    if (!unmounted) {
      await act(async () => {
        root.unmount()
      })
    }
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })

  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <AutoRefreshHarness />
      </TestTrpcProvider>,
    )
  })

  return {
    container,
    requests,
    client,
    unmount: async () => {
      unmounted = true
      await act(async () => {
        root.unmount()
      })
    },
  }
}

function makeAccount(
  overrides: {
    id?: string
    balance?: string | null
    balanceAsOf?: string
    connectionStatus?: 'connected' | 'needs_reconnect'
  } = {},
) {
  return {
    id: overrides.id ?? 'cb-1',
    exchange: 'coinbase' as const,
    displayName: 'Coinbase BTC',
    currency: 'BTC' as const,
    balance: overrides.balance !== undefined ? overrides.balance : '50000000',
    balanceAsOf: overrides.balanceAsOf ?? '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    connectionStatus: overrides.connectionStatus ?? 'connected',
  }
}

it('exchangeListChanged compares id, balance, and connectionStatus ignoring order and balanceAsOf', () => {
  const a1 = makeAccount({
    id: 'a',
    balance: '100',
    connectionStatus: 'connected',
    balanceAsOf: '2026-01-01T00:00:00Z',
  })
  const b1 = makeAccount({
    id: 'b',
    balance: '200',
    connectionStatus: 'connected',
    balanceAsOf: '2026-01-01T00:00:00Z',
  })
  const a2 = makeAccount({
    id: 'a',
    balance: '100',
    connectionStatus: 'connected',
    balanceAsOf: '2026-01-02T00:00:00Z',
  })
  const b2 = makeAccount({
    id: 'b',
    balance: '200',
    connectionStatus: 'connected',
    balanceAsOf: '2026-01-02T00:00:00Z',
  })

  expect(exchangeListChanged([a1, b1], [b2, a2])).toBe(false)
  expect(exchangeListChanged([a1], [makeAccount({ id: 'a', balance: '101' })])).toBe(true)
  expect(
    exchangeListChanged([a1], [makeAccount({ id: 'a', balance: null, connectionStatus: 'needs_reconnect' })]),
  ).toBe(true)
  expect(exchangeListChanged([a1], [a1, b1])).toBe(true)
})

it('does not call refreshAllBalances or consume debounce when there are zero or only reconnect-required exchange accounts', async () => {
  const onRefreshAll = vi.fn(async () => null)

  const emptyView = await mountHarness({
    getAccounts: () => [],
    onRefreshAll,
  })
  await vi.waitFor(() => {
    expect(emptyView.requests).toContain('portalProve.exchanges.list')
  })
  expect(onRefreshAll).not.toHaveBeenCalled()
  await emptyView.unmount()

  const reconnectView = await mountHarness({
    getAccounts: () => [makeAccount({ balance: null, connectionStatus: 'needs_reconnect' })],
    onRefreshAll,
    advanceClockMs: 1_000,
  })
  await vi.waitFor(() => {
    expect(reconnectView.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('needs_reconnect')
  })
  expect(onRefreshAll).not.toHaveBeenCalled()
  await reconnectView.unmount()

  // Because neither skipped mount consumed the 60s debounce, a connected account still refreshes immediately.
  const connectedView = await mountHarness({
    getAccounts: () => [makeAccount({ balance: '50000000', connectionStatus: 'connected' })],
    onRefreshAll,
    advanceClockMs: 1_000,
  })
  await vi.waitFor(() => {
    expect(onRefreshAll).toHaveBeenCalledTimes(1)
  })
  await connectedView.unmount()
})

it('keeps portfolio.getData fresh when refreshAllBalances finishes with unchanged exchange balances', async () => {
  let balanceAsOf = '2026-01-01T00:00:00.000Z'
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getAccounts: () => [makeAccount({ balance: '50000000', connectionStatus: 'connected', balanceAsOf })],
    onRefreshAll: async () => {
      await refreshGate
      balanceAsOf = '2026-01-01T00:05:00.000Z'
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.requests).toContain('portalProve.exchanges.refreshAllBalances')
    expect(view.requests).toContain('portalProve.portfolio.getData')
  })

  const requestsBeforeSettle = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    const afterSettle = view.requests.slice(requestsBeforeSettle)
    expect(afterSettle).toContain('portalProve.exchanges.list')
    expect(afterSettle).toContain('portalProve.exchanges.coinbase.list')
  })
  const afterSettle = view.requests.slice(requestsBeforeSettle)
  expect(afterSettle).not.toContain('portalProve.portfolio.getData')
  const portfolioQuery = view.client
    .getQueryCache()
    .findAll()
    .find((q) => JSON.stringify(q.queryKey).includes('portfolio'))
  expect(portfolioQuery?.state.isInvalidated).toBe(false)
})

it('invalidates portfolio.getData when a connected exchange balance changes after refreshAllBalances', async () => {
  let balance = '50000000'
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getAccounts: () => [makeAccount({ balance, connectionStatus: 'connected' })],
    onRefreshAll: async () => {
      await refreshGate
      balance = '60000000'
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.requests).toContain('portalProve.exchanges.refreshAllBalances')
  })

  const requestsBeforeSettle = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    expect(view.requests.slice(requestsBeforeSettle)).toEqual(
      expect.arrayContaining(['portalProve.exchanges.list', 'portalProve.portfolio.getData']),
    )
  })
})

it('invalidates exchanges and portfolio caches when refreshAllBalances rejects after a key is revoked', async () => {
  let status: 'connected' | 'needs_reconnect' = 'connected'
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getAccounts: () => [
      makeAccount({
        balance: status === 'connected' ? '50000000' : null,
        connectionStatus: status,
      }),
    ],
    onRefreshAll: async () => {
      await refreshGate
      status = 'needs_reconnect'
      throw TRPCClientError.from({
        error: {
          message: 'All refreshes failed: Coinbase BTC: Your Coinbase API key was rejected. Reconnect your account.',
          code: -32603,
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
        },
      })
    },
  })

  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('connected')
    expect(view.container.querySelector('[data-testid="cb-status"]')?.textContent).toBe('connected')
    expect(view.requests).toContain('portalProve.exchanges.refreshAllBalances')
  })

  const requestsBeforeReject = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('needs_reconnect')
    expect(view.container.querySelector('[data-testid="cb-status"]')?.textContent).toBe('needs_reconnect')
  })

  const requestsAfterReject = view.requests.slice(requestsBeforeReject)
  expect(requestsAfterReject).toEqual(
    expect.arrayContaining([
      'portalProve.exchanges.list',
      'portalProve.exchanges.coinbase.list',
      'portalProve.portfolio.getData',
    ]),
  )
})

it('refreshes exchange lists but keeps portfolio cached on transient rejection when balances and status did not change', async () => {
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getAccounts: () => [makeAccount({ balance: '50000000', connectionStatus: 'connected' })],
    onRefreshAll: async () => {
      await refreshGate
      throw TRPCClientError.from({
        error: {
          message: 'All refreshes failed: Coinbase BTC: Failed to refresh balance',
          code: -32603,
          data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
        },
      })
    },
  })

  await vi.waitFor(() => {
    expect(view.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('connected')
    expect(view.requests).toContain('portalProve.exchanges.refreshAllBalances')
  })

  const requestsBeforeReject = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    const requestsAfterReject = view.requests.slice(requestsBeforeReject)
    expect(requestsAfterReject).toEqual(
      expect.arrayContaining(['portalProve.exchanges.list', 'portalProve.exchanges.coinbase.list']),
    )
  })
  expect(view.requests.slice(requestsBeforeReject)).not.toContain('portalProve.portfolio.getData')
  expect(view.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('connected')
})

it('conservatively invalidates portfolio.getData if refetching the updated exchange list fails', async () => {
  let failList = false
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getAccounts: () => [makeAccount({ balance: '50000000', connectionStatus: 'connected' })],
    failListAfterRefresh: () => failList,
    onRefreshAll: async () => {
      await refreshGate
      failList = true
      return null
    },
  })

  await vi.waitFor(() => {
    expect(view.requests).toContain('portalProve.exchanges.refreshAllBalances')
  })

  const requestsBeforeSettle = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    expect(view.requests.slice(requestsBeforeSettle)).toContain('portalProve.portfolio.getData')
  })
})
