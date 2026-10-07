// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { StatementDto } from '../trpc/server-types'
import { type HomeDataSource, HomePage, type HomeViews } from './index'

type PortfolioData = NonNullable<ReturnType<HomeDataSource['usePortfolio']>['data']>
type AccountKind = 'claims' | 'exchange' | 'manual' | 'etf'

interface HomeState {
  accounts: Record<AccountKind, { id: string; status: string; balance: string }[]>
  history: PortfolioData['historicalData']
  isLoading: boolean
  isError: boolean
  portfolioLoading: boolean
  portfolioError: boolean
  statements: StatementDto[]
  statementsError: boolean
  btcPrice: string
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
    useStatements: () => query(state.statements, { isError: state.statementsError }),
    usePortfolio: () =>
      query(state.portfolioLoading || state.portfolioError ? undefined : portfolio, {
        isLoading: state.portfolioLoading,
        isError: state.portfolioError,
      }),
    useClaims: accounts('claims'),
    useExchanges: accounts('exchange'),
    useManual: accounts('manual'),
    useEtfs: accounts('etf'),
  }
}

const views: HomeViews = {
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
  // The price chart's own states are covered in bitcoin-price-chart.test.ts; here we only check placement.
  BitcoinPriceChart: () => createElement('section', { 'data-chart': 'price' }, 'Bitcoin Price'),
}

function renderHome(overrides: Partial<HomeState> = {}): string {
  const state: HomeState = {
    accounts: { claims: [], exchange: [], manual: [], etf: [] },
    history: [],
    isLoading: false,
    isError: false,
    portfolioLoading: false,
    portfolioError: false,
    statements: [],
    statementsError: false,
    btcPrice: '50000',
    ...overrides,
  }
  return renderToStaticMarkup(
    createElement(
      ChakraProvider,
      null,
      createElement(MemoryRouter, null, createElement(HomePage, { dataSource: fakeDataSource(state), views })),
    ),
  )
}

/** The page's visible text, without Chakra's injected styles or markup. */
function renderText(overrides: Partial<HomeState> = {}): string {
  return renderHome(overrides)
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
}

const statement: StatementDto = {
  id: 'statement',
  createdAt: new Date('2026-09-01T12:00:00Z'),
  updatedAt: new Date('2026-09-01T12:00:00Z'),
  openingDate: new Date('2026-08-01T00:00:00Z'),
  closingDate: new Date('2026-08-31T23:59:59Z'),
  counter: 1,
  timezone: 'UTC',
  status: 'completed',
  quoteCurrency: 'USD',
  errorMessage: null,
  user: { name: null, email: null },
  integrator: null,
  userId: 'user',
}

const zeroBalanceHistory = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]

describe('Home overview states', () => {
  it('previews zero balances and a labeled market chart with one account action', () => {
    const html = renderHome()
    expect(html).toContain('Your Bitcoin, in one place')
    expect(html.match(/href="\/accounts\/add"/g)).toHaveLength(1)
    for (const text of ['0.00000000 BTC', '$0.00 USD', '30d Change', 'Bitcoin Price', 'Your holdings, on record']) {
      expect(html).toContain(text)
    }
    expect(html).toContain('Generate Statement')
    expect(html).toContain('href="/statements/create"')
    expect(html).toContain('/statements/satoshi-statement.jpg')
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
    expect(html).toContain('Bitcoin Price')
    expect(html).not.toContain('href="/accounts/add"')
  }, 20_000)

  it('waits for account queries before offering account setup', () => {
    const html = renderHome({ isLoading: true })
    expect(html).toContain('Loading your holdings')
    expect(html).toContain('Bitcoin Price')
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

  it('does not count accounts until every account list has loaded', () => {
    const accounts: HomeState['accounts'] = { claims: [], exchange: [], manual: [], etf: [] }
    accounts.claims = [{ id: 'wallet', status: 'verified', balance: '0' }]
    expect(renderText({ accounts, history: zeroBalanceHistory, isLoading: true })).toContain('— tracked')
    expect(renderText({ accounts, history: zeroBalanceHistory })).toContain('1 tracked')
  })

  it('shows a fall in the same minus sign for Bitcoin and dollars', () => {
    const text = renderText({ history: [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '50000000' }] })
    expect(text).toContain('−0.50000000 BTC')
    expect(text).toContain('−$25,000.00')
    expect(text).not.toContain('-0.5')
  })

  it.each([
    ['loads', { portfolioLoading: true }, 'Loading your holdings'],
    ['fails', { portfolioError: true }, 'Holdings unavailable'],
  ] as const)('does not offer account setup while the balance overview %s', (_label, overrides, text) => {
    const html = renderHome(overrides)
    expect(html).toContain(text)
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('shows recent statements instead of the statements introduction', () => {
    const text = renderText({ statements: [statement], history: zeroBalanceHistory })
    expect(text).toContain('Recent Statements')
    expect(text).toContain('Period:')
    expect(text).not.toContain('Your holdings, on record')
  })

  it('keeps recent statements on screen when refreshing them fails', () => {
    const text = renderText({ statements: [statement], statementsError: true, history: zeroBalanceHistory })
    expect(text).toContain('Recent Statements')
    expect(text).not.toContain('Recent statements could not be loaded')
  })

  it('does not turn a missing market price into a zero fiat valuation', () => {
    const html = renderHome({
      btcPrice: '0',
      history: [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '100000000' }],
    })
    expect(html).toContain('USD value unavailable')
  })
})
