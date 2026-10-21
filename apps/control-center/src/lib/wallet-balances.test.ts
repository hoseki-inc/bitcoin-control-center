import { describe, expect, it } from 'vitest'
import { type WalletBalanceRow, summarizeWalletBalances, walletBalancesRefetchInterval } from './wallet-balances'

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

  it('keeps older balances while a wallet is unreachable and says how old the oldest is', () => {
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
    expect(summary.asOf?.toISOString()).toBe(minutesAgo(40))
    // A wallet that never synced counts as empty once it can't be reached.
    expect(summary.balances.get('c')).toBe(0)
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
