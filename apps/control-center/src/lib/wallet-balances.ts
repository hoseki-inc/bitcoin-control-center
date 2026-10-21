import { useEffect, useRef } from 'react'
import { type RouterOutput, trpc } from '../trpc'

export type WalletBalanceRow = RouterOutput['portalProve']['controlCenter']['walletBalances'][number]

/**
 * Whether the wallet balances in view are current, still loading, or older ones kept while
 * Electrum is unreachable, or whether a missing account list leaves the total unknown.
 */
export type WalletBalanceState = 'current' | 'loading' | 'stale' | 'unknown'

export interface WalletBalanceSummary {
  /** Each wallet's balance in satoshis, or null while it is unknown. */
  balances: Map<string, number | null>
  state: WalletBalanceState
  /** While a wallet can't be reached, when the oldest balance shown was current. */
  asOf: Date | null
  syncingIds: string[]
  failedIds: string[]
  /** The wallets' total, or null until every balance in it is known. */
  totalSats: number | null
}

/** A balance this recent, refreshed quietly in the background, still reads as current. */
const QUIET_REFRESH_MAX_AGE_MS = 5 * 60 * 1000

/** What the given wallets' balances add up to and how current they are, from `walletBalances` rows. */
export function summarizeWalletBalances(
  ids: readonly string[],
  rows: readonly WalletBalanceRow[] | undefined,
  now: number = Date.now(),
): WalletBalanceSummary {
  const byId = new Map((rows ?? []).map((row) => [row.accountId, row]))
  const balances = new Map<string, number | null>()
  const syncingIds: string[] = []
  const failedIds: string[] = []
  const shownTimes: number[] = []
  let outdated = false
  for (const id of ids) {
    const row = byId.get(id)
    // A wallet that has never synced counts as empty once it can't be reached, rather than
    // holding the total back for good; until then it is unknown.
    const sats = row?.balanceSats != null ? Number(row.balanceSats) : row?.failed === true ? 0 : null
    balances.set(id, sats)
    const asOf = row?.asOf != null ? Date.parse(row.asOf) : Number.NaN
    if (Number.isFinite(asOf)) {
      shownTimes.push(asOf)
    }
    if (row?.syncing === true) {
      syncingIds.push(id)
      if (!(now - asOf <= QUIET_REFRESH_MAX_AGE_MS)) {
        outdated = true
      }
    }
    if (row?.failed === true) {
      failedIds.push(id)
    }
  }

  const known = [...balances.values()]
  const totalSats = known.every((sats) => sats !== null) ? known.reduce((sum, sats) => sum + sats, 0) : null
  const state: WalletBalanceState =
    ids.length === 0
      ? 'current'
      : rows === undefined
        ? 'loading'
        : failedIds.length > 0
          ? 'stale'
          : outdated || totalSats === null
            ? 'loading'
            : 'current'
  return {
    balances,
    state,
    asOf: state === 'stale' && shownTimes.length > 0 ? new Date(Math.min(...shownTimes)) : null,
    syncingIds,
    failedIds,
    totalSats,
  }
}

/** Poll while a wallet is syncing, more slowly while one is failing, and not at all otherwise. */
export function walletBalancesRefetchInterval(rows: readonly WalletBalanceRow[] | undefined): number | false {
  if (rows?.some((row) => row.syncing) === true) {
    return 3_000
  }
  if (rows?.some((row) => row.failed) === true) {
    return 10_000
  }
  return false
}

export interface WalletBalancesQuery {
  rows: readonly WalletBalanceRow[] | undefined
  isError: boolean
}

/**
 * The newest known balance of each wallet, read without waiting on Electrum; Sentinel fetches
 * newer ones in the background and this polls until they arrive.
 */
export function useWalletBalances(claimIds: string[], { enabled }: { enabled: boolean }): WalletBalancesQuery {
  const utils = trpc.useUtils()
  const query = trpc.portalProve.controlCenter.walletBalances.useQuery(
    { claimIds },
    { enabled, keepPreviousData: true, refetchInterval: walletBalancesRefetchInterval },
  )

  // The portfolio total and history are built from these balances, so refresh them when one gets newer.
  const newestAsOf = Math.max(0, ...(query.data ?? []).map((row) => (row.asOf === null ? 0 : Date.parse(row.asOf))))
  const seenAsOf = useRef<number | null>(null)
  useEffect(() => {
    if (newestAsOf === 0) {
      return
    }
    if (seenAsOf.current !== null && newestAsOf > seenAsOf.current) {
      void utils.portalProve.controlCenter.getData.invalidate()
    }
    seenAsOf.current = newestAsOf
  }, [newestAsOf, utils])

  return { rows: query.data, isError: query.isError }
}
