import { describe, expect, it } from 'vitest'
import { bitcoinDisplayUnit, formatBitcoin } from './bitcoin-display'

describe('Bitcoin display', () => {
  it('shows the same 2.1 BTC in all three formats', () => {
    expect(formatBitcoin('2.1', 'symbol')).toBe('₿ 2.1')
    expect(formatBitcoin('2.1', 'sats')).toBe('210,000,000 sats')
    expect(formatBitcoin('2.1', 'btc')).toBe('2.1 BTC')
  })
  it('preserves single satoshis, negative amounts, zero, and large balances', () => {
    expect(formatBitcoin('0.00000001', 'btc')).toBe('0.00000001 BTC')
    expect(formatBitcoin('-0.00000001', 'sats')).toBe('-1 sats')
    expect(formatBitcoin('0', 'symbol')).toBe('₿ 0')
    expect(formatBitcoin('10', 'btc')).toBe('10 BTC')
    expect(formatBitcoin('20999999.99999999', 'sats')).toBe('2,099,999,999,999,999 sats')
  })
  it('defaults missing or invalid saved preferences to BTC', () => {
    for (const value of [null, undefined, '', 'invalid', 'btc']) expect(bitcoinDisplayUnit(value)).toBe('btc')
    expect(bitcoinDisplayUnit('symbol')).toBe('symbol')
    expect(bitcoinDisplayUnit('sats')).toBe('sats')
  })
})
