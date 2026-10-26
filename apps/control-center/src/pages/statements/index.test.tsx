// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { parseNavigationState } from '../../lib/navigation-state'
import { confirmDelete, statementFixture } from '../../testing/statements'
import { TestTrpcProvider, createTestTrpcClient, notFound } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { StatementListPage } from './index'

const statement = statementFixture()
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

/** Stands in for the create page, showing where its Cancel would return to. */
function CreateRoute(): JSX.Element {
  return <p>Create page, returning to {parseNavigationState(useLocation().state)?.returnTo ?? 'Home'}</p>
}

type ListService = (operation: Operation) => Promise<StatementDto[]>

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
  const rpc = createTestTrpcClient(async (operation) => requests(operation))
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
          <MemoryRouter initialEntries={['/statements']}>
            <Routes>
              <Route path="/statements" element={<StatementListPage />} />
              <Route path="/statements/create" element={<CreateRoute />} />
            </Routes>
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
  expect(container.textContent).toContain('Loading statements')
  expect(container.textContent).not.toContain('Your holdings, on record')
  // The heading stays put: the Generate button holds its place, hidden, until the statements arrive.
  expect(container.querySelector('a[href="/statements/create"]')).not.toBeNull()
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
  expect(container.querySelector('a[href="/statements/create"]')?.textContent).toBe('Generate Statement')
  const table = container.querySelector('table[aria-label="Statements"]')
  assert(table !== null, 'Expected the statements table')
  expect(table.textContent).toContain('Sep 1, 2026')
  expect(table.textContent).toContain('Test partner')
  const view = table.querySelector('a[href="/statements/statement"]')
  expect(view?.textContent).toBe('View')
  expect(view?.getAttribute('aria-label')).toMatch(/^View statement created Sep 1, 2026 /)
  expect(table.querySelector('thead')?.textContent).toContain('Actions')
  // Delete sits to the right of View.
  const actions = Array.from(table.querySelectorAll('tbody td:last-child :is(a, button)'))
  expect(actions.map((action) => action.getAttribute('aria-label')?.split(' ')[0])).toEqual(['View', 'Delete'])
})

it('shows card periods with short month names', async () => {
  const quarter = statementFixture({ openingDate: new Date(2026, 6, 9), closingDate: new Date(2026, 9, 7, 23, 59, 59) })
  const { container, settle } = await renderStatementsPage({ list: async () => [quarter] })
  await settle('success')
  expect(container.textContent).toContain('Period: Jul 9 - Oct 7, 2026')
})

it('returns to Statements when a statement started here is cancelled', async () => {
  const { container, settle } = await renderStatementsPage({ list: async () => [statement] })
  await settle('success')
  const generate = container.querySelector<HTMLAnchorElement>('a[href="/statements/create"]')
  assert(generate !== null, 'Expected the Generate Statement link')
  await act(async () => {
    generate.click()
  })
  expect(container.textContent).toContain('Create page, returning to /statements')
})

it('returns to Statements from the introduction when there are no statements', async () => {
  const { container, settle } = await renderStatementsPage({ list: async () => [] })
  await settle('success')
  const generate = container.querySelector<HTMLAnchorElement>('a[href="/statements/create"]')
  assert(generate !== null, 'Expected the Generate Statement link')
  await act(async () => {
    generate.click()
  })
  expect(container.textContent).toContain('Create page, returning to /statements')
})

