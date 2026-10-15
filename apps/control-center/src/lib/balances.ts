import { BTC } from '@hoseki/packages/currency'
import type { BalanceValue } from '@hoseki/packages/lib/balance'
import { isNullish } from '@hoseki/packages/lib/util'
import type { ClaimId } from '@hoseki/packages/schemas'
import type { Decimal } from 'decimal.js'
import { trpc } from '../trpc'

function getBalanceValue(balance: Decimal | bigint, price: Decimal | null): BalanceValue {
  const btc = BTC.fromSats(balance)
  const btcMajorAmount = btc.toMajorAmount()
  return {
    current: btc.amount,
    usd: price ? btcMajorAmount.mul(price) : null,
  }
}

// A retry of a query that never loaded reports itself as loading again, so compare times instead.
function hasFailedSinceLoading(query: { errorUpdatedAt: number; dataUpdatedAt: number }): boolean {
  return query.errorUpdatedAt > query.dataUpdatedAt
}

export type UseGetBalancesPerClaimIdOutput = {
  /** The latest balance fetch failed, even while a retry runs; `data` may still hold older balances. */
  balancesFailed: boolean
  /** When the balances in `data` were fetched, or 0 before the first fetch succeeds. */
  updatedAt: number
  /** Whether BTC balances are being fetched, independent of the fiat price query. */
  balancesFetching: boolean
  refetchBalances: () => Promise<void>
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error:
    | ReturnType<typeof trpc.portalProve.onchain.claimBalances.useQuery>['error']
    | ReturnType<typeof trpc.portalProve.retrieveBitcoinPrice.useQuery>['error']
  data: Map<ClaimId, BalanceValue | null>
}
export function useGetBalancesPerClaimIds({
  claimIds,
  enabled,
  retryFailedEveryMs,
}: {
  claimIds: ClaimId[]
  enabled: boolean
  /** Fetch failed balances again on this interval until they load. */
  retryFailedEveryMs?: number
}): UseGetBalancesPerClaimIdOutput {
  const balanceQueriesOpts = { enabled }
  const queries = trpc.useQueries((t) => [
    t.portalProve.retrieveBitcoinPrice(undefined, balanceQueriesOpts),
    t.portalProve.onchain.claimBalances(
      { claimIds },
      retryFailedEveryMs === undefined
        ? balanceQueriesOpts
        : {
            enabled,
            // The interval does the retrying, so a failure shows at once rather than after a burst of retries.
            retry: false,
            refetchInterval: (_data, query) => (hasFailedSinceLoading(query.state) ? retryFailedEveryMs : false),
          },
    ),
  ])
  const [btcPriceQuery, btcClaimBalancesQuery] = queries
  const btcPrice = btcPriceQuery.data?.value ?? null

  const balanceMap = new Map<ClaimId, BalanceValue | null>()
  for (const claimId of claimIds) {
    const balance = btcClaimBalancesQuery.data?.get(claimId)
    if (!isNullish(balance)) {
      balanceMap.set(claimId, getBalanceValue(balance, btcPrice))
      continue
    }
    balanceMap.set(claimId, null)
  }

  return {
    balancesFailed: hasFailedSinceLoading(btcClaimBalancesQuery),
    updatedAt: btcClaimBalancesQuery.dataUpdatedAt,
    balancesFetching: btcClaimBalancesQuery.isFetching,
    refetchBalances: async () => {
      await btcClaimBalancesQuery.refetch()
    },
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    isSuccess: queries.every((q) => q.isSuccess),
    error: btcClaimBalancesQuery.error ?? btcPriceQuery.error,
    data: balanceMap,
  }
}

export type UseGetClaimBalanceOutput = {
  isLoading: boolean
  isSuccess: boolean
  isError: boolean
  error:
    | ReturnType<typeof trpc.portalProve.onchain.claimBalances.useQuery>['error']
    | ReturnType<typeof trpc.portalProve.retrieveBitcoinPrice.useQuery>['error']
  data: BalanceValue | null
}
export function useGetClaimBalance(claimId: ClaimId | null, { enabled } = { enabled: true }): UseGetClaimBalanceOutput {
  const balanceQueriesOpts = { enabled }
  const queries = trpc.useQueries((t) => [
    t.portalProve.retrieveBitcoinPrice(undefined, balanceQueriesOpts),
    t.portalProve.onchain.claimBalances(
      { claimIds: claimId != null && claimId.length > 0 ? [claimId] : [] },
      balanceQueriesOpts,
    ),
  ])
  const [btcPriceQuery, btcClaimBalancesQuery] = queries
  const btcPrice = btcPriceQuery.data?.value ?? null
  const balance = claimId != null && claimId.length > 0 ? btcClaimBalancesQuery.data?.get(claimId) : null

  return {
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    isSuccess: queries.every((q) => q.isSuccess),
    error: btcClaimBalancesQuery.error ?? btcPriceQuery.error,
    data: balance ? getBalanceValue(balance, btcPrice) : null,
  }
}
