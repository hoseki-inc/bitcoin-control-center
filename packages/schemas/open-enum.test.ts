import { expect, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { openEnum } from './open-enum'

const values = ['a', 'b'] as const
const schema = openEnum(values)

it('should parse enum values', () => {
  for (const value of values) {
    expect(parseUnknown(schema, value).expect('valid input')).toEqual({ enum: value, string: undefined })
  }
})

it('should parse string value', () => {
  expect(parseUnknown(schema, 'any').expect('valid input')).toEqual({ enum: undefined, string: 'any' })
})
