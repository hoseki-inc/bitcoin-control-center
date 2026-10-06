import { expect, it } from 'vitest'
import { formatBitcoin } from './bitcoin-display'

it('keeps all 8 decimal places so amounts line up', () => {
  expect(formatBitcoin('0.0003789')).toBe('0.00037890 BTC')
  expect(formatBitcoin(0.0434895)).toBe('0.04348950 BTC')
  expect(formatBitcoin(1)).toBe('1.00000000 BTC')
  expect(formatBitcoin('-0.001')).toBe('-0.00100000 BTC')
  expect(formatBitcoin('12345.6')).toBe('12,345.60000000 BTC')
})
