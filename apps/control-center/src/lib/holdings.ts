import type { BalanceValue } from '@hoseki/packages/lib/balance'
import type { ClaimId } from '@hoseki/packages/schemas'
import type { ExchangeRefresh } from '../hooks/use-auto-refresh-exchanges'
import type { RouterOutput } from '../trpc'
import { needsExchangeReconnect } from '../utils/exchange-connection-status'
import { isUsableBtcPrice } from './bitcoin-display'
import { resolveWalletBalance } from './wallet-balance'

export interface HoldingBalance {
  sats: number | null
  updatedAt: number | null
  state: 'current' | 'loading' | 'updating' | 'stale' | 'waiting' | 'unavailable'
  context?: string
  manual?: boolean
}

export interface HoldingPrice {
  value: number | null
  lastKnown: boolean
  asOf: Date | null
}

export interface HoldingsSummary {
  knownTotalSats: number
  totalSats: number | null
  knownCount: number
  accountCount: number
  complete: boolean
  listsLoaded: boolean
  updating: boolean
  loading: boolean
  stale: boolean
  waiting: boolean
  unavailable: boolean
  oldestBalanceAt: number | null
}

export interface HoldingsQuery<T> {
  data?: T
  isLoading: boolean
  isError?: boolean
  isFetching?: boolean
  error?: Pick<Error, 'message'> | null
  refetch?: () => Promise<{ isError: boolean }>
}

export interface HoldingsAccounts {
  claimsQuery: HoldingsQuery<RouterOutput['portalProve']['registry']['claims']['list']>
  exchangeAccountsQuery: HoldingsQuery<RouterOutput['portalProve']['exchange']['list']>
  manualAccountsQuery: HoldingsQuery<RouterOutput['portalProve']['manual']['list']>
  etfAccountsQuery: HoldingsQuery<RouterOutput['portalProve']['etf']['list']>
  btcPriceQuery: HoldingsQuery<RouterOutput['portalProve']['retrieveBitcoinPrice']>
}

export interface WalletBalancesQuery {
  data: Map<ClaimId, BalanceValue | null>
  balancesFailed: boolean
  updatedAt: number
  balancesFetching: boolean
  refetchBalances?: () => Promise<void>
}

interface RecordedHolding {
  id: string
  balance: string
  balanceAsOf?: string | null
}

interface HoldingsInput {
  accounts: HoldingsAccounts
  wallets: WalletBalancesQuery
  stored: RouterOutput['portalProve']['controlCenter']['storedWalletBalances'] | undefined
  exchanges: ExchangeRefresh
}

export interface Holdings {
  balances: Map<string, HoldingBalance>
  walletBalances: Map<ClaimId, BalanceValue | null>
  price: HoldingPrice
  summary: HoldingsSummary
  listsLoaded: boolean
  listsFailed: boolean
  listsLoading: boolean
  walletsFailed: boolean
  exchangeIssue: boolean
}

export function readSats(value: string | null): number | null {
  if (value === null || value.trim() === '') {
    return null
  }
  const amount = Number(value)
  return Number.isFinite(amount) && amount >= 0 ? amount : null
}

export function readTimestamp(value: string | null): number | null {
  const timestamp = value === null ? Number.NaN : Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : null
}

export function summarizeBalances(balances: HoldingBalance[], listsLoaded: boolean): HoldingsSummary {
  const known = balances.filter((balance) => balance.sats !== null)
  const complete = listsLoaded && known.length === balances.length
  const times = known.flatMap((balance) =>
    balance.manual === true || balance.updatedAt === null ? [] : [balance.updatedAt],
  )
  const knownTotalSats = known.reduce((sum, balance) => sum + (balance.sats ?? 0), 0)
  return {
    knownTotalSats,
    totalSats: complete ? knownTotalSats : null,
    knownCount: known.length,
    accountCount: balances.length,
    complete,
    listsLoaded,
    updating: balances.some((balance) => balance.state === 'loading' || balance.state === 'updating'),
    loading: known.length === 0 && balances.some((balance) => balance.state === 'loading'),
    stale: balances.some((balance) => balance.state === 'stale'),
    waiting: balances.some((balance) => balance.state === 'waiting'),
    unavailable: balances.some((balance) => balance.state === 'unavailable'),
    oldestBalanceAt: times.length > 0 ? Math.min(...times) : null,
  }
}

