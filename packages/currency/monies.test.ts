import { describe, expect, test } from 'vitest'
import { currencies } from './currencies'
import { Money } from './money'
import { BTC, ETH, SOL, USD } from './monies'

describe('Money: fromMajor and fromMinor', () => {
  test('BTC', () => {
    const btcFromMinor = Money.fromMinor(currencies.BTC, '28511472530135')
    expect(btcFromMinor.toMajorAmount().toString()).toEqual('285114.72530135')

    const btcFromSats = BTC.fromSats('28511472530135')
    expect(btcFromMinor.amount).toEqual(btcFromSats.amount)

    const btcFromMajor = Money.fromMajor(currencies.BTC, '285114.72530135')
    expect(btcFromMajor.amount.toFixed()).toEqual('28511472530135')
    expect(btcFromMajor.amount).toEqual(btcFromMinor.amount)
    expect(btcFromMajor.amount).toEqual(btcFromSats.amount)
    expect(btcFromMajor.amount.add(1).gt(btcFromMinor.amount)).toBe(true)
  })

  test('ETH', () => {
    const ethFromMinor = Money.fromMinor(currencies.ETH, '6316687893457223894331')
    expect(ethFromMinor.toMajorAmount().toString()).toEqual('6316.687893457223894331')

    const ethFromWeis = ETH.fromWei('6316687893457223894331')
    expect(ethFromMinor.amount).toEqual(ethFromWeis.amount)

    const ethFromMajor = Money.fromMajor(currencies.ETH, '6316.687893457223894331')
    expect(ethFromMajor.amount.toFixed()).toEqual('6316687893457223894331')
    expect(ethFromMajor.amount).toEqual(ethFromMinor.amount)
    expect(ethFromMajor.amount).toEqual(ethFromWeis.amount)
    expect(ethFromMajor.amount.add(1).gt(ethFromMinor.amount)).toBe(true)
  })

  test('USDT', () => {
    const usdtFromMinor = Money.fromMinor(currencies.USDT, '206781651876')
    expect(usdtFromMinor.toMajorAmount().toString()).toEqual('206781.651876')

    const usdtFromMajor = Money.fromMajor(currencies.USDT, '206781.651876')
    expect(usdtFromMajor.amount.toFixed()).toEqual('206781651876')
    expect(usdtFromMajor.amount).toEqual(usdtFromMinor.amount)
    expect(usdtFromMajor.amount.add(1).gt(usdtFromMinor.amount)).toBe(true)
  })

  test('USDC', () => {
    const usdcFromMinor = Money.fromMinor(currencies.USDC, '206781651876')
    expect(usdcFromMinor.toMajorAmount().toString()).toEqual('206781.651876')

    const usdcFromMajor = Money.fromMajor(currencies.USDC, '206781.651876')
    expect(usdcFromMajor.amount.toFixed()).toEqual('206781651876')
    expect(usdcFromMajor.amount).toEqual(usdcFromMinor.amount)
    expect(usdcFromMajor.amount.add(1).gt(usdcFromMinor.amount)).toBe(true)
  })

  test('USD', () => {
    const usdFromMinor = Money.fromMinor(currencies.USD, '31257145')
    expect(usdFromMinor.toMajorAmount().toString()).toEqual('312571.45')

    const usdFromCents = USD.fromCents('31257145')
    expect(usdFromMinor.amount).toEqual(usdFromCents.amount)

    const usdFromMajor = Money.fromMajor(currencies.USD, '312571.45')
    expect(usdFromMajor.amount.toFixed()).toEqual('31257145')
    expect(usdFromMajor.amount).toEqual(usdFromMinor.amount)
    expect(usdFromMajor.amount).toEqual(usdFromCents.amount)
    expect(usdFromMajor.amount.add(1).gt(usdFromMinor.amount)).toBe(true)
  })

  test('SOL', () => {
    const solFromMinor = Money.fromMinor(currencies.SOL, '1234567890123')
    expect(solFromMinor.toMajorAmount().toString()).toEqual('1234.567890123')

    const solFromLamports = SOL.fromLamports('1234567890123')
    expect(solFromMinor.amount).toEqual(solFromLamports.amount)

    const solFromMajor = Money.fromMajor(currencies.SOL, '1234.567890123')
    expect(solFromMajor.amount.toFixed()).toEqual('1234567890123')
    expect(solFromMajor.amount).toEqual(solFromMinor.amount)
    expect(solFromMajor.amount).toEqual(solFromLamports.amount)
    expect(solFromMajor.amount.add(1).gt(solFromMinor.amount)).toBe(true)
  })
})
