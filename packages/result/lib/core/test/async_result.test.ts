import {
  AsyncErr,
  AsyncOk,
  AsyncResult,
  Err,
  ErrorWithTag,
  None,
  Ok,
  Panic,
  type Result,
  Some,
} from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('AsyncResult.fromPromise', () => {
  it('accepts PromiseLike values and supports chaining before awaiting', async () => {
    const value: PromiseLike<number> = Promise.resolve(21)
    const result = AsyncResult.fromPromise({ then: value.then.bind(value) })

    expectTypeOf(result).toEqualTypeOf<AsyncResult<number, Error>>()
    await expect(result.map((number) => number * 2)).resolves.toEqual(Ok(42))
  })

  it('preserves Error identity and normalizes non-Error rejections', async () => {
    const error = new Error('read failed')
    const failed = AsyncResult.fromPromise(Promise.reject(error))
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercise normalization of an invalid rejection payload.
    const invalid = AsyncResult.fromPromise(Promise.reject('read failed'))

    await expect(failed.expectErr('Expected read failure')).resolves.toBe(error)
    const normalized = await invalid.expectErr('Expected normalized failure')
    expect(normalized).toBeInstanceOf(TypeError)
    expect(normalized.cause).toBe('read failed')
  })

  it('keeps Panic rejections unrecoverable', async () => {
    const panic = new Panic('invariant failed')

    await expect(AsyncResult.fromPromise(Promise.reject(panic))).rejects.toBe(panic)
  })
})

describe('AsyncResult.fromThrowable', () => {
  it('runs once in a microtask and awaits the returned value', async () => {
    let calls = 0
    const result = AsyncResult.fromThrowable(async () => {
      calls += 1
      return Promise.resolve(42)
    })

    expectTypeOf(result).toEqualTypeOf<AsyncResult<number, Error>>()
    expect(calls).toBe(0)
    await expect(result).resolves.toEqual(Ok(42))
    await expect(result).resolves.toEqual(Ok(42))
    expect(calls).toBe(1)
  })

  it('supports synchronous return values and PromiseLike callbacks', async () => {
    const sync = AsyncResult.fromThrowable(() => 42)
    const promised = AsyncResult.fromThrowable((): PromiseLike<number> => Promise.resolve(42))

    expectTypeOf(sync).toEqualTypeOf<AsyncResult<number, Error>>()
    expectTypeOf(promised).toEqualTypeOf<AsyncResult<number, Error>>()
    await expect(sync).resolves.toEqual(Ok(42))
    await expect(promised).resolves.toEqual(Ok(42))
  })

  it('captures throws before a promise is returned and later rejections', async () => {
    const error = new Error('read failed')
    // oxlint-disable-next-line typescript/promise-function-async -- Exercise a synchronous throw before a promise is returned.
    const thrown = AsyncResult.fromThrowable((): Promise<string> => {
      throw error
    })
    const rejected = AsyncResult.fromThrowable(async () => Promise.reject(error))

    await expect(thrown.expectErr('Expected synchronous failure')).resolves.toBe(error)
    await expect(rejected.expectErr('Expected asynchronous failure')).resolves.toBe(error)
  })

  it('normalizes non-Error failures', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Exercise normalization of an invalid rejection payload.
    const result = AsyncResult.fromThrowable(async () => Promise.reject('read failed'))
    const error = await result.expectErr('Expected normalized failure')

    expect(error).toBeInstanceOf(TypeError)
    expect(error.cause).toBe('read failed')
  })

  it('preserves both thrown and rejected Panics as rejections', async () => {
    const panic = new Panic('invariant failed')
    const thrown = AsyncResult.fromThrowable(() => {
      throw panic
    })
    const rejected = AsyncResult.fromThrowable(async () => Promise.reject(panic))

    await expect(thrown).rejects.toBe(panic)
    await expect(rejected).rejects.toBe(panic)
  })
})

describe('catch', () => {
  it('passes fulfilled Results through without handling Err', async () => {
    const expected: Result<number, string> = Err('expected failure')
    const pending = new AsyncResult(Promise.resolve(expected))
    let calls = 0

    const caught = pending.catch<string>(() => {
      calls += 1
      return 'recovered'
    })

    expectTypeOf(caught).toEqualTypeOf<PromiseLike<Result<number, string> | string>>()
    await expect(caught).resolves.toBe(expected)
    expect(calls).toBe(0)
  })

  it('handles rejected promises', async () => {
    const rejection = new Error('rejected')
    const pending = new AsyncResult<number, string>(Promise.reject(rejection))

    await expect(
      pending.catch((cause) => {
        expect(cause).toBe(rejection)
        return 'recovered'
      }),
    ).resolves.toBe('recovered')
  })
})

