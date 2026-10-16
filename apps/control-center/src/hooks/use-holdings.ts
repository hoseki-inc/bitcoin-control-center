import { useGetBalancesPerClaimIds } from '../lib/balances'
import { type Holdings, type HoldingsAccounts, type WalletBalancesQuery, buildHoldings } from '../lib/holdings'
import { type RouterOutput, trpc } from '../trpc'
import { type ExchangeRefresh, useAutoRefreshExchanges } from './use-auto-refresh-exchanges'

export interface HoldingsDataSource {
  useAccounts: () => HoldingsAccounts
  useBalances: (...args: Parameters<typeof useGetBalancesPerClaimIds>) => WalletBalancesQuery
  useStoredBalances: (
    input: { claimIds: string[] },
    options: { enabled: boolean },
  ) => {
    data?: RouterOutput['portalProve']['controlCenter']['storedWalletBalances']
    refetch?: () => Promise<{ isError: boolean }>
  }
  useAutoRefresh: () => ExchangeRefresh
}

export const holdingsDataSource: HoldingsDataSource = {
  useAccounts: () => ({
    claimsQuery: trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
    exchangeAccountsQuery: trpc.portalProve.exchange.list.useQuery(),
    manualAccountsQuery: trpc.portalProve.manual.list.useQuery(),
    etfAccountsQuery: trpc.portalProve.etf.list.useQuery(),
    btcPriceQuery: trpc.portalProve.retrieveBitcoinPrice.useQuery(),
  }),
  useBalances: useGetBalancesPerClaimIds,
  useStoredBalances: (input, options) => trpc.portalProve.controlCenter.storedWalletBalances.useQuery(input, options),
  useAutoRefresh: useAutoRefreshExchanges,
}

export interface HoldingsData extends Holdings {
  accounts: HoldingsAccounts
  wallets: WalletBalancesQuery
  retry: () => void
}

/** Use identical query keys and state rules on every balance overview. */
export function useHoldings(dataSource: HoldingsDataSource = holdingsDataSource): HoldingsData {
  const accounts = dataSource.useAccounts()
  const claimIds = (accounts.claimsQuery.data ?? []).map((claim) => claim.id)
  const wallets = dataSource.useBalances({ claimIds, enabled: claimIds.length > 0, retryFailedEveryMs: 10_000 })
  const stored = dataSource.useStoredBalances({ claimIds }, { enabled: claimIds.length > 0 })
  const exchanges = dataSource.useAutoRefresh()
  return {
    ...buildHoldings({ accounts, wallets, stored: stored.data, exchanges }),
    accounts,
    wallets,
    retry: () => {
      void wallets.refetchBalances?.()
      void stored.refetch?.()
      for (const query of [
        accounts.claimsQuery,
        accounts.exchangeAccountsQuery,
        accounts.manualAccountsQuery,
        accounts.etfAccountsQuery,
        accounts.btcPriceQuery,
      ]) {
        if (query.isError === true) {
          void query.refetch?.()
        }
      }
    },
  }
}
