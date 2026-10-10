// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { type Operation, TRPCClientError } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, type NavigateFunction, Route, Routes, useNavigate } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { statementFixture } from '../../testing/statements'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { StatementDetailsPage } from './[id]'

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

const id = 'st_stmt_test'

/** What the next status check returns, or whether it fails. */
interface FakeSentinel {
  statement: StatementDto
  isDown: boolean
  isDeleted: boolean
}

/** The error Sentinel returns for a statement that no longer exists. */
function notFound(): TRPCClientError<never> {
  return TRPCClientError.from({
    error: { message: 'Statement not found', code: -32004, data: { code: 'NOT_FOUND', httpStatus: 404 } },
  })
}

/**
 * Render the statement page; `server.statement` is what the next retrieve returns.
 * `cached` is the status a previous visit left in the query cache.
 */
async function renderStatementPage(
  initial: StatementDto['status'],
  cached?: StatementDto['status'],
  { isDown = false, retries = false }: { isDown?: boolean; retries?: boolean } = {},
) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server: FakeSentinel = { statement: statementFixture({ id, status: initial }), isDown, isDeleted: false }
  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    switch (operation.path) {
      case 'portalProve.statement.retrieve':
        if (server.isDown) {
          throw new Error('Sentinel is restarting')
        }
        if (server.isDeleted && operation.input === id) {
          throw notFound()
        }
        // Any other statement opened during the test has already finished.
        return operation.input === id ? server.statement : statementFixture({ id: String(operation.input) })
      case 'portalProve.statement.delete':
        server.isDeleted = true
        return undefined
      case 'portalProve.statement.list':
        return []
      default:
        // Keep the PDF viewer loading; rendering is covered by the hook and PDF tests.
        return new Promise<never>(() => undefined)
    }
  })
  const client = new QueryClient({
    // `retries` keeps React Query's default retries, as in the app.
    defaultOptions: { queries: retries ? {} : { retry: false } },
    // Failed status checks are part of these tests; keep them out of the output.
    logger: { log: console.log, warn: console.warn, error: () => undefined },
  })
  if (cached !== undefined) {
    client.setQueryData(getQueryKey(trpc.portalProve.statement.retrieve, id, 'query'), {
      ...server.statement,
      status: cached,
    })
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    client.clear()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  let navigate: NavigateFunction | undefined
  function Navigator(): null {
    navigate = useNavigate()
    return null
  }
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={['/statements', `/statements/${id}`]} initialIndex={1}>
            <Navigator />
            <Routes>
              <Route path="/statements" element={<p>Statements list</p>} />
              <Route path="/statements/:statementId" element={<StatementDetailsPage />} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statement Details')
  })
  const click = async (name: string): Promise<void> => {
    // Modals render outside the page container.
    const found = Array.from(document.querySelectorAll('button')).find(
      (item) => item.textContent === name || item.getAttribute('aria-label') === name,
    )
    assert(found !== undefined, `Expected a ${name} button`)
    await act(async () => {
      found.click()
    })
  }
  const refresh = async (): Promise<void> => {
    await act(async () => {
      await client.invalidateQueries()
    })
  }
  const open = async (path: string | -1): Promise<void> => {
    await act(async () => {
      await (path === -1 ? navigate?.(-1) : navigate?.(path))
    })
  }
  return { container, server, requests, click, refresh, client, open }
}

const generationShown = (): boolean => document.body.textContent.includes('Generating Your Statement')

it('keeps showing generation when the statement finishes, until the animation finishes playing', async () => {
  const { container, server, refresh } = await renderStatementPage('pending')
  expect(generationShown()).toBe(true)
  expect(container.textContent).not.toContain('Delete')

  server.statement = { ...server.statement, status: 'completed' }
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  // The animation never plays here, so it never finishes; useGenerationSequence's tests cover the close.
  expect(generationShown()).toBe(true)
  expect(container.textContent).toContain('Delete')
})

