// @vitest-environment node
import { Wallets } from '@hoseki/packages/testing'
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { expect, it, onTestFinished, vi } from 'vitest'
import { claimFixture } from '../../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import type { ClaimDto, KeystoreDto } from '../../../trpc/server-types'
import { ClaimDetails } from './claim-details'

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

const keystore: KeystoreDto = {
  id: 're_ks_1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  wallet: null,
  derivationPath: null,
  xpub: Wallets.nativeSegwitXpub,
  model: null,
  label: 'Default Keystore',
  isIdentified: false,
}

async function renderDetails(status: ClaimDto['status']): Promise<HTMLDivElement> {
  const dom = browser.acquire()
  vi.stubGlobal('Image', document.defaultView?.Image)
  const claim: ClaimDto = {
    ...claimFixture('re_clmx_1', 'Cold storage'),
    status,
    isVerified: status === 'verified',
    keystores: [keystore],
  }
  const client = new QueryClient({ logger: { log: console.log, warn: console.warn, error: () => undefined } })
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
      <TestTrpcProvider client={client} rpc={createTestTrpcClient(async () => null)}>
        <TestChakraProvider>
          <MemoryRouter>
            <ClaimDetails claim={claim} />
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })
  return container
}

const continueButton = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Continue')

it('asks to continue signing a single-sig wallet waiting to be proven', async () => {
  const container = await renderDetails('pending')

  expect(continueButton(container)).toBeDefined()
})

it('shows a tracked single-sig wallet as unverified, without asking to sign', async () => {
  const container = await renderDetails('unverified')

  expect(continueButton(container)).toBeUndefined()
  expect(container.textContent).toContain('unverified')
})
