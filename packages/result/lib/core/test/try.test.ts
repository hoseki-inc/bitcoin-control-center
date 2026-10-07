import { AsyncResult, Err, Ok, Panic, type Result, tryBlock } from '@hoseki/packages/result'
import { expect, expectTypeOf, test } from 'vitest'

test('direct delegation preserves nullish values and creates fresh iterators', () => {
  const value = Ok({ count: 1 })
  const result = tryBlock(function* () {
    expect(yield* Ok(undefined)).toBeUndefined()
    expect(yield* Ok(null)).toBeNull()
    const first = yield* value
    const second = yield* value
    expect(first).toBe(second)
    return Ok(first.count + second.count)
  })
  expect(result.expect('Expected both delegations to complete')).toBe(2)
})

test('direct delegation stops before subsequent side effects on failure', async () => {
  const steps: string[] = []
  const failure = new Error('stop')
  const failed = Err(failure)
  const syncResult = tryBlock(function* () {
    yield* failed
    steps.push('sync continued')
    return Ok(1)
  })
  const asyncResult = await tryBlock(async function* () {
    yield* Ok(1)
    yield* new AsyncResult(Promise.resolve(failed))
    steps.push('async continued')
    return Ok(1)
  })
  expect(syncResult.expectErr('Expected synchronous failure')).toBe(failure)
  expect(asyncResult.expectErr('Expected asynchronous failure')).toBe(failure)
  expect(syncResult).toBe(failed)
  expect(asyncResult).toBe(failed)
  expect(steps).toEqual([])
})

test('direct delegation closes generators on failure', async () => {
  const steps: string[] = []
  const failed = Err(new Error('stop'))
  const syncResult = tryBlock(function* () {
    try {
      yield* failed
    } finally {
      steps.push('sync cleanup')
    }
    return Ok(1)
  })
  const asyncResult = await tryBlock(async function* () {
    try {
      yield* new AsyncResult(Promise.resolve(failed))
    } finally {
      await Promise.resolve()
      steps.push('async cleanup')
    }
    return Ok(1)
  })
  expect(syncResult).toBe(failed)
  expect(asyncResult).toBe(failed)
  expect(steps).toEqual(['sync cleanup', 'async cleanup'])
})

test('direct delegation propagates cleanup failures', async () => {
  const failCleanup = (error: Error): void => {
    throw error
  }
  const syncCleanupError = new Error('sync cleanup failed')
  expect(() =>
    tryBlock(function* () {
      try {
        yield* Err('stop')
      } finally {
        failCleanup(syncCleanupError)
      }
      return Ok(1)
    }),
  ).toThrow(syncCleanupError)

  const asyncCleanupError = new Error('async cleanup failed')
  await expect(
    tryBlock(async function* () {
      try {
        yield* Err('stop')
      } finally {
        await Promise.reject(asyncCleanupError)
      }
      return Ok(1)
    }),
  ).rejects.toMatchObject({
    cause: asyncCleanupError,
    message: 'Unexpected rejected promise in `tryBlock`: resolve the promise safely instead of throwing',
    name: 'Panic',
  })

  const panic = new Panic('cleanup panic')
  await expect(
    tryBlock(async function* () {
      try {
        yield* Err('stop')
      } finally {
        failCleanup(panic)
      }
      return Ok(1)
    }),
  ).rejects.toBe(panic)
})

test('async delegation can reuse an AsyncResult and unwrap nullish values', async () => {
  const value = new AsyncResult(Promise.resolve(Ok(2)))
  const result = await tryBlock(async function* () {
    expect(yield* new AsyncResult(Promise.resolve(Ok(undefined)))).toBeUndefined()
    expect(yield* new AsyncResult(Promise.resolve(Ok(null)))).toBeNull()
    const first = yield* value
    const second = yield* value
    return Ok(first + second)
  })
  expect(result.expect('Expected both async delegations to complete')).toBe(4)
})

test('tryBlock unwraps Ok values and propagates Err values', () => {
  const successful = tryBlock(function* () {
    const first = yield* Ok(1)
    const second = yield* Ok(1)
    return Ok(first + second)
  })
  expectTypeOf(successful).toEqualTypeOf<Result<number, never>>()
  expect(successful.expect('Expected value')).toBe(2)

  const union = tryBlock(function* () {
    const first = yield* Err('error')
    const second = yield* Err(2)
    void first
    void second
    if (Math.random() > 0.5) {
      return Ok('foo')
    }
    return Ok(0)
  })
  expectTypeOf(union).toEqualTypeOf<Result<string | number, string | number>>()

  const failed = tryBlock(function* () {
    const first = yield* Ok(1)
    yield* Err('error')
    return Ok(first)
  })
  expectTypeOf(failed).toEqualTypeOf<Result<number, string>>()
  expect(failed.expectErr('Expected Err')).toBe('error')

  const mixed = tryBlock(function* () {
    const value = yield* Ok(1)
    if (Math.random() > 0.5) {
      return Ok(value)
    }
    return Err('error')
  })
  expectTypeOf(mixed).toEqualTypeOf<Result<number, string>>()
})

