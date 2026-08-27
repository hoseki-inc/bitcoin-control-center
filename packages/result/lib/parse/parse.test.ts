import { Ok, type Result } from '@patina/core'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'
import { ParseError, parse } from './parse'

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
  const result = parse(z.string(), 123 as unknown as string)
  expect(result.isErr()).toEqual(true)
  const error = result.unwrapErr()
  expect(error).toBeInstanceOf(ParseError)
  expect(error!.cause).toBeInstanceOf(z.ZodError)
})
