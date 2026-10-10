// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { MotionGlobalConfig } from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, type NavigateFunction, Route, Routes, useNavigate } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { confirmDelete, statementFixture } from '../../testing/statements'
import { TestTrpcProvider, createTestTrpcClient, notFound } from '../../testing/trpc'
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

// Finish opening and closing animations at once, so a closed screen leaves the page.
MotionGlobalConfig.skipAnimations = true

const id = 'st_stmt_test'

/** What the next status check returns, or whether it fails. */
interface FakeSentinel {
  statement: StatementDto
  isDown: boolean
  isDeleted: boolean
  /** Status checks wait for this before answering. */
  answers: Promise<void>
}

/** Hold Sentinel's answers to status checks until the returned function releases them. */
function hold(server: FakeSentinel): () => Promise<void> {
  let release = (): void => undefined
  server.answers = new Promise((resolve) => {
    release = resolve
  })
  return async () => {
    await act(async () => {
      release()
    })
  }
}

/**
 * Render the statement page; `server.statement` is what the next retrieve returns.
 * `cached` is the status a previous visit left in the query cache.
 */
async function renderStatementPage(
  initial: StatementDto['status'],
  cached?: StatementDto['status'],
  { isDown = false, held = false }: { isDown?: boolean; held?: boolean } = {},
) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const server: FakeSentinel = {
    statement: statementFixture({ id, status: initial }),
    isDown,
    isDeleted: false,
    answers: Promise.resolve(),
  }
  const release = held ? hold(server) : async () => undefined
  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    switch (operation.path) {
      case 'portalProve.statement.retrieve':
        await server.answers
        if (server.isDown) {
          throw new Error('Sentinel is restarting')
        }
        if (server.isDeleted && operation.input === id) {
          throw notFound('Statement not found')
        }
        // Any other statement opened during the test has already finished.
        return operation.input === id ? server.statement : statementFixture({ id: String(operation.input) })
      case 'portalProve.statement.delete':
        if (server.isDeleted) {
          throw notFound('Statement not found')
        }
        server.isDeleted = true
        return undefined
      default:
        // Keep the PDF viewer loading; rendering is covered by the hook and PDF tests.
        return new Promise<never>(() => undefined)
    }
  })
  const client = new QueryClient({
    // The page retries failed status checks; don't wait between them here.
    defaultOptions: { queries: { retryDelay: 0 } },
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
  if (!held) {
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Statement Details')
    })
  }
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
  return { container, server, requests, click, refresh, client, open, release }
}

const generationShown = (): boolean => document.body.textContent.includes('Generating Your Statement')

it('keeps showing generation after the statement finishes, until its closing sequence ends', async () => {
  const { container, server, refresh } = await renderStatementPage('pending')
  expect(generationShown()).toBe(true)
  expect(container.textContent).not.toContain('Delete')

  server.statement = { ...server.statement, status: 'completed' }
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  // The sheet never plays here, so the sequence never ends; useGenerationSequence's tests cover the close.
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
    // React Query tells the page on a timer, and a closing screen takes a few frames to leave.
    await new Promise((resolve) => {
      setTimeout(resolve, 100)
    })
  })
  expect(container.textContent).not.toContain('Sentinel is restarting')
  expect(generationShown()).toBe(true)
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

it('shows the period month first', async () => {
  const { container } = await renderStatementPage('completed')
  expect(container.textContent).toContain('Period: Aug 1 - 31, 2026')
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
    await confirmDelete()
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

it('reveals the statement, with focus on its heading, when the finished screen is closed', async () => {
  const { container, server, refresh, click } = await renderStatementPage('pending')
  server.statement = { ...server.statement, status: 'completed' }
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statuscompleted')
  })
  await click('Close')
  await vi.waitFor(() => {
    expect(generationShown()).toBe(false)
  })
  expect(container.textContent).toContain('Statement Details')
  expect(document.activeElement?.textContent).toBe('Statement Details')
})

it('does not open generation for a cached status that could not be confirmed', async () => {
  const { container, client } = await renderStatementPage('pending', 'pending', { isDown: true })
  const retrieveKey = getQueryKey(trpc.portalProve.statement.retrieve, id, 'query')
  await act(async () => {
    await vi.waitFor(() => {
      expect(client.getQueryState(retrieveKey)?.status).toBe('error')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  })
  expect(container.textContent).toContain('Statement Details')
  expect(generationShown()).toBe(false)
})

it('shows that a statement deleted elsewhere is gone, even though it was on screen', async () => {
  const { container, server, refresh, requests } = await renderStatementPage('completed')
  server.isDeleted = true
  const checked = requests.length
  await refresh()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statement not found')
  })
  expect(container.textContent).not.toContain('Statuscompleted')
  // It won't come back, so it isn't checked again.
  expect(requests.slice(checked).filter((request) => request.path === 'portalProve.statement.retrieve')).toHaveLength(1)
})

it('does not show a deleted statement again when going Back to it', async () => {
  const { container, server, click, open } = await renderStatementPage('completed')
  await click('Delete')
  await confirmDelete()
  await vi.waitFor(() => {
    expect(container.textContent).toBe('Statements list')
  })
  const release = hold(server)
  await open(-1)
  expect(container.textContent).not.toContain('Statement Details')
  await release()
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Statement not found')
  })
})

it('finishes deleting a statement that was already deleted elsewhere', async () => {
  const { container, server, click } = await renderStatementPage('completed')
  server.isDeleted = true
  await click('Delete')
  await confirmDelete()
  await vi.waitFor(() => {
    expect(container.textContent).toBe('Statements list')
  })
})

it('confirms a cached generating status before showing anything', async () => {
  const { container, release } = await renderStatementPage('pending', 'pending', { held: true })
  expect(container.textContent).not.toContain('Statement Details')
  expect(generationShown()).toBe(false)
  await release()
  await vi.waitFor(() => {
    expect(generationShown()).toBe(true)
  })
})
