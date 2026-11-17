// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { ClaimsVerifyManualPage } from './manual'

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

it('keeps Add Holding disabled while the date is cleared', async () => {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: string[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation.path)
    return null
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
          <MemoryRouter>
            <ClaimsVerifyManualPage />
          </MemoryRouter>
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
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
  const addButton = (): HTMLButtonElement => {
    const found = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === 'Add Holding')
    assert(found !== undefined, 'Expected the Add Holding button')
    return found
  }
  const [nameInput, amountInput, dateInput] = Array.from(container.querySelectorAll('input'))
  assert.exists(nameInput, 'Expected the display name input')
  assert.exists(amountInput, 'Expected the amount input')
  assert.exists(dateInput, 'Expected the date input')

  await fill(nameInput, 'Paper wallet')
  await fill(amountInput, '0.5')
  expect(addButton().disabled).toBe(false)

  await fill(dateInput, '')
  expect(addButton().disabled).toBe(true)
  await act(async () => {
    addButton().click()
  })
  expect(requests).not.toContain('portalProve.manual.create')
})
