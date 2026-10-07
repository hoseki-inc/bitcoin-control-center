import { type AsyncResult, Err, ErrorWithTag, None, Ok, Panic, Result, Some } from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'

function testOk<T, E>(value: T): Result<T, E> {
  return Ok(value)
}

function testErr<T, E>(error: E): Result<T, E> {
  return Err(error)
}

describe('core', () => {
  it('requires narrowing before unwrapping, including after await', () => {
    // Checked by pnpm check; keep forbidden calls out of runtime execution.
    const check = async (result: Result<number, string>, pending: AsyncResult<number, string>): Promise<void> => {
      // @ts-expect-error An unnarrowed Result has no unwrap method.
      void result.unwrap
      // @ts-expect-error An unnarrowed Result has no unwrapErr method.
      void result.unwrapErr
      // @ts-expect-error Err has no unwrap method.
      void Err('error').unwrap
      // @ts-expect-error Ok has no unwrapErr method.
      void Ok(42).unwrapErr
      // @ts-expect-error AsyncResult must be awaited and narrowed first.
      void pending.unwrap
      // @ts-expect-error AsyncResult must be awaited and narrowed first.
      void pending.unwrapErr
      const resolved = await pending
      // @ts-expect-error Awaiting alone does not narrow a Result.
      void resolved.unwrap
      // @ts-expect-error Awaiting alone does not narrow a Result.
      void resolved.unwrapErr
      if (resolved.isOk()) {
        expectTypeOf(resolved.unwrap()).toEqualTypeOf<number>()
        // @ts-expect-error Narrowing to Ok excludes unwrapErr.
        void resolved.unwrapErr
      } else {
        expectTypeOf(resolved.unwrapErr()).toEqualTypeOf<string>()
        // @ts-expect-error Narrowing to Err excludes unwrap.
        void resolved.unwrap
      }
    }
    expectTypeOf(check).toBeFunction()
  })

  it.each([undefined, null])('preserves nullish payload %s on the matching variant', (value) => {
    expect(Ok(value).unwrap()).toBe(value)
    expect(Err(value).unwrapErr()).toBe(value)
  })

  it('preserves short-circuited variant identity across combinators', async () => {
    const ok = Ok({ id: 1 })
    const err = Err({ message: 'failed' })
    expect(err.andThen(() => ok)).toBe(err)
    await expect(err.andThenAsync(async () => ok)).resolves.toBe(err)
    expect(ok.orElse(() => err)).toBe(ok)
    await expect(ok.orElseAsync(async () => err)).resolves.toBe(ok)
  })

  it('creates an Ok result', () => {
    const result = Ok(42)

    expect(result.isOk()).toBe(true)
    expect(result.isErr()).toBe(false)
    expect(result.unwrap()).toBe(42)
    expectTypeOf<typeof result.unwrap>().toEqualTypeOf<() => number>()
    expectTypeOf<'unwrapErr'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrapErr'>()
    expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => number>()
    expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => never>()
  })

  it('creates an Err result', () => {
    const result = Err('error')

    expect(result.isOk()).toBe(false)
    expect(result.isErr()).toBe(true)
    expectTypeOf<'unwrap'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrap'>()
    expect(result.unwrapErr()).toBe('error')
    expectTypeOf<typeof result.unwrapErr>().toEqualTypeOf<() => string>()
    expectTypeOf<'unwrap'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrap'>()
    expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => never>()
    expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => string>()
  })

  it('narrows a Result discriminated union', () => {
    const result = testOk<number, string>(42)

    expectTypeOf<'unwrap' | 'unwrapErr'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrap' | 'unwrapErr'>()
    expectTypeOf(result.unwrapOr(undefined)).toEqualTypeOf<number | undefined>()
    if (result.isOk()) {
      expectTypeOf<typeof result.unwrap>().toEqualTypeOf<() => number>()
      expectTypeOf<'unwrapErr'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrapErr'>()
      expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => number>()
      expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => never>()
    } else {
      expectTypeOf<'unwrap'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrap'>()
      expectTypeOf<typeof result.unwrapErr>().toEqualTypeOf<() => string>()
      expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => never>()
      expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => string>()
    }

    if (result.isErr()) {
      expectTypeOf<'unwrap'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrap'>()
      expectTypeOf<typeof result.unwrapErr>().toEqualTypeOf<() => string>()
      expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => never>()
      expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => string>()
    } else {
      expectTypeOf<typeof result.unwrap>().toEqualTypeOf<() => number>()
      expectTypeOf<'unwrapErr'>().exclude<keyof typeof result>().toEqualTypeOf<'unwrapErr'>()
      expectTypeOf<typeof result.expect>().toEqualTypeOf<(message: string) => number>()
      expectTypeOf<typeof result.expectErr>().toEqualTypeOf<(message: string) => never>()
    }
  })
})

