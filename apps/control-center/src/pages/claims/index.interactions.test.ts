// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { AccountsDataSource } from './accounts-data'
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

/** An empty list query, or one that failed to load, with a refetch the test can watch. */
function listQuery(isError = false) {
  return {
    data: isError ? undefined : [],
    isLoading: false,
    isError,
    refetch: vi.fn(async () => Promise.resolve({ isError: false })),
  }
}

it('asks again for only the account lists that failed', async () => {
  const dom = browser.acquire()
  const lists = {
    claims: listQuery(),
    exchanges: listQuery(true),
    manual: listQuery(),
    etfs: listQuery(),
  }
  const dataSource: AccountsDataSource = {
    useLists: () => ({
      claimsQuery: lists.claims,
      exchangeAccountsQuery: lists.exchanges,
      manualAccountsQuery: lists.manual,
      etfAccountsQuery: lists.etfs,
      archivedClaimsQuery: listQuery(),
      btcPriceQuery: { data: undefined, isLoading: false },
    }),
    useWalletBalances: () => ({ rows: [], isError: false }),
    useRestore: () => ({ restore: () => undefined, restoringId: null }),
    useAutoRefresh: () => undefined,
  }
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      createElement(
        TestChakraProvider,
        null,
        createElement(MemoryRouter, null, createElement(ClaimsPage, { dataSource })),
      ),
    )
  })

  const retry = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Try Again')
  assert.exists(retry, 'Expected a Try Again button')
  await act(async () => {
    retry.click()
  })
  expect(lists.exchanges.refetch).toHaveBeenCalledTimes(1)
  expect(lists.claims.refetch).not.toHaveBeenCalled()
  expect(lists.manual.refetch).not.toHaveBeenCalled()
  expect(lists.etfs.refetch).not.toHaveBeenCalled()
})
