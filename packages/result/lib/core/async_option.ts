import { AsyncResult } from '.'
import { None, type Option, type OptionMatch, type OptionMatchAsync, Some } from './option'

/**
 * A promise that resolves to an `Option`.
 *
 * This class is useful for chaining multiple asynchronous operations that return an `Option`.
 */
export class AsyncOption<T> implements PromiseLike<Option<T>> {
  public readonly promise: Promise<Option<T>> | PromiseLike<Option<T>> | AsyncOption<T>

  /**
   * Wraps a promise of an `Option` for chaining before awaiting it.
   *
   * For a known variant, use `AsyncSome(value)` or `AsyncNone()`.
   * Use {@link fromNullish} for a plain value or a promise of a nullish value.
   *
   * @example
   *
   * ```ts
   * const pending: Promise<Option<number>> = Promise.resolve(Some(2));
   * const option = new AsyncOption(pending);
   * await option; // Some(2)
   * ```
   */
  public constructor(promise: Promise<Option<T>> | PromiseLike<Option<T>> | AsyncOption<T>) {
    this.promise = promise
  }

  /**
   * Creates an `AsyncOption` from a value or a promise of a value.
   *
   * After awaiting the value, `null` and `undefined` become `None`. All other
   * values, including `0`, `false`, and an empty string, become `Some(value)`.
   * A rejected promise remains a rejection; it does not become `None`.
   *
   * @example
   *
   * ```ts
   * const rows = [["A0", "A1"], ["B0", "B1"]];
   * const first = AsyncOption.fromNullish(rows[0]);
   * const item = first.andThen((row) => Option.fromNullish(row[1]));
   * await item; // Some("A1")
   *
   * await AsyncOption.fromNullish(null); // None
   * ```
   */
  public static fromNullish<T>(
    value: T | null | undefined | PromiseLike<T | null | undefined>,
  ): AsyncOption<NonNullable<Awaited<T>>> {
    return new AsyncOption(Promise.resolve(value).then((resolved) => (resolved == null ? None : Some(resolved))))
  }

  /**
   * Promise compatibility hook. Prefer `await` or the Option combinators in application code.
   */
  public then<A, B>(
    successCallback?: (res: Option<T>) => A | PromiseLike<A>,
    failureCallback?: (cause: unknown) => B | PromiseLike<B>,
  ): PromiseLike<A | B> {
    return this.promise.then(successCallback, failureCallback)
  }

  /**
   * Promise rejection compatibility hook. Use {@link orElse} to handle `None` values.
   */
  public catch<B = never>(rejectionCallback?: (cause: unknown) => B | PromiseLike<B>): PromiseLike<Option<T> | B> {
    return this.then<Option<T>, B>(undefined, rejectionCallback)
  }

  /**
   * Promise cleanup compatibility hook; not intended for routine application use.
   */
  public finally<Cleanup>(callback: () => Cleanup | PromiseLike<Cleanup>): PromiseLike<Option<T>> {
    return this.then(
      async (value) => {
        await Promise.resolve(callback())
        return value
      },
      async (reason) => {
        await Promise.resolve(callback())
        throw reason
      },
    )
  }

  /**
   * Awaits the option and calls the matching `Some` or `None` branch.
   *
   * Resolves to the branch's return value. A rejected wrapped promise bypasses both branches.
   *
   * Prefer {@link map} to transform a value, {@link andThen} to chain optional
   * lookups, or {@link unwrapOrElse} to supply a fallback. Use {@link okOrElse}
   * when absence should become an error. For branching with multiple statements
   * or early returns, await the option and narrow it with `isSome()`.
   *
   * @example
   *
   * ```ts
   * const option = AsyncSome(2);
   * await option.match({
   *   Some: (value) => value * 2,
   *   None: () => 0,
   * }); // 4
   * ```
   */
  public async match<A, B>(matcher: OptionMatch<T, A, B>): Promise<A | B> {
    return (await this).match(matcher)
  }

