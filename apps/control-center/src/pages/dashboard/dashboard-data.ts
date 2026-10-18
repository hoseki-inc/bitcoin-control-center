import type { UseQueryResult } from '@tanstack/react-query'
import { type ExchangeRefresh, useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { holdingsDataSource } from '../../hooks/use-holdings'
import { useGetBalancesPerClaimIds } from '../../lib/balances'
import type { HoldingsAccounts } from '../../lib/holdings'
import { type RouterInput, type RouterOutput, trpc } from '../../trpc'
import { getBrowserTimezone } from '../../utils/timezone'

type PortfolioInput = Exclude<RouterInput['portalProve']['controlCenter']['getData'], void>
type PortfolioData = RouterOutput['portalProve']['controlCenter']['getData']
export type StoredWalletBalance = RouterOutput['portalProve']['controlCenter']['storedWalletBalances'][number]

export interface PortfolioQuery {
  data?: PortfolioData
  isLoading: boolean
  isFetching: boolean
  isPreviousData: boolean
  error?: Pick<Error, 'message'> | null
  refetch: UseQueryResult<PortfolioData | undefined, Pick<Error, 'message'>>['refetch']
}

export interface DashboardAccounts extends HoldingsAccounts {
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
  ) => Pick<
    ReturnType<typeof useGetBalancesPerClaimIds>,
    'data' | 'balancesFailed' | 'updatedAt' | 'balancesFetching' | 'refetchBalances'
  >
  /** Each wallet's last recorded balance, shown while live balances load or can't be fetched. */
  useStoredBalances: (input: { claimIds: string[] }, options: { enabled: boolean }) => { data?: StoredWalletBalance[] }
  useAutoRefresh: () => ExchangeRefresh
  getTimezone: () => string
}

export const dashboardDataSource: DashboardDataSource = {
  useAccounts: () => ({
    ...holdingsDataSource.useAccounts(),
    recordSnapshot: trpc.portalProve.controlCenter.recordSnapshot.useMutation(),
  }),
  useHistory: (input, options) => trpc.portalProve.controlCenter.getData.useQuery(input, options),
  useBalances: useGetBalancesPerClaimIds,
  useStoredBalances: (input, options) => trpc.portalProve.controlCenter.storedWalletBalances.useQuery(input, options),
  useAutoRefresh: useAutoRefreshExchanges,
  getTimezone: getBrowserTimezone,
}
