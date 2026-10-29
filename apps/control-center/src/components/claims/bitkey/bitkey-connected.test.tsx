// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { Decimal } from 'decimal.js'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { BitkeyConnected } from './bitkey-connected'

const dom = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  const browserDom = createBrowserDom()
  // With reduced motion the balance shows at once and there are no fireworks to draw.
  browserDom.window.matchMedia = (media) => ({
    media,
    matches: media === '(prefers-reduced-motion)',
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  installBrowserDom(browserDom)
  return browserDom
})

it('shows the scanned balance when the price lookup fails', async () => {
  const claim = { ...claimFixture('re_clmx_bitkey', 'Bitkey'), status: 'unverified' as const }
  const rpc = createTestTrpcClient(async ({ path }) => {
    if (path === 'portalProve.onchain.claimBalances') {
      return new Map([[claim.id, new Decimal(100_000_000)]])
    }
    if (path === 'portalProve.retrieveBitcoinPrice') {
      throw new Error('No price source answered')
    }
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
      <ChakraProvider>
        <TestTrpcProvider client={client} rpc={rpc}>
          <MemoryRouter>
            <BitkeyConnected claim={claim} />
          </MemoryRouter>
        </TestTrpcProvider>
      </ChakraProvider>,
    )
  })

  await vi.waitFor(() => {
    expect(container.textContent).toContain('USD unavailable')
  })
  expect(container.textContent).toContain('1.00000000BTC')
  expect(container.textContent).not.toContain('—')
})
