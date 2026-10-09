// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { AccumulationChart } from './accumulation-chart'
import type { BalanceDataPoint } from './balance-history'

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

async function withTestSetup(run: () => Promise<void>, { reducedMotion = true } = {}): Promise<void> {
  const dom = browser.acquire()
  // Reduced motion draws the balance at its final shape straight away.
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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      public observe = vi.fn()
      public disconnect = vi.fn()
    },
  )
  // Give Recharts' ResponsiveContainer a deterministic size and each axis label a small one,
  // as the Y axis sizes itself to its labels; the chart itself stays real.
  const chartSize = { x: 0, y: 0, top: 0, left: 0, right: 640, bottom: 220, width: 640, height: 220 }
  const labelSize = { x: 0, y: 0, top: 0, left: 0, right: 40, bottom: 14, width: 40, height: 14 }
  function boundingBox(this: Element): DOMRect {
    const size = this instanceof dom.window.HTMLDivElement ? chartSize : labelSize
    return { ...size, toJSON: () => size }
  }
  const rect = vi.spyOn(dom.window.Element.prototype, 'getBoundingClientRect').mockImplementation(boundingBox)
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

async function render(data: BalanceDataPoint[], options: { startLabel?: 'day' | 'month' } = {}): Promise<void> {
  await act(async () => {
    root.render(
      <ChakraProvider>
        <AccumulationChart data={data} timezone="UTC" {...options} />
      </ChakraProvider>,
    )
  })
}

/** The balance in BTC on the 5th of every other month from March 2014, a past year, so each date shows its year. */
function history(...balances: number[]): BalanceDataPoint[] {
  return balances.map((btc, index) => ({
    timestamp: new Date(Date.UTC(2014, 2 + index * 2, 5, 12)).toISOString(),
    totalBalance: String(Math.round(btc * 100_000_000)),
    // Stored history carries each day's price.
    btcPrice: '500',
  }))
}

/** Each label along an axis, in order. */
function axisLabels(axis: 'xAxis' | 'yAxis'): (string | null)[] {
  return Array.from(container.querySelectorAll(`.recharts-${axis}-tick-labels text`), (label) => label.textContent)
}

/** Focuses the chart, which shows the first point's tooltip. */
async function inspectFirstPoint(): Promise<HTMLElement> {
  const chart = container.querySelector<SVGSVGElement>('svg[role="application"]')
  assert(chart !== null, 'Expected an inspectable chart')
  const view = chart.ownerDocument.defaultView
  assert.exists(view, 'Expected the chart window')
  await act(async () => chart.dispatchEvent(new view.FocusEvent('focusin', { bubbles: true })))
  const tooltip = container.querySelector<HTMLElement>('.recharts-tooltip-wrapper')
  assert.exists(tooltip, 'Expected the tooltip')
  return tooltip
}

it('names the chart for assistive technology', async () => {
  await withTestSetup(async () => {
    await render(history(0.5, 0.8, 1, 1.5))
    expect(container.querySelector('svg[role="application"]')?.getAttribute('aria-label')).toBe(
      'Bitcoin balance history',
    )
  })
})

it('labels only the first and last dates', async () => {
  await withTestSetup(async () => {
    await render(history(0.5, 0.8, 1, 1.5))
    expect(axisLabels('xAxis')).toEqual(['Mar 5, 2014', 'Sep 5, 2014'])
  })
})

it('shows the first date as a month and year for all-time history', async () => {
  await withTestSetup(async () => {
    await render(history(0.5, 0.8, 1, 1.5), { startLabel: 'month' })
    expect(axisLabels('xAxis')).toEqual(['Mar 2014', 'Sep 5, 2014'])
  })
})

it.each([
  ['two decimals from 1 BTC', history(0.5, 0.8, 1, 1.5), ['0.35', '1.00', '1.65']],
  // At four decimals a flat 123,456 sats reads 0.0011, 0.0012, 0.0014.
  [
    'decimals until a flat balance reads as even steps',
    history(0.00123456, 0.00123456),
    ['0.00111', '0.00123', '0.00136'],
  ],
])('labels the balance axis with %s', async (_label, data, expected) => {
  await withTestSetup(async () => {
    await render(data)
    expect(axisLabels('yAxis')).toEqual(expected)
  })
})

it.each([false, true])('animates only without reduced motion, reduced motion = %s', async (reducedMotion) => {
  await withTestSetup(
    async () => {
      await render(history(0.5, 0.8, 1, 1.5))
      const area = container.querySelector('.recharts-area')
      assert.exists(area, 'Expected the balance area')
      // Recharts reveals an animated area through a clip that widens from the left.
      expect(area.querySelector('[clip-path]') === null).toBe(reducedMotion)
      const tooltip = await inspectFirstPoint()
      expect(tooltip.style.transition === '').toBe(reducedMotion)
    },
    { reducedMotion },
  )
})

it("reads a point's date and BTC balance without a USD line", async () => {
  await withTestSetup(async () => {
    await render(history(0.5, 0.8, 1, 1.5))
    const tooltip = await inspectFirstPoint()
    // The point's stored price is not shown as USD.
    expect(tooltip.textContent).toBe('March 5, 20140.50000000 BTC')
  })
})
