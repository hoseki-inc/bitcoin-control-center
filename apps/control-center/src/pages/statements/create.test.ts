// @vitest-environment node
import * as pdfRenderer from '@hoseki/packages/pdf'
import { sampleCustomStatement } from '@hoseki/packages/pdf/preview/presets'
import { StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { TestChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { getQueryKey } from '@trpc/react-query'
import { type ReactElement, act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { StatementPollingProvider } from '../../providers/statement-polling-provider'
import { claimFixture } from '../../testing/claims'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import { trpc } from '../../trpc'
import type { StatementDto } from '../../trpc/server-types'
import { StatementCreatePage } from './create'

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

it.each(StatementQuoteCurrencySchema.options)(
  'sends selected %s consistently to preview and generation',
  async (currency) => {
    const dom = browser.acquire()
    const requests: Operation[] = []
    const claimId = 're_clmx_wallet'
    const statement: StatementDto = {
      id: 'new-statement',
      createdAt: new Date(),
      updatedAt: new Date(),
      openingDate: new Date('2026-08-01'),
      closingDate: new Date('2026-08-31'),
      counter: 1,
      timezone: 'UTC',
      status: 'pending',
      quoteCurrency: currency,
      errorMessage: null,
      user: { name: null, email: null },
      integrator: null,
      userId: 'local',
    }
    const rpc = createTestTrpcClient(async (operation) => {
      requests.push(operation)
      if (operation.path === 'portalProve.statement.generatePreview') {
        return { ...sampleCustomStatement, quoteCurrency: currency }
      }
      if (
        operation.path === 'portalProve.statement.initiateGeneration' ||
        operation.path === 'portalProve.statement.retrieve'
      ) {
        return statement
      }
      throw new Error(`Unexpected request: ${operation.path}`)
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    client.setQueryData(getQueryKey(trpc.portalProve.registry.claims.list, { excludePending: true }, 'query'), [
      claimFixture(claimId, 'Savings wallet'),
    ])
    client.setQueryData(getQueryKey(trpc.portalProve.exchange.list, undefined, 'query'), [])
    client.setQueryData(getQueryKey(trpc.portalProve.retrieveBitcoinPrice, undefined, 'query'), null)
    client.setQueryData(
      getQueryKey(trpc.portalProve.onchain.claimBalances, { claimIds: [claimId] }, 'query'),
      new Map(),
    )
    client.setQueryData(['local-settings', 'user_name'], null)
    // Keep rendering pending: this test checks request inputs; the hook and PDF tests cover rendering.
    vi.spyOn(pdfRenderer, 'renderStatementDocument').mockImplementation(
      async () => new Promise<ReactElement>(() => undefined),
    )
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    onTestFinished(async () => {
      await act(async () => {
        root.unmount()
      })
      client.clear()
      container.remove()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
      dom.window.close()
    })
    await act(async () => {
      root.render(
        createElement(
          TestTrpcProvider,
          { client, rpc },
          createElement(
            TestChakraProvider,
            null,
            createElement(
              MemoryRouter,
              null,
              createElement(StatementPollingProvider, null, createElement(StatementCreatePage)),
            ),
          ),
        ),
      )
    })
    const select = container.querySelector('#quote-currency')
    assert.instanceOf(select, dom.window.HTMLSelectElement)
    expect(select.value).toBe('USD')
    await act(async () => {
      select.value = currency
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const preview = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Preview Statement',
    )
    assert.exists(preview)
    await act(async () => {
      preview.click()
    })
    await vi.waitFor(() => {
      expect(requests.find((request) => request.path === 'portalProve.statement.generatePreview')?.input).toEqual(
        expect.objectContaining({ quoteCurrency: currency, claimIds: [claimId] }),
      )
    })
    const close = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === 'Close')
    assert.exists(close)
    await act(async () => {
      close.click()
    })
    const generate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Generate Statement',
    )
    assert.exists(generate)
    expect(generate.disabled).toBe(false)
    await act(async () => {
      generate.click()
    })
    await vi.waitFor(() => {
      expect(requests.find((request) => request.path === 'portalProve.statement.initiateGeneration')?.input).toEqual(
        expect.objectContaining({ quoteCurrency: currency, claimIds: [claimId] }),
      )
    })
  },
)