it('offers Delete only for statements that are no longer generating', async () => {
  const statements = [
    statementFixture({ id: 'completed', status: 'completed' }),
    statementFixture({ id: 'failed', status: 'failed' }),
    statementFixture({ id: 'pending', status: 'pending' }),
  ]
  const { container, requests, settle, button } = await renderStatementsPage({ list: async () => statements })
  await settle('success')
  const deleteButtons = (): number =>
    container.querySelectorAll('button[aria-label^="Delete statement created Sep 1, 2026 "]').length
  // Cards are the default view.
  expect(deleteButtons()).toBe(2)
  await act(async () => {
    button('List view').click()
  })
  expect(deleteButtons()).toBe(2)
  const rows = Array.from(container.querySelectorAll('table[aria-label="Statements"] tbody tr'))
  const labels = rows.map((row) => row.querySelector('button')?.getAttribute('aria-label') ?? null)
  expect(labels.map((label) => label?.startsWith('Delete statement created Sep 1, 2026 ') ?? null)).toEqual([
    true,
    true,
    null,
  ])

  const remove = rows[1]?.querySelector('button')
  assert(remove instanceof window.HTMLButtonElement, 'Expected the Delete button')
  await act(async () => {
    remove.click()
  })
  await confirmDelete()
  await vi.waitFor(() => {
    expect(
      requests.mock.calls.find(([operation]) => operation.path === 'portalProve.statement.delete')?.[0].input,
    ).toBe('failed')
  })
})

it('shows a status on cards only for statements that are generating or failed', async () => {
  const statements = [
    statementFixture({ id: 'completed', status: 'completed' }),
    statementFixture({ id: 'failed', status: 'failed' }),
    statementFixture({ id: 'pending', status: 'pending' }),
  ]
  const { container, settle } = await renderStatementsPage({ list: async () => statements })
  await settle('success')
  const text = container.textContent
  expect(text).toMatch(/failed/i)
  expect(text).toMatch(/pending/i)
  expect(text).not.toMatch(/completed/i)
})

it('keeps a generating statement current on its own until it is done', { timeout: 10_000 }, async () => {
  let status: StatementDto['status'] = 'pending'
  const { container, settle } = await renderStatementsPage({
    list: async () => [statementFixture({ id: 'generating', status })],
  })
  await settle('success')
  expect(container.textContent).toMatch(/pending/i)
  status = 'completed'
  await vi.waitFor(
    () => {
      expect(container.textContent).not.toMatch(/pending/i)
    },
    { timeout: 4000 },
  )
})

it('removes a deleted statement from the list', async () => {
  let rows = [statementFixture({ id: 'kept' }), statementFixture({ id: 'deleted' })]
  const { container, settle } = await renderStatementsPage({
    list: async (operation) => {
      if (operation.path === 'portalProve.statement.delete') {
        rows = rows.filter((row) => row.id !== operation.input)
      }
      return rows
    },
  })
  await settle('success')
  const trashButtons = (): HTMLButtonElement[] =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Delete statement created"]'))
  expect(trashButtons()).toHaveLength(2)
  await act(async () => {
    trashButtons()[1]?.click()
  })
  await confirmDelete()
  await vi.waitFor(() => {
    expect(trashButtons()).toHaveLength(1)
  })
})

it('removes a statement that another tab already deleted when deleting it here', async () => {
  let rows = [statementFixture({ id: 'kept' }), statementFixture({ id: 'deleted-elsewhere' })]
  const { container, settle } = await renderStatementsPage({
    list: async (operation) => {
      if (operation.path === 'portalProve.statement.delete') {
        rows = rows.filter((row) => row.id !== operation.input)
        throw notFound('Statement not found')
      }
      return rows
    },
  })
  await settle('success')
  const trashButtons = (): HTMLButtonElement[] =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Delete statement created"]'))
  await act(async () => {
    trashButtons()[1]?.click()
  })
  await confirmDelete()
  await vi.waitFor(() => {
    expect(trashButtons()).toHaveLength(1)
  })
})

it('takes a deleted statement off the list at once, before the list refreshes', async () => {
  let isDeleted = false
  const { container, settle } = await renderStatementsPage({
    list: async (operation) => {
      if (operation.path === 'portalProve.statement.delete') {
        isDeleted = true
        return []
      }
      // The refresh after the delete never answers, as on a slow connection.
      return isDeleted
        ? new Promise<StatementDto[]>(() => undefined)
        : [statementFixture({ id: 'kept' }), statementFixture({ id: 'deleted' })]
    },
  })
  await settle('success')
  const trashButtons = (): HTMLButtonElement[] =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Delete statement created"]'))
  await act(async () => {
    trashButtons()[1]?.click()
  })
  await confirmDelete()
  await vi.waitFor(() => {
    expect(trashButtons()).toHaveLength(1)
  })
})
