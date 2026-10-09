// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import type { BalanceDataPoint } from './balance-history'
import { chartColors } from './chart-colors'
import { MonthlyNetChangeChart } from './monthly-net-change-chart'

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

let root: Root
let container: HTMLDivElement

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  // Reduced motion draws each bar at its final size straight away.
  const matchMedia = (media: string): MediaQueryList => ({
    media,
    matches: true,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => true,
  })
  dom.window.matchMedia = matchMedia
  vi.stubGlobal('matchMedia', matchMedia)
  // Give Recharts' ResponsiveContainer a deterministic size; the chart itself stays real.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
  const size = { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 200, width: 640, height: 200 }
  const rect = vi
    .spyOn(dom.window.Element.prototype, 'getBoundingClientRect')
    .mockReturnValue({ ...size, toJSON: () => size })
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    try {
      await act(async () => {
        root.unmount()
      })
      container.remove()
      // Recharts batches its store updates behind a 100 ms fallback timer; let it run while the window still exists.
      await new Promise((resolve) => {
        setTimeout(resolve, 150)
      })
    } finally {
      rect.mockRestore()
      vi.unstubAllGlobals()
      dom.window.close()
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await run()
}

async function render(data: BalanceDataPoint[]): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <MonthlyNetChangeChart data={data} timezone="UTC" btcPrice={100_000} />
      </ChakraProvider>,
    )
  })
}

/** Starting from 1 BTC on August 1, 2025, the balance in BTC at the end of August and each month after. */
function monthEnds(...balances: number[]): BalanceDataPoint[] {
  return [
    { timestamp: '2025-08-01T12:00:00.000Z', totalBalance: '100000000' },
    ...balances.map((btc, index) => ({
      timestamp: new Date(Date.UTC(2025, 8 + index, 0, 12)).toISOString(),
      totalBalance: String(Math.round(btc * 100_000_000)),
    })),
  ]
}

/** Each month's bar, in month order. */
function bars(): SVGPathElement[] {
  return Array.from(container.querySelectorAll<SVGPathElement>('.recharts-bar-rectangle path'))
}

/** The y of each rounded corner's end point along a bar's outline. */
function cornerEnds(bar: SVGPathElement): number[] {
  return Array.from((bar.getAttribute('d') ?? '').matchAll(/A\s*(?:-?[\d.]+,\s*){5}-?[\d.]+,\s*(-?[\d.]+)/g), (arc) =>
    Number(arc[1]),
  )
}

/** Each label under the bars, in month order. */
function monthLabels(): (string | null)[] {
  return Array.from(container.querySelectorAll('.recharts-xAxis-tick-labels text'), (label) => label.textContent)
}

it('names the chart for assistive technology', async () => {
  await withTestSetup(async () => {
    await render(monthEnds(1.5, 1.7, 1.4))
    expect(container.querySelector('svg[role="application"]')?.getAttribute('aria-label')).toBe('Monthly net change')
  })
})

it('fills gains and losses with their own colors', async () => {
  await withTestSetup(async () => {
    await render(monthEnds(1.5, 1.7, 1.4))
    expect(bars().map((bar) => bar.getAttribute('fill'))).toEqual([
      chartColors.gain,
      chartColors.gain,
      chartColors.loss,
    ])
  })
})

it.each([
  ['gains', [1.2, 1.5, 1.6]],
  ['loses', [0.9, 0.7, 0.6]],
  ['gains or loses', [1.5, 1.7, 1.4]],
])('stands every bar on the zero line when each month %s', async (_label, balances) => {
  await withTestSetup(async () => {
    await render(monthEnds(...balances))
    const zero = container.querySelector('.recharts-reference-line-line')
    assert.exists(zero, 'Expected the zero line inside the chart')
    expect(bars()).toHaveLength(3)
    for (const bar of bars()) {
      // A loss has a negative height, so either way the bar's base is y + height.
      const height = Number(bar.getAttribute('height'))
      expect(Math.abs(height)).toBeGreaterThan(0)
      expect(Number(bar.getAttribute('y')) + height).toBeCloseTo(Number(zero.getAttribute('y1')))
    }
  })
})

it('rounds a losing bar at its bottom, away from the zero line', async () => {
  await withTestSetup(async () => {
    await render(monthEnds(1.5, 1.7, 1.4))
    const loss = bars()[2]
    assert.exists(loss, 'Expected the losing bar')
    const y = Number(loss.getAttribute('y'))
    const bottom = Math.max(y, y + Number(loss.getAttribute('height')))
    // Each 3px corner runs from the bottom edge to 3px up its side, so none reaches the zero line.
    const distancesFromBottom = cornerEnds(loss).map((end) => Number((bottom - end).toFixed(4)))
    expect(distancesFromBottom.sort((a, b) => a - b)).toEqual([0, 3])
  })
})

it('labels every third month beyond a year, counting back from the latest', async () => {
  await withTestSetup(async () => {
    // August 2025 through July 2027.
    await render(monthEnds(...Array.from({ length: 24 }, (_, index) => 1.1 + index / 10)))
    expect(bars()).toHaveLength(24)
    expect(monthLabels()).toEqual(['Oct \u201925', 'Jan \u201926', 'Apr', 'Jul', 'Oct', 'Jan \u201927', 'Apr', 'Jul'])
  })
})

it('reads a losing month with its year and a minus sign in BTC and USD', async () => {
  await withTestSetup(async () => {
    await render(monthEnds(1.5, 1.7, 1.4))
    const chart = container.querySelector<SVGSVGElement>('svg[role="application"]')
    assert(chart !== null, 'Expected an inspectable chart')
    const view = chart.ownerDocument.defaultView
    assert.exists(view, 'Expected the chart window')
    await act(async () => chart.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true })))
    for (let month = 0; month < 2; month++) {
      await act(async () =>
        chart.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })),
      )
    }
    expect(container.querySelector('.recharts-tooltip-wrapper')?.textContent).toBe(
      'Oct 2025\u22120.30000000 BTC\u2212$30,000.00',
    )
  })
})
