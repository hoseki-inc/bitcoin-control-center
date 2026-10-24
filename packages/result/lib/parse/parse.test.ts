import { Ok, type Result } from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { ParseError, parse, parseUnknown } from './parse'

describe('types', () => {
  it('should return correct type for schema', () => {
    const a = parse(z.string(), '123')
    expectTypeOf<Result<string, ParseError>>(a)
  })

  it('should return correct type for transformed schema', () => {
    const b = parse(
      z.number().transform(() => 'string'),
      123,
    )
    expectTypeOf<Result<string, ParseError>>(b)
  })
})

it('should return Ok when parsing is successful', () => {
  const result = parse(z.string(), '123')
  expect(result).toEqual(Ok('123'))
})

it('should return Err when parsing is unsuccessful', () => {
  const result = parseUnknown(z.string(), 123)
  expect(result.isErr()).toBe(true)
  const error = result.expectErr('invalid input should fail parsing')
  expect(error).toBeInstanceOf(ParseError)
  expect(error.cause).toBeInstanceOf(z.ZodError)
})

describe('errors', () => {
  it('joins every issue message', () => {
    const schema = z.object({ a: z.string().min(2, 'a is short'), b: z.number().min(5, 'b is small') })
    expect(parse(schema, { a: 'x', b: 1 }).unwrapErr().message).toBe('a is short; b is small')
  })
})
