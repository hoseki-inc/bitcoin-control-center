import { AsyncOption } from './async_option'
import { AsyncResult } from './async_result'
import { Panic } from './error'
import { Err, Ok, type Result } from './result'
import * as symbols from './symbols'

export type OptionMatch<T, A, B> = {
  Some: (value: T) => A
  None: () => B
}

export type OptionMatchAsync<T, A, B> = {
  Some: (value: T) => Promise<A>
  None: () => Promise<B>
}

export class OptionImpl<T> {
  private readonly kind?: true
  private readonly wrapped?: T

  public [Symbol.toStringTag] = 'Option'

  public constructor(kind: boolean, x?: T) {
    if (kind) {
      this.kind = true
      this.wrapped = x
    }
  }

  private unwrapFailed(message: string): never {
    throw new Panic(message, { cause: this.wrapped })
  }

  /**
   * Calls the matching `Some` or `None` callback and returns its value.
   *
   * Prefer {@link map} to transform a value, {@link andThen} to chain optional
   * lookups, or {@link unwrapOrElse} to supply a fallback. Use {@link okOrElse}
   * when absence should become an error. For branching with multiple statements
   * or early returns, narrow with {@link isSome} and use ordinary control flow.
   *
   * @example
   *
   * ```ts
   * Some(42).match({
   *   Some: (value) => value + 1,
   *   None: () => 0,
   * }); // 43
   * ```
   */
  public match<A, B>(pattern: OptionMatch<T, A, B>): A | B {
    return this.isSome() ? pattern.Some(this.unwrap()) : pattern.None()
  }

  /**
   * Matches `Some` or `None` with an asynchronous callback and awaits its value.
   *
   * Only the callback for the current variant runs.
   *
   * Prefer {@link mapAsync} to transform a value, {@link andThenAsync} to chain
   * optional lookups, or {@link unwrapOrElseAsync} to supply a fallback. For
   * multiple statements or early returns, narrow with {@link isSome} before
   * awaiting branch work.
   *
   * @example
   *
   * ```ts
   * await None.matchAsync({
   *   Some: async () => 1,
   *   None: async () => 0,
   * }); // 0
   * ```
   */
  public async matchAsync<A, B>(pattern: OptionMatchAsync<T, A, B>): Promise<A | B> {
    return this.isSome() ? pattern.Some(this.unwrap()) : pattern.None()
  }

  /**
   * Returns `true` if the option is a `Some` value.
   *
   * Narrows the option to `Some` so `unwrap()` is available in the true branch.
   *
   * @example
   *
   * ```ts
   * const x: Option<number> = Some(2);
   * assert.equal(x.isSome(), true);
   *
   * const y: Option<number> = None;
   * assert.equal(y.isSome(), false);
   * ```
   */
  public isSome(): this is Some<T> {
    return this.kind === true
  }

  /**
   * Returns `true` if the option is a `None` value.
   *
   * @example
   *
   * ```ts
   * const x: Option<number> = Some(2);
   * assert.equal(x.isNone(), false);
   *
   * const y: Option<number> = None;
   * assert.equal(y.isNone(), true);
   * ```
   */
  public isNone(): this is None<T> {
    return this.kind !== true
  }

  /**
   * Returns the contained `Some` value.
   *
   * Use mainly in tests or rare, explained assertions.
   *
   * Recommended message style: describe the reason you expect the option should
   * be `Some`. Focus on "should", as in "the list should not be empty".
   *
   * @param message - Why the option should be `Some`.
   * @returns The `Some` value.
   *
   * @throws {Panic} When the option is `None`, with the supplied `message`.
   *
   * @example
   *
   * ```ts
   * const x = Some("value");
   * assert.equal(x.expect("fruits are healthy"), "value");
   * ```
   *
   * @example
   * This example panics.
   *
   * ```ts
   * const x: Option<string> = None;
   * x.expect("fruits are healthy"); // Throws Panic("fruits are healthy").
   * ```
   *
   * @example
   *
   * ```ts
   * const list: number[] = [];
   * const item = Option.fromNullish(list[0])
   *   .expect("list should not be empty");
   * ```
   */
  public expect(message: string): T {
    return this.isSome() ? this.unwrap() : this.unwrapFailed(message)
  }

