import type { UseQueryResult } from '@tanstack/react-query'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import { type RouterInput, type RouterOutput, trpc } from '../../trpc'
import { getBrowserTimezone } from '../../utils/timezone'

type PortfolioInput = Exclude<RouterInput['portalProve']['controlCenter']['getData'], void>
type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']
export type StoredWalletBalance = RouterOutput['portalProve']['controlCenter']['storedWalletBalances'][number]
type ListQuery<T> = { data?: T[]; isLoading: boolean }

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
  recordSnapshot: Pick<ReturnType<typeof trpc.portalProve.controlCenter.recordSnapshot.useMutation>, 'mutate'>
}

/** The data required by the portfolio controller, independent of its transport. */
export interface DashboardDataSource {
  useAccounts: () => DashboardAccounts
  useHistory: (
    input: PortfolioInput,
    options: { enabled: boolean; staleTime: number; keepPreviousData: boolean },
  ) => PortfolioQuery
  useBalances: (
    ...args: Parameters<typeof useGetBalancesPerClaimIds>
  ) => Pick<ReturnType<typeof useGetBalancesPerClaimIds>, 'data' | 'balancesFailed' | 'updatedAt'>
  /** Each wallet's last recorded balance, shown while live balances load or can't be fetched. */
  useStoredBalances: (input: { claimIds: string[] }, options: { enabled: boolean }) => { data?: StoredWalletBalance[] }
  useAutoRefresh: () => void
  getTimezone: () => string
}

export const dashboardDataSource: DashboardDataSource = {
  useAccounts: () => ({
    recordSnapshot: trpc.portalProve.controlCenter.recordSnapshot.useMutation(),
    claimsQuery: trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
    exchangeAccountsQuery: trpc.portalProve.exchange.list.useQuery(),
    manualAccountsQuery: trpc.portalProve.manual.list.useQuery(),
    etfAccountsQuery: trpc.portalProve.etf.list.useQuery(),
    btcPriceQuery: trpc.portalProve.retrieveBitcoinPrice.useQuery(),
  }),
  useHistory: (input, options) => trpc.portalProve.controlCenter.getData.useQuery(input, options),
  useBalances: useGetBalancesPerClaimIds,
  useStoredBalances: (input, options) => trpc.portalProve.controlCenter.storedWalletBalances.useQuery(input, options),
  useAutoRefresh: useAutoRefreshExchanges,
  getTimezone: getBrowserTimezone,
}