describe('ok', () => {
  it('returns Some for Ok', () => {
    expect(testOk<number, string>(42).ok()).toEqual(Some(42))
  })

  it('returns None for Err', () => {
    expect(testErr<number, string>('error').ok()).toEqual(None)
  })
})

describe('err', () => {
  it('returns None for Ok', () => {
    expect(testOk<number, string>(42).err()).toEqual(None)
  })

  it('returns Some for Err', () => {
    expect(testErr<number, string>('error').err()).toEqual(Some('error'))
  })
})

describe('andThen', () => {
  it('maps an Ok result', () => {
    expect(
      testOk<number, string>(0)
        .andThen((value) => Ok(value + 1))
        .expect('Expected value'),
    ).toBe(1)
  })

  it('returns an Err result unchanged', () => {
    const result = testErr<number, string>('early error')

    expect(result.andThen((value) => Ok(value + 1)).expectErr('Expected Err')).toBe(result.expectErr('Expected Err'))
  })
})

describe('andThenAsync', () => {
  it('maps an Ok result', async () => {
    const result = testOk<number, string>(0).andThenAsync(async (value) => Ok(value + 1))

    await expect(result.expect('Expected value')).resolves.toBe(1)
  })

  it('returns an Err result unchanged', async () => {
    const original = testErr<number, string>('early error')
    const result = original.andThenAsync(async (value) => Ok(value + 1))

    await expect(result.expectErr('Expected Err')).resolves.toBe(original.expectErr('Expected Err'))
  })
})

describe('expect', () => {
  it('returns the Ok value', () => {
    expect(testOk<number, string>(42).expect('Panic message')).toBe(42)
  })

  it('throws Panic for Err', () => {
    const result = testErr<number, string>('error')

    expect(() => result.expect('Panic message')).toThrow(Panic)
    expect(() => result.expect('Panic message')).toThrow('Panic message')
  })
})

describe('expectErr', () => {
  it('returns the Err value', () => {
    expect(testErr<number, string>('error').expectErr('panic message')).toBe('error')
  })

  it('throws Panic for Ok', () => {
    const result = testOk<number, string>(0)

    expect(() => result.expectErr('Panic message')).toThrow(Panic)
    expect(() => result.expectErr('Panic message')).toThrow('Panic message')
  })
})

describe('flatten', () => {
  it('flattens Ok containing Ok', () => {
    const inner = testOk<number, string>(42)
    const flattened = testOk<Result<number, string>, boolean>(inner).flatten()

    expectTypeOf(flattened).toEqualTypeOf<Result<number, string | boolean>>()
    expect(flattened.expect('Expected value')).toBe(inner.expect('Expected value'))
  })

  it('flattens Ok containing Err', () => {
    const inner = testErr<number, string>('error')
    const flattened = testOk<Result<number, string>, boolean>(inner).flatten()

    expectTypeOf(flattened).toEqualTypeOf<Result<number, string | boolean>>()
    expect(flattened.expectErr('Expected Err')).toBe(inner.expectErr('Expected Err'))
  })

  it('preserves an outer Err', () => {
    const flattened = testErr<Result<number, string>, boolean>(true).flatten()

    expectTypeOf(flattened).toEqualTypeOf<Result<number, string | boolean>>()
    expect(flattened.expectErr('Expected Err')).toBe(true)
  })

  it('preserves non-primitive values and errors', () => {
    class Foo extends ErrorWithTag {
      public readonly tag = 'foo'
    }

    class Bar extends ErrorWithTag {
      public readonly tag = 'bar'
    }

    const result = testOk<{ id: string } | undefined, Foo>({ id: '1' })
    const flattened = result.map((value) => (value === undefined ? Err(new Bar()) : Ok(value))).flatten()

    expectTypeOf(flattened).toEqualTypeOf<Result<{ id: string }, Foo | Bar>>()
  })
})

describe('inspect', () => {
  it('calls the callback for Ok', () => {
    let calls = 0

    testOk<number, string>(42).inspect(() => {
      calls += 1
    })

    expect(calls).toBe(1)
  })

  it('does not call the callback for Err', () => {
    let calls = 0

    testErr<number, string>('').inspect(() => {
      calls += 1
    })

    expect(calls).toBe(0)
  })
})

describe('inspectAsync', () => {
  it('calls the callback for Ok', async () => {
    let calls = 0
    const result = testOk<number, string>(42).inspectAsync(async () => {
      calls += 1
    })

    await result
    expect(calls).toBe(1)
  })

  it('does not call the callback for Err', async () => {
    let calls = 0
    const result = testErr<number, string>('').inspectAsync(async () => {
      calls += 1
    })

    await result
    expect(calls).toBe(0)
  })
})