  /**
   * Returns the contained `Some` value or a provided default.
   *
   * Arguments passed to `unwrapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link unwrapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * assert.equal(Some("car").unwrapOr("bike"), "car");
   * assert.equal(None.unwrapOr("bike"), "bike");
   * ```
   */
  public unwrapOr<U>(defaultValue: U): T | U {
    return this.isSome() ? this.unwrap() : defaultValue
  }

  /**
   * Returns the contained `Some` value or computes it from a callback.
   *
   * The fallback runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const k = 10;
   * assert.equal(Some(4).unwrapOrElse(() => 2 * k), 4);
   * assert.equal(None.unwrapOrElse(() => 2 * k), 20);
   * ```
   */
  public unwrapOrElse<U>(defaultValue: () => U): T | U {
    return this.isSome() ? this.unwrap() : defaultValue()
  }

  /**
   * Resolves to the `Some` value or awaits a fallback computed for `None`.
   *
   * The fallback runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const k = 10;
   * assert.equal(await Some(4).unwrapOrElseAsync(async () => 2 * k), 4);
   * assert.equal(await None.unwrapOrElseAsync(async () => 2 * k), 20);
   * ```
   */
  public async unwrapOrElseAsync<U>(defaultValue: () => Promise<U>): Promise<T | U> {
    return this.isSome() ? Promise.resolve(this.unwrap()) : defaultValue()
  }

  /**
   * Maps an `Option<T>` to `Option<U>` by applying a function to a contained
   * value (if `Some`), or returns `None` (if `None`).
   *
   * @example
   *
   * Calculates the length of an `Option<string>` as an `Option<number>`.
   *
   * ```ts
   * const maybeSomeString = Some("Hello, World!");
   * const maybeSomeLength = maybeSomeString.map((s) => s.length);
   * assert.deepEqual(maybeSomeLength, Some(13));
   *
   * const x: Option<string> = None;
   * assert.deepEqual(x.map((s) => s.length), None);
   * ```
   */
  public map<U>(f: (value: T) => U): Option<U> {
    return this.isSome() ? Some(f(this.unwrap())) : None
  }

  /**
   * Maps an `Option<T>` to `AsyncOption<U>` by applying an async function to a
   * contained value (if `Some`), or resolves to `None` (if `None`).
   *
   * @example
   *
   * ```ts
   * const maybeSomeString = Some("Hello, World!");
   * const maybeSomeLength = await maybeSomeString.mapAsync(async (s) => s.length);
   * assert.deepEqual(maybeSomeLength, Some(13));
   *
   * const x: Option<string> = None;
   * assert.deepEqual(await x.mapAsync(async (s) => s.length), None);
   * ```
   */
  public mapAsync<U>(f: (value: T) => Promise<U>): AsyncOption<U> {
    return new AsyncOption(this.isSome() ? f(this.unwrap()).then(Some) : Promise.resolve(None))
  }

  /**
   * Calls a function with the contained value if `Some`.
   *
   * Returns the original option.
   *
   * @param f - Runs with the `Some` value; not called for `None`.
   * @returns The original option, including its variant and value.
   *
   * @example
   *
   * ```ts
   * const list = [1, 2, 3];
   *
   * // Prints "got: 2".
   * const x = Option.fromNullish(list[1])
   *   .inspect((value) => console.log(`got: ${value}`))
   *   .expect("list should be long enough");
   *
   * // Prints nothing.
   * Option.fromNullish(list[5]).inspect((value) => console.log(`got: ${value}`));
   * ```
   */
  public inspect(f: (value: T) => void): this {
    if (this.isSome()) {
      f(this.unwrap())
    }
    return this
  }

