import { ChakraProvider } from '@chakra-ui/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { expect, it } from 'vitest'
import { type InvestmentListQuery, InvestmentOverview } from './investment-overview'

const loaded: InvestmentListQuery = {
  data: [
    {
      id: 'treasury',
      displayName: 'Treasury stocks',
      currency: 'USD',
      valueCents: '1350000',
      valuedAt: '2026-11-03',
      createdAt: '',
    },
    {
      id: 'preferred',
      displayName: 'Preferred shares',
      currency: 'USD',
      valueCents: '250000',
      valuedAt: '2026-10-01',
      createdAt: '',
    },
  ],
  isLoading: false,
  isError: false,
  refetch: async () => ({}),
}
function render(query: InvestmentListQuery, bitcoinUsd: number | null): string {
  return renderToStaticMarkup(
    <ChakraProvider>
      <MemoryRouter>
        <InvestmentOverview
          query={query}
          bitcoinUsd={bitcoinUsd}
          showCombined
          chart={<div>Reported value history</div>}
        />
      </MemoryRouter>
    </ChakraProvider>,
  )
}

it('separates manually reported investment values and includes them in the USD total', () => {
  const html = render(loaded, 50000)
  expect(html).toContain('$16,000.00')
  expect(html).toContain('$66,000.00')
  expect(html).toContain('Reported value history')
  expect(html).not.toContain('View Accounts')
  expect(html).not.toContain('Oldest valuation:')
  expect(html).not.toContain('Manually updated')
  expect(html).not.toContain('excluded from BTC balances and accumulation')
})

it('withholds the combined value without a Bitcoin price and hides stale investment totals after errors', () => {
  const noPrice = render(loaded, null)
  expect(noPrice).toContain('$16,000.00')
  expect(noPrice).toContain('Unavailable until Bitcoin holdings can be valued')
  const failed = render({ ...loaded, isError: true }, 50000)
  expect(failed).toContain('Try Again')
  expect(failed).not.toContain('$16,000.00')
  expect(failed).not.toContain('$66,000.00')
})

it.each([NaN, Infinity, -1])(
  'does not display a false combined total for an invalid Bitcoin value: %s',
  (bitcoinUsd) => {
    const html = render(loaded, bitcoinUsd)
    expect(html).toContain('Unavailable until Bitcoin holdings can be valued')
    expect(html).toContain('$16,000.00')
  },
)

it('hides the panel for no investment accounts and omits the combined total for investment-only holdings', () => {
  expect(render({ ...loaded, data: [] }, 50000)).not.toContain('Other Bitcoin Investments')
  const html = renderToStaticMarkup(
    <ChakraProvider>
      <InvestmentOverview query={loaded} />
    </ChakraProvider>,
  )
  expect(html).toContain('$16,000.00')
  expect(html).not.toContain('Combined Portfolio Value')
})
