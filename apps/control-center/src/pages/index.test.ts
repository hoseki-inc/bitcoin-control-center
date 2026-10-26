// @vitest-environment node
import { ChakraProvider } from '@chakra-ui/react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import type { WalletBalanceRow } from '../lib/wallet-balances'
import { statementFixture } from '../testing/statements'
import type { StatementDto } from '../trpc/server-types'
import { type HomeDataSource, HomePage, type HomeViews } from './index'

type PortfolioData = NonNullable<ReturnType<HomeDataSource['usePortfolio']>['data']>
type AccountKind = 'claims' | 'exchange' | 'manual' | 'etf'

interface QueryFlags {
  isLoading?: boolean
  isError?: boolean
  /** A failed refresh that keeps the data it loaded before. */
  keepData?: boolean
}

interface HomeState {
  accounts: Record<AccountKind, { id: string; status: string; balance: string }[]>
  /** Applies to every account list; `accountStates` sets one list. */
  accountsLoading: boolean
  accountsError: boolean
  accountStates: Partial<Record<AccountKind, QueryFlags>>
  currentSats: string
  history: PortfolioData['historicalData']
  portfolioLoading: boolean
  portfolioError: boolean
  /** Undefined when the statements never loaded. */
  statements: StatementDto[] | undefined
  statementsLoading: boolean
  statementsError: boolean
  btcPrice: string
  walletRows: WalletBalanceRow[]
}

/** A query as React Query reports it: no data while loading for the first time. */
function query<T>(data: T | undefined, flags: QueryFlags = {}) {
  const isLoading = flags.isLoading ?? false
  return {
    data: isLoading ? undefined : data,
    isLoading,
    isError: flags.isError ?? false,
    refetch: vi.fn(async () => Promise.resolve({ isError: false })),
  }
}

function fakeDataSource(state: HomeState): HomeDataSource {
  const accounts = (kind: AccountKind) => () => {
    const isLoading = state.accountsLoading || state.accountStates[kind]?.isLoading === true
    const isError = state.accountsError || state.accountStates[kind]?.isError === true
    const keepData = state.accountStates[kind]?.keepData === true
    return query(isError && !keepData ? undefined : state.accounts[kind], { isLoading, isError })
  }
  const portfolio: PortfolioData = {
    currentTotalBalance: state.currentSats,
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
    walletBalancesAsOf: {},
  }
  return {
    useStatements: () =>
      query(state.statements, {
        isLoading: state.statementsLoading,
        isError: state.statementsError,
      }),
    usePortfolio: () =>
      // A failed refresh keeps a loaded history; a first load that fails has nothing.
      query(state.portfolioError && state.history.length === 0 ? undefined : portfolio, {
        isLoading: state.portfolioLoading,
        isError: state.portfolioError,
      }),
    useClaims: accounts('claims'),
    useExchanges: accounts('exchange'),
    useManual: accounts('manual'),
    useEtfs: accounts('etf'),
    useWalletBalances: () => ({ rows: state.walletRows, isError: false }),
  }
}

const views: HomeViews = {
  AccumulationChart: () => createElement('div', null, 'Balance chart'),
  // The price chart's own states are covered in bitcoin-price-chart.test.ts; here we only check placement.
  BitcoinPriceChart: () => createElement('section', { 'data-chart': 'price' }, 'Bitcoin Price'),
  // The introduction is covered in onboarding-takeover.test.tsx and index.interactions.test.tsx.
  Onboarding: () => createElement('div'),
}