/** One current-balance policy for Accounts, Home and Portfolio; unknown amounts never become zero. */
export function buildHoldings({ accounts, wallets, stored, exchanges }: HoldingsInput): Holdings {
  const balances = new Map<string, HoldingBalance>()
  const walletBalances = new Map<ClaimId, BalanceValue | null>()
  const snapshots = new Map((stored ?? []).map((snapshot) => [snapshot.accountId, snapshot]))
  for (const claim of accounts.claimsQuery.data ?? []) {
    const resolved = resolveWalletBalance({
      live: wallets.data.get(claim.id) ?? null,
      stored: snapshots.get(claim.id),
      balancesFailed: wallets.balancesFailed,
      updatedAt: wallets.updatedAt,
    })
    walletBalances.set(claim.id, resolved.balance)
    const sats = resolved.balance === null ? null : Number(resolved.balance.current)
    balances.set(claim.id, {
      sats,
      updatedAt: resolved.updatedAt,
      state:
        sats === null
          ? wallets.balancesFailed || (!wallets.balancesFetching && wallets.updatedAt > 0)
            ? 'unavailable'
            : wallets.balancesFetching
              ? 'loading'
              : 'waiting'
          : wallets.balancesFetching
            ? 'updating'
            : wallets.balancesFailed || resolved.fromStorage || accounts.claimsQuery.isError === true
              ? 'stale'
              : 'current',
      context: wallets.balancesFailed
        ? 'Check your Electrum connection in Settings.'
        : wallets.updatedAt > 0
          ? 'Open this account to check its connection.'
          : 'Waiting for your Electrum server.',
    })
  }
  for (const account of accounts.exchangeAccountsQuery.data ?? []) {
    const sats = readSats(account.balance)
    const reconnect = needsExchangeReconnect(account)
    const missed =
      exchanges.hasSettled &&
      (exchanges.failed ||
        (exchanges.previousBalanceTimes.has(account.id) &&
          exchanges.previousBalanceTimes.get(account.id) === account.balanceAsOf))
    balances.set(account.id, {
      sats,
      updatedAt: readTimestamp(account.balanceAsOf),
      state:
        sats === null
          ? !reconnect && exchanges.isRefreshing
            ? 'loading'
            : 'unavailable'
          : !reconnect && exchanges.isRefreshing
            ? 'updating'
            : reconnect || missed || accounts.exchangeAccountsQuery.isError === true
              ? 'stale'
              : 'current',
      context: reconnect ? 'Open this account to reconnect.' : 'Open this account to retry the connection.',
    })
  }
  for (const query of [accounts.manualAccountsQuery, accounts.etfAccountsQuery]) {
    const records: RecordedHolding[] = query.data ?? []
    for (const account of records) {
      const sats = readSats(account.balance)
      balances.set(account.id, {
        sats,
        updatedAt: readTimestamp(account.balanceAsOf ?? null),
        state: sats === null ? 'unavailable' : query.isError === true ? 'stale' : 'current',
        context: 'Based on your recorded holdings.',
        manual: true,
      })
    }
  }
  const lists = [
    accounts.claimsQuery,
    accounts.exchangeAccountsQuery,
    accounts.manualAccountsQuery,
    accounts.etfAccountsQuery,
  ]
  const listsLoaded = lists.every((query) => query.data !== undefined)
  const quote = accounts.btcPriceQuery.data
  const value = quote === undefined ? null : Number(quote.value)
  return {
    balances,
    walletBalances,
    price: {
      value: isUsableBtcPrice(value) ? value : null,
      lastKnown: quote?.lastKnown === true || accounts.btcPriceQuery.isError === true,
      asOf: quote?.asOf ?? null,
    },
    summary: summarizeBalances([...balances.values()], listsLoaded),
    walletsFailed: wallets.balancesFailed,
    exchangeIssue: (accounts.exchangeAccountsQuery.data ?? []).some((account) => {
      const state = balances.get(account.id)?.state
      return state === 'stale' || state === 'unavailable'
    }),
    listsLoaded,
    listsFailed: lists.some((query) => query.isError === true),
    listsLoading: lists.some((query) => query.isLoading && query.isError !== true),
  }
}
