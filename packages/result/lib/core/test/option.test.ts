import { type AsyncOption, None, Option, Panic, Some } from '@hoseki/packages/result'
import { describe, expect, expectTypeOf, it } from 'vitest'

function testSome<T>(value: T): Option<T> {
  return Some(value)
}

function testNone<T>(): Option<T> {
  return None
}

function stringOrNumberOrNull(): string | number | null {
  return 'hello'
}

describe('core', () => {
  it('requires narrowing before unwrapping, including after await', () => {
    // Checked by pnpm check; keep forbidden calls out of runtime execution.
    const check = async (option: Option<number>, pending: AsyncOption<number>): Promise<void> => {
      // @ts-expect-error An unnarrowed Option has no unwrap method.
      void option.unwrap
      // @ts-expect-error None has no unwrap method.
      void None.unwrap
      // @ts-expect-error AsyncOption must be awaited and narrowed first.
      void pending.unwrap
      const resolved = await pending
      // @ts-expect-error Awaiting alone does not narrow an Option.
      void resolved.unwrap
      if (resolved.isSome()) {
        expectTypeOf(resolved.unwrap()).toEqualTypeOf<number>()
      } else {
        // @ts-expect-error Narrowing to None excludes unwrap.
        void resolved.unwrap
      }
    }
    expectTypeOf(check).toBeFunction()
  })

  it.each([undefined, null])('preserves nullish Some payload %s', (value) => {
    expect(Some(value).unwrap()).toBe(value)
  })

  it('creates a Some option', () => {
    const option = Some(42)

    expect(option.isSome()).toBe(true)
    expect(option.isNone()).toBe(false)
    expect(option.unwrap()).toBe(42)
    expectTypeOf<typeof option.unwrap>().toEqualTypeOf<() => number>()
  })

  it('creates a None option', () => {
    const option = None

    expect(option.isSome()).toBe(false)
    expect(option.isNone()).toBe(true)
    expectTypeOf<'unwrap'>().exclude<keyof typeof option>().toEqualTypeOf<'unwrap'>()
    expectTypeOf<typeof option.expect>().toEqualTypeOf<(message: string) => never>()
  })

  it('narrows an Option discriminated union', () => {
    const option = testSome(42)

    expectTypeOf<'unwrap'>().exclude<keyof typeof option>().toEqualTypeOf<'unwrap'>()
    if (option.isSome()) {
      expectTypeOf<typeof option.unwrap>().toEqualTypeOf<() => number>()
      expectTypeOf<typeof option.expect>().toEqualTypeOf<(message: string) => number>()
    } else {
      expectTypeOf<'unwrap'>().exclude<keyof typeof option>().toEqualTypeOf<'unwrap'>()
      expectTypeOf<typeof option.expect>().toEqualTypeOf<(message: string) => never>()
    }

    if (option.isNone()) {
      expectTypeOf<'unwrap'>().exclude<keyof typeof option>().toEqualTypeOf<'unwrap'>()
      expectTypeOf<typeof option.expect>().toEqualTypeOf<(message: string) => never>()
    } else {
      expectTypeOf<typeof option.unwrap>().toEqualTypeOf<() => number>()
      expectTypeOf<typeof option.expect>().toEqualTypeOf<(message: string) => number>()
    }
  })
})

describe('okOr', () => {
  it('returns the value for Some', () => {
    expect(testSome(42).okOr('error').expect('Expected value')).toBe(42)
  })

  it('returns the error for None', () => {
    expect(testNone<string>().okOr('error').expectErr('Expected Err')).toBe('error')
  })
})

describe('okOrElse', () => {
  it('returns the value for Some', () => {
    expect(
      testSome(42)
        .okOrElse(() => 'error')
        .expect('Expected value'),
    ).toBe(42)
  })

  it('returns the computed error for None', () => {
    expect(
      testNone<string>()
        .okOrElse(() => 'error')
        .expectErr('Expected Err'),
    ).toBe('error')
  })
})

describe('andThen', () => {
  it('returns the mapped Some value', () => {
    expect(testSome(0).andThen((value) => testSome(value + 1))).toEqual(Some(1))
  })

  it('returns None without calling the mapper', () => {
    const option = testNone<string>()

    expect(option.andThen((value) => Some(value + 1))).toEqual(option)
  })
})

describe('expect', () => {
  it('returns the value for Some', () => {
    expect(testSome(42).expect('error')).toBe(42)
  })

  it('throws Panic for None', () => {
    const option = testNone<string>()

    expect(() => option.expect('error')).toThrow(Panic)
    expect(() => option.expect('error')).toThrow('error')
  })
})

describe('filter', () => {
  it('retains Some when the predicate passes', () => {
    const option = Some(42)

    expect(option.filter((value) => value === 42)).toBe(option)
  })

  it('returns None when the predicate fails', () => {
    expect(testSome(42).filter((value) => value !== 42)).toEqual(None)
  })

  it('returns None without evaluating its predicate', () => {
    const option = testNone<string>()

    expect(option.filter((value) => value === 'hello')).toEqual(option)
  })
})