function renderHome(overrides: Partial<HomeState> = {}): string {
  const state: HomeState = {
    accounts: { claims: [], exchange: [], manual: [], etf: [] },
    accountsLoading: false,
    accountsError: false,
    accountStates: {},
    currentSats: '0',
    history: [],
    portfolioLoading: false,
    portfolioError: false,
    statements: [],
    statementsLoading: false,
    statementsError: false,
    btcPrice: '50000',
    walletRows: [],
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

const statement = statementFixture()

const zeroBalanceHistory = [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '0' }]

describe('Home overview states', () => {
  it('previews zero balances, the price chart and one account action', () => {
    const html = renderHome()
    expect(html).toMatch(/<h1[^>]*>Your Bitcoin, in one place<\/h1>/)
    expect(html.match(/href="\/accounts\/add"/g)).toHaveLength(1)
    for (const text of ['0.00000000 BTC', '$0.00', '30d Change', 'Bitcoin Price', 'Your holdings, on record']) {
      expect(html).toContain(text)
    }
    expect(html).not.toContain('$0.00 USD')
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
    const html = renderHome({ accountsError: true })
    expect(html).toContain('role="alert"')
    expect(html).toContain('Your balances could not be confirmed')
    expect(html).not.toContain('Showing the last available overview')
    expect(html).toContain('Holdings unavailable')
    expect(html).not.toContain('$0.00')
    expect(html).not.toContain('0 BTC')
    expect(html).toContain('Try Again')
    expect(html).toContain('Bitcoin Price')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('waits for account queries before offering account setup', () => {
    const html = renderHome({ accountsLoading: true })
    expect(html).toContain('Loading your holdings')
    expect(html).toContain('Bitcoin Price')
    expect(html).not.toContain('0.00000000')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('keeps holdings visible when statements fail independently', () => {
    const html = renderHome({ statements: undefined, statementsError: true, history: zeroBalanceHistory })
    expect(html).toContain('href="/statements"')
    expect(html).toContain('Balance chart')
    expect(html).toContain('Recent statements could not be loaded')
    expect(html).not.toContain('Holdings unavailable')
  })

  it('retains the last overview with a persistent warning when account refresh fails', () => {
    const html = renderHome({ accountsError: true, history: zeroBalanceHistory })
    expect(html).toContain('Balance chart')
    expect(html).toContain('Showing the last available overview')
    expect(html).not.toContain('href="/accounts/add"')
  })

  it('does not count accounts until every account list has loaded', () => {
    const accounts: HomeState['accounts'] = { claims: [], exchange: [], manual: [], etf: [] }
    accounts.claims = [{ id: 'wallet', status: 'verified', balance: '0' }]
    expect(renderText({ accounts, history: zeroBalanceHistory, accountsLoading: true })).toContain('— tracked')
    expect(
      renderText({ accounts, history: zeroBalanceHistory, accountStates: { etf: { isLoading: true } } }),
    ).toContain('— tracked')
    expect(renderText({ accounts, history: zeroBalanceHistory })).toContain('1 tracked')
  })

  it('says when wallet balances are updating, and when they were last synced if a wallet is unreachable', () => {
    const accounts: HomeState['accounts'] = { claims: [], exchange: [], manual: [], etf: [] }
    accounts.claims = [{ id: 'wallet', status: 'verified', balance: '0' }]
    const row: WalletBalanceRow = {
      accountId: 'wallet',
      balanceSats: '0',
      asOf: '2020-01-01T00:00:00.000Z',
      syncing: true,
      failed: false,
    }
    expect(renderText({ accounts, history: zeroBalanceHistory, walletRows: [row] })).toContain('Updating balances')
    expect(
      renderText({ accounts, history: zeroBalanceHistory, walletRows: [{ ...row, syncing: false, failed: true }] }),
    ).toContain('Last synced')
    // A quiet refresh of a recent balance needs no word, and neither do settled balances.
    expect(
      renderText({
        accounts,
        history: zeroBalanceHistory,
        walletRows: [{ ...row, asOf: new Date().toISOString() }],
      }),
    ).not.toMatch(/Synced|Updating balances/)
    expect(
      renderText({ accounts, history: zeroBalanceHistory, walletRows: [{ ...row, syncing: false }] }),
    ).not.toContain('Synced')
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

  it('shows loading recent statements, not the statements introduction, until they arrive', () => {
    const text = renderText({ statementsLoading: true, history: zeroBalanceHistory })
    expect(text).toContain('Loading recent statements…')
    expect(text).not.toContain('Your holdings, on record')
  })

  it('does not count accounts while some holdings data is unavailable', () => {
    const accounts: HomeState['accounts'] = { claims: [], exchange: [], manual: [], etf: [] }
    accounts.claims = [{ id: 'wallet', status: 'verified', balance: '0' }]
    expect(renderText({ accounts, history: zeroBalanceHistory, accountsError: true })).toContain('— tracked')
    // A list whose refresh failed may be out of date, even with its old data.
    expect(
      renderText({
        accounts,
        history: zeroBalanceHistory,
        accountStates: { claims: { isError: true, keepData: true } },
      }),
    ).toContain('— tracked')
    // While the lists load, the overview is a placeholder with no count at all.
    expect(renderText({ accountsLoading: true })).toContain('Loading your holdings')
    expect(renderText({ accountsLoading: true })).not.toContain('tracked')
    // The count comes from the account lists alone, so a failed overview refresh keeps it.
    expect(renderText({ accounts, history: zeroBalanceHistory, portfolioError: true })).not.toContain('— tracked')
  })

  it('lists the preview stats in the same order as the loaded overview', () => {
    for (const text of [renderText(), renderText({ history: zeroBalanceHistory })]) {
      expect(text.indexOf('30d Change')).toBeGreaterThan(-1)
      expect(text.indexOf('30d Change')).toBeLessThan(text.indexOf('Accounts'))
    }
  })

  it('shows no sign on a dollar change that rounds to zero', () => {
    const text = renderText({ history: [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '1' }] })
    expect(text).toContain('−0.00000001 BTC')
    expect(text).toContain('$0.00')
    expect(text).not.toContain('−$0.00')
    expect(text).not.toContain('+$0.00')
    expect(text).not.toContain('$0.01')
  })

  it('shows recent statements instead of the statements introduction', () => {
    const statements = ['a', 'b', 'c'].map((id) => statementFixture({ id }))
    const text = renderText({ statements, history: zeroBalanceHistory })
    expect(text.match(/Period:/g)).toHaveLength(3)
    expect(text).toContain('Recent Statements')
    expect(text).toContain('Period:')
    expect(text).not.toContain('View All')
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
    expect(html).not.toContain('$')
  })

  it('shows the balance in Bitcoin and dollars', () => {
    // An unchanged balance, so the only dollar amount is the balance itself.
    const text = renderText({
      currentSats: '123456789',
      history: [{ timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '123456789' }],
    })
    expect(text).toContain('1.23456789 BTC')
    expect(text).toContain('$61,728.39')
    expect(text).toContain('+0.00000000 BTC')
  })

  it('measures the 30-day change from the first day of the history', () => {
    const text = renderText({
      btcPrice: '61234.56',
      currentSats: '150000000',
      history: [
        { timestamp: '2026-09-01T00:00:00.000Z', totalBalance: '100000000' },
        { timestamp: '2026-09-15T00:00:00.000Z', totalBalance: '120000000' },
      ],
    })
    expect(text).toContain('+0.50000000 BTC')
    expect(text).toContain('+$30,617.28')
  })

  it('counts every kind of account', () => {
    const account = { id: 'account', status: 'verified', balance: '0' }
    const accounts = { claims: [account], exchange: [account], manual: [account], etf: [account] }
    expect(renderText({ accounts, history: zeroBalanceHistory })).toContain('4 tracked')
  })

  it.each(['claims', 'exchange', 'manual', 'etf'] as const)(
    'waits for the %s list before choosing between account setup and history',
    (kind) => {
      const account = { id: 'account', status: 'verified', balance: '0' }
      const text = renderText({
        accounts: { claims: [account], exchange: [], manual: [], etf: [] },
        accountStates: { [kind]: { isLoading: true } },
      })
      expect(text).toContain('Loading your holdings')
      expect(text).not.toContain('Your history will appear here')
    },
  )

  it('shows three recent statements and links to the rest', () => {
    const statements = ['a', 'b', 'c', 'd'].map((id) => statementFixture({ id }))
    const html = renderHome({ statements, history: zeroBalanceHistory })
    expect(html.match(/Period:/g)).toHaveLength(3)
    expect(html).toMatch(/href="\/statements"[^>]*>View All</)
  })

  it('keeps the statements introduction when refreshing an empty list fails', () => {
    const text = renderText({ statements: [], statementsError: true, history: zeroBalanceHistory })
    expect(text).toContain('Your holdings, on record')
    expect(text).not.toContain('Recent statements could not be loaded')
  })
})
