import { ChakraProvider } from '@chakra-ui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as DashboardBanner from '../components/dashboard/banner'
import type { BitcoinDisplayUnit } from '../lib/bitcoin-display'
import { HomePage } from './index'

const mocks = vi.hoisted(() => ({
  accounts: { claims: [] as unknown[], exchange: [] as unknown[], manual: [] as unknown[], etf: [] as unknown[] },
  prices: [] as Array<{ time: number; value: number }>,
  history: [] as Array<{ timestamp: string; totalBalance: string }>,
  isLoading: false,
  isError: false,
  statementsError: false,
  btcPrice: '50000',
  onboarding: 'dismissed' as string | null,
  unit: 'btc' as BitcoinDisplayUnit,
}))

vi.mock('../trpc', () => {
  const result = (data: unknown) => ({ data, isLoading: false, isError: false, refetch: vi.fn() })
  const accounts = (key: keyof typeof mocks.accounts) => ({
    list: { useQuery: () => ({ ...result(mocks.accounts[key]), isLoading: mocks.isLoading, isError: mocks.isError }) },
  })
  return {
    trpc: {
      portalProve: {
        retrieveBitcoinPriceHistory: { useQuery: () => result(mocks.prices) },
        statement: { list: { useQuery: () => ({ ...result([]), isError: mocks.statementsError }) } },
        registry: { claims: accounts('claims') },
        exchange: accounts('exchange'),
        manual: accounts('manual'),
        etf: accounts('etf'),
        controlCenter: {
          getData: {
            useQuery: () =>
              result({
                currentTotalBalance: '0',
                currentBtcPrice: mocks.btcPrice,
                historicalData: mocks.history,
                verifiedClaimsCount: 0,
                exchangeAccountCount: 0,
              }),
          },
        },
      },
    },
  }
})

vi.mock('../hooks/use-local-settings', () => ({
  useLocalSetting: () => ({ data: mocks.onboarding, isLoading: false, isError: false }),
}))

vi.mock('../hooks/use-ui-settings', () => ({
  useUiSettings: () => ({ isStatementsMadeEasyDismissed: false, updateUiSettings: vi.fn() }),
}))
vi.mock('../hooks/use-bitcoin-display', () => ({ useBitcoinDisplay: () => ({ unit: mocks.unit }) }))
vi.mock('../components/dashboard-charts/history-line-chart', () => ({
  HistoryLineChart: () => createElement('svg', { 'data-chart': 'history' }),
}))
vi.mock('../components/dashboard/banner', async (importOriginal) => ({
  ...(await importOriginal<typeof DashboardBanner>()),
  Banner: () => createElement('div', null, 'Statement introduction'),
}))
vi.mock('../components/dashboard/recent-statements', () => ({ RecentStatements: () => null }))
vi.mock('../components/dashboard-charts/accumulation-chart', () => ({
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
}))
vi.mock('@hoseki/packages/ui/design-system', async () => {
  const { EmptyView } = await import('@hoseki/packages/ui/design-system/empty-view')
  return {
    EmptyView,
    Spinner: () => createElement('div', null, 'Loading overview'),
    ErrorBanner: ({ message }: { message: string }) => createElement('div', { role: 'alert' }, message),
  }
})

function renderHome(): string {
  return renderToStaticMarkup(
    createElement(ChakraProvider, null, createElement(MemoryRouter, null, createElement(HomePage))),
  )
}

beforeEach(() => {
  mocks.accounts = { claims: [], exchange: [], manual: [], etf: [] }
  mocks.onboarding = 'dismissed'
  mocks.prices = []
  mocks.history = []
  mocks.isLoading = false
  mocks.isError = false
  mocks.statementsError = false
  mocks.btcPrice = '50000'
  mocks.unit = 'btc'
})

describe('Home overview states', () => {
  it('previews zero balances and a labeled market chart with one account action', () => {
    const html = renderHome()
    expect(html).toContain('Your Bitcoin, in one place')
    expect(html.match(/href="\/accounts\/add"/g)).toHaveLength(1)
    for (const text of [
      '0 BTC',
      '$0.00 USD',
      '30d Change',
      'Bitcoin Price',
      'Last 7 days',
      'Your holdings, on record',
      'data-chart="history"',
    ]) {
      expect(html).toContain(text)
    }
    expect(html).toContain('Generate Statement')
    expect(html).toContain('href="/statements/create"')
    expect(html).toContain('/statements/satoshi-statement.jpg')
    expect(html).not.toContain('Sample chart')
    expect(html).not.toContain('$98,820')
    expect(html).not.toContain('Statement introduction')
  })

  it.each([
    ['btc', '0 BTC'],
    ['sats', '0 sats'],
    ['symbol', '₿ 0'],
  ] as const)('uses %s for both empty-state Bitcoin values', (unit, expected) => {
    mocks.unit = unit
    const html = renderHome()
    expect(html.split(`>${expected}<`)).toHaveLength(3)
    expect(html).not.toContain('0.00000000')
    if (unit !== 'btc') expect(html).not.toContain('0 BTC')
  })

  it.each(['claims', 'exchange', 'manual', 'etf'] as const)(
    'keeps a zero-balance %s account distinct from no accounts',
    (kind) => {
      mocks.accounts[kind] = [{ id: 'account', status: 'pending', balance: '0' }]
      const html = renderHome()
      expect(html).toContain('Your history will appear here')
      expect(html).toContain('href="/accounts"')
      expect(html).not.toContain('href="/accounts/add"')
      expect(html).not.toContain('0.00000000')
    },
  )

  it('keeps the dashboard available when history exists, including a zero balance', () => {
    mocks.history = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]
    expect(renderHome()).toContain('Balance chart')
  })

  it('does not present failed account queries as an empty portfolio', () => {
    mocks.isError = true
    const html = renderHome()
    expect(html).toContain('role="alert"')
    expect(html).toContain('Holdings unavailable')
    expect(html).not.toContain('$0.00 USD')
    expect(html).not.toContain('0 BTC')
    expect(html).toContain('Try Again')
    expect(html).not.toContain('Dashboard preview')
    expect(html).toContain('Bitcoin Price')
    expect(html).not.toContain('href="/accounts/add"')
  }, 20_000)

  it('waits for account queries before offering onboarding', () => {
    mocks.isLoading = true
    const html = renderHome()
    expect(html).toContain('Loading your holdings')
    expect(html).toContain('Bitcoin Price')
    expect(html).not.toContain('0.00000000')
    expect(html).not.toContain('href="/accounts/add"')
  })
  it('keeps holdings visible when statements fail independently', () => {
    mocks.statementsError = true
    mocks.history = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]
    const html = renderHome()
    expect(html).toContain('Balance chart')
    expect(html).toContain('Recent statements could not be loaded')
    expect(html).not.toContain('Holdings unavailable')
  })

  it('retains the last overview with a persistent warning when account refresh fails', () => {
    mocks.isError = true
    mocks.history = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]
    const html = renderHome()
    expect(html).toContain('Balance chart')
    expect(html).toContain('Showing the last available overview')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('does not turn a missing market price into a zero fiat valuation', () => {
    mocks.btcPrice = '0'
    mocks.history = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '100000000' }]
    expect(renderHome()).toContain('USD value unavailable')
  })
})
