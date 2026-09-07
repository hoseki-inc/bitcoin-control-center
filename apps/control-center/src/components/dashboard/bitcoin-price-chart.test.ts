// @vitest-environment jsdom
import { ChakraProvider } from '@chakra-ui/react'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { BitcoinPriceChart } from './bitcoin-price-chart'

const mocks = vi.hoisted(() => ({ query: vi.fn(), chart: vi.fn() }))
vi.mock('../../trpc', () => ({ trpc: { portalProve: { retrieveBitcoinPriceHistory: { useQuery: mocks.query } } } }))
vi.mock('liveline', () => ({
  Liveline: (props: unknown) => {
    mocks.chart(props)
    return null
  },
}))

it.each([false, true])(
  'keeps chart inspection and range selection available with reduced motion = %s',
  async (reducedMotion) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: reducedMotion, addListener: vi.fn(), removeListener: vi.fn() })
    mocks.query.mockReturnValue({
      data: [
        { time: 1000, value: 100 },
        { time: 2000, value: 110 },
      ],
      isLoading: false,
      isError: false,
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(ChakraProvider, null, createElement(BitcoinPriceChart))))
      expect(mocks.query.mock.lastCall?.[0]).toEqual({ days: 7 })
      for (const [label, days] of [
        ['24H', 1],
        ['7D', 7],
        ['30D', 30],
        ['6M', 180],
        ['1Y', 365],
      ] as const) {
        const button = Array.from(container.querySelectorAll('button')).find((item) => item.textContent === label)!
        await act(async () => button.click())
        expect(button.getAttribute('aria-pressed')).toBe('true')
        expect(container.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
        expect(mocks.query.mock.lastCall?.[0]).toEqual({ days })
        expect(mocks.chart.mock.lastCall?.[0].scrub).toBe(true)
        expect(mocks.chart.mock.lastCall?.[0].window).toBe(days * 86400)
        expect(container.textContent).toContain(`10.00% · ${label.toLowerCase()}`)
      }
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  },
)