  /**
   * Calls an async function with the contained value if `Some`.
   *
   * Resolves to the original option after the callback completes.
   *
   * @param f - Runs with the `Some` value; not called for `None`.
   * @returns An `AsyncOption` that resolves after the callback finishes.
   *
   * @example
   *
   * ```ts
   * const list = [1, 2, 3];
   *
   * // Prints "got: 2".
   * const x = await Option.fromNullish(list[1])
   *   .inspectAsync(async (value) => console.log(`got: ${value}`))
   *   .expect("list should be long enough");
   *
   * // Prints nothing.
   * await Option.fromNullish(list[5]).inspectAsync(async (value) => console.log(`got: ${value}`));
   * ```
   */
  public inspectAsync(f: (value: T) => Promise<void>): AsyncOption<T> {
    return new AsyncOption(this.isSome() ? f(this.unwrap()).then(() => this) : Promise.resolve(None))
  }

  /**
   * Returns the provided default result (if none), or applies a function to the contained value (if any).
   *
   * Arguments passed to `mapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x = Some("foo");
   * assert.equal(x.mapOr(42, (v) => v.length), 3);
   *
   * const y: Option<string> = None;
   * assert.equal(y.mapOr(42, (v) => v.length), 42);
   * ```
   */
  public mapOr<A, B>(defaultValue: A, f: (value: T) => B): A | B {
    return this.isSome() ? f(this.unwrap()) : defaultValue
  }

  /**
   * Resolves to the provided default for `None`, or awaits the mapping function for `Some`.
   *
   * Arguments passed to `mapOrAsync` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElseAsync}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x = Some("foo");
   * assert.equal(await x.mapOrAsync(42, async (v) => v.length), 3);
   *
   * const y: Option<string> = None;
   * assert.equal(await y.mapOrAsync(42, async (v) => v.length), 42);
   * ```
   */
  public async mapOrAsync<A, B>(defaultValue: A, f: (value: T) => Promise<B>): Promise<A | B> {
    return this.isSome() ? f(this.unwrap()) : Promise.resolve(defaultValue)
  }

  /**
   * Computes a default function result (if none), or applies a different
   * function to the contained value (if any).
   *
   * Only the function for the current variant runs.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x = Some("foo");
   * assert.equal(x.mapOrElse(() => k * 2, (v) => v.length), 3);
   *
   * const y: Option<string> = None;
   * assert.equal(y.mapOrElse(() => k * 2, (v) => v.length), 42);
   * ```
   *
   * @example
   * Handling a Result-based fallback: parse a command-line argument, or read
   * a file when the argument is absent. Reading the file can fail, so wrap
   * the present argument in `Ok` to give both branches a `Result` return type.
   *
   * ```ts
   * const value = tryBlock(function* () {
   *   const text = yield* Option.fromNullish(process.argv[2]).mapOrElse(
   *     () => Result.fromThrowable(() => readFileSync("/etc/someconfig.conf", "utf8")),
   *     (argument) => Ok(argument),
   *   );
   *   const number = Number(text);
   *   return Number.isSafeInteger(number) && number >= 0
   *     ? Ok(number)
   *     : Err(new Error("expected a nonnegative integer"));
   * });
   * ```
   */
  public mapOrElse<A, B>(defaultValue: () => A, f: (value: T) => B): A | B {
    return this.isSome() ? f(this.unwrap()) : defaultValue()
  }

  /**
   * Awaits the `Some` mapping function or the `None` fallback function.
   *
   * Only the function for the current variant runs.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x = Some("foo");
   * assert.equal(await x.mapOrElseAsync(async () => k * 2, async (v) => v.length), 3);
   *
   * const y: Option<string> = None;
   * assert.equal(await y.mapOrElseAsync(async () => k * 2, async (v) => v.length), 42);
   * ```
   *
   * @example
   * Handling an asynchronous Result-based fallback.
   *
   * ```ts
   * const value = tryBlock(async function* () {
   *   const text = yield* await Option.fromNullish(process.argv[2]).mapOrElseAsync(
   *     async () => AsyncResult.fromPromise(readFile("/etc/someconfig.conf", "utf8")),
   *     async (argument) => Ok(argument),
   *   );
   *   const number = Number(text);
   *   return Number.isSafeInteger(number) && number >= 0
   *     ? Ok(number)
   *     : Err(new Error("expected a nonnegative integer"));
   * });
   * ```
   */
  public async mapOrElseAsync<A, B>(defaultValue: () => Promise<A>, f: (value: T) => Promise<B>): Promise<A | B> {
    return this.isSome() ? f(this.unwrap()) : defaultValue()
  }