describe('finally', () => {
  it('awaits cleanup before preserving a fulfilled Result', async () => {
    const expected: Result<number, string> = Ok(42)
    let startCleanup = (): void => {
      throw new Error('Cleanup did not start')
    }
    let finishCleanup = (): void => {
      throw new Error('Cleanup did not finish')
    }
    const cleanupStarted = new Promise<void>((resolve) => {
      startCleanup = resolve
    })
    const cleanupFinished = new Promise<void>((resolve) => {
      finishCleanup = resolve
    })
    const finalized = new AsyncResult(Promise.resolve(expected)).finally(async () => {
      startCleanup()
      await cleanupFinished
    })
    let settled = false
    void finalized.then(() => {
      settled = true
    })

    await cleanupStarted
    expect(settled).toBe(false)
    finishCleanup()
    await expect(finalized).resolves.toBe(expected)
  })

  it('preserves the original rejection after cleanup', async () => {
    const rejection = new Error('rejected')
    const pending = new AsyncResult<number, string>(Promise.reject(rejection))

    await expect(pending.finally(async () => Promise.resolve())).rejects.toBe(rejection)
  })

  it('rejects with a cleanup failure instead of the original settlement', async () => {
    const rejection = new Error('rejected')
    const cleanupFailure = new Error('cleanup failed')
    const rejected = new AsyncResult<number, string>(Promise.reject(rejection))
    const failCleanup = async (): Promise<void> => Promise.reject(cleanupFailure)

    await expect(AsyncOk(42).finally(failCleanup)).rejects.toBe(cleanupFailure)
    await expect(rejected.finally(failCleanup)).rejects.toBe(cleanupFailure)
  })
})

describe('ok', () => {
  it('returns Some for Ok', async () => {
    await expect(AsyncOk(42).ok()).resolves.toEqual(Some(42))
  })

  it('returns None for Err', async () => {
    await expect(AsyncErr('error').ok()).resolves.toEqual(None)
  })
})

describe('andThen', () => {
  it('maps an Ok result', async () => {
    await expect(
      AsyncOk(0)
        .andThen((value) => Ok(value + 1))
        .expect('Expected value'),
    ).resolves.toBe(1)
  })

  it('returns an Err result unchanged', async () => {
    await expect(
      AsyncErr<string, number>('error')
        .andThen((value) => Ok(value + 1))
        .expectErr('Expected Err'),
    ).resolves.toBe('error')
  })
})

describe('andThenAsync', () => {
  it('maps an Ok result', async () => {
    await expect(
      AsyncOk<number, string>(0)
        .andThenAsync(async (value) => Ok(value + 1))
        .expect('Expected value'),
    ).resolves.toBe(1)
  })

  it('returns an Err result unchanged', async () => {
    await expect(
      AsyncErr<number, string>(0)
        .andThenAsync(async (value) => Ok(value + 1))
        .expectErr('Expected Err'),
    ).resolves.toBe(0)
  })
})

describe('expect', () => {
  it('returns the Ok value', async () => {
    await expect(AsyncOk(42).expect('Panic message')).resolves.toBe(42)
  })

  it('rejects with Panic for Err', async () => {
    await expect(AsyncErr('error').expect('Panic message')).rejects.toThrow(Panic)
    await expect(AsyncErr('error').expect('Panic message')).rejects.toThrow('Panic message')
  })
})

describe('expectErr', () => {
  it('returns the Err value', async () => {
    const error = new Error('Test error')

    await expect(AsyncErr(error).expectErr('Panic message')).resolves.toBe(error)
  })

  it('rejects with Panic for Ok', async () => {
    await expect(AsyncOk(42).expectErr('Panic message')).rejects.toThrow(Panic)
    await expect(AsyncOk(42).expectErr('Panic message')).rejects.toThrow('Panic message')
  })
})

