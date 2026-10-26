import { toast } from 'sonner'
import { useAutoRefreshExchanges } from '../../hooks/use-auto-refresh-exchanges'
import { type WalletBalancesQuery, useWalletBalances } from '../../lib/wallet-balances'
import { type RouterOutput, trpc } from '../../trpc'
import type { ClaimDto } from '../../trpc/server-types'

export type ExchangeAccountDto = RouterOutput['portalProve']['exchange']['list'][number]
export type ManualAccountDto = RouterOutput['portalProve']['manual']['list'][number]
export type EtfAccountDto = RouterOutput['portalProve']['etf']['list'][number]

export interface AccountsListQuery<T> {
  data?: T[]
  isLoading: boolean
  isError: boolean
  error?: { message: string } | null
  refetch: () => Promise<{ isError: boolean }>
}

export interface AccountsLists {
  claimsQuery: AccountsListQuery<ClaimDto>
  exchangeAccountsQuery: AccountsListQuery<ExchangeAccountDto>
  manualAccountsQuery: AccountsListQuery<ManualAccountDto>
  etfAccountsQuery: AccountsListQuery<EtfAccountDto>
  archivedClaimsQuery: AccountsListQuery<ClaimDto>
  btcPriceQuery: { data?: RouterOutput['portalProve']['retrieveBitcoinPrice']; isLoading: boolean }
}

export interface AccountRestore {
  restore: (id: string) => void
  /** The archived account being restored, if any. */
  restoringId: string | null
}

/** The queries behind the Accounts page, independent of their transport. */
export interface AccountsDataSource {
  useLists: () => AccountsLists
  useWalletBalances: (claimIds: string[], options: { enabled: boolean }) => WalletBalancesQuery
  useRestore: () => AccountRestore
  useAutoRefresh: () => void
}

export const accountsDataSource: AccountsDataSource = {
  useLists: () => ({
    claimsQuery: trpc.portalProve.registry.claims.list.useQuery({ excludePending: false }),
    exchangeAccountsQuery: trpc.portalProve.exchange.list.useQuery(),
    manualAccountsQuery: trpc.portalProve.manual.list.useQuery(),
    etfAccountsQuery: trpc.portalProve.etf.list.useQuery(),
    archivedClaimsQuery: trpc.portalProve.registry.claims.listArchived.useQuery(),
    btcPriceQuery: trpc.portalProve.retrieveBitcoinPrice.useQuery(),
  }),
  useWalletBalances,
  useRestore: () => {
    const trpcUtils = trpc.useUtils()
    const restoreMutation = trpc.portalProve.registry.claims.restore.useMutation({
      onSuccess: async () => {
        await Promise.all([
          trpcUtils.portalProve.registry.claims.list.invalidate(),
          trpcUtils.portalProve.registry.claims.listArchived.invalidate(),
          trpcUtils.portalProve.controlCenter.getData.invalidate(),
        ])
        toast.success('Account restored')
      },
      onError: () => {
        toast.error('Failed to restore account')
      },
    })
    return {
      restore: (id) => {
        restoreMutation.mutate({ id })
      },
      restoringId: restoreMutation.isLoading ? (restoreMutation.variables?.id ?? null) : null,
    }
  },
  useAutoRefresh: useAutoRefreshExchanges,
}
