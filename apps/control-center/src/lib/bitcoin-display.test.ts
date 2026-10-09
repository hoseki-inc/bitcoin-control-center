import { describe, expect, it } from 'vitest'
import { formatBitcoin, formatBitcoinNumber, formatSignedBitcoinNumber, formatSignedUsd } from './bitcoin-display'

it('keeps all 8 decimal places so amounts line up', () => {
  expect(formatBitcoin('0.0003789')).toBe('0.00037890 BTC')
  expect(formatBitcoin(0.0434895)).toBe('0.04348950 BTC')
  expect(formatBitcoin(1)).toBe('1.00000000 BTC')
  expect(formatBitcoin('-0.001')).toBe('-0.00100000 BTC')
  expect(formatBitcoin('12345.6')).toBe('12,345.60000000 BTC')
})

it('drops the unit for a separately styled one', () => {
  expect(formatBitcoinNumber('12345.6')).toBe('12,345.60000000')
})

describe('signed BTC without a unit', () => {
  it.each([
    ['a gain', '0.21543450', '+0.21543450'],
    ['a loss', '-0.01', '\u22120.01000000'],
    ['no change', '0', '0.00000000'],
    ['a loss under half a satoshi', '-0.000000003', '0.00000000'],
    ['a loss of half a satoshi', '-0.000000005', '\u22120.00000001'],
  ] as const)('formats %s', (_label, btc, expected) => {
    expect(formatSignedBitcoinNumber(btc)).toBe(expected)
  })
})

describe('signed USD at a price', () => {
  it.each([
    ['a gain', '0.5', 50_000, '+$25,000.00'],
    ['a loss', '-0.5', 50_000, '−$25,000.00'],
    ['a half-cent gain', '0.0000001', 50_000, '+$0.01'],
    ['a half-cent loss', '-0.0000001', 50_000, '−$0.01'],
    ['an amount under half a cent', '-0.00000009', 50_000, '$0.00'],
    ['no change', '0', 50_000, '$0.00'],
  ] as const)('formats %s', (_label, btc, price, expected) => {
    expect(formatSignedUsd(btc, price)).toBe(expected)
  })

  it.each([null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY])('is empty without a usable price (%s)', (price) => {
    expect(formatSignedUsd('1', price)).toBe('')
  })
})
