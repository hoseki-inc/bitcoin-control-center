import { describe, expect, it } from 'vitest'
import {
  InvalidProviderAmountError,
  ZERO_VALIDATED_SATS,
  isHeaderSafeApiKey,
  parseBtcBalanceSats,
  parseSignedBtcAmountToSats,
  parseSignedBtcNetToSats,
  parseStoredBalanceSats,
} from './amounts'

describe('parseBtcBalanceSats', () => {
  it.each([
    { input: '0', expected: '0' },
    { input: '-0', expected: '0' },
    { input: '-0.0', expected: '0' },
    { input: '0.00000001', expected: '1' },
    { input: '1e-8', expected: '1' },
    { input: '1E-8', expected: '1' },
    { input: '1e-10000000', expected: '0' },
    { input: '.5', expected: '50000000' },
    { input: '1.', expected: '100000000' },
    { input: '0.000000005', expected: '1' },
    { input: '0.000000004', expected: '0' },
    { input: '0.000000015', expected: '2' },
    { input: '0.000000014', expected: '1' },
    { input: '0.123456789', expected: '12345679' },
    { input: '21000000', expected: '2100000000000000' },
  ])('accepts $input as $expected sats', ({ input, expected }) => {
    const result = parseBtcBalanceSats(input)
    expect(result.isOk()).toBe(true)
    expect(result.unwrap()).toBe(expected)
  })

  it.each([
    'NaN',
    'nan',
    'Infinity',
    '-Infinity',
    'abc',
    '',
    ' 1',
    '1 ',
    '0x10',
    '0b1',
    '+1',
    '-0.5',
    '-0.000000001',
    '1e10000000',
    '1e99999999999999999999',
    '21000000.00000001',
    '.',
    '-',
    '1e',
  ])('rejects %j without echoing the input in the error message', (input) => {
    const result = parseBtcBalanceSats(input)
    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(InvalidProviderAmountError)
    if (input.length > 0) {
      expect(err.message).not.toContain(input)
    }
  })

  it('does not leak canary strings in InvalidProviderAmountError', () => {
    const canary = 'AMOUNT_CANARY_982144'
    const result = parseBtcBalanceSats(canary)
    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().message).not.toContain(canary)
  })

  it('exports ZERO_VALIDATED_SATS as "0"', () => {
    expect(ZERO_VALIDATED_SATS).toBe('0')
  })
})

describe('parseSignedBtcAmountToSats', () => {
  it.each([
    { input: '0', expected: 0n },
    { input: '-0', expected: 0n },
    { input: '-0.000000004', expected: 0n },
    { input: '0.5', expected: 50_000_000n },
    { input: '-0.5', expected: -50_000_000n },
    { input: '-0.000000005', expected: -1n },
    { input: '-1e-8', expected: -1n },
    { input: '-21000000', expected: -2_100_000_000_000_000n },
  ])('parses signed amount $input as $expected', ({ input, expected }) => {
    const result = parseSignedBtcAmountToSats(input)
    expect(result.isOk()).toBe(true)
    expect(result.unwrap()).toBe(expected)
  })

  it.each(['NaN', 'Infinity', '-Infinity', 'abc', '', ' 1', '0x10', '1e10000000', '-21000000.00000001'])(
    'rejects invalid signed amount %j',
    (input) => {
      const result = parseSignedBtcAmountToSats(input)
      expect(result.isErr()).toBe(true)
      expect(result.unwrapErr()).toBeInstanceOf(InvalidProviderAmountError)
    },
  )
})

describe('parseSignedBtcNetToSats', () => {
  it.each([
    { amount: '1.0', fee: '0.0001', expected: 99_990_000n },
    { amount: '-0.5', fee: '0.0005', expected: -50_050_000n },
    { amount: '0.0001', fee: '0.0001', expected: 0n },
    { amount: '0.000000014', fee: '0.000000004', expected: 1n },
    { amount: '0', fee: '0', expected: 0n },
  ])('computes net ($amount - $fee) as $expected sats', ({ amount, fee, expected }) => {
    const result = parseSignedBtcNetToSats(amount, fee)
    expect(result.isOk()).toBe(true)
    expect(result.unwrap()).toBe(expected)
  })

  it.each([
    { amount: 'NaN', fee: '0' },
    { amount: '1.0', fee: 'NaN' },
    { amount: 'abc', fee: '0' },
    { amount: '1.0', fee: 'Infinity' },
    { amount: '20000000', fee: '-2000000' },
    { amount: '-20000000', fee: '2000000' },
  ])('rejects invalid net inputs ($amount, $fee)', ({ amount, fee }) => {
    const result = parseSignedBtcNetToSats(amount, fee)
    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toBeInstanceOf(InvalidProviderAmountError)
  })
})

describe('parseStoredBalanceSats', () => {
  it.each([
    { input: '0', expected: '0' },
    { input: '00', expected: '00' },
    { input: '123456789', expected: '123456789' },
    { input: 'NaN', expected: null },
    { input: '-1', expected: null },
    { input: '1.2', expected: null },
    { input: '', expected: null },
    { input: ' 100', expected: null },
    { input: null, expected: null },
  ])('maps stored $input to $expected', ({ input, expected }) => {
    expect(parseStoredBalanceSats(input)).toBe(expected)
  })
})

describe('isHeaderSafeApiKey', () => {
  it.each([
    { input: 'valid-api-key_123/+=', expected: true },
    { input: 'organizations/abc/apiKeys/def', expected: true },
    { input: 'key\twith-tab', expected: true },
    { input: '', expected: false },
    { input: 'bad\rkey', expected: false },
    { input: 'bad\nkey', expected: false },
    { input: 'bad\r\nkey', expected: false },
    { input: 'bad\0key', expected: false },
    { input: 'bad\u0100key', expected: false },
  ])('classifies $input as $expected', ({ input, expected }) => {
    expect(isHeaderSafeApiKey(input)).toBe(expected)
  })
})
