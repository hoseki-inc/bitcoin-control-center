// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { StrikeAccountDetailsPage } from './[id]'

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

/** Serves the Strike account, its statement month, and one transaction as the local Sentinel service would. */
const rpc = createTestTrpcClient(async ({ path }: Operation) => {
  switch (path) {
    case 'portalProve.exchange.strike.list':
      return [
        {
          id: 'strike',
          displayName: 'Test Strike',
          createdAt: '2026-08-01T00:00:00Z',
          balance: '24690000',
          connectionStatus: 'connected',
        },
      ]
    case 'portalProve.exchange.strike.listStatementMonths':
      return ['2026-08']
    case 'portalProve.exchange.strike.listStatementTransactions':
      return [
        {
          id: 'transaction',
          transactedAt: '2026-08-01T12:00:00Z',
          type: 'purchase',
          amountBtc: '0.2469',
          amountUsd: '12345',
          exchangeRate: '50000',
        },
      ]
    default:
      return null
  }
})

it('masks and restores all financial values in the actual Strike transaction table', async () => {
  const dom = browser.acquire()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  queryClient.setQueryData(['local-settings', 'bitcoin_display_unit'], 'btc')
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  // Deliver tRPC query results inside act so React applies them before assertions.
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  await act(async () => {
    root.render(
      <ChakraProvider>
        <TestTrpcProvider client={queryClient} rpc={rpc}>
          <MemoryRouter initialEntries={['/accounts/strike/strike']}>
            <Routes>
              <Route path="/accounts/strike/:accountId" element={<StrikeAccountDetailsPage />} />
            </Routes>
          </MemoryRouter>
        </TestTrpcProvider>
      </ChakraProvider>,
    )
  })
  const month = await vi.waitFor(async () => {
    await act(async () => {})
    const found = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'August 2026',
    )
    assert.exists(found, 'Missing statement month')
    return found
  })
  await act(async () => {
    month.click()
  })
  const table = (): HTMLTableElement => {
    const found = container.querySelector('table')
    assert.exists(found, 'Missing transaction table')
    return found
  }
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(table().textContent).toContain('$12345.00')
  })
  for (const hidden of [true, false]) {
    await act(async () => {
      localStorage.setItem('control-center:privacy', String(hidden))
      window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'control-center:privacy' }))
    })
    for (const value of ['12345', '50,000', '0.2469']) {
      expect(table().textContent.includes(value)).toBe(!hidden)
    }
  }
})