describe('flatten', () => {
  it('flattens Ok containing Ok', async () => {
    const inner: Result<number, string> = Ok(42)
    const flattened = AsyncOk<Result<number, string>, boolean>(inner).flatten()

    expectTypeOf(flattened).toEqualTypeOf<AsyncResult<number, string | boolean>>()
    await expect(flattened.expect('Expected value')).resolves.toBe(inner.unwrap())
  })

  it('flattens Ok containing Err', async () => {
    const inner: Result<number, string> = Err('error')
    const flattened = AsyncOk<Result<number, string>, boolean>(inner).flatten()

    expectTypeOf(flattened).toEqualTypeOf<AsyncResult<number, string | boolean>>()
    await expect(flattened.expectErr('Expected Err')).resolves.toBe(inner.unwrapErr())
  })

  it('preserves an outer Err', async () => {
    const flattened = AsyncErr<boolean, Result<number, string>>(true).flatten()

    expectTypeOf(flattened).toEqualTypeOf<AsyncResult<number, string | boolean>>()
    await expect(flattened.expectErr('Expected Err')).resolves.toBe(true)
  })

  it('preserves non-primitive values and errors', () => {
    class Foo extends ErrorWithTag {
      public readonly tag = 'foo'
    }

    class Bar extends ErrorWithTag {
      public readonly tag = 'bar'
    }

    const result = AsyncOk<{ id: string } | undefined, Foo>({ id: '1' })
    const flattened = result.map((value) => (value === undefined ? Err(new Bar()) : Ok(value))).flatten()

    expectTypeOf(flattened).toEqualTypeOf<AsyncResult<{ id: string }, Foo | Bar>>()
  })
})

describe('inspect', () => {
  it('calls the callback for Ok', async () => {
    let calls = 0

    await AsyncOk(42).inspect(() => {
      calls += 1
    })

    expect(calls).toBe(1)
  })

  it('does not call the callback for Err', async () => {
    let calls = 0

    await AsyncErr('foo').inspect(() => {
      calls += 1
    })

    expect(calls).toBe(0)
  })
})

describe('inspectAsync', () => {
  it('calls the callback for Ok', async () => {
    let calls = 0

    await AsyncOk(42).inspectAsync(async () => {
      calls += 1
    })

    expect(calls).toBe(1)
  })

  it('does not call the callback for Err', async () => {
    let calls = 0

    await AsyncErr<number, string>(0).inspectAsync(async () => {
      calls += 1
    })

    expect(calls).toBe(0)
  })
})

describe('inspectErr', () => {
  it('does not call the callback for Ok', async () => {
    let calls = 0

    await AsyncOk(42).inspectErr(() => {
      calls += 1
    })

    expect(calls).toBe(0)
  })

  it('calls the callback for Err', async () => {
    let calls = 0

    await AsyncErr('foo').inspectErr(() => {
      calls += 1
    })

    expect(calls).toBe(1)
  })
})

describe('inspectErrAsync', () => {
  it('does not call the callback for Ok', async () => {
    let calls = 0

    await AsyncOk<number, string>(0).inspectErrAsync(async () => {
      calls += 1
    })

    expect(calls).toBe(0)
  })

  it('calls the callback for Err', async () => {
    let calls = 0

    await AsyncErr(42).inspectErrAsync(async () => {
      calls += 1
    })

    expect(calls).toBe(1)
  })
})

describe('map', () => {
  it('maps an Ok value', async () => {
    await expect(
      AsyncOk(42)
        .map((value) => value * 2)
        .expect('Expected value'),
    ).resolves.toBe(84)
  })

  it('preserves an Err value', async () => {
    const original = AsyncErr<string, number>('error')
    const mapped = original.map((value) => value * 2)
    const result = await original

    await expect(mapped.expectErr('Expected Err')).resolves.toBe(result.expectErr('Expected Err'))
  })
})

describe('mapAsync', () => {
  it('maps an Ok value', async () => {
    await expect(
      AsyncOk(42)
        .mapAsync(async (value) => value * 2)
        .expect('Expected value'),
    ).resolves.toBe(84)
  })

  it('preserves an Err value', async () => {
    const original = AsyncErr<string, number>('error')
    const mapped = original.mapAsync(async (value) => value * 2)
    const result = await original

    await expect(mapped.expectErr('Expected Err')).resolves.toBe(result.expectErr('Expected Err'))
  })
})

describe('mapErr', () => {
  it('maps an Err value', async () => {
    await expect(
      AsyncErr('error')
        .mapErr(() => 'new error')
        .expectErr('Expected Err'),
    ).resolves.toBe('new error')
  })

  it('preserves an Ok value', async () => {
    await expect(
      AsyncOk(undefined)
        .mapErr(() => new Error('Error'))
        .expect('Expected value'),
    ).resolves.toBeUndefined()
  })
})