  /**
   * Awaits the option and the callback for its `Some` or `None` branch.
   *
   * A rejected wrapped promise bypasses both callbacks.
   *
   * Prefer awaiting the option and using `mapAsync`, `andThenAsync`, or
   * `unwrapOrElseAsync` for a single-purpose operation. For multiple statements
   * or early returns, narrow the awaited option with `isSome()` before awaiting
   * branch work.
   *
   * @example
   *
   * ```ts
   * const option = AsyncSome(2);
   * await option.matchAsync({
   *   Some: async (value) => value * 2,
   *   None: async () => 0,
   * }); // 4
   * ```
   */
  public async matchAsync<A, B>(matcher: OptionMatchAsync<T, A, B>): Promise<A | B> {
    return (await this).matchAsync(matcher)
  }

  /**
   * Transforms an `AsyncOption<T>` into an `AsyncResult<T, E>`, mapping
   * `Some(value)` to `Ok(value)` and `None` to `Err(err)`.
   *
   * Arguments passed to `okOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link okOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome("foo");
   * assert.deepEqual(await x.okOr(0), Ok("foo"));
   *
   * const y = AsyncNone<string>();
   * assert.deepEqual(await y.okOr(0), Err(0));
   * ```
   */
  public okOr<E>(err: E): AsyncResult<T, E> {
    return new AsyncResult(this.then((option) => option.okOr(err)))
  }

  /**
   * Transforms an `AsyncOption<T>` into an `AsyncResult<T, E>`, mapping
   * `Some(value)` to `Ok(value)` and `None` to `Err(err())`.
   *
   * The error factory runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome("foo");
   * assert.deepEqual(await x.okOrElse(() => 0), Ok("foo"));
   *
   * const y = AsyncNone<string>();
   * assert.deepEqual(await y.okOrElse(() => 0), Err(0));
   * ```
   */
  public okOrElse<E>(err: () => E): AsyncResult<T, E> {
    return new AsyncResult(this.then((option) => option.okOrElse(err)))
  }

  /**
   * Resolves to `None` if the option is `None`, otherwise calls `f` with the
   * contained value and resolves to the result.
   *
   * Some languages call this operation flatmap.
   *
   * @example
   *
   * ```ts
   * function squareThenToString(x: number): Option<string> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString());
   * }
   *
   * const x = AsyncSome(2);
   * assert.deepEqual(await x.andThen(squareThenToString), Some("4"));
   *
   * const y = AsyncSome(1_000_000);
   * assert.deepEqual(await y.andThen(squareThenToString), None); // Overflowed.
   *
   * const z = AsyncNone<number>();
   * assert.deepEqual(await z.andThen(squareThenToString), None);
   * ```
   *
   * @example
   * Often used to chain fallible operations that may return `None`.
   *
   * ```ts
   * const rows = [["A0", "A1"], ["B0", "B1"]];
   * const first = AsyncOption.fromNullish(rows[0]);
   * assert.deepEqual(await first.andThen((row) => Option.fromNullish(row[1])), Some("A1"));
   *
   * const missing = AsyncOption.fromNullish(rows[2]);
   * assert.deepEqual(await missing.andThen((row) => Option.fromNullish(row[0])), None);
   * ```
   */
  public andThen<U>(f: (value: T) => Option<U>): AsyncOption<U> {
    return new AsyncOption(this.then((option) => option.andThen((value) => f(value))))
  }

  /**
   * Calls a function with the contained value if the resolved option is `Some`.
   *
   * Resolves to the original option.
   *
   * @returns An `AsyncOption` containing the original option after inspection.
   *
   * @example
   *
   * ```ts
   * const list = [1, 2, 3];
   *
   * // Prints "got: 2".
   * const second = AsyncOption.fromNullish(list[1]);
   * const x = await second
   *   .inspect((value) => console.log(`got: ${value}`))
   *   .expect("list should be long enough");
   *
   * // Prints nothing.
   * const missing = AsyncOption.fromNullish(list[5]);
   * await missing.inspect((value) => console.log(`got: ${value}`));
   * ```
   */
  public inspect(f: (value: T) => void): AsyncOption<T> {
    return new AsyncOption(this.then((option) => option.inspect(f)))
  }

