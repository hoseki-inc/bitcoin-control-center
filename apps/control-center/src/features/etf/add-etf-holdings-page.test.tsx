// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { ClaimsVerifyEtfPage } from './add-etf-holdings-page'

const dom = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  const browserDom = createBrowserDom()
  installBrowserDom(browserDom)
  return browserDom
})

it('names each holding row remove button by its row', async () => {
  const rpc = createTestTrpcClient(async ({ path }) => {
    throw new Error(`Unexpected request: ${path}`)
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      client.clear()
      container.remove()
    } finally {
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })
  await act(async () => {
    root.render(
      <TestChakraProvider>
        <TestTrpcProvider client={client} rpc={rpc}>
          <MemoryRouter>
            <ClaimsVerifyEtfPage />
          </MemoryRouter>
        </TestTrpcProvider>
      </TestChakraProvider>,
    )
  })
  const removeLabels = (): (string | null)[] =>
    Array.from(container.querySelectorAll('button[aria-label^="Remove"]'), (button) =>
      button.getAttribute('aria-label'),
    )
  // One row has nothing to remove.
  expect(removeLabels()).toEqual([])

  const addRow = Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent.includes('Add Another ETF'),
  )
  assert(addRow)
  for (const _ of [1, 2]) {
    await act(async () => {
      addRow.click()
    })
  }

  expect(removeLabels()).toEqual(['Remove holding 1', 'Remove holding 2', 'Remove holding 3'])
  expect(container.querySelector('button[aria-label="Close"]')).toBeNull()
})
