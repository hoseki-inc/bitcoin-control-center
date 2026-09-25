// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { type RouterOutput, trpc } from '../../../trpc'
import { ManualAccountDetailsPage } from './[id]'

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

const accountId = 'test'
const removals: unknown[] = []

/** Records removals and serves any follow-up request as the local Sentinel service would. */
const rpc = createTestTrpcClient(async ({ path, input }: Operation) => {
  if (path === 'portalProve.manual.delete') {
    removals.push(input)
  }
  return null
})

let queryClient: QueryClient
let root: Root
let container: HTMLDivElement

function seedQueries(client: QueryClient): void {
  client.setQueryData<RouterOutput['portalProve']['manual']['get']>(
    getQueryKey(trpc.portalProve.manual.get, { accountId }, 'query'),
    {
      id: accountId,
      displayName: 'Test holding',
      currency: 'BTC',
      balance: '100000000',
      balanceAsOf: '2026-09-01T00:00:00Z',
      createdAt: '2026-09-01T00:00:00Z',
    },
  )
  client.setQueryData<RouterOutput['portalProve']['manual']['transactions']['list']>(
    getQueryKey(trpc.portalProve.manual.transactions.list, { accountId }, 'query'),
    [],
  )
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  seedQueries(queryClient)
  removals.length = 0
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  // The confirmation dialog's focus lock inspects iframes, which the shared browser globals omit.
  vi.stubGlobal('HTMLIFrameElement', dom.window.HTMLIFrameElement)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)

  await run()
}

async function click(label: string): Promise<void> {
  const button = [...document.querySelectorAll('button')].find((item) => item.textContent === label)
  assert.exists(button, `Missing button: ${label}`)
  await act(async () => {
    button.click()
  })
}

it('requires confirmation and allows cancellation before removing an account', async () => {
  await withTestSetup(async () => {
    await act(async () => {
      root.render(
        createElement(
          ChakraProvider,
          null,
          createElement(
            TestTrpcProvider,
            { client: queryClient, rpc },
            createElement(
              MemoryRouter,
              { initialEntries: [`/accounts/manual/${accountId}`] },
              createElement(
                Routes,
                null,
                createElement(Route, {
                  path: '/accounts/manual/:accountId',
                  element: createElement(ManualAccountDetailsPage),
                }),
                createElement(Route, { path: '/accounts', element: createElement('p', null, 'Accounts') }),
              ),
            ),
          ),
        ),
      )
    })
    await click('Remove Account')
    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain('Test holding')
    expect(removals).toEqual([])
    await click('Cancel')
    expect(removals).toEqual([])
    await click('Remove Account')
    await click('Remove')
    expect(removals).toEqual([{ accountId }])
  })
})
