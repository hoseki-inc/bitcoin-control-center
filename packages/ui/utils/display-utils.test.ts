import { describe, expect, it } from 'vitest'
import {
  toBitcoinAmountDisplayValue,
  toUsdAmountDisplayValue,
  toXpubDisplayValue,
  toXpubShortDisplayValue,
} from './display-utils'

// Run: pnpm --filter=control-center test:unit --run ../../packages/ui/utils/display-utils.test.ts

describe('display-utils', () => {
  describe('toBitcoinAmountDisplayValue', () => {
    it('should format sats string to BTC correctly', () => {
      expect(toBitcoinAmountDisplayValue('5200000')).toBe('0.05200000 BTC')
      expect(toBitcoinAmountDisplayValue('100000000')).toBe('1.00000000 BTC')
      expect(toBitcoinAmountDisplayValue('625000000')).toBe('6.25000000 BTC')
      expect(toBitcoinAmountDisplayValue('102021000000')).toBe('1020.21000000 BTC')
    })
  })

  describe('toUsdAmountDisplayValue', () => {
    it('should format to USD correctly', () => {
      expect(toUsdAmountDisplayValue(1)).toBe('1.00 USD')
      expect(toUsdAmountDisplayValue(1234.56)).toBe('1,234.56 USD')
      expect(toUsdAmountDisplayValue(123456789.69)).toBe('123,456,789.69 USD')
    })
  })

  describe('toXpubDisplayValue', () => {
    it('should display xpub with mask', () => {
      const xpubStr =
        'xpub694qt9hX4kPgLCQm6Zw3tGa6YJ7oFLsWFNLwCFvPrsnLqDEEKHCFdnXNu858phziqhs6EbuMBs3z73Nsa7tayYe5JfTcxqyWrpmzxAgPbcD'
      expect(toXpubDisplayValue(xpubStr)).toBe(
        'xpub 694q **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** **** xAgP bcD',
      )
    })

    it('should display xpub without mask', () => {
      const xpubStr =
        'xpub694qt9hX4kPgLCQm6Zw3tGa6YJ7oFLsWFNLwCFvPrsnLqDEEKHCFdnXNu858phziqhs6EbuMBs3z73Nsa7tayYe5JfTcxqyWrpmzxAgPbcD'
      expect(toXpubDisplayValue(xpubStr, false)).toBe(
        'xpub 694q t9hX 4kPg LCQm 6Zw3 tGa6 YJ7o FLsW FNLw CFvP rsnL qDEE KHCF dnXN u858 phzi qhs6 EbuM Bs3z 73Ns a7ta yYe5 JfTc xqyW rpmz xAgP bcD',
      )
    })
  })

  describe('toXpubShortDisplayValue', () => {
    it('should shorten a typical xpub', () => {
      const xpub =
        'xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKp6GH2VYb7nMRuX6r1wzX5cV6kRrgPf63HgFUsVTNff7kwh28ykVfoUfHmxz7dxyzXYZ1234'
      expect(toXpubShortDisplayValue(xpub)).toBe('xpub 6CUG ... zXYZ 1234')
    })

    it('should handle a short xpub (<=16 chars)', () => {
      const xpub = 'xpub1234567890'
      expect(toXpubShortDisplayValue(xpub)).toBe(xpub)
    })

    it('should work with another random xpub', () => {
      const xpub =
        'xpub661MyMwAqRbcF8uQ7x1Q2Q2pYt6DvFqouBZhECabuX41sJLdnLhMrDXe4sdRQnXrhTbk4P8GHWxirMRHkRkNvztNFVQVw1Gc7YDxUM3FZ3V'
      expect(toXpubShortDisplayValue(xpub)).toBe('xpub 661M ... xUM3 FZ3V')
    })

    it('should work with exactly 16 chars', () => {
      const xpub = 'xpub123456789012'
      expect(toXpubShortDisplayValue(xpub)).toBe(xpub)
    })

    it('should work with exactly 17 chars', () => {
      const xpub = 'xpub1234567890123'
      expect(toXpubShortDisplayValue(xpub)).toBe('xpub 1234 ... 6789 0123')
    })
  })
})
