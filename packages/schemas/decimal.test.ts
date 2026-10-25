import { Decimal } from 'decimal.js'
import { describe, expect, it, test } from 'vitest'
import { parse } from '../result/lib/parse'
import { decimal } from './decimal'

it('should parse string', () => {
  expect(decimal().parse('1')).toEqual(new Decimal('1'))
})

it('should parse number', () => {
  expect(decimal().parse(1)).toEqual(new Decimal('1'))
})

it('should parse bigint', () => {
  expect(decimal().parse(BigInt(1))).toEqual(new Decimal('1'))
})

it('should parse Decimal', () => {
  expect(decimal().parse(new Decimal('1'))).toEqual(new Decimal('1'))
})

describe('prisma decimal', () => {
  test('one d', () => {
    expect(
      decimal().parse({
        d: [10000],
        e: 11,
        s: 1,
      }),
    ).toEqual(new Decimal('100000000000'))
  })

  test('two d', () => {
    expect(
      decimal().parse({
        d: [12, 3400000],
        e: 1,
        s: 1,
      }),
    ).toEqual(new Decimal('12.34'))
  })

  // Explicit test case that started breaking May, 28th 2021
  it('should parse Prisma Decimal with large numbers', () => {
    expect(
      decimal().parse({
        d: [12851, 1163656],
        e: 11,
        s: 1,
      }),
    ).toEqual(new Decimal('128511163656'))
  })
})

it('should parse with config', () => {
  expect(
    decimal({
      precision: 1,
    })
      .parse(new Decimal('1'))
      .precision(),
  ).toBe(1)
})

it.each([
  ['invalid numeric string', 'not-a-number', 'cannot parse not-a-number as decimal number'],
  ['NaN string', 'NaN', 'NaN is not a valid decimal number'],
  ['NaN instance', new Decimal(NaN), 'NaN is not a valid decimal number'],
  ['invalid decimal representation', { d: [1], e: 0, s: 0 }, '{"d":[1],"e":0,"s":0} is not a valid decimal number'],
])('reports a readable validation error for %s', (_label, input, message) => {
  const result = parse(decimal(), input)
  expect(result.isErr()).toBe(true)
  expect(result.expectErr('invalid decimal should fail validation').message).toBe(message)
})

it('preserves bigint precision', () => {
  const result = parse(decimal(), 900719925474099312345n)
  expect(result.expect('valid bigint').toString()).toBe('900719925474099312345')
})

it.each([
  ['positive', decimal.positive()],
  ['nonnegative', decimal.nonnegative()],
])('decimal.%s returns a parse error for text that is not a number', (_name, schema) => {
  expect(parse(schema, 'not-a-number').isErr()).toBe(true)
})
