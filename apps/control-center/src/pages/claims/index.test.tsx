// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import Decimal from 'decimal.js'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { type RouterOutput, trpc } from '../../trpc'
import { ClaimsPage } from './index'

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

type Output = RouterOutput['portalProve']

const exchangeAccounts: Output['exchange']['list'] = [
  {
    id: 'strike',
    displayName: 'Offline Strike',
    exchange: 'strike',
    currency: 'BTC',
    balance: '98765000000',
    balanceAsOf: null,
    createdAt: '2026-09-01T00:00:00Z',
    connectionStatus: 'needs_reconnect',
  },
]
const manualAccounts: Output['manual']['list'] = [
  {
    id: 'manual',
    displayName: 'Savings',
    currency: 'BTC',
    balance: '100000000',
    balanceAsOf: null,
    createdAt: '2026-09-01T00:00:00Z',
  },
]

/** Serves the page's requests from local fixtures, as the local Sentinel service would. */
const rpc = createTestTrpcClient(async ({ path }) => {
  switch (path) {
    case 'portalProve.exchange.refreshAllBalances':
    case 'portalProve.controlCenter.getData':
      return null
    case 'portalProve.exchange.list':
      return exchangeAccounts
    default:
      throw new Error(`Unexpected request: ${path}`)
  }
})

let queryClient: QueryClient
let root: Root
let container: HTMLDivElement

function seedQueries(client: QueryClient): void {
  client.setQueryData<Output['registry']['claims']['list']>(
    getQueryKey(trpc.portalProve.registry.claims.list, { excludePending: false }, 'query'),
    [],
  )
  client.setQueryData<Output['registry']['claims']['listArchived']>(
    getQueryKey(trpc.portalProve.registry.claims.listArchived, undefined, 'query'),
    [],
  )
  client.setQueryData(getQueryKey(trpc.portalProve.exchange.list, undefined, 'query'), exchangeAccounts)
  client.setQueryData(getQueryKey(trpc.portalProve.manual.list, undefined, 'query'), manualAccounts)
  client.setQueryData<Output['etf']['list']>(getQueryKey(trpc.portalProve.etf.list, undefined, 'query'), [])
  client.setQueryData<Output['retrieveBitcoinPrice']>(
    getQueryKey(trpc.portalProve.retrieveBitcoinPrice, undefined, 'query'),
    { value: new Decimal(50_000), asOf: new Date('2026-09-01T00:00:00Z') },
  )
}

async function mount(): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <TestTrpcProvider client={queryClient} rpc={rpc}>
          <MemoryRouter>
            <ClaimsPage />
          </MemoryRouter>
        </TestTrpcProvider>
      </ChakraProvider>,
    )
  })
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  seedQueries(queryClient)
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    localStorage.clear()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  localStorage.clear()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

function verifyLinks(): void {
  expect(container.querySelector('[aria-label="Add account"]')?.getAttribute('href')).toBe('/accounts/add')
  expect(container.querySelector('a[href="/accounts/strike/strike"]')?.textContent).not.toContain('987.65')
  expect(container.textContent).not.toContain('987.65')
  expect(container.textContent).toContain('Some balances are unavailable')
}

it('defaults to cards, remembers view across remounts, and offers add/reconnect links in both views', async () => {
  await withTestSetup(async () => {
    await mount()
    expect(container.querySelector('[aria-label="Card view"]')?.getAttribute('aria-pressed')).toBe('true')
    verifyLinks()
    const listViewButton = container.querySelector<HTMLButtonElement>('[aria-label="List view"]')
    assert.exists(listViewButton, 'Missing list view button')
    await act(async () => {
      listViewButton.click()
    })
    verifyLinks()
    expect(container.querySelector('a[href="/accounts/strike/strike"]')?.textContent).toContain('Reconnect needed')
    await act(async () => {
      root.unmount()
    })
    root = createRoot(container)
    await mount()
    expect(container.querySelector('[aria-label="List view"]')?.getAttribute('aria-pressed')).toBe('true')
    verifyLinks()
  })
})
