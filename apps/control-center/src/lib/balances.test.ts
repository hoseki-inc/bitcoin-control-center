import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import { claimBalanceRefetchInterval, priceRefetchInterval } from './balances'

describe('account balance refresh', () => {
  it("asks again while the wallet's balance couldn't be read, then stops", () => {
    expect(claimBalanceRefetchInterval(undefined, 'wallet-1')).toBe(10_000)
    expect(claimBalanceRefetchInterval(new Map(), 'wallet-1')).toBe(10_000)
    expect(claimBalanceRefetchInterval(new Map([['wallet-1', 0]]), 'wallet-1')).toBe(false)
  })

  it('asks for the price again until there is one', () => {
    expect(priceRefetchInterval(undefined)).toBe(30_000)
    expect(
      priceRefetchInterval({ value: new Decimal(50_000), source: 'mempool', asOf: new Date(), lastKnown: false }),
    ).toBe(false)
  })
})
