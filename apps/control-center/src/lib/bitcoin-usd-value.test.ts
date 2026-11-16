import { expect, it } from 'vitest'
import { bitcoinUsdValue } from './bitcoin-usd-value'

const known = { balanceSats: 50_000_000, priceUsd: 80_000, walletStatus: { kind: 'current' as const } }

it('converts the Bitcoin subtotal using the supplied quote', () => {
  expect(bitcoinUsdValue(known)).toBe(40_000)
  expect(bitcoinUsdValue({ ...known, balanceSats: 29, priceUsd: 100_000 })).toBe(0.029)
})

it('keeps a known zero balance available without a quote', () => {
  expect(bitcoinUsdValue({ ...known, balanceSats: 0, priceUsd: null })).toBe(0)
})

it('withholds incomplete and unreachable Bitcoin subtotals', () => {
  expect(bitcoinUsdValue({ ...known, balanceUnavailable: true })).toBeNull()
  expect(bitcoinUsdValue({ ...known, balanceSats: null })).toBeNull()
  expect(bitcoinUsdValue({ ...known, balanceSats: 0, walletStatus: { kind: 'unreachable' } })).toBeNull()
  expect(bitcoinUsdValue({ ...known, walletStatus: { kind: 'lastSynced', at: new Date() } })).toBe(40_000)
})

it.each([null, NaN, Infinity, 0, -1])('withholds a nonzero balance with an unusable quote: %s', (priceUsd) => {
  expect(bitcoinUsdValue({ ...known, priceUsd })).toBeNull()
})
