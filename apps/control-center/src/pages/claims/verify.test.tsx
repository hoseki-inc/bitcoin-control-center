// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'
import { ClaimVerificationReceiptPage } from './verify'

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

const id = 're_clmx_receipt'

/** Open the receipt; Sentinel answers with `status`, and `cached` is what signing left in the cache. */
async function openReceipt(status: ClaimDto['status'], cached?: ClaimDto['status']): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const rpc = createTestTrpcClient(async (operation) =>
    operation.path === 'portalProve.registry.claims.get.byId'
      ? { ...claimFixture(id, 'Cold storage'), status }
      : new Promise<never>(() => undefined),
  )
  const client = new QueryClient()
  if (cached !== undefined) {
    const key = getQueryKey(trpc.portalProve.registry.claims.get.byId, { id }, 'query')
    client.setQueryData(key, { ...claimFixture(id, 'Cold storage'), status: cached })
    // Completing the challenge marks every query stale.
    await client.invalidateQueries({ refetchType: 'none' })
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
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <ChakraProvider>
          <MemoryRouter initialEntries={[`/accounts/verify/receipt/${id}`]}>
            <Routes>
              <Route path="/accounts/verify/receipt/:claimId" element={<ClaimVerificationReceiptPage />} />
              <Route path="/accounts/:id" element={<p>Account page</p>} />
            </Routes>
          </MemoryRouter>
        </ChakraProvider>
      </TestTrpcProvider>,
    )
  })
  return container
}

it.each(['unverified', 'pending', 'expired'] as const)(
  'sends a %s account to its details instead of a receipt',
  async (status) => {
    const container = await openReceipt(status)

    await vi.waitFor(() => {
      expect(container.textContent).toContain('Account page')
    })
    expect(container.textContent).not.toContain('Verified!')
  },
)

it('shows the receipt once signing has verified the account, even if the cache still says pending', async () => {
  const container = await openReceipt('verified', 'pending')

  await vi.waitFor(
    () => {
      expect(container.textContent).toContain('Verified!')
    },
    { timeout: 4000 },
  )
  expect(container.textContent).not.toContain('Account page')
})