  /**
   * Resolves to the contained `Some` value.
   *
   * Use mainly in tests or rare, explained assertions.
   *
   * Recommended message style: describe the reason you expect the option should
   * be `Some`. Focus on "should", as in "the list should not be empty".
   *
   * @param message - Why the option should be `Some`.
   * @throws {Panic} Rejects when the resolved option is `None`, with the supplied message.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome("value");
   * assert.equal(await x.expect("fruits are healthy"), "value");
   * ```
   *
   * @example
   * This example rejects with `Panic`.
   *
   * ```ts
   * const x = AsyncNone<string>();
   * await x.expect("fruits are healthy"); // Rejects with Panic("fruits are healthy").
   * ```
   *
   * @example
   * Recommended message style.
   *
   * ```ts
   * const list: number[] = [];
   * const first = AsyncOption.fromNullish(list[0]);
   * const item = await first.expect("list should not be empty");
   * ```
   */
  public async expect(message: string): Promise<T> {
    return (await this).expect(message)
  }

  /**
   * Resolves to `None` if the option is `None`, otherwise calls `f` with the
   * contained value and resolves to:
   *
   * - `Some(value)` if `f` returns `true`, and
   * - `None` if `f` returns `false`.
   *
   * Like filtering a collection of zero or one elements, `filter` lets you
   * decide whether to keep the contained value.
   *
   * @example
   *
   * ```ts
   * function isEven(n: number): boolean {
   *   return n % 2 === 0;
   * }
   *
   * const missing = AsyncNone<number>();
   * const odd = AsyncSome(3);
   * const even = AsyncSome(4);
   * assert.deepEqual(await missing.filter(isEven), None);
   * assert.deepEqual(await odd.filter(isEven), None);
   * assert.deepEqual(await even.filter(isEven), Some(4));
   * ```
   */
  public filter(f: (value: T) => boolean): AsyncOption<T> {
    return new AsyncOption(this.then((option) => option.filter(f)))
  }

  /**
   * Converts from `AsyncOption<Option<U>>` to `AsyncOption<U>`.
   *
   * Both `None` and `Some(None)` become `None`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome(Some(6));
   * assert.deepEqual(await x.flatten(), Some(6));
   *
   * const y = AsyncSome(None);
   * assert.deepEqual(await y.flatten(), None);
   *
   * const z = AsyncNone<Option<number>>();
   * assert.deepEqual(await z.flatten(), None);
   * ```
   *
   * @example
   * Flattening only removes one level of nesting at a time.
   *
   * ```ts
   * const x = AsyncSome(Some(Some(6)));
   * assert.deepEqual(await x.flatten(), Some(Some(6)));
   * assert.deepEqual(await x.flatten().flatten(), Some(6));
   * ```
   */
  public flatten<U>(this: AsyncOption<Option<U>>): AsyncOption<U> {
    return new AsyncOption(this.then((option) => option.flatten()))
  }

  /**
   * Maps an `AsyncOption<T>` to `AsyncOption<U>` by applying a function to a
   * contained value (if `Some`), or resolves to `None` (if `None`).
   *
   * @example
   *
   * Calculates the length of an `AsyncOption<string>` as an `AsyncOption<number>`.
   *
   * ```ts
   * const maybeSomeString = AsyncSome("Hello, World!");
   * const maybeSomeLength = await maybeSomeString.map((s) => s.length);
   * assert.deepEqual(maybeSomeLength, Some(13));
   *
   * const x = AsyncNone<string>();
   * assert.deepEqual(await x.map((s) => s.length), None);
   * ```
   */
  public map<U>(f: (value: T) => U): AsyncOption<U> {
    return new AsyncOption(this.then((option) => option.map(f)))
  }

  /**
   * Resolves to the provided default (if none), or applies a function to the
   * contained value (if any).
   *
   * Arguments passed to `mapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome("foo");
   * assert.equal(await x.mapOr(42, (v) => v.length), 3);
   *
   * const y = AsyncNone<string>();
   * assert.equal(await y.mapOr(42, (v) => v.length), 42);
   * ```
   */
  public async mapOr<A, B>(defaultValue: A, f: (value: T) => B): Promise<A | B> {
    return (await this).mapOr(defaultValue, f)
  }

