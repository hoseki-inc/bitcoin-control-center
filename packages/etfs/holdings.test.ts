import { describe, expect, it } from 'vitest'
import { isFuturePurchaseDate, isValidEtfShares } from './holdings'

describe('isValidEtfShares', () => {
  it.each(['1', '12.5', '0.001', '.5', '10000000'])('accepts %s', (shares) => {
    expect(isValidEtfShares(shares)).toBe(true)
  })

  it.each(['', '0', '0.000', '-5', '-0.5', '1e5', 'abc', '1.', ' 1', '1,000', 'Infinity'])('rejects %j', (shares) => {
    expect(isValidEtfShares(shares)).toBe(false)
  })
})

describe('isFuturePurchaseDate', () => {
  const now = new Date(2026, 10, 16, 23, 30)

  it('allows today and earlier in local time', () => {
    expect(isFuturePurchaseDate('2026-11-16', now)).toBe(false)
    expect(isFuturePurchaseDate('2026-01-05', now)).toBe(false)
  })

  it('rejects tomorrow and later', () => {
    expect(isFuturePurchaseDate('2026-11-17', now)).toBe(true)
    expect(isFuturePurchaseDate('2030-12-31', now)).toBe(true)
  })
})
