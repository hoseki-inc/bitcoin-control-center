import { parseUnknown } from '@hoseki/packages/result'
// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Link, MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { AddInvestmentPage } from '../verify/investments'
import { ManualTypeSelectorPage } from '../verify/manual-type'
import { InvestmentDetailsPage } from './[id]'

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

async function renderPage(page: 'add' | 'details') {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const operations: Operation[] = []
  let valueCents = '1200000'
  const rpc = createTestTrpcClient(async (operation) => {
    operations.push(operation)
    if (operation.path === 'portalProve.investments.create') {
      return 'treasury'
    }
    if (operation.path === 'portalProve.investments.saveValuation') {
      valueCents = '1350050'
      return undefined
    }
    if (operation.path === 'portalProve.investments.get') {
      const { accountId } = parseUnknown(z.object({ accountId: z.string() }), operation.input).expect(
        'Expected account ID',
      )
      return {
        id: accountId,
        displayName: accountId === 'treasury' ? 'Treasury stocks' : 'Other investments',
        currency: 'USD',
        valueCents,
        valuedAt: '2026-10-01',
        createdAt: '',
        valuations: [
          {
            id: 'original',
            accountId: 'treasury',
            valueCents,
            valuedAt: '2026-10-01',
            note: 'Brokerage total',
            createdAt: '',
          },
        ],
      }
    }
    return []
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
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
          <MemoryRouter
            initialEntries={[
              {
                pathname: page === 'add' ? '/add' : '/accounts/investments/treasury',
                state: { returnTo: '/accounts/add' },
              },
            ]}
          >
            {page === 'details' && <Link to="/accounts/investments/other">Open another account</Link>}
            <Routes>
              <Route path="/add" element={<AddInvestmentPage />} />
              <Route path="/accounts/add" element={<p>Account choices</p>} />
              <Route path="/accounts/verify/manual-type" element={<ManualTypeSelectorPage />} />
              <Route
                path="/accounts/investments/:accountId"
                element={page === 'add' ? <p>Investment account created</p> : <InvestmentDetailsPage />}
              />
            </Routes>
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })
  async function fill(id: string, value: string): Promise<void> {
    const input = container.querySelector<HTMLInputElement>(`#${id}`)
    assert.exists(input)
    await act(async () => {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')
      assert(descriptor?.set !== undefined, 'Expected the value setter')
      descriptor.set.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
  async function click(label: string): Promise<void> {
    const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent === label)
    assert.exists(button)
    await act(async () => {
      button.click()
    })
  }
  return { container, operations, fill, click }
}

it('adds a manually valued account with exact USD cents, a date and a note', async () => {
  const page = await renderPage('add')
  await page.fill('investment-name', 'Treasury stocks')
  await page.fill('investment-value', '13500.50')
  await page.fill('investment-date', '2026-10-01')
  await page.fill('investment-note', 'Brokerage total')
  await page.click('Add Account')
  await vi.waitFor(
    () => {
      expect(page.container.textContent).toContain('Investment Added!')
    },
    { timeout: 3000 },
  )
  expect(page.container.textContent).not.toContain('BTC')
  expect(page.operations.some((operation) => operation.path.endsWith('.retrieveBitcoinPrice'))).toBe(false)
  await page.click('View Investment')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('Investment account created')
  })
  expect(page.operations.find((operation) => operation.path.endsWith('.create'))?.input).toEqual({
    displayName: 'Treasury stocks',
    valueCents: '1350050',
    valuedAt: '2026-10-01',
    note: 'Brokerage total',
  })
})

it('prefills an existing valuation for editing and refreshes the reported value after saving', async () => {
  const page = await renderPage('details')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('$12,000.00')
  })
  await page.click('Edit')
  expect(page.container.querySelector<HTMLInputElement>('#investment-value')?.value).toBe('12000.00')
  await page.fill('investment-value', '13500.50')
  await page.click('Save Valuation')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('$13,500.50')
  })
  expect(page.operations.find((operation) => operation.path.endsWith('.saveValuation'))?.input).toMatchObject({
    accountId: 'treasury',
    id: 'original',
    valueCents: '1350050',
    valuedAt: '2026-10-01',
    note: 'Brokerage total',
  })
  expect(page.container.textContent).not.toContain('Add Transaction')
})

it('requires an account name before creating an investment account', async () => {
  const page = await renderPage('add')
  await page.fill('investment-value', '100')
  const submit = page.container.querySelector<HTMLButtonElement>('button[type="submit"]')
  expect(submit?.disabled).toBe(true)
  expect(page.operations).toHaveLength(0)
})

it('clears the previous account edit state when opening another investment account', async () => {
  const page = await renderPage('details')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('Treasury stocks')
  })
  await page.click('Edit')
  await page.fill('investment-value', '15000')
  const link = page.container.querySelector<HTMLAnchorElement>('a[href="/accounts/investments/other"]')
  assert.exists(link)
  await act(async () => {
    link.click()
  })
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('Other investments')
  })
  expect(page.container.querySelector<HTMLInputElement>('#investment-value')?.value).toBe('')
  expect(page.container.textContent).toContain('Update Value')
})

it('asks before removing an investment account and does not send a delete on cancel', async () => {
  const page = await renderPage('details')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('Treasury stocks')
  })
  await page.click('Remove Account')
  expect(document.body.textContent).toContain('Remove Treasury stocks?')
  expect(page.operations.some((operation) => operation.path.endsWith('.delete'))).toBe(false)
  await page.click('Cancel')
  expect(page.operations.some((operation) => operation.path.endsWith('.delete'))).toBe(false)
})

it('returns from the investment celebration to the account choices', async () => {
  const page = await renderPage('add')
  await page.fill('investment-name', 'Preferred shares')
  await page.fill('investment-value', '1000')
  await page.click('Add Account')
  await vi.waitFor(
    () => {
      expect(page.container.textContent).toContain('Investment Added!')
    },
    { timeout: 3000 },
  )
  await page.click('Connect Another Account')
  await vi.waitFor(() => {
    expect(page.container.textContent).toContain('Account choices')
  })
})

it('goes back to the tracking choices and preserves their return to Add Account', async () => {
  const page = await renderPage('add')
  const back = page.container.querySelector<HTMLAnchorElement>('a[href="/accounts/verify/manual-type"]')
  assert.exists(back)
  await act(async () => {
    back.click()
  })
  expect(page.container.textContent).toContain('Track Balance, ETF, or xpub')
  const choicesBack = page.container.querySelector<HTMLAnchorElement>('a[href="/accounts/add"]')
  assert.exists(choicesBack)
  await act(async () => {
    choicesBack.click()
  })
  expect(page.container.textContent).toContain('Account choices')
})