  /**
   * Transforms the `Option<T>` into a `Result<T, E>`, mapping `Some(v)` to `Ok(v)` and `None` to `Err(err)`.
   *
   * Arguments passed to `okOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link okOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x = Some("foo");
   * assert.deepEqual(x.okOr(0), Ok("foo"));
   *
   * const y: Option<string> = None;
   * assert.deepEqual(y.okOr(0), Err(0));
   * ```
   */
  public okOr<E>(err: E): Result<T, E> {
    return this.isSome() ? Ok(this.unwrap()) : Err(err)
  }

  /**
   * Transforms the `Option<T>` into a `Result<T, E>`, mapping `Some(v)` to `Ok(v)` and `None` to `Err(err())`.
   *
   * The error factory runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const x = Some("foo");
   * assert.deepEqual(x.okOrElse(() => 0), Ok("foo"));
   *
   * const y: Option<string> = None;
   * assert.deepEqual(y.okOrElse(() => 0), Err(0));
   * ```
   */
  public okOrElse<E>(err: () => E): Result<T, E> {
    return this.isSome() ? Ok(this.unwrap()) : Err(err())
  }

  /**
   * Converts `Some` to `Ok`, or awaits an error factory to convert `None` to `Err`.
   *
   * The factory runs only for `None`.
   *
   * @example
   *
   * ```ts
   * const x = Some("foo");
   * assert.deepEqual(await x.okOrElseAsync(async () => 0), Ok("foo"));
   *
   * const y: Option<string> = None;
   * assert.deepEqual(await y.okOrElseAsync(async () => 0), Err(0));
   * ```
   */
  public okOrElseAsync<E>(err: () => Promise<E>): AsyncResult<T, E> {
    return new AsyncResult<T, E>(this.isSome() ? Promise.resolve(Ok(this.unwrap())) : err().then((error) => Err(error)))
  }

  /**
   * Returns `None` if the option is `None`, otherwise calls `f` with the wrapped value and returns the result.
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
   * assert.deepEqual(Some(2).andThen(squareThenToString), Some("4"));
   * assert.deepEqual(Some(1_000_000).andThen(squareThenToString), None); // Overflowed.
   * assert.deepEqual(None.andThen(squareThenToString), None);
   * ```
   *
   * @example
   * Often used to chain fallible operations that may return `None`.
   *
   * ```ts
   * const rows = [["A0", "A1"], ["B0", "B1"]];
   * const item01 = Option.fromNullish(rows[0]).andThen((row) => Option.fromNullish(row[1]));
   * assert.deepEqual(item01, Some("A1"));
   *
   * const item20 = Option.fromNullish(rows[2]).andThen((row) => Option.fromNullish(row[0]));
   * assert.deepEqual(item20, None);
   * ```
   */
  public andThen<U>(f: (value: T) => Option<U>): Option<U> {
    return this.isSome() ? f(this.unwrap()) : None
  }

  /**
   * Calls `f` for `Some`, returning its asynchronously computed `Option`.
   *
   * Returns `None` without calling `f` for `None`.
   * Some languages call this operation flatmap.
   *
   * @example
   *
   * ```ts
   * async function squareThenToString(x: number): Promise<Option<string>> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString());
   * }
   *
   * assert.deepEqual(await Some(2).andThenAsync(squareThenToString), Some("4"));
   * assert.deepEqual(await Some(1_000_000).andThenAsync(squareThenToString), None); // Overflowed.
   * assert.deepEqual(await None.andThenAsync(squareThenToString), None);
   * ```
   *
   * @example
   * Chain lookups that may return `None`.
   *
   * ```ts
   * const rows = [["A0", "A1"], ["B0", "B1"]];
   * const item01 = await Option.fromNullish(rows[0])
   *   .andThenAsync(async (row) => Option.fromNullish(row[1]));
   * assert.deepEqual(item01, Some("A1"));
   *
   * const item20 = await Option.fromNullish(rows[2])
   *   .andThenAsync(async (row) => Option.fromNullish(row[0]));
   * assert.deepEqual(item20, None);
   * ```
   */
  public andThenAsync<U>(f: (value: T) => Promise<Option<U>> | AsyncOption<U>): AsyncOption<U> {
    return new AsyncOption(this.isSome() ? f(this.unwrap()) : Promise.resolve(None))
  }