describe('flatten', () => {
  it('returns the inner option for Some', () => {
    const inner = testSome(42)

    expect(testSome(inner).flatten()).toEqual(inner)
  })

  it('returns None for None', () => {
    const option = testNone<Option<string>>()

    expect(option.flatten()).toEqual(option)
  })
})

describe('inspect', () => {
  it('calls the callback for Some and returns itself', () => {
    const option = testSome(42)
    let inspected: number | undefined

    const result = option.inspect((value) => {
      inspected = value
    })

    expect(result).toBe(option)
    expect(inspected).toBe(42)
  })

  it('does not call the callback for None', () => {
    const option = testNone<string>()
    let calls = 0

    const result = option.inspect(() => {
      calls += 1
    })

    expect(result).toBe(option)
    expect(calls).toBe(0)
  })
})

describe('map', () => {
  it('maps a Some value', () => {
    expect(testSome(42).map((value) => value + 1)).toEqual(Some(43))
  })

  it('returns None unchanged', () => {
    const option = testNone<string>()

    expect(option.map((value) => value + 1)).toEqual(option)
  })
})

describe('mapOr', () => {
  it('maps a Some value', () => {
    expect(testSome(42).mapOr('default', (value) => value + 1)).toBe(43)
  })

  it('returns the default for None', () => {
    expect(testNone<string>().mapOr('default', (value) => value + 1)).toBe('default')
  })
})

describe('mapOrElse', () => {
  it('maps a Some value', () => {
    expect(
      testSome(42).mapOrElse(
        () => 'default',
        (value) => value + 1,
      ),
    ).toBe(43)
  })

  it('computes the default for None', () => {
    expect(
      testNone<string>().mapOrElse(
        () => 'default',
        (value) => value + 1,
      ),
    ).toBe('default')
  })
})

describe('orElse', () => {
  it('returns the first Some without calling the fallback', () => {
    const option = testSome(0)

    expect(option.orElse(() => Some(1))).toEqual(option)
  })

  it('returns the fallback result for None', () => {
    expect(testNone<string>().orElse(() => Some(1))).toEqual(Some(1))
  })
})

describe('unwrap', () => {
  it('returns the Some value', () => {
    expect(Some(42).unwrap()).toBe(42)
  })

  it('does not exist on None', () => {
    expect('unwrap' in None).toBe(false)
  })
})

describe('unwrapOr', () => {
  it('returns the Some value', () => {
    expect(testSome(42).unwrapOr('default')).toBe(42)
  })

  it('returns the default for None', () => {
    expect(testNone<string>().unwrapOr('default')).toBe('default')
  })
})

describe('unwrapOrElse', () => {
  it('returns the Some value', () => {
    expect(testSome(42).unwrapOrElse(() => 'default')).toBe(42)
  })

  it('computes the default for None', () => {
    expect(testNone<string>().unwrapOrElse(() => 'default')).toBe('default')
  })
})

describe('xor', () => {
  it('returns Some for Some and None', () => {
    const first = testSome(2)
    const second = testNone<string>()

    expect(first.xor(second)).toEqual(first)
  })

  it('returns Some for None and Some', () => {
    const first = testNone<string>()
    const second = testSome('foo')

    expect(first.xor(second)).toEqual(second)
  })

  it('returns None for None and None', () => {
    const first = testNone<string>()
    const second = testNone<string>()

    expect(first.xor(second)).toEqual(first)
  })

  it('returns None for Some and Some', () => {
    expect(testSome(2).xor(testSome('str'))).toEqual(None)
  })
})

describe('match', () => {
  it('calls the Some matcher', () => {
    expect(
      testSome(42).match({
        Some: (value) => value + 1,
        None: () => 'default',
      }),
    ).toBe(43)
  })

  it('calls the None matcher', () => {
    expect(
      testNone<string>().match({
        Some: (value) => value + 1,
        None: () => 'default',
      }),
    ).toBe('default')
  })
})

describe('Option.fromNullish', () => {
  it('returns Some for non-nullish values', () => {
    const value = stringOrNumberOrNull()
    const option = Option.fromNullish(value)

    expectTypeOf(option).toEqualTypeOf<Option<string | number>>()
    expect(option).toEqual(Some(value))
  })

  it('returns Some for falsy values', () => {
    expect(Option.fromNullish(false)).toEqual(Some(false))
    expect(Option.fromNullish(0)).toEqual(Some(0))
    expect(Option.fromNullish('')).toEqual(Some(''))
  })

  it('returns None for nullish values', () => {
    expect(Option.fromNullish(null)).toEqual(None)
    expect(Option.fromNullish(undefined)).toEqual(None)
  })
})