describe('inspectErr', () => {
  it('does not call the callback for Ok', () => {
    let calls = 0

    testOk<number, string>(42).inspectErr(() => {
      calls += 1
    })

    expect(calls).toBe(0)
  })

  it('calls the callback for Err', () => {
    let calls = 0

    testErr<number, string>('').inspectErr(() => {
      calls += 1
    })

    expect(calls).toBe(1)
  })
})

describe('inspectErrAsync', () => {
  it('does not call the callback for Ok', async () => {
    let calls = 0
    const result = testOk<number, string>(42).inspectErrAsync(async () => {
      calls += 1
    })

    await result
    expect(calls).toBe(0)
  })

  it('calls the callback for Err', async () => {
    let calls = 0
    const result = testErr<number, string>('').inspectErrAsync(async () => {
      calls += 1
    })

    await result
    expect(calls).toBe(1)
  })
})

describe('map', () => {
  it('maps an Ok value', () => {
    const result = testOk<number, string>(42).map((value) => value * 2)

    expect(result.expect('Expected value')).toBe(84)
  })

  it('preserves an Err value', () => {
    const original = testErr<number, string>('error')
    const result = original.map((value) => value * 2)

    expect(result.expectErr('Expected Err')).toBe(original.expectErr('Expected Err'))
  })
})

describe('mapAsync', () => {
  it('maps an Ok value', async () => {
    const result = testOk<number, string>(42).mapAsync(async (value) => value * 2)

    await expect(result.expect('Expected value')).resolves.toBe(84)
  })

  it('preserves an Err value', async () => {
    const original = testErr<number, string>('error')
    const result = original.mapAsync(async (value) => value * 2)

    await expect(result.expectErr('Expected Err')).resolves.toBe(original.expectErr('Expected Err'))
  })
})

describe('mapErr', () => {
  it('maps an Err value', () => {
    const result = testErr<number, string>('error').mapErr(() => 'new error')

    expect(result.expectErr('Expected Err')).toBe('new error')
  })

  it('preserves an Ok value', () => {
    const result = testOk<number, string>(0).mapErr(() => 'new error')

    expect(result.expect('Expected value')).toBe(0)
  })
})

describe('mapErrAsync', () => {
  it('maps an Err value', async () => {
    const result = testErr<number, string>('error').mapErrAsync(async () => 'new error')

    await expect(result.expectErr('Expected Err')).resolves.toBe('new error')
  })

  it('preserves an Ok value', async () => {
    const original = testOk<number, string>(0)
    const result = original.mapErrAsync(async () => 'new error')

    await expect(result.expect('Expected value')).resolves.toBe(original.expect('Expected value'))
  })
})

describe('mapOr', () => {
  it('maps an Ok value', () => {
    expect(testOk<number, string>(42).mapOr(0, (value) => value * 2)).toBe(84)
  })

  it('returns the default for Err', () => {
    expect(testErr<number, string>('error').mapOr(0, (value) => value * 2)).toBe(0)
  })
})

describe('mapOrElse', () => {
  it('maps an Ok value', () => {
    expect(
      testOk<number, string>(42).mapOrElse(
        () => 0,
        (value) => value * 2,
      ),
    ).toBe(84)
  })

  it('computes the default for Err', () => {
    expect(
      testErr<number, string>('error').mapOrElse(
        () => 0,
        (value) => value * 2,
      ),
    ).toBe(0)
  })
})

describe('orElse', () => {
  it('returns an Ok result unchanged', () => {
    const result = testOk<number, string>(0)

    expect(result.orElse(() => Ok(1)).expect('Expected value')).toBe(result.expect('Expected value'))
  })

  it('maps an Err result', () => {
    const result = testErr<number, string>('early error')

    expect(result.orElse(() => Ok(1)).expect('Expected value')).toBe(1)
    expect(result.orElse(() => Err(1)).expectErr('Expected Err')).toBe(1)
  })
})

describe('orElseAsync', () => {
  it('returns an Ok result unchanged', async () => {
    const result = testOk<number, string>(0).orElseAsync(async () => Ok(1))

    await expect(result.expect('Expected value')).resolves.toBe(0)
  })

  it('maps an Err result', async () => {
    const result = testErr<number, string>('early error')

    await expect(result.orElseAsync(async () => Ok(1)).expect('Expected value')).resolves.toBe(1)
    await expect(result.orElseAsync(async () => Err(1)).expectErr('Expected Err')).resolves.toBe(1)
  })
})

describe('unwrap', () => {
  it('returns the Ok value', () => {
    expect(Ok(42).unwrap()).toBe(42)
  })

  it('does not exist on Err', () => {
    expect('unwrap' in Err('error')).toBe(false)
  })
})

