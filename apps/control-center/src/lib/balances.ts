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

export type UseGetBalancesPerClaimIdOutput = {
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
}: {
  claimIds: ClaimId[]
  enabled: boolean
}): UseGetBalancesPerClaimIdOutput {
  const balanceQueriesOpts = { enabled }
  const queries = trpc.useQueries((t) => [
    t.portalProve.retrieveBitcoinPrice(undefined, balanceQueriesOpts),
    // Sentinel reuses a wallet balance for a minute, so asking again sooner returns the same one.
    t.portalProve.onchain.claimBalances({ claimIds }, { ...balanceQueriesOpts, staleTime: 60_000 }),
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
    isLoading: queries.some((q) => q.isLoading),
    isError: queries.some((q) => q.isError),
    isSuccess: queries.every((q) => q.isSuccess),
    error: btcClaimBalancesQuery.error ?? btcPriceQuery.error,
    data: balanceMap,
  }
}

/** A balance as a screen reads it: still loading, or `data` null when it can't be known yet. */
export interface BalanceState {
  isLoading: boolean
  data: BalanceValue | null
}

/**
 * A balance that arrived with its account, such as an exchange's on connecting, valued at the current price.
 * `sats` is null when the account had no balance to report.
 */
export function useBalanceFromSats(sats: string | null): BalanceState {
  const btcPriceQuery = trpc.portalProve.retrieveBitcoinPrice.useQuery()
  return {
    isLoading: btcPriceQuery.isLoading,
    data: sats === null ? null : getBalanceValue(BigInt(sats), btcPriceQuery.data?.value ?? null),
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
