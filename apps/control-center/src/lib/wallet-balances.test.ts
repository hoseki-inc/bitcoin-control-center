import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { getQueryKey } from '@trpc/react-query'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { trpc } from '../trpc'
import {
  type WalletBalanceRow,
  newerWalletBalancesKey,
  refetchPortfolioWhenBehind,
  summarizeWalletBalances,
  walletBalancesRefetchInterval,
} from './wallet-balances'

const now = Date.parse('2026-10-21T12:00:00.000Z')
const minutesAgo = (minutes: number): string => new Date(now - minutes * 60_000).toISOString()

function row(accountId: string, overrides: Partial<WalletBalanceRow> = {}): WalletBalanceRow {
  return {
    accountId,
    balanceSats: '100000',
    asOf: minutesAgo(1),
    syncing: false,
    failed: false,
    failure: null,
    ...overrides,
  }
}

describe('summarizeWalletBalances', () => {
  it('adds up current balances', () => {
    const summary = summarizeWalletBalances(['a', 'b'], [row('a'), row('b', { balanceSats: '50000' })], now)
    expect(summary).toMatchObject({ state: 'current', totalSats: 150_000, asOf: null, syncingIds: [], failedIds: [] })
    expect(summary.balances.get('b')).toBe(50_000)
  })

  it('reads as loading before the first read, and as current with no wallets', () => {
    expect(summarizeWalletBalances(['a'], undefined, now)).toMatchObject({ state: 'loading', totalSats: null })
    expect(summarizeWalletBalances([], undefined, now)).toMatchObject({ state: 'current', totalSats: 0 })
  })

  it('shows a recorded balance while it updates, as loading once it is a few minutes old', () => {
    const quiet = summarizeWalletBalances(['a'], [row('a', { syncing: true, asOf: minutesAgo(2) })], now)
    expect(quiet).toMatchObject({ state: 'current', totalSats: 100_000, syncingIds: ['a'] })
    const outdated = summarizeWalletBalances(['a'], [row('a', { syncing: true, asOf: minutesAgo(14) })], now)
    expect(outdated).toMatchObject({ state: 'loading', totalSats: 100_000 })
  })

  it('leaves the total unknown while a wallet has no balance yet, never counting it as zero', () => {
    const summary = summarizeWalletBalances(
      ['a', 'b'],
      [row('a'), row('b', { balanceSats: null, asOf: null, syncing: true })],
      now,
    )
    expect(summary).toMatchObject({ state: 'loading', totalSats: null })
    expect(summary.balances.get('b')).toBeNull()
    expect(summarizeWalletBalances(['a', 'missing'], [row('a')], now).totalSats).toBeNull()
  })

  it('keeps older balances while a wallet is unreachable and dates them by the oldest, once every wallet has synced', () => {
    const summary = summarizeWalletBalances(
      ['a', 'b', 'c'],
      [
        row('a', { asOf: minutesAgo(3) }),
        row('b', { failed: true, failure: 'timeout', asOf: minutesAgo(40) }),
        row('c', { failed: true, balanceSats: null, asOf: null }),
      ],
      now,
    )
    expect(summary).toMatchObject({ state: 'stale', totalSats: 200_000, failedIds: ['b', 'c'] })
    // A wallet that never synced counts as empty once it can't be reached, and leaves no last sync of them all.
    expect(summary.balances.get('c')).toBe(0)
    expect(summary.asOf).toBeNull()

    const synced = summarizeWalletBalances(
      ['a', 'b'],
      [row('a', { asOf: minutesAgo(3) }), row('b', { failed: true, asOf: minutesAgo(40) })],
      now,
    )
    expect(synced.asOf?.toISOString()).toBe(minutesAgo(40))
  })

  it('ignores wallets outside the view', () => {
    const summary = summarizeWalletBalances(['a'], [row('a'), row('b', { failed: true })], now)
    expect(summary).toMatchObject({ state: 'current', totalSats: 100_000, failedIds: [] })
  })
})

describe('walletBalancesRefetchInterval', () => {
  it('polls quickly while syncing, slowly while failing, and not otherwise', () => {
    expect(walletBalancesRefetchInterval(undefined)).toBe(false)
    expect(walletBalancesRefetchInterval([row('a')])).toBe(false)
    expect(walletBalancesRefetchInterval([row('a', { failed: true }), row('b', { syncing: true })])).toBe(3_000)
    expect(walletBalancesRefetchInterval([row('a', { failed: true })])).toBe(10_000)
    // A read that failed keeps trying, so the page isn't left waiting.
    expect(walletBalancesRefetchInterval(undefined, true)).toBe(10_000)
  })
})

describe('newerWalletBalancesKey', () => {
  it('names wallets whose balance is newer than the one counted, and nothing once it is counted', () => {
    const rows = [row('a', { asOf: minutesAgo(1) }), row('b', { asOf: minutesAgo(5) })]
    expect(newerWalletBalancesKey(rows, { a: minutesAgo(5), b: minutesAgo(5) })).toBe(`a@${minutesAgo(1)}`)
    expect(newerWalletBalancesKey(rows, { a: minutesAgo(1), b: minutesAgo(5) })).toBeNull()
    // A wallet first counted as empty, and wallets the read doesn't include.
    expect(newerWalletBalancesKey(rows, { b: null })).toBe(`b@${minutesAgo(5)}`)
    expect(newerWalletBalancesKey([row('a', { asOf: null })], { a: null })).toBeNull()
  })
})

describe('refetchPortfolioWhenBehind', () => {
  it('reads the portfolio again when a scan finishes during its first read, once per newer balance', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    onTestFinished(() => {
      queryClient.clear()
    })
    const pending: Array<(asOf: string) => void> = []
    const read = vi.fn(
      async () =>
        new Promise<{ walletBalancesAsOf: Record<string, string> }>((resolve) => {
          pending.push((asOf) => {
            resolve({ walletBalancesAsOf: { a: asOf } })
          })
        }),
    )
    const observer = new QueryObserver(queryClient, {
      queryKey: getQueryKey(trpc.portalProve.controlCenter.getData, { timeRange: '30d' }, 'query'),
      queryFn: read,
    })
    onTestFinished(observer.subscribe(() => undefined))
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(1)
    })

    // The scan finishes while the first read, which counted the snapshot, is still loading.
    const refetched = new Map<string, string>()
    const rows = [row('a', { asOf: minutesAgo(1) })]
    onTestFinished(
      queryClient.getQueryCache().subscribe(() => {
        refetchPortfolioWhenBehind(queryClient, rows, refetched)
      }),
    )
    refetchPortfolioWhenBehind(queryClient, rows, refetched)
    pending.shift()?.(minutesAgo(10))
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
    })

    // Sentinel still counts the snapshot, such as when recording the new balance failed: no loop.
    pending.shift()?.(minutesAgo(10))
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    })
    refetchPortfolioWhenBehind(queryClient, rows, refetched)
    expect(read).toHaveBeenCalledTimes(2)
  })
})
