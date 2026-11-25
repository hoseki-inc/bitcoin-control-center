// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { MotionGlobalConfig } from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { Toaster, toast } from 'sonner'
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

async function renderManualAccount(options?: { balanceSats?: string; addTransactionError?: string }) {
  const dom = browser.acquire()
  MotionGlobalConfig.skipAnimations = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: Array<{ path: string; input: unknown }> = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push({ path: operation.path, input: operation.input })
    switch (operation.path) {
      case 'portalProve.manual.get':
        return {
          id: 'acct_manual',
          displayName: 'Paper wallet',
          balance: options?.balanceSats ?? '100000000',
          balanceAsOf: '2026-10-01T16:00:00.000Z',
          createdAt: '2026-10-01T16:00:00.000Z',
        }
      case 'portalProve.manual.transactions.list':
        return []
      case 'portalProve.manual.transactions.add':
        if (options?.addTransactionError !== undefined) {
          throw new Error(options.addTransactionError)
        }
        return null
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
      toast.dismiss()
      root.unmount()
    })
    container.remove()
    client.clear()
    notifyManager.setNotifyFunction((callback) => {
      callback()
    })
    MotionGlobalConfig.skipAnimations = false
    vi.unstubAllGlobals()
    dom.window.close()
  })
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <TestChakraProvider>
          <Toaster />
          <MemoryRouter initialEntries={['/accounts/manual/acct_manual']}>
            <Routes>
              <Route path="/accounts/manual/:accountId" element={<ManualAccountDetailsPage />} />
              <Route path="/accounts" element={<div data-testid="accounts-list">Accounts</div>} />
            </Routes>
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })
  await vi.waitFor(() => {
    expect(container.textContent).toContain('Update Balance')
  })

  const fill = async (element: HTMLInputElement | HTMLSelectElement, value: string): Promise<void> => {
    await act(async () => {
      // Set the value the way the browser does, so React sees the change.
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')
      assert(descriptor?.set !== undefined, 'Expected the value setter')
      descriptor.set.call(element, value)
      element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
    })
  }
  const button = (label: string): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
    assert(found !== undefined, `Expected the ${label} button`)
    return found
  }
  const dialog = (): Element | null => document.body.querySelector('[role="dialog"]')
  const clickDialogButton = async (label: string): Promise<void> => {
    const activeDialog = dialog()
    assert(activeDialog !== null, 'Expected confirmation dialog to be open')
    const found = Array.from(activeDialog.querySelectorAll('button')).find((item) => item.textContent === label)
    assert(found !== undefined, `Expected the ${label} dialog button`)
    await act(async () => {
      found.click()
    })
  }
  const [balanceAmount, txAmount] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="number"]'))
  const [balanceDate, txDate] = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'))
  const txType = container.querySelector<HTMLSelectElement>('select')
  const addToBalance = container.querySelector<HTMLInputElement>('input[type="checkbox"]')
  assert.exists(balanceAmount, 'Expected the balance amount input')
  assert.exists(txAmount, 'Expected the transaction amount input')
  assert.exists(balanceDate, 'Expected the balance date input')
  assert.exists(txDate, 'Expected the transaction date input')
  assert.exists(txType, 'Expected the transaction type select')
  assert.exists(addToBalance, 'Expected the Add this amount to balance checkbox')
  requests.length = 0
  return {
    container,
    requests,
    fill,
    button,
    dialog,
    clickDialogButton,
    balanceAmount,
    txAmount,
    balanceDate,
    txDate,
    txType,
    addToBalance,
  }
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
  expect(page.requests.map((request) => request.path)).not.toContain('portalProve.manual.updateBalance')
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
  expect(page.requests.map((request) => request.path)).not.toContain('portalProve.manual.transactions.add')
})

it.each([
  'This would take the balance below zero. Update the balance first, then log the sell.',
  'This would take the balance on Sep 3, 2026 below zero. Update the balance first, then log the sell.',
])('shows the refusal toast and keeps the balance unchanged when a checked sell is refused (%s)', async (message) => {
  const page = await renderManualAccount({
    balanceSats: '50000000',
    addTransactionError: message,
  })
  expect(page.container.textContent).toContain('0.50000000 BTC')

  await page.fill(page.txType, 'sell')
  await page.fill(page.txAmount, '0.8')
  await act(async () => {
    page.addToBalance.click()
  })
  await act(async () => {
    page.button('Add').click()
  })

  await vi.waitFor(() => {
    expect(document.body.textContent).toContain(message)
  })
  expect(page.requests.map((request) => request.path)).toEqual(['portalProve.manual.transactions.add'])
  expect(page.requests[0]?.input).toMatchObject({
    accountId: 'acct_manual',
    type: 'sell',
    amountSats: '80000000',
    addToBalance: true,
  })
  expect(page.container.textContent).toContain('0.50000000 BTC')
  expect(page.container.textContent).not.toContain('Transactions')
})

it('confirms before removing a manual account: Cancel keeps it, Remove deletes it', async () => {
  const page = await renderManualAccount()

  await act(async () => {
    page.button('Remove Account').click()
  })
  expect(page.dialog()?.textContent).toContain('Remove Paper wallet?')
  expect(page.dialog()?.textContent).toContain(
    'It will be removed from all your charts and totals, and its balance history and transactions will be deleted.',
  )
  expect(page.requests.map((request) => request.path)).not.toContain('portalProve.manual.delete')

  await page.clickDialogButton('Cancel')
  await vi.waitFor(() => {
    expect(page.dialog()).toBeNull()
  })
  expect(page.requests.map((request) => request.path)).not.toContain('portalProve.manual.delete')
  expect(page.container.textContent).toContain('Paper wallet')

  await act(async () => {
    page.button('Remove Account').click()
  })
  await page.clickDialogButton('Remove')

  await vi.waitFor(() => {
    expect(page.container.querySelector('[data-testid="accounts-list"]')).not.toBeNull()
  })
  expect(page.requests).toContainEqual({
    path: 'portalProve.manual.delete',
    input: { accountId: 'acct_manual' },
  })
})
