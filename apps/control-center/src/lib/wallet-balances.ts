import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { useEffect, useRef } from 'react'
import { z } from 'zod'
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
  /**
   * While a wallet can't be reached, when every wallet shown last synced (the oldest balance's time),
   * or null if one never has.
   */
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
    if (row === undefined) {
      // Not read yet, such as a wallet added since the last read.
      outdated = true
    }
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
          : outdated
            ? 'loading'
            : 'current'
  return {
    balances,
    state,
    // A wallet that has never synced means there was no sync of them all to name a time for.
    asOf: state === 'stale' && shownTimes.length === ids.length ? new Date(Math.min(...shownTimes)) : null,
    syncingIds,
    failedIds,
    totalSats,
  }
}

/**
 * Poll while a wallet is syncing, more slowly while one is failing or the read itself failed, so a
 * page never waits for good, and not at all otherwise.
 */
export function walletBalancesRefetchInterval(
  rows: readonly WalletBalanceRow[] | undefined,
  readFailed = false,
): number | false {
  if (rows?.some((row) => row.syncing) === true) {
    return 3_000
  }
  if (readFailed || rows?.some((row) => row.failed) === true) {
    return 10_000
  }
  return false
}

export interface WalletBalancesQuery {
  rows: readonly WalletBalanceRow[] | undefined
  isError: boolean
}

const PortfolioBalanceTimesSchema = z.object({ walletBalancesAsOf: z.record(z.string(), z.string().nullable()) })

/**
 * The wallets whose balance in `rows` is newer than the one a portfolio read counted, as a key that
 * changes with each newer balance, or null when the read is up to date.
 */
export function newerWalletBalancesKey(
  rows: readonly WalletBalanceRow[],
  counted: Readonly<Record<string, string | null>>,
): string | null {
  const newer = rows.filter(({ accountId, asOf }) => {
    if (asOf === null || !Object.hasOwn(counted, accountId)) {
      return false
    }
    const countedAsOf = counted[accountId] ?? null
    return countedAsOf === null || Date.parse(asOf) > Date.parse(countedAsOf)
  })
  return newer.length === 0 ? null : newer.map(({ accountId, asOf }) => `${accountId}@${asOf}`).join(',')
}

/**
 * Refetches each settled portfolio read whose total counted an older wallet balance than `rows` shows,
 * such as one Sentinel answered from a snapshot while a scan finished. Each read is refetched once per
 * newer balance, so a balance Sentinel can't count yet doesn't refetch it again and again.
 */
export function refetchPortfolioWhenBehind(
  queryClient: QueryClient,
  rows: readonly WalletBalanceRow[],
  refetched: Map<string, string>,
): void {
  for (const query of queryClient
    .getQueryCache()
    .findAll({ queryKey: getQueryKey(trpc.portalProve.controlCenter.getData) })) {
    if (query.state.fetchStatus !== 'idle') {
      continue
    }
    const counted = parseUnknown(PortfolioBalanceTimesSchema, query.state.data)
    const key = counted.isOk() ? newerWalletBalancesKey(rows, counted.unwrap().walletBalancesAsOf) : null
    if (key === null || refetched.get(query.queryHash) === key) {
      continue
    }
    refetched.set(query.queryHash, key)
    void queryClient.invalidateQueries({ queryKey: query.queryKey, exact: true })
  }
}

/**
 * The newest known balance of each wallet, read without waiting on Electrum; Sentinel fetches
 * newer ones in the background and this polls until they arrive.
 */
export function useWalletBalances(claimIds: string[], { enabled }: { enabled: boolean }): WalletBalancesQuery {
  const queryClient = useQueryClient()
  const query = trpc.portalProve.controlCenter.walletBalances.useQuery(
    { claimIds },
    {
      enabled,
      keepPreviousData: true,
      refetchInterval: (rows, read) => walletBalancesRefetchInterval(rows, read.state.status === 'error'),
    },
  )

  // The portfolio total and history are built from these balances, so a portfolio read that counted
  // older ones is read again, including one still loading when a scan finished.
  const rows = query.data
  const refetched = useRef(new Map<string, string>())
  useEffect(() => {
    if (rows === undefined) {
      return
    }
    const check = (): void => {
      refetchPortfolioWhenBehind(queryClient, rows, refetched.current)
    }
    check()
    return queryClient.getQueryCache().subscribe(check)
  }, [rows, queryClient])

  return { rows: query.data, isError: query.isError }
}
