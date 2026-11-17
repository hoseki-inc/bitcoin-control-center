// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
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

async function renderManualAccount() {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: string[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation.path)
    switch (operation.path) {
      case 'portalProve.manual.get':
        return {
          id: 'acct_manual',
          displayName: 'Paper wallet',
          balance: '100000000',
          balanceAsOf: '2026-10-01T16:00:00.000Z',
          createdAt: '2026-10-01T16:00:00.000Z',
        }
      case 'portalProve.manual.transactions.list':
        return []
      default:
        return null
    }
  })
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
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <TestChakraProvider>
          <MemoryRouter initialEntries={['/accounts/manual/acct_manual']}>
            <Routes>
              <Route path="/accounts/manual/:accountId" element={<ManualAccountDetailsPage />} />
            </Routes>
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Update Balance')
  })

  const fill = async (element: HTMLInputElement, value: string): Promise<void> => {
    await act(async () => {
      // Set the value the way the browser does, so React sees the change.
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected the value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  const button = (label: string): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
    assert(found !== undefined, `Expected the ${label} button`)
    return found
  }
  const [balanceAmount, txAmount] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'))
  const [balanceDate, txDate] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'))
  assert.exists(balanceAmount, 'Expected the balance amount input')
  assert.exists(txAmount, 'Expected the transaction amount input')
  assert.exists(balanceDate, 'Expected the balance date input')
  assert.exists(txDate, 'Expected the transaction date input')
  requests.length = 0
  return { requests, fill, button, balanceAmount, txAmount, balanceDate, txDate }
}

it('keeps Update disabled while the balance date is cleared', async () => {
  const page = await renderManualAccount()

  await page.fill(page.balanceAmount, '0.5')
  expect(page.button('Update').disabled).toBe(false)

  await page.fill(page.balanceDate, '')
  expect(page.button('Update').disabled).toBe(true)
  await act(async () => {
    page.button('Update').click()
  })
  expect(page.requests).not.toContain('portalProve.manual.updateBalance')
})

it('keeps Add disabled while the transaction date is cleared', async () => {
  const page = await renderManualAccount()

  await page.fill(page.txAmount, '0.1')
  expect(page.button('Add').disabled).toBe(false)

  await page.fill(page.txDate, '')
  expect(page.button('Add').disabled).toBe(true)
  await act(async () => {
    page.button('Add').click()
  })
  expect(page.requests).not.toContain('portalProve.manual.transactions.add')
})
