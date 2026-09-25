// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { BitcoinDisplayUnit } from '../lib/bitcoin-display'
import { type HomeDataSource, HomePage, type HomeViews } from './index'

type PortfolioData = NonNullable<ReturnType<HomeDataSource['usePortfolio']>['data']>
type AccountKind = 'claims' | 'exchange' | 'manual' | 'etf'

interface HomeState {
  accounts: Record<AccountKind, { id: string; status: string; balance: string }[]>
  history: PortfolioData['historicalData']
  isLoading: boolean
  isError: boolean
  statementsError: boolean
  btcPrice: string
  unit: BitcoinDisplayUnit
}

function query<T>(data: T, state: { isLoading?: boolean; isError?: boolean } = {}) {
  return {
    data,
    isLoading: state.isLoading ?? false,
    isError: state.isError ?? false,
    error: null,
    refetch: vi.fn(async () => Promise.resolve({ isError: false })),
  }
}

function fakeDataSource(state: HomeState): HomeDataSource {
  const accounts = (kind: AccountKind) => () =>
    query(state.accounts[kind], { isLoading: state.isLoading, isError: state.isError })
  const portfolio: PortfolioData = {
    currentTotalBalance: '0',
    currentBtcPrice: state.btcPrice,
    verifiedClaimsCount: 0,
    exchangeAccountCount: 0,
    manualAccountCount: 0,
    etfAccountCount: 0,
    historicalData: state.history,
    historySyncingAccountIds: [],
    historySyncedAccountIds: [],
    historyRefreshingAccountIds: [],
    historyFailedAccountIds: [],
  }
  return {
    useStatements: () => query([], { isError: state.statementsError }),
    usePortfolio: () => query(portfolio),
    useClaims: accounts('claims'),
    useExchanges: accounts('exchange'),
    useManual: accounts('manual'),
    useEtfs: accounts('etf'),
  }
}

const views: HomeViews = {
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
}

function renderHome(overrides: Partial<HomeState> = {}): string {
  const state: HomeState = {
    accounts: { claims: [], exchange: [], manual: [], etf: [] },
    history: [],
    isLoading: false,
    isError: false,
    statementsError: false,
    btcPrice: '50000',
    unit: 'btc',
    ...overrides,
  }
  // Seed the stored display preference the same way a loaded settings query would.
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  queryClient.setQueryData(['local-settings', 'bitcoin_display_unit'], state.unit)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        ChakraProvider,
        null,
        createElement(MemoryRouter, null, createElement(HomePage, { dataSource: fakeDataSource(state), views })),
      ),
    ),
  )
}

const zeroBalanceHistory = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]

describe('Home overview states', () => {
  it('previews zero balances with one account action', () => {
    const html = renderHome()
    expect(html).toContain('Your Bitcoin, in one place')
    expect(html.match(/href="\/accounts\/add"/g)).toHaveLength(1)
    for (const text of ['0 BTC', '$0.00 USD', '30d Change', 'Your holdings, on record']) {
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
    const html = renderHome({ unit })
    expect(html.split(`>${expected}<`)).toHaveLength(3)
    expect(html).not.toContain('0.00000000')
    if (unit !== 'btc') {
      expect(html).not.toContain('0 BTC')
    }
  })

  it.each(['claims', 'exchange', 'manual', 'etf'] as const)(
    'keeps a zero-balance %s account distinct from no accounts',
    (kind) => {
      const accounts: HomeState['accounts'] = { claims: [], exchange: [], manual: [], etf: [] }
      accounts[kind] = [{ id: 'account', status: 'pending', balance: '0' }]
      const html = renderHome({ accounts })
      expect(html).toContain('Your history will appear here')
      expect(html).toContain('href="/accounts"')
      expect(html).not.toContain('href="/accounts/add"')
      expect(html).not.toContain('0.00000000')
    },
  )

  it('keeps the dashboard available when history exists, including a zero balance', () => {
    expect(renderHome({ history: zeroBalanceHistory })).toContain('Balance chart')
  })

  it('does not present failed account queries as an empty portfolio', () => {
    const html = renderHome({ isError: true })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Holdings unavailable')
    expect(html).not.toContain('$0.00 USD')
    expect(html).not.toContain('0 BTC')
    expect(html).toContain('Try Again')
    expect(html).not.toContain('Dashboard preview')
    expect(html).not.toContain('href="/accounts/add"')
  }, 20_000)

  it('waits for account queries before offering account setup', () => {
    const html = renderHome({ isLoading: true })
    expect(html).toContain('Loading your holdings')
    expect(html).not.toContain('0.00000000')
    expect(html).not.toContain('href="/accounts/add"')
  })
  it('keeps holdings visible when statements fail independently', () => {
    const html = renderHome({ statementsError: true, history: zeroBalanceHistory })
    expect(html).toContain('Balance chart')
    expect(html).toContain('Recent statements could not be loaded')
    expect(html).not.toContain('Holdings unavailable')
  })

  it('retains the last overview with a persistent warning when account refresh fails', () => {
    const html = renderHome({ isError: true, history: zeroBalanceHistory })
    expect(html).toContain('Balance chart')
    expect(html).toContain('Showing the last available overview')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('does not turn a missing market price into a zero fiat valuation', () => {
    const html = renderHome({
      btcPrice: '0',
      history: [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '100000000' }],
    })
    expect(html).toContain('USD value unavailable')
  })
})
