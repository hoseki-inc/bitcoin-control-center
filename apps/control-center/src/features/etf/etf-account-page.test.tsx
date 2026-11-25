// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { MotionGlobalConfig } from 'framer-motion'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { EtfAccountDetailsPage } from './etf-account-page'

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

it('confirms before removing an ETF account: Cancel keeps it, Remove deletes it', async () => {
  const dom = browser.acquire()
  MotionGlobalConfig.skipAnimations = true
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })

  const deleteCalls: unknown[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    switch (operation.path) {
      case 'portalProve.etf.get':
        return {
          id: 'etf-1',
          displayName: 'Fidelity IRA',
          balance: '100000000',
          createdAt: '2026-01-01T00:00:00.000Z',
        }
      case 'portalProve.etf.holdings.list':
        return []
      case 'portalProve.etf.delete':
        deleteCalls.push(operation.input)
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
          <MemoryRouter initialEntries={['/accounts/etf/etf-1']}>
            <Routes>
              <Route path="/accounts/etf/:accountId" element={<EtfAccountDetailsPage />} />
              <Route path="/accounts" element={<div data-testid="accounts-list">Accounts</div>} />
            </Routes>
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })

  await vi.waitFor(() => {
    expect(container.textContent).toContain('Fidelity IRA')
  })

  const clickPageButton = async (label: string): Promise<void> => {
    const button = [...container.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
    assert(button !== undefined, `Expected button "${label}"`)
    await act(async () => {
      button.click()
    })
  }
  const dialog = (): Element | null => document.body.querySelector('[role="dialog"]')
  const clickDialogButton = async (label: string): Promise<void> => {
    const activeDialog = dialog()
    assert(activeDialog !== null, 'Expected confirmation dialog to be open')
    const button = [...activeDialog.querySelectorAll('button')].find((node) => node.textContent.trim() === label)
    assert(button !== undefined, `Expected dialog button "${label}"`)
    await act(async () => {
      button.click()
    })
  }

  await clickPageButton('Remove Account')
  expect(deleteCalls).toEqual([])
  expect(dialog()?.textContent).toContain('Remove Fidelity IRA?')
  expect(dialog()?.textContent).toContain('ETF account')

  await clickDialogButton('Cancel')
  await vi.waitFor(() => {
    expect(dialog()).toBeNull()
  })
  expect(deleteCalls).toEqual([])
  expect(container.textContent).toContain('Fidelity IRA')

  await clickPageButton('Remove Account')
  await clickDialogButton('Remove')

  await vi.waitFor(() => {
    expect(container.querySelector('[data-testid="accounts-list"]')).not.toBeNull()
  })
  expect(deleteCalls).toEqual([{ accountId: 'etf-1' }])
})
