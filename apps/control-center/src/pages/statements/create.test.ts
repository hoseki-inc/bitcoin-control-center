// @vitest-environment node
import { StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { type RouterOutput, trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCreatePage } from './create'

type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]

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

it.each(StatementQuoteCurrencySchema.options)(
  'sends selected %s and only self-custody accounts to generation, then opens the statement',
  async (currency) => {
    const requests: Operation[] = []
    const claimId = 're_clmx_wallet'
    const statement: StatementDto = {
      id: 'new-statement',
      createdAt: new Date(),
      updatedAt: new Date(),
      openingDate: new Date('2026-08-01'),
      closingDate: new Date('2026-08-31'),
      counter: 1,
      timezone: 'UTC',
      status: 'pending',
      quoteCurrency: currency,
      errorMessage: null,
      txSource: 'public_mempool',
      progress: 0,
      user: { name: null, email: null },
      integrator: null,
      userId: 'local',
    }
    const rpc = createTestTrpcClient(async (operation) => {
      requests.push(operation)
      if (operation.path === 'portalProve.statement.initiateGeneration') {
        return statement
      }
      throw new Error(`Unexpected request: ${operation.path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(getQueryKey(trpc.portalProve.registry.claims.list, { excludePending: true }, 'query'), [
      claimFixture(claimId, 'Savings wallet'),
    ])
    // A connected exchange must stay off the page and out of statement requests.
    client.setQueryData<ExchangeAccountDto[]>(getQueryKey(trpc.portalProve.exchange.list, undefined, 'query'), [
      {
        id: 'exchange-account',
        exchange: 'coinbase',
        displayName: 'Coinbase savings',
        currency: 'BTC',
        balance: '100000000',
        balanceAsOf: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        connectionStatus: 'connected',
      },
    ])
    client.setQueryData(getQueryKey(trpc.portalProve.retrieveBitcoinPrice, undefined, 'query'), null)
    client.setQueryData(
      getQueryKey(trpc.portalProve.onchain.claimBalances, { claimIds: [claimId] }, 'query'),
      new Map(),
    )
    client.setQueryData(['local-settings', 'user_name'], null)
    // The statements list a visit to Statements left behind.
    const listKey = getQueryKey(trpc.portalProve.statement.list, undefined, 'query')
    client.setQueryData(listKey, [])
    const container = await renderCreatePage(client, rpc)
    expect(container.textContent).not.toMatch(/coinbase/i)
    const select = container.querySelector('#quote-currency')
    assert.instanceOf(select, window.HTMLSelectElement)
    expect(select.value).toBe('USD')
    await act(async () => {
      select.value = currency
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const generate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Generate Statement',
    )
    assert.exists(generate)
    expect(generate.disabled).toBe(false)
    await act(async () => {
      generate.click()
    })
    await vi.waitFor(() => {
      const input = requests.find((request) => request.path === 'portalProve.statement.initiateGeneration')?.input
      expect(input).toEqual(expect.objectContaining({ quoteCurrency: currency, claimIds: [claimId] }))
      expect(input).not.toHaveProperty('exchangeAccountIds')
      expect(container.textContent).toBe('Statement new-statement')
    })
    // So Statements shows it as generating straight away.
    expect(client.getQueryData(listKey)).toEqual([statement])
  },
)

/** Stands in for the statement page, which shows generation progress. */
function StatementRoute(): JSX.Element {
  return createElement('p', null, `Statement ${useParams()['statementId'] ?? ''}`)
}

/** Renders the statement page and removes it when the test ends. */
async function renderCreatePage(
  client: QueryClient,
  rpc: ReturnType<typeof createTestTrpcClient>,
): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        TestTrpcProvider,
        { client, rpc },
        createElement(
          TestChakraProvider,
          null,
          createElement(
            MemoryRouter,
            { initialEntries: ['/statements/create'] },
            createElement(
              Routes,
              null,
              createElement(Route, { path: '/statements/create', element: createElement(StatementCreatePage) }),
              createElement(Route, { path: '/statements/:statementId', element: createElement(StatementRoute) }),
            ),
          ),
        ),
      ),
    )
  })
  return container
}

it.each([
  {
    state: 'loading',
    status: 'loading',
    heading: 'Select Accounts',
    loadClaims: async () => new Promise<never>(() => undefined),
  },
  {
    state: 'unavailable',
    status: 'error',
    heading: 'Select Accounts',
    loadClaims: async () => Promise.reject(new Error('Accounts unavailable')),
  },
  { state: 'empty', status: 'success', heading: 'First, Connect an Account.', loadClaims: async () => [] },
])('shows "$heading" while accounts are $state', async ({ status, heading, loadClaims }) => {
  const rpc = createTestTrpcClient(async (operation) => {
    if (operation.path === 'portalProve.registry.claims.list') {
      return loadClaims()
    }
    throw new Error(`Unexpected request: ${operation.path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  client.setQueryData(['local-settings', 'user_name'], null)
  // The failed accounts request is expected.
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const container = await renderCreatePage(client, rpc)
  await vi.waitFor(() => {
    const claimsKey = getQueryKey(trpc.portalProve.registry.claims.list, { excludePending: true }, 'query')
    expect(client.getQueryState(claimsKey)?.status).toBe(status)
    expect(container.textContent).toContain(heading)
  })
})