  /**
   * Returns `None` if the option is `None`, otherwise calls `predicate` with the wrapped value and returns:
   *
   * - `Some<T>` if predicate returns true, and
   * - `None` if predicate returns false.
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
   * assert.deepEqual(None.filter(isEven), None);
   * assert.deepEqual(Some(3).filter(isEven), None);
   * assert.deepEqual(Some(4).filter(isEven), Some(4));
   * ```
   */
  public filter(predicate: (value: T) => boolean): Option<T> {
    return this.isSome() && predicate(this.unwrap()) ? this : None
  }

  /**
   * Returns the option if it contains a value, otherwise calls `f` and returns the result.
   *
   * The fallback is evaluated lazily, only for `None`.
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
   * assert.deepEqual(Some("barbarians").orElse(vikings), Some("barbarians"));
   * assert.deepEqual(None.orElse(vikings), Some("vikings"));
   * assert.deepEqual(None.orElse(nobody), None);
   * ```
   */
  public orElse<U>(f: () => Option<U>): Option<T | U> {
    return this.isSome() ? this : f()
  }

  /**
   * Returns `Some` unchanged, or awaits a fallback `Option` for `None`.
   *
   * The fallback runs only for `None`.
   *
   * @example
   *
   * ```ts
   * async function nobody(): Promise<Option<string>> {
   *   return None;
   * }
   *
   * async function vikings(): Promise<Option<string>> {
   *   return Some("vikings");
   * }
   *
   * assert.deepEqual(await Some("barbarians").orElseAsync(vikings), Some("barbarians"));
   * assert.deepEqual(await None.orElseAsync(vikings), Some("vikings"));
   * assert.deepEqual(await None.orElseAsync(nobody), None);
   * ```
   */
  public orElseAsync<U>(f: () => Promise<Option<U>> | AsyncOption<U>): AsyncOption<T | U> {
    return new AsyncOption<T | U>(this.isSome() ? Promise.resolve(this) : f())
  }

  /**
   * Returns `Some` if exactly one of `this` and `other` is `Some`, otherwise returns `None`.
   *
   * @example
   *
   * ```ts
   * assert.deepEqual(Some(2).xor(None), Some(2));
   * assert.deepEqual(None.xor(Some(2)), Some(2));
   * assert.deepEqual(Some(2).xor(Some(2)), None);
   * assert.deepEqual(None.xor(None), None);
   * ```
   */
  public xor<U>(other: Option<U>): Option<T | U> {
    return this.isSome() ? (other.isSome() ? None : this) : other
  }

  /**
   * Converts from `Option<Option<U>>` to `Option<U>`.
   *
   * Both `None` and `Some(None)` become `None`.
   *
   * @example
   *
   * ```ts
   * const x: Option<Option<number>> = Some(Some(6));
   * assert.deepEqual(x.flatten(), Some(6));
   *
   * const y: Option<Option<number>> = Some(None);
   * assert.deepEqual(y.flatten(), None);
   *
   * const z: Option<Option<number>> = None;
   * assert.deepEqual(z.flatten(), None);
   * ```
   *
   * @example
   * Flattening only removes one level of nesting at a time.
   *
   * ```ts
   * const x = Some(Some(Some(6)));
   * assert.deepEqual(x.flatten(), Some(Some(6)));
   * assert.deepEqual(x.flatten().flatten(), Some(6));
   * ```
   */
  public flatten<U>(this: Option<Option<U>>): Option<U> {
    return this.isSome() ? this.unwrap() : None
  }

