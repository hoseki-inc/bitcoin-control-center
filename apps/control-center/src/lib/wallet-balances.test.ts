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
    ...overrides,
  }
}

describe('summarizeWalletBalances', () => {
  it('adds up current balances', () => {
    const summary = summarizeWalletBalances(['a', 'b'], [row('a'), row('b', { balanceSats: '50000' })], now)
    expect(summary).toMatchObject({ status: { kind: 'current' }, totalSats: 150_000 })
    expect(summary.balances.get('b')).toBe(50_000)
  })

  it('reads as loading before the first read, and as current with no wallets', () => {
    expect(summarizeWalletBalances(['a'], undefined, now)).toMatchObject({
      status: { kind: 'updating' },
      totalSats: null,
    })
    expect(summarizeWalletBalances([], undefined, now)).toMatchObject({ status: { kind: 'current' }, totalSats: 0 })
  })

  it('shows a recorded balance while it updates, as loading once it is a few minutes old', () => {
    const quiet = summarizeWalletBalances(['a'], [row('a', { syncing: true, asOf: minutesAgo(2) })], now)
    expect(quiet).toMatchObject({ status: { kind: 'current' }, totalSats: 100_000 })
    const outdated = summarizeWalletBalances(['a'], [row('a', { syncing: true, asOf: minutesAgo(14) })], now)
    expect(outdated).toMatchObject({ status: { kind: 'updating' }, totalSats: 100_000 })
  })

  it('leaves the total unknown while a wallet has no balance yet, never counting it as zero', () => {
    const summary = summarizeWalletBalances(
      ['a', 'b'],
      [row('a'), row('b', { balanceSats: null, asOf: null, syncing: true })],
      now,
    )
    expect(summary).toMatchObject({ status: { kind: 'updating' }, totalSats: null })
    expect(summary.balances.get('b')).toBeNull()
    expect(summarizeWalletBalances(['a', 'missing'], [row('a')], now).totalSats).toBeNull()
  })

  it('keeps older balances while a wallet is unreachable and dates them by the oldest, once every wallet has synced', () => {
    const summary = summarizeWalletBalances(
      ['a', 'b', 'c'],
      [
        row('a', { asOf: minutesAgo(3) }),
        row('b', { failed: true, asOf: minutesAgo(40) }),
        row('c', { failed: true, balanceSats: null, asOf: null }),
      ],
      now,
    )
    // A wallet that never synced counts as empty once it can't be reached, and leaves no last sync of them all.
    expect(summary).toMatchObject({ status: { kind: 'unreachable' }, totalSats: 200_000 })
    expect(summary.balances.get('c')).toBe(0)

    const synced = summarizeWalletBalances(
      ['a', 'b'],
      [row('a', { asOf: minutesAgo(3) }), row('b', { failed: true, asOf: minutesAgo(40) })],
      now,
    )
    expect(synced.status).toEqual({ kind: 'lastSynced', at: new Date(minutesAgo(40)) })
  })

  it('ignores wallets outside the view', () => {
    const summary = summarizeWalletBalances(['a'], [row('a'), row('b', { failed: true })], now)
    expect(summary).toMatchObject({ status: { kind: 'current' }, totalSats: 100_000 })
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

  it('skips routine rescans with unchanged balanceSats and triggers on null->0 or changed balanceSats when walletBalancesSats is present', () => {
    // Routine 60s rescan: newer timestamp, identical balanceSats -> null (no refetch).
    expect(
      newerWalletBalancesKey(
        [row('a', { balanceSats: '100000', asOf: minutesAgo(1) })],
        { a: minutesAgo(5) },
        { a: '100000' },
      ),
    ).toBeNull()

    // First scan transitioning provisional null -> known "0" -> triggers refetch.
    expect(
      newerWalletBalancesKey([row('a', { balanceSats: '0', asOf: minutesAgo(1) })], { a: null }, { a: null }),
    ).toBe('a:null->0')

    // Real balance change with newer timestamp -> triggers refetch.
    expect(
      newerWalletBalancesKey(
        [row('a', { balanceSats: '150000', asOf: minutesAgo(1) })],
        { a: minutesAgo(5) },
        { a: '100000' },
      ),
    ).toBe('a:100000->150000')
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
      queryKey: getQueryKey(trpc.portalProve.portfolio.getData, { timeRange: '30d' }, 'query'),
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

  it('ignores routine 60s rescans with identical balanceSats and retriggers cleanly across A -> B -> A -> B', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    onTestFinished(() => {
      queryClient.clear()
    })
    let serverSnapshot = {
      walletBalancesAsOf: { a: minutesAgo(10) },
      walletBalancesSats: { a: '100000' },
    }
    const read = vi.fn(async () => ({ ...serverSnapshot }))
    const observer = new QueryObserver(queryClient, {
      queryKey: getQueryKey(trpc.portalProve.portfolio.getData, { timeRange: '30d' }, 'query'),
      queryFn: read,
    })
    onTestFinished(observer.subscribe(() => undefined))
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(1)
      expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    })

    const refetched = new Map<string, string>()
    // Routine 60s rescan: newer timestamp, identical balanceSats -> NO refetch.
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '100000', asOf: minutesAgo(5) })], refetched)
    expect(read).toHaveBeenCalledTimes(1)

    // A -> B
    serverSnapshot = { walletBalancesAsOf: { a: minutesAgo(4) }, walletBalancesSats: { a: '200000' } }
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '200000', asOf: minutesAgo(4) })], refetched)
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(2)
      expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    })
    // Caught up at B -> clears recorded key.
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '200000', asOf: minutesAgo(4) })], refetched)

    // B -> A
    serverSnapshot = { walletBalancesAsOf: { a: minutesAgo(3) }, walletBalancesSats: { a: '100000' } }
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '100000', asOf: minutesAgo(3) })], refetched)
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(3)
      expect(observer.getCurrentResult().fetchStatus).toBe('idle')
    })
    // Caught up at A -> clears recorded key.
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '100000', asOf: minutesAgo(3) })], refetched)

    // A -> B again -> MUST retrigger cleanly!
    serverSnapshot = { walletBalancesAsOf: { a: minutesAgo(2) }, walletBalancesSats: { a: '200000' } }
    refetchPortfolioWhenBehind(queryClient, [row('a', { balanceSats: '200000', asOf: minutesAgo(2) })], refetched)
    await vi.waitFor(() => {
      expect(read).toHaveBeenCalledTimes(4)
    })
  })
})