describe('unwrapErr', () => {
  it('returns the Err value', () => {
    expect(Err('error').unwrapErr()).toBe('error')
  })

  it('does not exist on Ok', () => {
    expect('unwrapErr' in Ok(42)).toBe(false)
  })
})

describe('unwrapOr', () => {
  it('returns the Ok value', () => {
    expect(testOk<number, string>(42).unwrapOr(0)).toBe(42)
  })

  it('returns the default for Err', () => {
    expect(testErr<number, string>('error').unwrapOr(42)).toBe(42)
  })
})

describe('unwrapOrElse', () => {
  it('returns the Ok value', () => {
    expect(testOk<number, string>(42).unwrapOrElse(() => 0)).toBe(42)
  })

  it('computes the default for Err', () => {
    expect(testErr<number, string>('error').unwrapOrElse(() => 42)).toBe(42)
  })
})

describe('match', () => {
  it('calls the Ok matcher', () => {
    expect(
      testOk<number, string>(42).match({
        Ok: (value) => value * 2,
        Err: () => 0,
      }),
    ).toBe(84)
  })

  it('calls the Err matcher', () => {
    expect(
      testErr<number, string>('error').match({
        Ok: (value) => value * 2,
        Err: () => 0,
      }),
    ).toBe(0)
  })
})

describe('Result.fromThrowable', () => {
  it('wraps a successful function call', () => {
    const result = Result.fromThrowable(() => 42)

    expect(result.expect('Expected value')).toBe(42)
  })

  it('wraps a thrown error', () => {
    const error = new Error('Test error')
    const result = Result.fromThrowable(() => {
      throw error
    })

    expect(result.expectErr('Expected Err')).toBe(error)
  })
})

describe('Result.from', () => {
  it('wraps a successful function call', () => {
    const result = Result.fromThrowable(() => 42)

    expect(result.expect('Expected value')).toBe(42)
  })

  it('wraps a thrown error', () => {
    const error = new Error('Test error')
    const result = Result.fromThrowable(() => {
      throw error
    })

    expect(result.expectErr('Expected Err')).toBe(error)
  })
})

describe('Result.fromPromise', () => {
  it('settles a fulfilled Promise to Ok', async () => {
    const result = await Result.fromPromise(Promise.resolve(42))

    expect(result.expect('Expected value')).toBe(42)
  })

  it('settles a rejected Promise to Err', async () => {
    const error = new Error('Test error')
    const result = await Result.fromPromise(Promise.reject(error))

    expect(result.expectErr('Expected Err')).toBe(error)
  })
})

describe('Result iterator', () => {
  it('completes with Ok values and yields Err values', () => {
    const okIterator = Ok(1)[Symbol.iterator]()
    const errIterator = Err('error')[Symbol.iterator]()

    expect(okIterator.next()).toEqual({ done: true, value: 1 })
    const failure = errIterator.next()
    expect(failure.done).toBe(false)
    if (failure.done === true) {
      expect.fail('Expected the iterator to yield an error')
    }
    expect(failure.value.expectErr('Expected yielded error')).toBe('error')
    expect(() => errIterator.next()).toThrow(Panic)
  })
})

describe('Vitest Result equality', () => {
  it('compares variants and payloads without consuming control-flow iterators', () => {
    expect(Ok({ id: 1 })).toEqual(Ok({ id: 1 }))
    expect(Ok({ id: 1 })).not.toEqual(Ok({ id: 2 }))
    expect(Err(new Error('failure'))).toEqual(Err(new Error('failure')))
    expect(Err('first')).not.toEqual(Err('second'))
    expect(Ok(undefined)).not.toEqual(Err(undefined))
    expect(Err(undefined)).not.toEqual(Ok(undefined))
    expect(Ok(null)).not.toEqual(Ok(undefined))
    expect(Err(null)).not.toEqual(Err(undefined))
    expect(Ok(1)).not.toBe(1)
    expect(1).not.toEqual(Ok(1))
  })

  it('uses Vitest equality for nested Results and asymmetric payload matchers', () => {
    expect({ results: [Ok(Err({ code: 'missing' }))] }).toEqual({
      results: [Ok(Err({ code: 'missing' }))],
    })
    expect(Ok(Err('first'))).not.toEqual(Ok(Err('second')))
    expect(Ok({ id: 1, name: 'Alice' })).toEqual(Ok(expect.objectContaining({ id: 1 })))
    expect(Ok(1)).toEqual(Ok(expect.any(Number)))
    expect(Err(new Error('failure'))).toEqual(Err(expect.any(Error)))
    expect({ values: [1, 2] }).toEqual({ values: [1, 2] })
    expect(new Set([1, 2])).toEqual(new Set([2, 1]))
  })
})