  /**
   * Returns `{ isSome: true, value }` for `Some` or
   * `{ isSome: false, value: null }` for `None`.
   *
   * @example
   *
   * ```ts
   * Some(2).toObject(); // { isSome: true, value: 2 }
   * None.toObject(); // { isSome: false, value: null }
   * ```
   */
  public toObject(): { isSome: true; value: T } | { isSome: false; value: null } {
    return this.isSome() ? { isSome: true, value: this.unwrap() } : { isSome: false, value: null }
  }

  /**
   * Returns `Some(value)` using JavaScript's `String` conversion, or `None`.
   *
   * @example
   *
   * ```ts
   * Some(2).toString(); // "Some(2)"
   * None.toString(); // "None"
   * ```
   */
  public toString(): `Some(${string})` | 'None' {
    return this.kind ? `Some(${String(this.wrapped)})` : 'None'
  }

  /**
   * Uses the same representation as `toString()` when inspected.
   *
   * @example
   *
   * ```ts
   * inspect(Some(2)); // "Some(2)"
   * ```
   */
  public [symbols.inspect](): ReturnType<OptionImpl<T>['toString']> {
    return this.toString()
  }
}

export interface Some<T> extends OptionImpl<T> {
  [symbols.tag]: 'Some'
  /**
   * Returns the contained `Some` value.
   *
   * Available on `Some`, including an `Option` narrowed with `isSome()`.
   *
   * @returns The contained value without a panic path.
   *
   * @example
   * ```ts
   * const x: Option<string> = Some("air");
   * if (x.isSome()) {
   *   assert.equal(x.unwrap(), "air");
   * }
   * ```
   */
  unwrap(): T
  /**
   * Returns the contained `Some` value.
   *
   * Use mainly in tests or rare, explained assertions.
   *
   * @param message - Why the option should be `Some`.
   * @see OptionImpl.expect
   *
   * @example
   * ```ts
   * assert.equal(Some("value").expect("fruits are healthy"), "value");
   * ```
   */
  expect(message: string): T
}

/**
 * Some value of type `T`.
 *
 * @example
 *
 * ```ts
 * Some(2).isSome(); // true
 * ```
 */
export function Some<T>(value: T): Some<T> {
  return new SomeImpl(value)
}

class SomeImpl<T> extends OptionImpl<T> {
  public readonly [symbols.tag] = 'Some'

  private readonly value: T

  public constructor(value: T) {
    super(true, value)
    this.value = value
  }

  /**
   * Returns the contained `Some` value after narrowing.
   *
   * This method is only available on a `Some` variant and has no panic path.
   *
   * @example
   *
   * ```ts
   * const option: Option<number> = Some(2);
   * if (option.isSome()) {
   *   option.unwrap(); // 2
   * }
   * ```
   */
  public unwrap(): T {
    return this.value
  }
}

export interface None<T = never> extends OptionImpl<T> {
  [symbols.tag]: 'None'
  /**
   * Panics because this option is `None`.
   *
   * @param message - Why the option was expected to be `Some`.
   * @throws {Panic} With the supplied message.
   * @see OptionImpl.expect
   *
   * @example
   * ```ts
   * assert.throws(() => None.expect("fruits are healthy"), Panic);
   * ```
   */
  expect(message: string): never
}

class NoneImpl extends OptionImpl<never> {
  public readonly [symbols.tag] = 'None'
}

/**
 * No value.
 *
 * @example
 *
 * ```ts
 * None.isNone(); // true
 * ```
 */
export const None: None = new NoneImpl(false)

/**
 * `Option` represents an optional value: every `Option` is either `Some` and contains a value, or `None`, and does not.
 */
export type Option<T> = Some<T> | None<T>

export namespace Option {
  /**
   * Creates an `Option` from a nullish value.
   * Both `null` and `undefined` become `None`; all other values, including
   * `0`, `false`, and an empty string, become `Some(value)`.
   *
   * @example
   *
   * ```ts
   * Option.fromNullish(0); // Some(0)
   * Option.fromNullish(null); // None
   * ```
   */
  export function fromNullish<T>(value: T | undefined | null): Option<T> {
    return value == null ? None : Some(value)
  }
}
