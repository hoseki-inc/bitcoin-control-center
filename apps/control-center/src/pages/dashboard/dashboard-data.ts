import type { UseQueryResult } from '@tanstack/react-query'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { type WalletBalancesQuery, useWalletBalances } from '../../lib/wallet-balances'
import { type RouterInput, type RouterOutput, trpc } from '../../trpc'
import { getBrowserTimezone } from '../../utils/timezone'

type PortfolioInput = Exclude<RouterInput['portalProve']['controlCenter']['getData'], void>
type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']
type ListQuery<T> = { data?: T[]; isLoading: boolean; refetch: () => Promise<object> }

export interface PortfolioQuery {
  data?: PortfolioData
  isLoading: boolean
  isFetching: boolean
  isPreviousData: boolean
  error?: Pick<Error, 'message'> | null
  refetch: UseQueryResult<PortfolioData | undefined, Pick<Error, 'message'>>['refetch']
}

export interface DashboardAccounts {
  claimsQuery: ListQuery<RouterOutput['portalProve']['registry']['claims']['list'][number]>
  exchangeAccountsQuery: ListQuery<RouterOutput['portalProve']['exchange']['list'][number]>
  manualAccountsQuery: ListQuery<RouterOutput['portalProve']['manual']['list'][number]>
  etfAccountsQuery: ListQuery<RouterOutput['portalProve']['etf']['list'][number]>
  btcPriceQuery: {
    data?: RouterOutput['portalProve']['retrieveBitcoinPrice']
    isLoading: boolean
  }
}

/** The data required by the portfolio controller, independent of its transport. */
export interface DashboardDataSource {
  useAccounts: () => DashboardAccounts
  useHistory: (
    input: PortfolioInput,
    options: { enabled: boolean; staleTime: number; keepPreviousData: boolean },
  ) => PortfolioQuery
  /** Each wallet's newest known balance, read without waiting on Electrum. */
  useWalletBalances: (claimIds: string[], options: { enabled: boolean }) => WalletBalancesQuery
  useAutoRefresh: () => void
  getTimezone: () => string
}

export const dashboardDataSource: DashboardDataSource = {
  useAccounts: () => ({
    claimsQuery: trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
    exchangeAccountsQuery: trpc.portalProve.exchange.list.useQuery(),
    manualAccountsQuery: trpc.portalProve.manual.list.useQuery(),
    etfAccountsQuery: trpc.portalProve.etf.list.useQuery(),
    btcPriceQuery: trpc.portalProve.retrieveBitcoinPrice.useQuery(),
  }),
  useHistory: (input, options) => trpc.portalProve.controlCenter.getData.useQuery(input, options),
  useWalletBalances,
  useAutoRefresh: useAutoRefreshExchanges,
  getTimezone: getBrowserTimezone,
}
