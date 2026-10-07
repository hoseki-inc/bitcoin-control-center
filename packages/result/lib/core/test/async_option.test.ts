import { AsyncNone, AsyncOption, AsyncSome, None, type Option, Panic, Some } from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'

describe('AsyncOption.fromNullish', () => {
  it.each([null, undefined])('converts %s to None, directly or through a promise', async (value) => {
    await expect(AsyncOption.fromNullish(value)).resolves.toBe(None)
    await expect(AsyncOption.fromNullish(Promise.resolve(value))).resolves.toBe(None)
  })

  it.each([0, false, ''])('preserves the non-nullish value %s', async (value) => {
    await expect(AsyncOption.fromNullish(value)).resolves.toEqual(Some(value))
    await expect(AsyncOption.fromNullish(Promise.resolve(value))).resolves.toEqual(Some(value))
  })

  it('accepts PromiseLike values and removes nullish types before chaining', async () => {
    const value: PromiseLike<string | null | undefined> = Promise.resolve('Ada')
    const option = AsyncOption.fromNullish({ then: value.then.bind(value) })
    const explicit = AsyncOption.fromNullish<string | null | undefined>(value)
    const missing = AsyncOption.fromNullish<string>(null)

    expectTypeOf(option).toEqualTypeOf<AsyncOption<string>>()
    expectTypeOf(explicit).toEqualTypeOf<AsyncOption<string>>()
    expectTypeOf(missing).toEqualTypeOf<AsyncOption<string>>()
    await expect(option.map((name) => name.length)).resolves.toEqual(Some(3))
    await expect(missing).resolves.toBe(None)
  })

  it('preserves rejection rather than treating it as absence', async () => {
    const rejection = new Error('lookup failed')

    await expect(AsyncOption.fromNullish(Promise.reject(rejection))).rejects.toBe(rejection)
  })
})

describe('catch', () => {
  it('passes fulfilled Options through without handling None', async () => {
    const expected: Option<number> = None
    const pending = new AsyncOption(Promise.resolve(expected))
    let calls = 0

    const caught = pending.catch<string>(() => {
      calls += 1
      return 'recovered'
    })

    expectTypeOf(caught).toEqualTypeOf<PromiseLike<Option<number> | string>>()
    await expect(caught).resolves.toBe(expected)
    expect(calls).toBe(0)
  })

  it('handles rejected promises', async () => {
    const rejection = new Error('rejected')
    const pending = new AsyncOption<number>(Promise.reject(rejection))

    await expect(
      pending.catch((cause) => {
        expect(cause).toBe(rejection)
        return 'recovered'
      }),
    ).resolves.toBe('recovered')
  })
})