test('tryBlock unwraps synchronous and asynchronous results', async () => {
  const successful = tryBlock(async function* () {
    const first = yield* Ok(1)
    const second = yield* Ok(1)
    return Ok(first + second)
  })
  expectTypeOf(successful).toEqualTypeOf<AsyncResult<number, never>>()
  await expect(successful.expect('Expected value')).resolves.toBe(2)

  const union = tryBlock(async function* () {
    const first = yield* Err('error')
    const second = yield* new AsyncResult(Promise.resolve(Err(2)))
    void first
    void second
    if (Math.random() > 0.5) {
      return Ok('foo')
    }
    return Ok(0)
  })
  expectTypeOf(union).toEqualTypeOf<AsyncResult<string | number, string | number>>()

  const asynchronousSuccess = tryBlock(async function* () {
    const first = yield* new AsyncResult(Promise.resolve(Ok(1)))
    const second = yield* new AsyncResult(Promise.resolve(Ok(1)))
    return Ok(first + second)
  })
  expectTypeOf(asynchronousSuccess).toEqualTypeOf<AsyncResult<number, never>>()
  await expect(asynchronousSuccess.expect('Expected value')).resolves.toBe(2)

  const asynchronousFailure = tryBlock(async function* () {
    const first = yield* new AsyncResult(Promise.resolve(Ok(1)))
    yield* new AsyncResult(Promise.resolve(Err('error')))
    return Ok(first)
  })
  expectTypeOf(asynchronousFailure).toEqualTypeOf<AsyncResult<number, string>>()
  await expect(asynchronousFailure.expectErr('Expected Err')).resolves.toBe('error')

  const mixed = tryBlock(async function* () {
    const value = yield* Ok(1)
    if (Math.random() > 0.5) {
      return Ok(value)
    }
    return Err('error')
  })
  expectTypeOf(mixed).toEqualTypeOf<AsyncResult<number, string>>()

  const chained = tryBlock(async function* () {
    return Ok(2)
  })
    .andThen((value) => Ok(value + 1))
    .map((value) => value * 2)
  expectTypeOf(chained).toEqualTypeOf<AsyncResult<number, never>>()
  await expect(chained.expect('Expected fluent chaining')).resolves.toBe(6)

  const panic = new Panic('known panic')
  await expect(
    tryBlock(async function* () {
      throw panic
    }).expect('Expected value'),
  ).rejects.toBe(panic)

  const error = new Error('unexpected')
  await expect(
    tryBlock(async function* () {
      throw error
    }).expect('Expected value'),
  ).rejects.toMatchObject({
    cause: error,
    message: 'Unexpected rejected promise in `tryBlock`: resolve the promise safely instead of throwing',
    name: 'Panic',
  })
})

test('synchronous blocks preserve immediate execution and thrown errors', () => {
  const steps: string[] = []
  const returned = Ok(1)
  const result = tryBlock(function* () {
    steps.push('executed')
    return returned
  })
  expectTypeOf(result).toEqualTypeOf<Result<number, never>>()
  expect(steps).toEqual(['executed'])
  expect(result).toBe(returned)

  const error = new Error('unexpected synchronous error')
  expect(() =>
    tryBlock(function* () {
      throw error
    }),
  ).toThrow(error)
})

test('yield* await delegates native promises of Results', async () => {
  const promisedResult: Promise<Result<number, Error>> = Promise.resolve(Ok(1))
  const successful = tryBlock(async function* () {
    const value = yield* await promisedResult
    return Ok(value + 1)
  })
  expectTypeOf(successful).toEqualTypeOf<AsyncResult<number, Error>>()
  await expect(successful.expect('Expected promised value')).resolves.toBe(2)

  const failed = Err(new Error('stop'))
  const steps: string[] = []
  const failure = await tryBlock(async function* () {
    yield* await Promise.resolve(failed)
    steps.push('continued')
    return Ok(1)
  })
  expect(failure).toBe(failed)
  expect(steps).toEqual([])
})
