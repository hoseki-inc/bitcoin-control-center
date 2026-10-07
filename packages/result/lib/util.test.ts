import {
  AsyncErr,
  AsyncNone,
  AsyncOk,
  type AsyncOption,
  type AsyncResult,
  AsyncSome,
  None,
  Some,
} from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('async variant helpers', () => {
  it('preserves promise payloads without awaiting or flattening them', async () => {
    const promise = Promise.resolve(42)
    const ok = AsyncOk(promise)
    const some = AsyncSome(promise)

    expectTypeOf(ok).toEqualTypeOf<AsyncResult<Promise<number>, never>>()
    expectTypeOf(some).toEqualTypeOf<AsyncOption<Promise<number>>>()
    expect((await ok).expect('Expected promise payload')).toBe(promise)
    expect((await some).expect('Expected promise payload')).toBe(promise)
  })

  it('preserves error payloads as fulfilled Err values', async () => {
    const error = { kind: 'NotFound' }
    const result = AsyncErr(error)

    expectTypeOf(result).toEqualTypeOf<AsyncResult<never, { kind: string }>>()
    expect((await result).expectErr('Expected missing value')).toBe(error)
  })

  it('distinguishes Some with a nullish payload from None', async () => {
    await expect(AsyncSome(null)).resolves.toEqual(Some(null))
    await expect(AsyncSome(undefined)).resolves.toEqual(Some(undefined))
    await expect(AsyncNone()).resolves.toBe(None)
  })

  it('supports explicit opposite-variant types for typed chains and mocks', async () => {
    const ok = AsyncOk<number, string>(42)
    const err = AsyncErr<string, number>('missing')
    const none = AsyncNone<number>()

    expectTypeOf(ok).toEqualTypeOf<AsyncResult<number, string>>()
    expectTypeOf(err).toEqualTypeOf<AsyncResult<number, string>>()
    expectTypeOf(none).toEqualTypeOf<AsyncOption<number>>()
    await expect(ok.expect('Expected value')).resolves.toBe(42)
    await expect(err.unwrapOr(0)).resolves.toBe(0)
    await expect(none.unwrapOr(0)).resolves.toBe(0)
  })
})
