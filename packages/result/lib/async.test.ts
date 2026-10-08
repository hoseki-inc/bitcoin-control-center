import { describe, expect, expectTypeOf, it } from 'vitest'
import { asyncResultAll, asyncResultToPromise } from './async'
import { AsyncResult } from './core/async_result'
import { Err, Ok, type Result } from './core/result'

describe('asyncResultToPromise', () => {
  it('resolves successes and preserves Error rejection identity', async () => {
    await expect(asyncResultToPromise(new AsyncResult(Promise.resolve(Ok(42))))).resolves.toBe(42)
    const error = new Error('failed')
    await expect(asyncResultToPromise(new AsyncResult(Promise.resolve(Err(error))))).rejects.toBe(error)
  })

  it('wraps non-Error failures with their original cause', async () => {
    await expect(asyncResultToPromise(new AsyncResult(Promise.resolve(Err('failed'))))).rejects.toMatchObject({
      name: 'TypeError',
      cause: 'failed',
    })
  })
})

describe('asyncResultAll', () => {
  it('collects successes in input order, including an empty input', async () => {
    const result = asyncResultAll([new AsyncResult(Promise.resolve(Ok(1))), new AsyncResult(Promise.resolve(Ok(2)))])
    expectTypeOf(result).toEqualTypeOf<AsyncResult<number[], never>>()
    await expect(result).resolves.toEqual(Ok([1, 2]))
    await expect(asyncResultAll([])).resolves.toEqual(Ok([]))
  })

  it('preserves the first settled failure without waiting for other results', async () => {
    const cause = { code: 'failed' }
    const pending = new AsyncResult(new Promise<Result<number, typeof cause>>(() => {}))
    const result = asyncResultAll([pending, new AsyncResult(Promise.resolve(Err(cause)))])
    expectTypeOf(result).toEqualTypeOf<AsyncResult<number[], typeof cause>>()
    await expect(result.expectErr('Expected failure')).resolves.toBe(cause)
  })

  it('propagates unexpected promise rejection', async () => {
    const error = new Error('unexpected rejection')
    const pending = new AsyncResult<number, never>(Promise.reject(error))
    await expect(asyncResultAll([pending])).rejects.toBe(error)
  })
})