describe('finally', () => {
  it('awaits cleanup before preserving a fulfilled Option', async () => {
    const expected: Option<number> = Some(42)
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
    const finalized = new AsyncOption(Promise.resolve(expected)).finally(async () => {
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
    const pending = new AsyncOption<number>(Promise.reject(rejection))

    await expect(pending.finally(async () => Promise.resolve())).rejects.toBe(rejection)
  })

  it('rejects with a cleanup failure instead of the original settlement', async () => {
    const rejection = new Error('rejected')
    const cleanupFailure = new Error('cleanup failed')
    const rejected = new AsyncOption<number>(Promise.reject(rejection))
    const failCleanup = async (): Promise<void> => Promise.reject(cleanupFailure)

    await expect(AsyncSome(42).finally(failCleanup)).rejects.toBe(cleanupFailure)
    await expect(rejected.finally(failCleanup)).rejects.toBe(cleanupFailure)
  })
})

describe('okOr', () => {
  it('returns the value for Some', async () => {
    await expect(AsyncSome(42).okOr('error').expect('Expected value')).resolves.toBe(42)
  })

  it('returns the error for None', async () => {
    await expect(AsyncNone<number>().okOr('error').expectErr('Expected Err')).resolves.toBe('error')
  })
})

describe('okOrElse', () => {
  it('returns the value for Some', async () => {
    await expect(
      AsyncSome(42)
        .okOrElse(() => 'error')
        .expect('Expected value'),
    ).resolves.toBe(42)
  })

  it('computes the error for None', async () => {
    await expect(
      AsyncNone<number>()
        .okOrElse(() => 'error')
        .expectErr('Expected Err'),
    ).resolves.toBe('error')
  })
})

describe('andThen', () => {
  it('maps a Some value', async () => {
    await expect(
      AsyncSome(0)
        .andThen((value) => Some(value + 1))
        .expect('Expected value'),
    ).resolves.toBe(1)
  })

  it('returns None for None', async () => {
    await expect(AsyncNone<number>().andThen((value) => Some(value + 1))).resolves.toEqual(None)
  })
})

describe('expect', () => {
  it('returns the Some value', async () => {
    await expect(AsyncSome(42).expect('error')).resolves.toBe(42)
  })

  it('rejects with Panic for None', async () => {
    await expect(AsyncNone<number>().expect('msg')).rejects.toThrow(Panic)
    await expect(AsyncNone<number>().expect('msg')).rejects.toThrow('msg')
  })
})

describe('filter', () => {
  it('retains Some when the predicate passes', async () => {
    await expect(
      AsyncSome(42)
        .filter((value) => value === 42)
        .expect('Expected value'),
    ).resolves.toBe(42)
  })

  it('returns None when the predicate fails', async () => {
    await expect(AsyncSome(42).filter((value) => value !== 42)).resolves.toEqual(None)
  })
})

describe('flatten', () => {
  it('returns the inner option for Some', async () => {
    await expect(AsyncSome(Some(42)).flatten()).resolves.toEqual(Some(42))
  })

  it('returns None for None', async () => {
    await expect(AsyncNone<Option<number>>().flatten()).resolves.toEqual(None)
  })
})

describe('inspect', () => {
  it('calls the callback for Some', async () => {
    let inspected: number | undefined

    await AsyncSome(42).inspect((value) => {
      inspected = value
    })

    expect(inspected).toBe(42)
  })

  it('does not call the callback for None', async () => {
    let calls = 0

    await AsyncNone<number>().inspect(() => {
      calls += 1
    })

    expect(calls).toBe(0)
  })
})

describe('map', () => {
  it('maps a Some value', async () => {
    await expect(AsyncSome(42).map((value) => value + 1)).resolves.toEqual(Some(43))
  })

  it('returns None for None', async () => {
    await expect(AsyncNone<number>().map((value) => value + 1)).resolves.toEqual(None)
  })
})

describe('mapOr', () => {
  it('maps a Some value', async () => {
    await expect(AsyncSome(42).mapOr('default', (value) => value + 1)).resolves.toBe(43)
  })

  it('returns the default for None', async () => {
    await expect(AsyncNone<number>().mapOr('default', (value) => value + 1)).resolves.toBe('default')
  })
})

describe('mapOrElse', () => {
  it('maps a Some value', async () => {
    await expect(
      AsyncSome(42).mapOrElse(
        () => 'default',
        (value) => value + 1,
      ),
    ).resolves.toBe(43)
  })

  it('computes the default for None', async () => {
    await expect(
      AsyncNone<number>().mapOrElse(
        () => 'default',
        (value) => value + 1,
      ),
    ).resolves.toBe('default')
  })
})

describe('orElse', () => {
  it('resolves to the first Some', async () => {
    await expect(AsyncSome(1).orElse(() => Some(2))).resolves.toEqual(Some(1))
  })

  it('resolves to the fallback for None', async () => {
    await expect(AsyncNone<number>().orElse(() => Some(1))).resolves.toEqual(Some(1))
  })
})

describe('unwrap', () => {
  it('returns the Some value', async () => {
    await expect(AsyncSome(42).expect('Expected value')).resolves.toBe(42)
  })

  it('requires a default before awaiting and narrowing', async () => {
    expect('unwrap' in AsyncNone<number>()).toBe(false)
    await expect(AsyncNone<number>().unwrapOr(undefined)).resolves.toBeUndefined()
  })
})

describe('unwrapOr', () => {
  it('returns the Some value', async () => {
    await expect(AsyncSome(42).unwrapOr('default')).resolves.toBe(42)
  })

  it('returns the default for None', async () => {
    await expect(AsyncNone<number>().unwrapOr('default')).resolves.toBe('default')
  })
})

describe('unwrapOrElse', () => {
  it('returns the Some value', async () => {
    await expect(AsyncSome(42).unwrapOrElse(() => 'default')).resolves.toBe(42)
  })

  it('computes the default for None', async () => {
    await expect(AsyncNone<number>().unwrapOrElse(() => 'default')).resolves.toBe('default')
  })
})

describe('xor', () => {
  it('resolves to Some for Some and None', async () => {
    const first = AsyncSome(2)
    const second = AsyncNone<string>()

    await expect(first.xor(second)).resolves.toEqual(Some(2))
  })

  it('resolves to Some for None and Some', async () => {
    const first = AsyncNone<number>()
    const second = AsyncSome('foo')

    await expect(first.xor(second)).resolves.toEqual(Some('foo'))
  })

  it('resolves to None for None and None', async () => {
    const first = AsyncNone<number>()
    const second = AsyncNone<string>()

    await expect(first.xor(second)).resolves.toEqual(None)
  })

  it('resolves to None for Some and Some', async () => {
    const first = AsyncSome(2)
    const second = AsyncSome('str')

    await expect(first.xor(second)).resolves.toEqual(None)
  })
})

describe('match', () => {
  it('calls the Some matcher', async () => {
    await expect(
      AsyncSome(42).match({
        Some: (value) => value + 1,
        None: () => 'none',
      }),
    ).resolves.toBe(43)
  })

  it('calls the None matcher', async () => {
    await expect(
      AsyncNone<number>().match({
        Some: (value) => value + 1,
        None: () => 'none',
      }),
    ).resolves.toBe('none')
  })
})
