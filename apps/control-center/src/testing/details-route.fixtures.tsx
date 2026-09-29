import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { expect, onTestFinished, vi } from 'vitest'
import { KeystoreReceiptPage } from '../components/multisig/keystore-receipt'
import { MultisigPageWrapper } from '../components/multisig/multisig-page-wrapper'
import { ClaimDetailsPage } from '../pages/claims/[id]'
import { SinglesigSigningPage } from '../pages/claims/[id]/signing'
import { ClaimVerificationReceiptPage } from '../pages/claims/verify'
import { StatementDetailsPage } from '../pages/statements/[id]'
import { TestTrpcProvider, createTestTrpcClient } from './trpc'

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

interface DetailsRouteScenario {
  container: HTMLDivElement
  open: () => Promise<void>
  goHome: () => Promise<void>
  requests: Operation[]
}

async function clickLink(container: HTMLElement, label: string): Promise<void> {
  const link = Array.from(container.querySelectorAll('a')).find((element) => element.textContent === label)
  if (link === undefined) {
    expect.fail(`Missing navigation link: ${label}`)
  }

  await act(async () => {
    link.click()
  })
}

function createMissingRecordClient(requests: Operation[]) {
  return createTestTrpcClient(async (operation) => {
    requests.push(operation)

    throw new Error('Not found')
  })
}

function setupRouteRenderer(path: string) {
  const dom = browser.acquire()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const requests: Operation[] = []
  const rpc = createMissingRecordClient(requests)

  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    client.clear()
    container.remove()

    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })

  const render = async (initialPath: string): Promise<void> => {
    await act(async () => {
      root.render(
        <ChakraProvider>
          <TestTrpcProvider client={client} rpc={rpc}>
            <MemoryRouter initialEntries={[initialPath]}>
              <Link to="/home">Home</Link>
              <Routes>
                <Route
                  path="/home"
                  element={
                    <main>
                      <h1>Home page</h1>
                      <Link to={path}>Open details</Link>
                    </main>
                  }
                />
                <Route path="/accounts/:claimId" element={<ClaimDetailsPage />} />
                <Route path="/accounts/:claimId/signing" element={<SinglesigSigningPage />} />
                <Route path="/accounts/verify/receipt/:claimId" element={<ClaimVerificationReceiptPage />} />
                <Route path="/statements/:statementId" element={<StatementDetailsPage />} />
                <Route path="/multisig/:claimId" element={<MultisigPageWrapper />} />
                <Route path="/multisig/verify/receipt/:claimId/:keystoreId" element={<KeystoreReceiptPage />} />
              </Routes>
            </MemoryRouter>
          </TestTrpcProvider>
        </ChakraProvider>,
      )
    })
  }

  return { container, render, requests }
}

export async function setupDetailsRoute(path: string, entry: 'direct' | 'navigation'): Promise<DetailsRouteScenario> {
  const { container, render, requests } = setupRouteRenderer(path)

  if (entry === 'navigation') {
    await render('/home')
    expect(container.textContent, 'Navigation must start from a rendered page').toContain('Home page')
  }

  return {
    container,
    requests,
    open: async () => (entry === 'direct' ? render(path) : clickLink(container, 'Open details')),
    goHome: async () => clickLink(container, 'Home'),
  }
}