it('keeps showing generation when a status check fails', async () => {
  const { container, server, refresh, client } = await renderStatementPage('pending')
  server.isDown = true
  await refresh()
  const retrieveKey = getQueryKey(trpc.portalProve.statement.retrieve, id, 'query')
  await act(async () => {
    await vi.waitFor(() => {
      expect(client.getQueryState(retrieveKey)?.status).toBe('error')
    })
    // React Query tells the page on a timer; let it render the failure.
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  expect(container.textContent).not.toContain('Sentinel is restarting')
  expect(generationShown()).toBe(true)
})

it('marks the cached statements list stale once generation ends', async () => {
  const { server, client } = await renderStatementPage('pending')
  const listKey = getQueryKey(trpc.portalProve.statement.list, undefined, 'query')
  client.setQueryData(listKey, [server.statement])
  expect(client.getQueryState(listKey)?.isInvalidated).toBe(false)
  server.statement = { ...server.statement, status: 'failed' }
  await act(async () => {
    await client.invalidateQueries(getQueryKey(trpc.portalProve.statement.retrieve, id, 'query'))
  })
  await vi.waitFor(() => {
    expect(client.getQueryState(listKey)?.isInvalidated).toBe(true)
  })
})

it('starts fresh when another statement opens on the same page', async () => {
  const { container, open } = await renderStatementPage('pending')
  expect(generationShown()).toBe(true)
  // Going back or forward between statements keeps this page mounted.
  await open('/statements/st_stmt_other')
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  expect(generationShown()).toBe(false)
})

it('does not show generation for a statement that finished since it was last opened', async () => {
  const { container } = await renderStatementPage('completed', 'pending')
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  expect(generationShown()).toBe(false)
})

it('closes to the statements list', async () => {
  const { container } = await renderStatementPage('completed')
  const close = container.querySelector<HTMLAnchorElement>('a[aria-label="Back to statements"]')
  assert(close !== null, 'Expected the close link')
  await act(async () => {
    close.click()
  })
  expect(container.textContent).toBe('Statements list')
})

it('goes to the statements list when generation is closed', async () => {
  const { container, click } = await renderStatementPage('pending')
  await click('Close')
  expect(container.textContent).toBe('Statements list')
})

it.each(['completed', 'failed'] as const)(
  'deletes a %s statement after confirmation and returns to the list',
  async (status) => {
    const { container, requests, click } = await renderStatementPage(status)
    expect(generationShown()).toBe(false)
    await click('Delete')
    expect(document.body.textContent).toContain('Delete statement?')
    expect(document.body.textContent).toContain("This can't be undone.")
    const confirm = Array.from(document.querySelectorAll('footer button')).find(
      (button) => button.textContent === 'Delete',
    )
    assert(confirm instanceof window.HTMLButtonElement, 'Expected the confirm button')
    await act(async () => {
      confirm.click()
    })
    await vi.waitFor(() => {
      expect(container.textContent).toBe('Statements list')
    })
    expect(requests.find((request) => request.path === 'portalProve.statement.delete')?.input).toBe(id)
  },
)

it('checks a generating statement again on its own until it is done', async () => {
  const { container, server } = await renderStatementPage('pending')
  server.statement = { ...server.statement, status: 'completed' }
  await vi.waitFor(
    () => {
      expect(container.textContent).toContain('Statuscompleted')
    },
    { timeout: 3000 },
  )
})

it('reveals the statement instead of leaving it when the finished screen is closed', async () => {
  const { container, server, refresh, click } = await renderStatementPage('pending')
  server.statement = { ...server.statement, status: 'completed' }
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  await click('Close')
  // Closing fades the screen out over the statement; jsdom never finishes the fade, so check where we are.
  await new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
  expect(container.textContent).toContain('Statement Details')
  expect(container.textContent).not.toContain('Statements list')
})

it('does not open generation for a cached status that could not be confirmed', async () => {
  const { container, server, client } = await renderStatementPage('pending', 'pending', { isDown: true })
  const retrieveKey = getQueryKey(trpc.portalProve.statement.retrieve, id, 'query')
  await act(async () => {
    await vi.waitFor(() => {
      expect(client.getQueryState(retrieveKey)?.status).toBe('error')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  expect(server.isDown).toBe(true)
  expect(container.textContent).toContain('Statement Details')
  expect(generationShown()).toBe(false)
})

it('shows that a statement deleted elsewhere is gone, even though it was on screen', async () => {
  // With the app's usual retries on, so this also checks "not found" isn't retried for seconds.
  const { container, server, refresh } = await renderStatementPage('completed', undefined, { retries: true })
  server.isDeleted = true
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statement not found')
  })
  expect(container.textContent).not.toContain('Statuscompleted')
})

it('does not bring a deleted statement back when going Back to it', async () => {
  const { container, click, open } = await renderStatementPage('completed')
  await click('Delete')
  const confirm = Array.from(document.querySelectorAll('footer button')).find(
    (button) => button.textContent === 'Delete',
  )
  assert(confirm instanceof window.HTMLButtonElement, 'Expected the confirm button')
  await act(async () => {
    confirm.click()
  })
  await vi.waitFor(() => {
    expect(container.textContent).toBe('Statements list')
  })
  await open(-1)
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statement not found')
  })
  expect(container.textContent).not.toContain('Statuscompleted')
})
