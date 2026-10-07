// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
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

type ListService = () => Promise<StatementDto[]>

const failing: ListService = async () => {
  throw new Error('Sentinel is restarting')
}

/** Render the statements page against a local list service, optionally with statements already cached. */
async function renderStatementsPage({ cached, list = failing }: { cached?: StatementDto[]; list?: ListService } = {}) {
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
  const requests = vi.fn(list)
  const rpc = createTestTrpcClient(async () => requests())
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
  /** Wait for the request to settle, then let React Query notify the page (it batches on a timer). */
  const settle = async (status: 'success' | 'error'): Promise<void> => {
    await act(async () => {
      await vi.waitFor(() => {
        expect(client.getQueryState(listKey)?.status).toBe(status)
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
    })
  }
  const button = (name: string): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === name || item.getAttribute('aria-label') === name,
    )
    assert(found !== undefined, `Expected a ${name} button`)
    return found
  }
  return { container, requests, settle, button }
}

it('keeps the statements already shown when refreshing them fails', async () => {
  const { container, settle } = await renderStatementsPage({ cached: [statement] })
  await settle('error')
  expect(container.textContent).toContain('Period:')
  expect(container.textContent).not.toContain('Error fetching your statements')
})

it('offers to try again when the statements never loaded, and asks again', async () => {
  const { container, requests, settle, button } = await renderStatementsPage()
  await settle('error')
  expect(container.textContent).toContain('Error fetching your statements: Sentinel is restarting')
  await act(async () => {
    button('Try Again').click()
  })
  expect(requests).toHaveBeenCalledTimes(2)
})

it('shows only a loading state until the statements arrive', async () => {
  const { container } = await renderStatementsPage({ list: async () => new Promise<StatementDto[]>(() => undefined) })
  expect(container.textContent).toContain('Loading...')
  expect(container.textContent).not.toContain('Your holdings, on record')
})

it('introduces statements when there are none yet', async () => {
  const { container, settle } = await renderStatementsPage({ list: async () => [] })
  await settle('success')
  expect(container.textContent).toContain('Your holdings, on record')
  expect(container.querySelector('[aria-label="List view"]')).toBeNull()
})

it('switches to a table of statements with their requester and View links', async () => {
  const fromPartner = { ...statement, integrator: { name: 'Test partner' } }
  const { container, settle, button } = await renderStatementsPage({ list: async () => [fromPartner] })
  await settle('success')
  expect(button('Card view').getAttribute('aria-pressed')).toBe('true')
  await act(async () => {
    button('List view').click()
  })
  expect(button('List view').getAttribute('aria-pressed')).toBe('true')
  expect(button('Card view').getAttribute('aria-pressed')).toBe('false')
  const table = container.querySelector('table[aria-label="Statements"]')
  assert(table !== null, 'Expected the statements table')
  expect(table.textContent).toContain('01 Sep 2026')
  expect(table.textContent).toContain('Test partner')
  const view = table.querySelector('a[href="/statements/statement"]')
  expect(view?.textContent).toBe('View')
  expect(view?.getAttribute('aria-label')).toMatch(/^View statement created 01 Sep 2026 /)
})
