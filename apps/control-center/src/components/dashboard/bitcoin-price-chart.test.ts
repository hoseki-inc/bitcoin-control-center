// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClient } from '@tanstack/react-query'
import type { Operation } from '@trpc/client'
import { act, createElement } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { TestTrpcProvider, createTestTrpcClient } from '../../testing/trpc'
import type { HistoryLineChart } from '../dashboard-charts/history-line-chart'
import { BitcoinPriceChart, type BitcoinPriceChartViews } from './bitcoin-price-chart'

type HistoryLineChartProps = Parameters<typeof HistoryLineChart>[0]

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

const prices = [
  { time: 1000, value: 100 },
  { time: 2000, value: 105 },
]
const latest = { time: 2500, value: 110, source: 'mempool', sourceLabel: 'Your mempool server (node.local)' }
const requests: unknown[] = []
let unavailable = false
const rpc = createTestTrpcClient(async ({ path, input }: Operation) => {
  if (path !== 'portalProve.retrieveBitcoinPriceHistory') {
    throw new Error(`Unexpected request: ${path}`)
  }
  requests.push(input)
  if (unavailable) {
    throw new Error('Price history for this range is not available from your allowed price sources.')
  }
  return { quoteCurrency: 'USD', points: prices, historySources: ['node.local'], latest }
})

const chart = vi.fn<(props: HistoryLineChartProps) => void>()
const views: BitcoinPriceChartViews = {
  HistoryLineChart: (props) => {
    chart(props)
    return createElement('svg', { 'data-chart': 'history' })
  },
}

let root: Root
let container: HTMLDivElement

/** Let the tRPC link resolve inside act so React applies the resulting query update. */
async function waitForText(text: string): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      expect(container.textContent).toContain(text)
    })
  })
}

async function withTestSetup(reducedMotion: boolean, run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: reducedMotion,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  dom.window.matchMedia = matchMedia
  vi.stubGlobal('matchMedia', matchMedia)
  requests.length = 0
  chart.mockClear()
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
    queryClient.clear()
    unavailable = false
    vi.unstubAllGlobals()
    dom.window.close()
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      createElement(
        TestTrpcProvider,
        { client: queryClient, rpc },
        createElement(ChakraProvider, null, createElement(BitcoinPriceChart, { views })),
      ),
    )
  })
  await run()
}

it.each([false, true])(
  'keeps chart inspection and range selection available with reduced motion = %s',
  async (reducedMotion) => {
    await withTestSetup(reducedMotion, async () => {
      await waitForText('10.00% · 7d')
      expect(requests).toEqual([{ days: 7, quoteCurrency: 'USD' }])
      expect(container.textContent).toContain('$110')
      expect(container.textContent).toContain(
        'Daily prices from node.local · Latest from Your mempool server (node.local)',
      )
      expect(container.querySelector('h2')?.textContent).toBe('Bitcoin Price')
      expect(container.querySelector('[aria-pressed="true"]')?.getAttribute('aria-label')).toBe('Last 7 days')
      expect(container.querySelector('[data-chart="history"]')).not.toBeNull()
      for (const [label, days] of [
        ['7D', 7],
        ['30D', 30],
        ['6M', 180],
        ['1Y', 365],
      ] as const) {
        const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)
        assert(button !== undefined, `Expected a ${label} range button`)
        await act(async () => {
          button.click()
        })
        expect(button.getAttribute('aria-pressed')).toBe('true')
        expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
        await waitForText(`10.00% · ${label.toLowerCase()}`)
        expect(requests).toContainEqual({ days, quoteCurrency: 'USD' })
        expect(chart.mock.lastCall?.[0].data).toEqual([...prices, { time: latest.time, value: latest.value }])
      }
      expect(requests).toHaveLength(4)
    })
  },
)

it('shows when a range is not available from the allowed price sources', async () => {
  unavailable = true
  await withTestSetup(false, async () => {
    await waitForText('Price sources and fallbacks are set in Settings.')
    expect(chart.mock.lastCall?.[0]).toMatchObject({
      data: [],
      emptyMessage: 'Price history for this range is not available from your allowed price sources.',
    })
  })
})
