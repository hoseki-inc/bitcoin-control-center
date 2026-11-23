// @vitest-environment node
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { TRPCClientError } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../testing/trpc'
import { trpc } from '../trpc'
import { useAutoRefreshExchanges } from './use-auto-refresh-exchanges'

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
  useAutoRefreshExchanges()
  const exchanges = trpc.portalProve.exchanges.list.useQuery()
  const coinbase = trpc.portalProve.exchanges.coinbase.list.useQuery()
  trpc.portalProve.portfolio.getData.useQuery()
  return (
    <div>
      <span data-testid="all-status">{exchanges.data?.[0]?.connectionStatus ?? 'loading'}</span>
      <span data-testid="cb-status">{coinbase.data?.[0]?.connectionStatus ?? 'loading'}</span>
    </div>
  )
}

let clockMs = 1_800_000_000_000

async function mountHarness(args: {
  onRefreshAll: () => Promise<null>
  getStatus: () => 'connected' | 'needs_reconnect'
}) {
  clockMs += 120_000
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
      const status = args.getStatus()
      return [
        {
          id: 'cb-1',
          exchange: 'coinbase',
          displayName: 'Coinbase BTC',
          currency: 'BTC',
          balance: status === 'connected' ? '50000000' : null,
          balanceAsOf: '2026-01-01T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
          connectionStatus: status,
        },
      ]
    }
    return null
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

  return { container, requests }
}

it('invalidates exchanges and portfolio caches when refreshAllBalances rejects after a key is revoked', async () => {
  let status: 'connected' | 'needs_reconnect' = 'connected'
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getStatus: () => status,
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

it('invalidates exchanges and portfolio caches on transient rejection while keeping connected status', async () => {
  let releaseRefresh: (() => void) | undefined
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve
  })

  const view = await mountHarness({
    getStatus: () => 'connected',
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
  })

  const requestsBeforeReject = view.requests.length
  releaseRefresh?.()

  await vi.waitFor(() => {
    const requestsAfterReject = view.requests.slice(requestsBeforeReject)
    expect(requestsAfterReject).toEqual(
      expect.arrayContaining([
        'portalProve.exchanges.list',
        'portalProve.exchanges.coinbase.list',
        'portalProve.portfolio.getData',
      ]),
    )
  })
  expect(view.container.querySelector('[data-testid="all-status"]')?.textContent).toBe('connected')
})
