import { Decimal } from 'decimal.js'
import { describe, expect, it, test } from 'vitest'
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
  ).toEqual(1)
})
