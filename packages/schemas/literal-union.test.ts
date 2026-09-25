import type { LiteralUnion } from 'type-fest'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { literalUnion } from './literal-union'

describe('literalUnion with strings', () => {
  const status = literalUnion(['pending', 'approved', 'rejected'] as const)

  describe('runtime validation', () => {
    it('should accept enum values', () => {
      expect(status.safeParse('pending').success).toBe(true)
      expect(status.safeParse('approved').success).toBe(true)
      expect(status.safeParse('rejected').success).toBe(true)
    })

    it('should accept any string value', () => {
      expect(status.safeParse('unknown').success).toBe(true)
      expect(status.safeParse('custom_status').success).toBe(true)
      expect(status.safeParse('').success).toBe(true)
    })

    it('should reject non-string values', () => {
      expect(status.safeParse(123).success).toBe(false)
      expect(status.safeParse(null).success).toBe(false)
      expect(status.safeParse(undefined).success).toBe(false)
      expect(status.safeParse({}).success).toBe(false)
      expect(status.safeParse([]).success).toBe(false)
      expect(status.safeParse(true).success).toBe(false)
    })
  })

  describe('type inference', () => {
    it('should infer known enum values for autocomplete', () => {
      type StatusType = ReturnType<typeof status.parse>

      // These should be autocompleted and valid
      expectTypeOf<'pending'>().toMatchTypeOf<StatusType>()
      expectTypeOf<'approved'>().toMatchTypeOf<StatusType>()
      expectTypeOf<'rejected'>().toMatchTypeOf<StatusType>()
    })

    it('should accept any string type', () => {
      type StatusType = ReturnType<typeof status.parse>

      // Any string should also be assignable
      expectTypeOf<string>().toMatchTypeOf<StatusType>()
      expectTypeOf<'unknown_value'>().toMatchTypeOf<StatusType>()
    })

    it('should provide correct output type', () => {
      const result = status.parse('pending')

      // Result should be typed as the union of known values + any string
      expectTypeOf(result).toBeString()
      expectTypeOf(result).toEqualTypeOf<LiteralUnion<'pending' | 'approved' | 'rejected', string>>()
    })
  })
})

describe('literalUnion with numbers', () => {
  const statusCode = literalUnion([200, 201, 404, 500] as const)

  describe('runtime validation', () => {
    it('should accept enum values', () => {
      expect(statusCode.safeParse(200).success).toBe(true)
      expect(statusCode.safeParse(201).success).toBe(true)
      expect(statusCode.safeParse(404).success).toBe(true)
      expect(statusCode.safeParse(500).success).toBe(true)
    })

    it('should accept any number value', () => {
      expect(statusCode.safeParse(999).success).toBe(true)
      expect(statusCode.safeParse(0).success).toBe(true)
      expect(statusCode.safeParse(-1).success).toBe(true)
      expect(statusCode.safeParse(3.14).success).toBe(true)
    })

    it('should reject non-number values', () => {
      expect(statusCode.safeParse('200').success).toBe(false)
      expect(statusCode.safeParse(null).success).toBe(false)
      expect(statusCode.safeParse(undefined).success).toBe(false)
      expect(statusCode.safeParse({}).success).toBe(false)
      expect(statusCode.safeParse([]).success).toBe(false)
      expect(statusCode.safeParse(true).success).toBe(false)
    })
  })

  describe('type inference', () => {
    it('should infer known enum values for autocomplete', () => {
      type StatusCodeType = ReturnType<typeof statusCode.parse>

      // These should be autocompleted and valid
      expectTypeOf<200>().toMatchTypeOf<StatusCodeType>()
      expectTypeOf<201>().toMatchTypeOf<StatusCodeType>()
      expectTypeOf<404>().toMatchTypeOf<StatusCodeType>()
      expectTypeOf<500>().toMatchTypeOf<StatusCodeType>()
    })

    it('should accept any number type', () => {
      type StatusCodeType = ReturnType<typeof statusCode.parse>

      // Any number should also be assignable
      expectTypeOf<number>().toMatchTypeOf<StatusCodeType>()
      expectTypeOf<999>().toMatchTypeOf<StatusCodeType>()
    })

    it('should provide correct output type', () => {
      const result = statusCode.parse(200)

      // Result should be typed as the union of known values + any number
      expectTypeOf(result).toBeNumber()
      expectTypeOf(result).toEqualTypeOf<LiteralUnion<200 | 201 | 404 | 500, number>>()
    })
  })
})

describe('literalUnion with booleans', () => {
  const boolFlag = literalUnion([true] as const)

  describe('runtime validation', () => {
    it('should accept boolean values', () => {
      expect(boolFlag.safeParse(true).success).toBe(true)
      expect(boolFlag.safeParse(false).success).toBe(true)
    })

    it('should reject non-boolean values', () => {
      expect(boolFlag.safeParse('true').success).toBe(false)
      expect(boolFlag.safeParse(1).success).toBe(false)
      expect(boolFlag.safeParse(0).success).toBe(false)
      expect(boolFlag.safeParse(null).success).toBe(false)
      expect(boolFlag.safeParse(undefined).success).toBe(false)
      expect(boolFlag.safeParse({}).success).toBe(false)
    })
  })

  describe('type inference', () => {
    it('should provide correct output type', () => {
      const result = boolFlag.parse(true)

      // Result should be typed as boolean
      expectTypeOf(result).toBeBoolean()
      expectTypeOf(result).toEqualTypeOf<LiteralUnion<true, boolean>>()
    })
  })
})
