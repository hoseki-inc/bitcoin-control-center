import { expect, it } from 'vitest'
import { openEnum } from './open-enum'

const values = ['a', 'b'] as const
const schema = openEnum(values)

it('should parse enum values', () => {
  for (const value of values) {
    expect(schema.parse(value)).toEqual({ enum: value, string: undefined })
  }
})

it('should parse string value', () => {
  expect(schema.parse('any')).toEqual({ enum: undefined, string: 'any' })
})
