// @vitest-environment node
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient, notifyManager } from '@tanstack/react-query'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../../testing/trpc'
import { trpc } from '../../../trpc'
import { RenameClaim } from './rename-claim'

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

/** The lists that show account names, kept on screen beside the rename form. */
function AccountNameLists(): null {
  trpc.portalProve.registry.claims.list.useQuery({ excludePending: false })
  trpc.portalProve.registry.claims.listArchived.useQuery()
  trpc.portalProve.portfolio.getData.useQuery()
  return null
}

it('refreshes every list that shows account names after a rename', async () => {
  const dom = browser.acquire()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  notifyManager.setNotifyFunction((callback) => {
    act(callback)
  })
  const requests: string[] = []
  const rpc = createTestTrpcClient(async (operation) => {
    requests.push(operation.path)
    return operation.path.endsWith('.list') || operation.path.endsWith('.listArchived') ? [] : null
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
  let closed = false
  await act(async () => {
    root.render(
      <TestTrpcProvider client={client} rpc={rpc}>
        <TestChakraProvider>
          <AccountNameLists />
          <RenameClaim
            claimId="re_clmx_1"
            defaultName="Cold storage"
            onCancel={() => {
              closed = true
            }}
          />
        </TestChakraProvider>
      </TestTrpcProvider>,
    )
  })
  requests.length = 0

  const form = container.querySelector('form')
  assert.exists(form, 'Expected the rename form')
  await act(async () => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => {
    expect(closed).toBe(true)
  })

  expect(requests).toEqual(
    expect.arrayContaining([
      'portalProve.registry.claims.update',
      'portalProve.registry.claims.list',
      'portalProve.registry.claims.listArchived',
      'portalProve.portfolio.getData',
    ]),
  )
})
