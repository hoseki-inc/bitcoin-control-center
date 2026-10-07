// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { StatementListPage } from './index'

const statement: StatementDto = {
  id: 'statement',
  createdAt: new Date('2026-09-01T12:00:00Z'),
  updatedAt: new Date('2026-09-01T12:00:00Z'),
  openingDate: new Date('2026-08-01T00:00:00Z'),
  closingDate: new Date('2026-08-31T23:59:59Z'),
  counter: 1,
  timezone: 'UTC',
  status: 'completed',
  quoteCurrency: 'USD',
  errorMessage: null,
  user: { name: null, email: null },
  integrator: null,
  userId: 'user',
}
const listKey = getQueryKey(trpc.portalProve.statement.list, undefined, 'query')

// Browser APIs that keep Node's byte arrays, which the wallet libraries imported by the page check.
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

/** Render the statements page against a service whose list request always fails. */
async function renderWithFailingList(cached?: StatementDto[]): Promise<{ text: () => string; client: QueryClient }> {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
    // The failures are expected; keep them out of the test output.
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  if (cached) {
    client.setQueryData(listKey, cached)
  }
  const rpc = createTestTrpcClient(async () => {
    throw new Error('Sentinel is restarting')
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Vitest owns teardown so it runs once, even after a failed assertion.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    client.clear()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter>
            <StatementListPage />
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })
  // Wait for the failed request, then let React Query notify the page (it batches on a timer) before reading it.
  await act(async () => {
    await vi.waitFor(() => {
      expect(client.getQueryState(listKey)?.status).toBe('error')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  return { text: () => container.textContent, client }
}

it('keeps the statements already shown when refreshing them fails', async () => {
  const { text } = await renderWithFailingList([statement])
  expect(text()).toContain('Period:')
  expect(text()).not.toContain('Error fetching your statements')
}, 20_000)

it('offers to try again when the statements never loaded', async () => {
  const { text } = await renderWithFailingList()
  expect(text()).toContain('Error fetching your statements: Sentinel is restarting')
  expect(text()).toContain('Try Again')
}, 20_000)
