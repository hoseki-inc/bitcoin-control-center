// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useParams } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { StatementDto } from '../trpc/server-types'
import { type HomeDataSource, HomePage, type HomeViews } from './index'

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

const views: HomeViews = {
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
  BitcoinPriceChart: () => createElement('section', null, 'Bitcoin Price'),
}

function fakeQuery<T>(data: T | undefined, isError = false) {
  return { data, isLoading: false, isError, refetch: vi.fn(async () => Promise.resolve({ isError: false })) }
}

function StatementRoute(): JSX.Element {
  return createElement('p', null, `Statement page ${useParams()['id'] ?? ''}`)
}

async function renderHome(dataSource: HomeDataSource): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  // Vitest owns teardown so it runs once, even after a failed assertion.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        ChakraProvider,
        null,
        createElement(
          MemoryRouter,
          null,
          createElement(
            Routes,
            null,
            createElement(Route, { path: '/', element: createElement(HomePage, { dataSource, views }) }),
            createElement(Route, { path: '/statements/:id', element: createElement(StatementRoute) }),
          ),
        ),
      ),
    )
  })
  return container
}

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === name)
  assert(found !== undefined, `Expected a ${name} button`)
  return found
}

it('retries every failed holdings query and the statements from Try Again', async () => {
  const queries = {
    statements: fakeQuery<StatementDto[]>(undefined, true),
    portfolio: fakeQuery(undefined, true),
    claims: fakeQuery<unknown[]>(undefined, true),
    exchanges: fakeQuery<unknown[]>([]),
    manual: fakeQuery<unknown[]>([]),
    etfs: fakeQuery<unknown[]>([]),
  }
  const container = await renderHome({
    useStatements: () => queries.statements,
    usePortfolio: () => queries.portfolio,
    useClaims: () => queries.claims,
    useExchanges: () => queries.exchanges,
    useManual: () => queries.manual,
    useEtfs: () => queries.etfs,
  })
  await act(async () => {
    button(container, 'Try Again').click()
  })
  for (const query of Object.values(queries)) {
    expect(query.refetch).toHaveBeenCalledTimes(1)
  }
})

it('opens a recent statement from its View button', async () => {
  const container = await renderHome({
    useStatements: () => fakeQuery([statement]),
    usePortfolio: () => fakeQuery(undefined),
    useClaims: () => fakeQuery<unknown[]>([]),
    useExchanges: () => fakeQuery<unknown[]>([]),
    useManual: () => fakeQuery<unknown[]>([]),
    useEtfs: () => fakeQuery<unknown[]>([]),
  })
  await act(async () => {
    button(container, 'View').click()
  })
  expect(container.textContent).toContain('Statement page statement')
})
