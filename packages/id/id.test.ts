import { describe, expect, expectTypeOf, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { Id } from './id'

describe('Id.gen', () => {
  it('should generate id with prefix', () => {
    const id = Id.gen('test')
    expect(id).toMatch(/^test_[a-zA-Z0-9]{21}$/)
    expectTypeOf(id).toEqualTypeOf<`test_${string}`>()
  })
})

describe('Id.factory', () => {
  it('should create factory function', () => {
    const genId = Id.factory('ah')
    expectTypeOf(genId).toEqualTypeOf<() => `ah_${string}`>()
    expect(genId()).toMatch(/^ah_[a-zA-Z0-9]{21}$/)
  })
})

describe('Id.strip', () => {
  it('should remove prefix from multi-part id', () => {
    expect(Id.strip('st_stmt_vZ8LBbWJ28vf1QYUkrZ7M')).toBe('vZ8LBbWJ28vf1QYUkrZ7M')
  })

  it('should remove prefix from underscore-prefixed id', () => {
    expect(Id.strip('_ctx_ezwIXuhcaxO749oDQdZef')).toBe('ezwIXuhcaxO749oDQdZef')
  })

  it('should remove prefix from simple id', () => {
    expect(Id.strip('sn_YaojD7ZMkzxNiDITju6i1')).toBe('YaojD7ZMkzxNiDITju6i1')
  })
})

describe('Id.schema', () => {
  it('should validate id with correct prefix', () => {
    const schema = Id.schema('test')
    const result = schema.safeParse('test_abc123')
    expect(result.success).toBe(true)
  })

  it('should reject id with wrong prefix', () => {
    const schema = Id.schema('test')
    const result = schema.safeParse('wrong_abc123')
    expect(result.success).toBe(false)
  })

  it('names the expected prefix', () => {
    expect(parseUnknown(Id.schema('acc'), 'tx_123').unwrapErr().message).toBe('id must start with "acc_"')
  })
})