  /**
   * Computes a default function result (if none), or applies a different
   * function to the contained value (if any), resolving to the callback's value.
   *
   * Only the callback for the current variant runs.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x = AsyncSome("foo");
   * assert.equal(await x.mapOrElse(() => k * 2, (v) => v.length), 3);
   *
   * const y = AsyncNone<string>();
   * assert.equal(await y.mapOrElse(() => k * 2, (v) => v.length), 42);
   * ```
   *
   * @example
   * Handling a Result-based fallback: read a file only if the command-line
   * argument is absent. Wrap the present argument in `Ok` so both branches
   * return a `Result`.
   *
   * ```ts
   * const argument = AsyncOption.fromNullish(process.argv[2]);
   * const value = tryBlock(async function* () {
   *   const text = yield* await argument.mapOrElse(
   *     () => Result.fromThrowable(() => readFileSync("/etc/someconfig.conf", "utf8")),
   *     (text) => Ok(text),
   *   );
   *   const number = Number(text);
   *   return Number.isSafeInteger(number) && number >= 0
   *     ? Ok(number)
   *     : Err(new Error("expected a nonnegative integer"));
   * });
   * ```
   */
  public async mapOrElse<A, B>(defaultValue: () => A, f: (value: T) => B): Promise<A | B> {
    return (await this).mapOrElse(defaultValue, f)
  }

  /**
   * Resolves to the option if it contains a value, otherwise calls `f` and
   * resolves to the result.
   *
   * Handles expected absence represented by `None`. A rejected wrapped promise bypasses this callback.
   *
   * @example
   *
   * ```ts
   * function nobody(): Option<string> {
   *   return None;
   * }
   *
   * function vikings(): Option<string> {
   *   return Some("vikings");
   * }
   *
   * const x = AsyncSome("barbarians");
   * const y = AsyncNone<string>();
   * assert.deepEqual(await x.orElse(vikings), Some("barbarians"));
   * assert.deepEqual(await y.orElse(vikings), Some("vikings"));
   * assert.deepEqual(await y.orElse(nobody), None);
   * ```
   */
  public orElse<U>(f: () => Option<U>): AsyncOption<T | U> {
    return new AsyncOption(this.then((thisOption) => thisOption.orElse(() => f())))
  }

  /**
   * Resolves to the contained `Some` value or a provided default.
   *
   * Arguments passed to `unwrapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link unwrapOrElse}, which is lazily evaluated.
   *
   * Await and narrow the option to `Some` before calling `unwrap()`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome("car");
   * const y = AsyncNone<string>();
   * assert.equal(await x.unwrapOr("bike"), "car");
   * assert.equal(await y.unwrapOr("bike"), "bike");
   * ```
   */
  public async unwrapOr<U>(defaultValue: U): Promise<T | U> {
    return (await this).unwrapOr(defaultValue)
  }

  /**
   * Resolves to the contained `Some` value or computes it from a callback.
   *
   * The fallback runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const k = 10;
   * const x = AsyncSome(4);
   * const y = AsyncNone<number>();
   * assert.equal(await x.unwrapOrElse(() => 2 * k), 4);
   * assert.equal(await y.unwrapOrElse(() => 2 * k), 20);
   * ```
   */
  public async unwrapOrElse<U>(f: () => U): Promise<T | U> {
    return (await this).unwrapOrElse(f)
  }

  /**
   * Resolves to `Some` if exactly one of the two options is `Some`, otherwise
   * resolves to `None`.
   *
   * Waits for both options before deciding which variant to return.
   *
   * @example
   *
   * ```ts
   * const x = AsyncSome(2);
   * const y = AsyncNone<number>();
   * assert.deepEqual(await x.xor(y), Some(2));
   * assert.deepEqual(await y.xor(x), Some(2));
   * assert.deepEqual(await x.xor(x), None);
   * assert.deepEqual(await y.xor(y), None);
   * ```
   */
  public xor<U>(other: AsyncOption<U>): AsyncOption<T | U> {
    return new AsyncOption(this.then((thisOption) => other.then((otherOption) => thisOption.xor(otherOption))))
  }
}
