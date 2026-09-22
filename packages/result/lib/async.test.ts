import { AsyncResult, Err, Ok, Panic, type Result } from '@patina/core'
import { describe, expect, it } from 'vitest'
import { asyncResultAll } from './async'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T): void => {}
  const promise = new Promise<T>((finish) => {
    resolve = finish
  })
  return { promise, resolve }
}

describe('asyncResultAll', () => {
  it('returns an empty success for no operations', async () => {
    expect(await asyncResultAll([])).toEqual(Ok([]))
  })

  it('preserves input order when operations complete in reverse order', async () => {
    const first = deferred<Result<number, Error>>()
    const second = deferred<Result<number, Error>>()
    const combined = asyncResultAll([new AsyncResult(first.promise), new AsyncResult(second.promise)])

    second.resolve(Ok(2))
    await second.promise
    first.resolve(Ok(1))

    expect(await combined).toEqual(Ok([1, 2]))
  })

  it('returns the first completed error without waiting for an earlier pending operation', async () => {
    const pending = new AsyncResult<number, Error>(new Promise(() => {}))
    const failure = deferred<Result<number, Error>>()
    const error = new Error('Discovery failed')
    const combined = asyncResultAll([pending, new AsyncResult(failure.promise)])

    failure.resolve(Err(error))

    const result = await combined
    expect(result.expectErr('discovery should fail')).toBe(error)
  })

  it.each([new Error('Rejected operation'), new Panic('Panicked operation')])(
    'preserves a rejected Error, including a Panic (%s)',
    async (error) => {
      const rejected = new AsyncResult<number, Error>(Promise.reject(error))
      const result = await asyncResultAll([rejected])
      expect(result.expectErr('rejection should fail')).toBe(error)
    },
  )

  it.each(['rejected value', null, undefined, { reason: 'unexpected' }])(
    'wraps a non-Error rejection and retains its cause (%j)',
    async (cause) => {
      const rejected = new AsyncResult<number, Error>(Promise.reject(cause))
      const result = await asyncResultAll([rejected])
      const error = result.expectErr('rejection should fail')
      expect(error).toBeInstanceOf(Error)
      expect(error.cause).toBe(cause)
    },
  )
})
