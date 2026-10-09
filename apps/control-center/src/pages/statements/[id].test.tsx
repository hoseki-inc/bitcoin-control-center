// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { statementFixture } from '../../testing/statements'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
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

/** Render the statement page for a statement with the given status. */
async function renderStatementPage(initial: StatementDto['status']) {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const statement = statementFixture({ id, status: initial })
  const requests: Operation[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation)
    switch (operation.path) {
      case 'portalProve.statement.retrieve':
        return statement
      case 'portalProve.statement.delete':
        return undefined
      case 'portalProve.statement.list':
        return []
      default:
        // Keep the PDF viewer loading; rendering is covered by the hook and PDF tests.
        return new Promise<never>(() => undefined)
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={[`/statements/${id}`]}>
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
  return { container, requests, click }
}

it.each(['completed', 'failed'] as const)(
  'deletes a %s statement after confirmation and returns to the list',
  async (status) => {
    const { container, requests, click } = await renderStatementPage(status)
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
