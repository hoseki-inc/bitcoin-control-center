import { describe, expect, it } from 'vitest'
import type { ClaimDto } from '../trpc/server-types'
import { type AccountTotalsInput, computeAccountTotals } from './account-totals'

const claim = (id: string, status: 'verified' | 'pending' | 'expired'): ClaimDto =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Totals read only these fields; full DTO fixtures would hide what matters.
  ({ id, status }) as unknown as ClaimDto
type Exchange = AccountTotalsInput['exchangeAccounts'][number]
type Manual = AccountTotalsInput['manualAccounts'][number]
const exchange = (balance: string | null, connectionStatus: 'connected' | 'needs_reconnect'): Exchange =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- As above.
  ({ balance, connectionStatus }) as unknown as Exchange
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- As above.
const manual = (balance: string): Manual => ({ balance }) as unknown as Manual

describe('computeAccountTotals', () => {
  it('sums every source and prices non-claim balances at the Bitcoin price', () => {
    const totals = computeAccountTotals({
      claims: [claim('a', 'verified'), claim('b', 'expired'), claim('c', 'pending')],
      claimBalances: new Map([
        ['a', { current: 100_000_000, usd: 60_000 }],
        ['b', { current: 50_000_000, usd: 30_000 }],
        ['c', { current: 0, usd: 0 }],
      ]),
      exchangeAccounts: [exchange('25000000', 'connected'), exchange('999', 'needs_reconnect')],
      manualAccounts: [manual('25000000')],
      etfAccounts: [],
      btcUsdPrice: 60_000,
    })
    expect(totals.totalSats).toBe(200_000_000)
    expect(totals.totalUsd).toBe(120_000)
    // Expired claims count as verified; exchanges needing reconnection are excluded from the total.
    expect(totals.verifiedCount).toBe(2)
    expect(totals.pendingCount).toBe(1)
    expect(totals.reconnectCount).toBe(1)
    expect(totals.accountCount).toBe(6)
    expect(totals.hasUnknownBalance).toBe(true)
  })

  it('knows every balance when all are loaded and connected', () => {
    const totals = computeAccountTotals({
      claims: [claim('a', 'verified')],
      claimBalances: new Map([['a', { current: 1, usd: null }]]),
      exchangeAccounts: [],
      manualAccounts: [manual('1')],
      etfAccounts: [],
      btcUsdPrice: null,
    })
    expect(totals.hasUnknownBalance).toBe(false)
    expect(totals.totalSats).toBe(2)
    expect(totals.totalUsd).toBe(0)
  })

  it('treats missing claim balances as unknown', () => {
    const totals = computeAccountTotals({
      claims: [claim('a', 'verified')],
      claimBalances: undefined,
      exchangeAccounts: [],
      manualAccounts: [],
      etfAccounts: [],
      btcUsdPrice: 1,
    })
    expect(totals.hasUnknownBalance).toBe(true)
    expect(totals.totalSats).toBe(0)
  })
})