describe('mapErrAsync', () => {
  it('maps an Err value', async () => {
    await expect(
      AsyncErr('string')
        .mapErrAsync(async () => 'error')
        .expectErr('Expected Err'),
    ).resolves.toBe('error')
  })

  it('preserves an Ok value', async () => {
    await expect(
      AsyncOk(undefined)
        .mapErrAsync(async () => new Error('Error'))
        .expect('Expected value'),
    ).resolves.toBeUndefined()
  })
})

describe('mapOr', () => {
  it('maps an Ok value', async () => {
    await expect(AsyncOk(42).mapOr(0, (value) => value * 2)).resolves.toBe(84)
  })

  it('returns the default for Err', async () => {
    const error = new Error('Test error')

    await expect(AsyncErr<Error, number>(error).mapOr(0, (value) => value * 2)).resolves.toBe(0)
  })
})

describe('mapOrElse', () => {
  it('maps an Ok value', async () => {
    await expect(
      AsyncOk(42).mapOrElse(
        () => 0,
        (value) => value * 2,
      ),
    ).resolves.toBe(84)
  })

  it('computes the default for Err', async () => {
    const error = new Error('Test error')

    await expect(
      AsyncErr<Error, number>(error).mapOrElse(
        () => 0,
        (value) => value * 2,
      ),
    ).resolves.toBe(0)
  })
})

describe('orElse', () => {
  it('returns an Ok result unchanged', async () => {
    await expect(
      AsyncOk(1)
        .orElse(() => Ok(2))
        .expect('Expected value'),
    ).resolves.toBe(1)
  })

  it('maps an Err result', async () => {
    const result = AsyncErr('error')

    await expect(result.orElse(() => Ok(1)).expect('Expected value')).resolves.toBe(1)
    await expect(result.orElse(() => Err(1)).expectErr('Expected Err')).resolves.toBe(1)
  })
})

describe('orElseAsync', () => {
  it('returns an Ok result unchanged', async () => {
    await expect(
      AsyncOk<number, string>(0)
        .orElseAsync(async () => Ok(1))
        .expect('Expected value'),
    ).resolves.toBe(0)
  })

  it('maps an Err result', async () => {
    const result = AsyncErr<string, string>('original')

    await expect(result.orElseAsync(async () => Ok(1)).expect('Expected value')).resolves.toBe(1)
    await expect(result.orElseAsync(async () => Err(1)).expectErr('Expected Err')).resolves.toBe(1)
  })
})

describe('unwrap', () => {
  it('returns the Ok value', async () => {
    await expect(AsyncOk(42).expect('Expected value')).resolves.toBe(42)
  })

  it('requires a default before awaiting and narrowing', async () => {
    expect('unwrap' in AsyncOk(42)).toBe(false)
    await expect(AsyncErr(new Error('Test error')).unwrapOr(undefined)).resolves.toBeUndefined()
  })
})

describe('unwrapErr', () => {
  it('returns the Err value', async () => {
    const error = new Error('Test error')

    await expect(AsyncErr(error).expectErr('Expected Err')).resolves.toBe(error)
  })

  it('does not exist on AsyncResult', () => {
    expect('unwrapErr' in AsyncOk(42)).toBe(false)
  })
})

describe('unwrapOr', () => {
  it('returns the Ok value', async () => {
    await expect(AsyncOk(42).unwrapOr(0)).resolves.toBe(42)
  })

  it('returns the default for Err', async () => {
    await expect(AsyncErr(new Error('Test error')).unwrapOr(42)).resolves.toBe(42)
  })
})

describe('unwrapOrElse', () => {
  it('returns the Ok value', async () => {
    await expect(AsyncOk(42).unwrapOrElse(() => 0)).resolves.toBe(42)
  })

  it('computes the default for Err', async () => {
    await expect(AsyncErr(new Error('Test error')).unwrapOrElse(() => 42)).resolves.toBe(42)
  })
})

describe('match', () => {
  it('calls the Ok matcher', async () => {
    await expect(
      AsyncOk(42).match({
        Ok: (value) => value * 2,
        Err: () => 0,
      }),
    ).resolves.toBe(84)
  })

  it('calls the Err matcher', async () => {
    await expect(
      AsyncErr<Error, number>(new Error('Test error')).match({
        Ok: (value) => value * 2,
        Err: () => 0,
      }),
    ).resolves.toBe(0)
  })
})
