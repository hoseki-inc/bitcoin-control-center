import type { LiteralUnion } from 'type-fest'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { literalUnion } from './literal-union'

describe('literalUnion with strings', () => {
  const status = literalUnion(['pending', 'approved', 'rejected'] as const)

  describe('runtime validation', () => {
    it('should accept enum values', () => {
      expect(parseUnknown(status, 'pending').isOk()).toBe(true)
      expect(parseUnknown(status, 'approved').isOk()).toBe(true)
      expect(parseUnknown(status, 'rejected').isOk()).toBe(true)
    })

    it('should accept any string value', () => {
      expect(parseUnknown(status, 'unknown').isOk()).toBe(true)
      expect(parseUnknown(status, 'custom_status').isOk()).toBe(true)
      expect(parseUnknown(status, '').isOk()).toBe(true)
    })

    it('should reject non-string values', () => {
      expect(parseUnknown(status, 123).isOk()).toBe(false)
      expect(parseUnknown(status, null).isOk()).toBe(false)
      expect(parseUnknown(status, undefined).isOk()).toBe(false)
      expect(parseUnknown(status, {}).isOk()).toBe(false)
      expect(parseUnknown(status, []).isOk()).toBe(false)
      expect(parseUnknown(status, true).isOk()).toBe(false)
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
      const result = parseUnknown(status, 'pending').expect('valid input')

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
      expect(parseUnknown(statusCode, 200).isOk()).toBe(true)
      expect(parseUnknown(statusCode, 201).isOk()).toBe(true)
      expect(parseUnknown(statusCode, 404).isOk()).toBe(true)
      expect(parseUnknown(statusCode, 500).isOk()).toBe(true)
    })

    it('should accept any number value', () => {
      expect(parseUnknown(statusCode, 999).isOk()).toBe(true)
      expect(parseUnknown(statusCode, 0).isOk()).toBe(true)
      expect(parseUnknown(statusCode, -1).isOk()).toBe(true)
      expect(parseUnknown(statusCode, 3.14).isOk()).toBe(true)
    })

    it('should reject non-number values', () => {
      expect(parseUnknown(statusCode, '200').isOk()).toBe(false)
      expect(parseUnknown(statusCode, null).isOk()).toBe(false)
      expect(parseUnknown(statusCode, undefined).isOk()).toBe(false)
      expect(parseUnknown(statusCode, {}).isOk()).toBe(false)
      expect(parseUnknown(statusCode, []).isOk()).toBe(false)
      expect(parseUnknown(statusCode, true).isOk()).toBe(false)
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
      const result = parseUnknown(statusCode, 200).expect('valid input')

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
      expect(parseUnknown(boolFlag, true).isOk()).toBe(true)
      expect(parseUnknown(boolFlag, false).isOk()).toBe(true)
    })

    it('should reject non-boolean values', () => {
      expect(parseUnknown(boolFlag, 'true').isOk()).toBe(false)
      expect(parseUnknown(boolFlag, 1).isOk()).toBe(false)
      expect(parseUnknown(boolFlag, 0).isOk()).toBe(false)
      expect(parseUnknown(boolFlag, null).isOk()).toBe(false)
      expect(parseUnknown(boolFlag, undefined).isOk()).toBe(false)
      expect(parseUnknown(boolFlag, {}).isOk()).toBe(false)
    })
  })

  describe('type inference', () => {
    it('should provide correct output type', () => {
      const result = parseUnknown(boolFlag, true).expect('valid input')

      // Result should be typed as boolean
      expectTypeOf(result).toBeBoolean()
      expectTypeOf(result).toEqualTypeOf<LiteralUnion<true, boolean>>()
    })
  })
})
