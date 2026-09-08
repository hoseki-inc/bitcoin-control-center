// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { type ReactElement, act, cloneElement } from 'react'
import { createRoot } from 'react-dom/client'
import type * as Recharts from 'recharts'
import { expect, it, vi } from 'vitest'
import { HistoryLineChart } from './history-line-chart'

// Give Recharts a deterministic viewport; all chart and tooltip behavior stays real.
vi.mock('recharts', async (importOriginal) => ({
  ...(await importOriginal<typeof Recharts>()),
  ResponsiveContainer: ({ children }: { children: ReactElement<{ width: number; height: number }> }) =>
    cloneElement(children, { width: 640, height: 240 }),
}))

it.each([false, true])('supports keyboard inspection with reduced motion = %s', async (reducedMotion) => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', () => ({
    matches: reducedMotion,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  }))
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <ChakraProvider>
          <HistoryLineChart
            data={[
              { time: 1000, value: 100 },
              { time: 2000, value: 110 },
            ]}
            formatValue={(value) => `$${value}`}
            formatTime={(time) => `Time ${time}`}
          />
        </ChakraProvider>,
      ),
    )
    const chart = container.querySelector<SVGSVGElement>('svg[role="application"]')!
    expect(chart).not.toBeNull()
    expect(chart.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('.recharts-line-curve')).not.toBeNull()
    await act(async () => chart.dispatchEvent(new FocusEvent('focusin', { bubbles: true })))
    await act(async () => chart.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(container.querySelector('.recharts-tooltip-wrapper')?.textContent).toContain('$110')
    expect(container.querySelector('.recharts-tooltip-wrapper')?.textContent).toContain('Time 2000')
  } finally {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
  }
})
