import { AsyncResult } from './async_result'
import { Panic, parseError } from './error'
import { None, type Option, Some } from './option'
import * as symbols from './symbols'

export type ResultMatch<T, E, A, B> = {
  Ok: (value: T) => A
  Err: (error: E) => B
}

export type ResultMatchAsync<T, E, A, B> = {
  Ok: (value: T) => Promise<A>
  Err: (error: E) => Promise<B>
}

export abstract class ResultImpl<T, E> {
  private readonly kind?: true
  protected readonly wrapped: T | E

  public [Symbol.toStringTag] = 'Result'

  public constructor(k: boolean, v: T | E) {
    if (k) {
      this.kind = true
    }
    this.wrapped = v
  }

  /**
   * Unwraps successes or propagates errors through `yield*` inside a try block.
   *
   * @example
   *
   * ```ts
   * const result = tryBlock(function* () {
   *   const value = yield* Ok(2);
   *   return Ok(value * 2);
   * }); // Ok(4)
   * ```
   */
  public abstract [Symbol.iterator](): Generator<Err<E, never>, T>

  protected abstract variant(): Ok<T> | Err<E>

  private unwrapFailed(message: string): never {
    throw new Panic(message, { cause: this.wrapped })
  }

  /**
   * Calls the matching `Ok` or `Err` callback and returns its value.
   *
   * Prefer {@link map} to transform a success, {@link andThen} to chain fallible
   * operations, or {@link unwrapOrElse} to supply a fallback. Use `yield*` inside
   * `tryBlock` for several dependent operations that propagate errors. For
   * branching with multiple statements or early returns, narrow the result with
   * {@link isOk} or {@link isErr} and use ordinary control flow.
   *
   * @param pattern - Callbacks for the `Ok` and `Err` variants.
   * @returns The value returned by the matching callback.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(2);
   * const success = x.match({
   *   Ok: (value) => value * 2,
   *   Err: (error) => error.length,
   * });
   * assert.equal(success, 4);
   *
   * const y: Result<number, string> = Err("error");
   * const failure = y.match({
   *   Ok: (value) => value * 2,
   *   Err: (error) => error.length,
   * });
   * assert.equal(failure, 5);
   * ```
   */
  public match<A, B>(pattern: ResultMatch<T, E, A, B>): A | B {
    const result = this.variant()
    return result.isOk() ? pattern.Ok(result.unwrap()) : pattern.Err(result.unwrapErr())
  }

  /**
   * Matches `Ok` or `Err` with an asynchronous callback and awaits its value.
   *
   * Only the callback for the current variant runs.
   *
   * Prefer {@link mapAsync} to transform a success, {@link andThenAsync} to
   * chain fallible operations, or {@link orElseAsync} to recover from an error.
   * For multiple steps, use `yield*` inside an async `tryBlock`, or narrow with
   * {@link isOk} or {@link isErr} before awaiting branch work.
   *
   * @example
   *
   * ```ts
   * await Err("missing").matchAsync({
   *   Ok: async () => 1,
   *   Err: async (error) => error.length,
   * }); // 7
   * ```
   */
  public async matchAsync<A, B>(pattern: ResultMatchAsync<T, E, A, B>): Promise<A | B> {
    const result = this.variant()
    return result.isOk() ? pattern.Ok(result.unwrap()) : pattern.Err(result.unwrapErr())
  }

  /**
   * Returns `true` if the result is `Ok`.
   *
   * Narrows the result to `Ok` so `unwrap()` is available in the true branch.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(-3);
   * assert.equal(x.isOk(), true);
   *
   * const y: Result<number, string> = Err("Some error message");
   * assert.equal(y.isOk(), false);
   * ```
   */
  public isOk(): this is Ok<T, E> {
    return this.kind === true
  }

  /**
   * Returns `true` if the result is `Err`.
   *
   * Narrows the result to `Err` so `unwrapErr()` is available in the true branch.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(-3);
   * assert.equal(x.isErr(), false);
   *
   * const y: Result<number, string> = Err("Some error message");
   * assert.equal(y.isErr(), true);
   * ```
   */
  public isErr(): this is Err<E, T> {
    return this.kind === undefined
  }

  /**
   * Converts from `Result<T, E>` to `Option<T>`.
   *
   * Converts `Ok(value)` into `Some(value)`, discarding the error, if any.
   * An `Err` becomes `None`.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(2);
   * assert.deepEqual(x.ok(), Some(2));
   *
   * const y: Result<number, string> = Err("Nothing here");
   * assert.deepEqual(y.ok(), None);
   * ```
   */
  public ok(): Option<T> {
    return this.isOk() ? Some(this.unwrap()) : None
  }

  /**
   * Converts from `Result<T, E>` to `Option<E>`.
   *
   * Converts `Err(error)` into `Some(error)`, discarding the success value, if any.
   * An `Ok` becomes `None`.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(2);
   * assert.deepEqual(x.err(), None);
   *
   * const y: Result<number, string> = Err("Nothing here");
   * assert.deepEqual(y.err(), Some("Nothing here"));
   * ```
   */
  public err(): Option<E> {
    return this.isErr() ? Some(this.unwrapErr()) : None
  }

  /**
   * Maps a `Result<T, E>` to `Result<U, E>` by applying a function to a
   * contained `Ok` value, leaving an `Err` value untouched.
   *
   * This function can be used to compose the results of two functions.
   *
   * @example
   * Print the numbers on each line of a string multiplied by two.
   *
   * ```ts
   * function parseNumber(line: string): Result<number, string> {
   *   const value = Number(line);
   *   return Number.isNaN(value) ? Err(`invalid number: ${line}`) : Ok(value);
   * }
   *
   * const lines = "1\n2\n3\n4\n";
   * for (const line of lines.trimEnd().split("\n")) {
   *   const doubled = parseNumber(line).map((value) => value * 2);
   *   if (doubled.isOk()) {
   *     console.log(doubled.unwrap()); // 2, 4, 6, 8
   *   }
   * }
   * ```
   */
  public map<U>(f: (value: T) => U): Result<U, E> {
    const result = this.variant()
    return result.isOk() ? Ok(f(result.unwrap())) : Err(result.unwrapErr())
  }

  /**
   * Maps a `Result<T, E>` to `AsyncResult<U, E>` by applying an async function
   * to a contained `Ok` value, leaving an `Err` value untouched.
   *
   * This function can be used to compose the results of two functions.
   * The returned `AsyncResult` awaits the mapped value.
   *
   * @example
   * Print the numbers on each line of a string multiplied by two.
   *
   * ```ts
   * function parseNumber(line: string): Result<number, string> {
   *   const value = Number(line);
   *   return Number.isNaN(value) ? Err(`invalid number: ${line}`) : Ok(value);
   * }
   *
   * const lines = "1\n2\n3\n4\n";
   * for (const line of lines.trimEnd().split("\n")) {
   *   const doubled = await parseNumber(line).mapAsync(async (value) => value * 2);
   *   if (doubled.isOk()) {
   *     console.log(doubled.unwrap()); // 2, 4, 6, 8
   *   }
   * }
   * ```
   */
  public mapAsync<U>(f: (value: T) => Promise<U>): AsyncResult<U, E> {
    const result = this.variant()
    return new AsyncResult(
      result.isOk() ? f(result.unwrap()).then((v) => Ok(v)) : Promise.resolve(Err(result.unwrapErr())),
    )
  }

  /**
   * Returns the provided default (if `Err`), or applies a function to the contained value (if `Ok`).
   *
   * Arguments passed to `mapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x: Result<string, string> = Ok("foo");
   * assert.equal(x.mapOr(42, (v) => v.length), 3);
   *
   * const y: Result<string, string> = Err("bar");
   * assert.equal(y.mapOr(42, (v) => v.length), 42);
   * ```
   */
  public mapOr<A, B>(defaultValue: A, f: (value: T) => B): A | B {
    return this.isOk() ? f(this.unwrap()) : defaultValue
  }

  /**
   * Awaits the mapping function for `Ok`, or resolves to the provided default for `Err`.
   *
   * Arguments passed to `mapOrAsync` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElseAsync}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x: Result<string, string> = Ok("foo");
   * assert.equal(await x.mapOrAsync(42, async (v) => v.length), 3);
   *
   * const y: Result<string, string> = Err("bar");
   * assert.equal(await y.mapOrAsync(42, async (v) => v.length), 42);
   * ```
   */
  public async mapOrAsync<A, B>(defaultValue: A, f: (value: T) => Promise<B>): Promise<A | B> {
    return this.isOk() ? f(this.unwrap()) : Promise.resolve(defaultValue)
  }

  /**
   * Maps a `Result<T, E>` to `A | B` by applying fallback function `defaultValue`
   * to a contained `Err` value, or function `f` to a contained `Ok` value.
   *
   * This function can be used to unpack a successful result while handling an error.
   * Only the function for the current variant runs.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x: Result<string, string> = Ok("foo");
   * assert.equal(x.mapOrElse(() => k * 2, (v) => v.length), 3);
   *
   * const y: Result<string, string> = Err("bar");
   * assert.equal(y.mapOrElse(() => k * 2, (v) => v.length), 42);
   * ```
   */
  public mapOrElse<A, B>(defaultValue: (error: E) => A, f: (value: T) => B): A | B {
    const result = this.variant()
    return result.isOk() ? f(result.unwrap()) : defaultValue(result.unwrapErr())
  }

  /**
   * Awaits the `Ok` mapping function or the `Err` fallback function.
   *
   * This function can be used to unpack a successful result while handling an error.
   * Only the function for the current variant runs; the fallback receives the error.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x: Result<string, string> = Ok("foo");
   * assert.equal(await x.mapOrElseAsync(async () => k * 2, async (v) => v.length), 3);
   *
   * const y: Result<string, string> = Err("bar");
   * assert.equal(await y.mapOrElseAsync(async () => k * 2, async (v) => v.length), 42);
   * ```
   */
  public async mapOrElseAsync<A, B>(
    defaultValue: (error: E) => Promise<A>,
    f: (value: T) => Promise<B>,
  ): Promise<A | B> {
    const result = this.variant()
    return result.isOk() ? f(result.unwrap()) : defaultValue(result.unwrapErr())
  }

  /**
   * Maps a `Result<T, E>` to `Result<T, F>` by applying a function to a
   * contained `Err` value, leaving an `Ok` value untouched.
   *
   * This function can be used to pass through a successful result while handling an error.
   *
   * @example
   *
   * ```ts
   * function stringify(x: number): string {
   *   return `error code: ${x}`;
   * }
   *
   * const x: Result<number, number> = Ok(2);
   * assert.deepEqual(x.mapErr(stringify), Ok(2));
   *
   * const y: Result<number, number> = Err(13);
   * assert.deepEqual(y.mapErr(stringify), Err("error code: 13"));
   * ```
   */
  public mapErr<F>(f: (error: E) => F): Result<T, F> {
    const result = this.variant()
    return result.isOk() ? Ok(result.unwrap()) : Err(f(result.unwrapErr()))
  }

  /**
   * Maps a `Result<T, E>` to `AsyncResult<T, F>` by applying an async function
   * to a contained `Err` value, leaving an `Ok` value untouched.
   *
   * This function can be used to pass through a successful result while handling an error.
   * The returned `AsyncResult` awaits the mapped error.
   *
   * @example
   *
   * ```ts
   * async function stringify(x: number): Promise<string> {
   *   return `error code: ${x}`;
   * }
   *
   * const x: Result<number, number> = Ok(2);
   * assert.deepEqual(await x.mapErrAsync(stringify), Ok(2));
   *
   * const y: Result<number, number> = Err(13);
   * assert.deepEqual(await y.mapErrAsync(stringify), Err("error code: 13"));
   * ```
   */
  public mapErrAsync<F>(f: (error: E) => Promise<F>): AsyncResult<T, F> {
    const result = this.variant()
    return new AsyncResult(
      result.isOk() ? Promise.resolve(Ok(result.unwrap())) : f(result.unwrapErr()).then((v) => Err(v)),
    )
  }

  /**
   * Calls a function with the contained value if `Ok`.
   *
   * Returns the original result.
   *
   * @param f - Runs with the `Ok` value; not called for `Err`.
   * @returns The original result, including its variant and value.
   *
   * @example
   *
   * ```ts
   * function parseNumber(text: string): Result<number, string> {
   *   const value = Number(text);
   *   return Number.isNaN(value) ? Err("not a number") : Ok(value);
   * }
   *
   * const cubed = parseNumber("4")
   *   .inspect((value) => console.log(`original: ${value}`))
   *   .map((value) => value ** 3)
   *   .expect("input should be a number");
   * // Logs "original: 4"; cubed is 64.
   *
   * parseNumber("bad").inspect((value) => console.log(value));
   * // Does not log anything; returns the original Err.
   * ```
   */
  public inspect(f: (value: T) => void): this {
    if (this.isOk()) {
      f(this.unwrap())
    }
    return this
  }

  /**
   * Calls an async function with the contained value if `Ok`.
   *
   * Resolves to a result with the original variant and value after the callback completes.
   *
   * @param f - Runs with the `Ok` value; not called for `Err`.
   * @returns An `AsyncResult` that resolves after the callback finishes.
   *
   * @example
   *
   * ```ts
   * function parseNumber(text: string): Result<number, string> {
   *   const value = Number(text);
   *   return Number.isNaN(value) ? Err("not a number") : Ok(value);
   * }
   *
   * const cubed = await parseNumber("4")
   *   .inspectAsync(async (value) => console.log(`original: ${value}`))
   *   .map((value) => value ** 3)
   *   .expect("input should be a number");
   * // Logs "original: 4"; cubed is 64 after inspection completes.
   * ```
   */
  public inspectAsync(f: (value: T) => Promise<void>): AsyncResult<T, E> {
    return new AsyncResult(
      this.matchAsync({
        Ok: async (t) => f(t).then(() => Ok(t)),
        Err: async (e) => Promise.resolve(Err(e)),
      }),
    )
  }

  /**
   * Calls a function with the contained error if `Err`.
   *
   * Returns the original result.
   *
   * @param f - Runs with the `Err` value; not called for `Ok`.
   * @returns The original result, including its variant and value.
   *
   * @example
   *
   * ```ts
   * function read(): Result<string, Error> {
   *   return Result.fromThrowable(() => readFileSync("address.txt", "utf8"))
   *     .inspectErr((error) => console.error(`failed to read file: ${error.message}`));
   * }
   * ```
   */
  public inspectErr(f: (error: E) => void): this {
    if (this.isErr()) {
      f(this.unwrapErr())
    }
    return this
  }

  /**
   * Calls an async function with the contained error if `Err`.
   *
   * Resolves to a result with the original variant and value after the callback completes.
   *
   * @param f - Runs with the `Err` value; not called for `Ok`.
   * @returns An `AsyncResult` that resolves after the callback finishes.
   *
   * @example
   *
   * ```ts
   * function read(): AsyncResult<string, Error> {
   *   return Result.fromThrowable(() => readFileSync("address.txt", "utf8"))
   *     .inspectErrAsync(async (error) => console.error(`failed to read file: ${error.message}`));
   * }
   * ```
   */
  public inspectErrAsync(f: (error: E) => Promise<void>): AsyncResult<T, E> {
    const result = this.variant()
    return new AsyncResult(
      result.isOk() ? Promise.resolve(Ok(result.unwrap())) : f(result.unwrapErr()).then(() => Err(result.unwrapErr())),
    )
  }

  /**
   * Returns the contained `Ok` value.
   *
   * Because this function may panic, prefer to match and handle the `Err` case
   * explicitly, or call {@link unwrapOr} or {@link unwrapOrElse}.
   * Use this mainly in tests and rare, explained assertions in app code.
   *
   * Recommended message style: explain the reason you expect the result should
   * be `Ok`. Focus on "should", as in "the environment variable should be set
   * by the wrapper script".
   *
   * @param message - Why the result should be `Ok`.
   * @returns The `Ok` value.
   *
   * @throws {Panic} When the result is `Err`. The error is attached as `cause`.
   * The `Panic` message is the supplied `message`; it does not include the error text.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Err("emergency failure");
   * x.expect("Testing expect"); // Throws Panic("Testing expect"), cause: "emergency failure".
   * ```
   *
   * @example
   *
   * ```ts
   * const path = Option.fromNullish(process.env["IMPORTANT_PATH"])
   *   .okOr("IMPORTANT_PATH is missing")
   *   .expect("env variable IMPORTANT_PATH should be set by wrapper_script.sh");
   * ```
   */
  public expect(message: string): T {
    return this.isOk() ? this.unwrap() : this.unwrapFailed(message)
  }

  /**
   * Returns the contained `Err` value.
   *
   * Use this mainly in tests or rare, explained assertions. The message should explain
   * why the result should be `Err`.
   *
   * @param message - Why the result should be `Err`.
   * @returns The `Err` value.
   *
   * @throws {Panic} When the result is `Ok`. The value is attached as `cause`.
   * The `Panic` message is the supplied `message`; it does not include the value text.
   *
   * @example
   *
   * ```ts
   * const x: Result<number, string> = Ok(10);
   * x.expectErr("Testing expectErr"); // Throws Panic("Testing expectErr"), cause: 10.
   * ```
   */
  public expectErr(message: string): E {
    return this.isErr() ? this.unwrapErr() : this.unwrapFailed(message)
  }

  /**
   * Calls `f` if the result is `Ok`, otherwise returns the original `Err`.
   *
   * This function can be used for control flow based on `Result` values.
   * The returned error type includes errors from both operations: `E | F`.
   *
   * @returns The callback's result for `Ok`, or the original `Err`.
   *
   * @example
   * ```ts
   * function squareThenToString(x: number): Result<string, string> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString()).okOr("overflowed");
   * }
   *
   * assert.deepEqual(Ok(2).andThen(squareThenToString), Ok("4"));
   * assert.deepEqual(Ok(1_000_000).andThen(squareThenToString), Err("overflowed"));
   * assert.deepEqual(Err("not a number").andThen(squareThenToString), Err("not a number"));
   * ```
   *
   * @example
   * Often used to chain fallible operations that may return `Err`.
   * Node's file metadata already contains the modification time.
   *
   * ```ts
   * const rootModifiedTime = Result.fromThrowable(() => statSync("/"))
   *   .andThen((metadata) => Ok(metadata.mtime));
   * assert.equal(rootModifiedTime.isOk(), true);
   *
   * const shouldFail = Result.fromThrowable(() => statSync("/bad/path"))
   *   .andThen((metadata) => Ok(metadata.mtime));
   * assert.equal(shouldFail.isErr(), true);
   * const error = shouldFail.expectErr("the nonexistent path should fail");
   * assert.equal("code" in error && error.code, "ENOENT");
   * ```
   */
  public andThen<U, F>(f: (value: T) => Result<U, F>): Result<U, E | F> {
    const result = this.variant()
    return result.isOk() ? f(result.unwrap()) : result
  }

  /**
   * Calls `f` if the result is `Ok`, otherwise resolves to the original `Err`.
   *
   * This function can be used for control flow based on `Result` values.
   * The callback may return an `AsyncResult` or a promise of a `Result`.
   * The returned error type includes errors from both operations: `E | F`.
   *
   * @returns An `AsyncResult` that awaits the callback's result for `Ok`.
   *
   * @example
   * ```ts
   * async function squareThenToString(x: number): Promise<Result<string, string>> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString()).okOr("overflowed");
   * }
   *
   * assert.deepEqual(await Ok(2).andThenAsync(squareThenToString), Ok("4"));
   * assert.deepEqual(await Ok(1_000_000).andThenAsync(squareThenToString), Err("overflowed"));
   * assert.deepEqual(await Err("not a number").andThenAsync(squareThenToString), Err("not a number"));
   * ```
   *
   * @example
   * Chain a successful path lookup with an asynchronous metadata read.
   *
   * ```ts
   * const rootModifiedTime = await Ok("/").andThenAsync((path) =>
   *   AsyncResult.fromPromise(stat(path)).map((metadata) => metadata.mtime),
   * );
   * assert.equal(rootModifiedTime.isOk(), true);
   *
   * const shouldFail = await Ok("/bad/path").andThenAsync((path) =>
   *   AsyncResult.fromPromise(stat(path)).map((metadata) => metadata.mtime),
   * );
   * const error = shouldFail.expectErr("the nonexistent path should fail");
   * assert.equal("code" in error && error.code, "ENOENT");
   * ```
   */
  public andThenAsync<U, F>(f: (value: T) => AsyncResult<U, F> | Promise<Result<U, F>>): AsyncResult<U, E | F> {
    const result = this.variant()
    return new AsyncResult<U, E | F>(result.isOk() ? f(result.unwrap()) : Promise.resolve(result))
  }

  /**
   * Calls `f` if the result is `Err`, otherwise returns the original `Ok`.
   *
   * This function can be used for control flow based on result values.
   * The callback may recover with `Ok` or return a new `Err`.
   *
   * @returns The original `Ok`, or the callback's result for `Err`.
   *
   * @example
   * ```ts
   * function square(x: number): Result<number, number> {
   *   return Ok(x * x);
   * }
   *
   * function error(x: number): Result<number, number> {
   *   return Err(x);
   * }
   *
   * assert.deepEqual(Ok(2).orElse(square).orElse(square), Ok(2));
   * assert.deepEqual(Ok(2).orElse(error).orElse(square), Ok(2));
   * assert.deepEqual(Err(3).orElse(square).orElse(error), Ok(9));
   * assert.deepEqual(Err(3).orElse(error).orElse(error), Err(3));
   * ```
   */
  public orElse<U, F>(f: (error: E) => Result<U, F>): Result<T | U, F> {
    const result = this.variant()
    return result.isOk() ? result : f(result.unwrapErr())
  }

  /**
   * Calls `f` if the result is `Err`, otherwise resolves to the original `Ok`.
   *
   * This function can be used for control flow based on result values.
   * The callback may return an `AsyncResult` or a promise of a `Result`.
   *
   * @returns An `AsyncResult` that awaits recovery for `Err` and preserves `Ok`.
   *
   * @example
   * ```ts
   * async function square(x: number): Promise<Result<number, number>> {
   *   return Ok(x * x);
   * }
   *
   * async function error(x: number): Promise<Result<number, number>> {
   *   return Err(x);
   * }
   *
   * assert.deepEqual(await Ok(2).orElseAsync(square).orElseAsync(square), Ok(2));
   * assert.deepEqual(await Ok(2).orElseAsync(error).orElseAsync(square), Ok(2));
   * assert.deepEqual(await Err(3).orElseAsync(square).orElseAsync(error), Ok(9));
   * assert.deepEqual(await Err(3).orElseAsync(error).orElseAsync(error), Err(3));
   * ```
   */
  public orElseAsync<U, F>(f: (error: E) => AsyncResult<U, F> | Promise<Result<U, F>>): AsyncResult<T | U, F> {
    const result = this.variant()
    return new AsyncResult<T | U, F>(result.isOk() ? Promise.resolve(result) : f(result.unwrapErr()))
  }

  /**
   * Returns the contained `Ok` value or a provided default.
   *
   * Arguments passed to `unwrapOr` are eagerly evaluated. If you are passing
   * the result of a function call, use {@link unwrapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const defaultValue = 2;
   * const x: Result<number, string> = Ok(9);
   * assert.equal(x.unwrapOr(defaultValue), 9);
   *
   * const y: Result<number, string> = Err("error");
   * assert.equal(y.unwrapOr(defaultValue), defaultValue);
   * ```
   */
  public unwrapOr<U>(defaultValue: U): T | U {
    return this.isOk() ? this.unwrap() : defaultValue
  }

  /**
   * Returns the contained `Ok` value or computes it from `defaultValue`.
   *
   * The fallback runs only for `Err` and receives the error.
   *
   * @example
   *
   * ```ts
   * function count(x: string): number {
   *   return x.length;
   * }
   *
   * assert.equal(Ok(2).unwrapOrElse(count), 2);
   * assert.equal(Err("foo").unwrapOrElse(count), 3);
   * ```
   */
  public unwrapOrElse<U>(defaultValue: (error: E) => U): T | U {
    const result = this.variant()
    return result.isOk() ? result.unwrap() : defaultValue(result.unwrapErr())
  }

  /**
   * Resolves to the `Ok` value or awaits a fallback computed from the `Err` value.
   *
   * The fallback runs only for `Err`.
   *
   * @example
   *
   * ```ts
   * async function count(x: string): Promise<number> {
   *   return x.length;
   * }
   *
   * assert.equal(await Ok(2).unwrapOrElseAsync(count), 2);
   * assert.equal(await Err("foo").unwrapOrElseAsync(count), 3);
   * ```
   */
  public async unwrapOrElseAsync<U>(defaultValue: (error: E) => Promise<U>): Promise<T | U> {
    const result = this.variant()
    return result.isOk() ? Promise.resolve(result.unwrap()) : defaultValue(result.unwrapErr())
  }

  /**
   * Converts from `Result<Result<U, F>, E>` to `Result<U, E | F>`.
   *
   * Either outer or inner `Err` remains an `Err`; an outer `Ok(Ok(value))` becomes `Ok(value)`.
   *
   * @example
   *
   * ```ts
   * const x: Result<Result<string, number>, number> = Ok(Ok("hello"));
   * assert.deepEqual(x.flatten(), Ok("hello"));
   *
   * const y: Result<Result<string, number>, number> = Ok(Err(6));
   * assert.deepEqual(y.flatten(), Err(6));
   *
   * const z: Result<Result<string, number>, number> = Err(6);
   * assert.deepEqual(z.flatten(), Err(6));
   * ```
   *
   * @example
   * Flattening only removes one level of nesting at a time.
   *
   * ```ts
   * const x = Ok(Ok(Ok("hello")));
   * assert.deepEqual(x.flatten(), Ok(Ok("hello")));
   * assert.deepEqual(x.flatten().flatten(), Ok("hello"));
   * ```
   */
  public flatten<U, F>(this: Result<Result<U, F>, E>): Result<U, E | F> {
    return this.isOk() ? this.unwrap() : Err(this.unwrapErr())
  }

  /**
   * Returns a plain discriminated object for the current variant.
   * `Ok(value)` becomes `{ isOk: true, value }`; `Err(error)` becomes
   * `{ isOk: false, error }`.
   *
   * @example
   *
   * ```ts
   * Ok(2).toObject(); // { isOk: true, value: 2 }
   * Err("missing").toObject(); // { isOk: false, error: "missing" }
   * ```
   */
  public toObject(): { isOk: true; value: T } | { isOk: false; error: E } {
    const result = this.variant()
    return result.isOk() ? { isOk: true, value: result.unwrap() } : { isOk: false, error: result.unwrapErr() }
  }

  /**
   * Returns `Ok(value)` or `Err(error)` using JavaScript's `String` conversion.
   *
   * @example
   *
   * ```ts
   * Ok(2).toString(); // "Ok(2)"
   * Err("missing").toString(); // "Err(missing)"
   * ```
   */
  public toString(): `Ok(${string})` | `Err(${string})` {
    const str = String(this.wrapped)
    return this.kind ? `Ok(${str})` : `Err(${str})`
  }

  /**
   * Uses the same representation as `toString()` when inspected.
   *
   * @example
   *
   * ```ts
   * inspect(Ok(2)); // "Ok(2)"
   * ```
   */
  public [symbols.inspect](): ReturnType<ResultImpl<T, E>['toString']> {
    return this.toString()
  }
}

export interface Ok<T = undefined, E = never> extends ResultImpl<T, E> {
  [symbols.tag]: 'Ok'
  /**
   * Returns the contained `Ok` value.
   *
   * Available on `Ok`, including a `Result` narrowed with `isOk()`.
   *
   * @returns The success value without a panic path.
   *
   * @example
   * ```ts
   * const x: Result<number, string> = Ok(2);
   * if (x.isOk()) {
   *   assert.equal(x.unwrap(), 2);
   * }
   * ```
   */
  unwrap(): T
  /**
   * Returns the contained `Ok` value.
   *
   * Use mainly in tests or rare, explained assertions. The message explains
   * why the result should be `Ok` if its variant later changes.
   *
   * @param message - Why the result should be `Ok`.
   * @see ResultImpl.expect
   *
   * @example
   * ```ts
   * assert.equal(Ok(2).expect("the computation should succeed"), 2);
   * ```
   */
  expect(message: string): T
  /**
   * Panics because this result contains an `Ok` value.
   *
   * @param message - Why the result was expected to be `Err`.
   * @throws {Panic} With the supplied message and the success value as `cause`.
   * @see ResultImpl.expectErr
   *
   * @example
   * ```ts
   * assert.throws(() => Ok(10).expectErr("the computation should fail"), Panic);
   * ```
   */
  expectErr(message: string): never
}

/**
 * Contains the success value.
 *
 * @example
 *
 * ```ts
 * Ok(2).isOk(); // true
 * Ok().toObject(); // { isOk: true, value: undefined }
 * ```
 */
export function Ok(): Ok
export function Ok<T>(value: T): Ok<T>
export function Ok<T>(value?: T): Ok<T | undefined> {
  return new OkImpl(value)
}

class OkImpl<T> extends ResultImpl<T, never> {
  public readonly [symbols.tag] = 'Ok'

  public constructor(value: T) {
    super(true, value)
  }

  protected variant(): Ok<T> {
    return this
  }

  public *[Symbol.iterator](): Generator<Err<never, never>, T> {
    return this.wrapped
  }

  /**
   * Returns the contained `Ok` value after narrowing.
   *
   * This method is only available on an `Ok` variant and has no panic path.
   *
   * @example
   *
   * ```ts
   * const result: Result<number, string> = Ok(2);
   * if (result.isOk()) {
   *   result.unwrap(); // 2
   * }
   * ```
   */
  public unwrap(): T {
    return this.wrapped
  }
}

export interface Err<E = undefined, T = never> extends ResultImpl<T, E> {
  [symbols.tag]: 'Err'
  /**
   * Returns the contained `Err` value.
   *
   * Available on `Err`, including a `Result` narrowed with `isErr()`.
   *
   * @returns The error value without a panic path.
   *
   * @example
   * ```ts
   * const x: Result<number, string> = Err("emergency failure");
   * if (x.isErr()) {
   *   assert.equal(x.unwrapErr(), "emergency failure");
   * }
   * ```
   */
  unwrapErr(): E
  /**
   * Panics because this result contains an `Err` value.
   *
   * @param message - Why the result was expected to be `Ok`.
   * @throws {Panic} With the supplied message and the error as `cause`.
   * @see ResultImpl.expect
   *
   * @example
   * ```ts
   * assert.throws(() => Err("emergency failure").expect("the computation should succeed"), Panic);
   * ```
   */
  expect(message: string): never
  /**
   * Returns the contained `Err` value.
   *
   * Use mainly in tests or rare, explained assertions.
   *
   * @param message - Why the result should be `Err`.
   * @see ResultImpl.expectErr
   *
   * @example
   * ```ts
   * assert.equal(Err("emergency failure").expectErr("the computation should fail"), "emergency failure");
   * ```
   */
  expectErr(message: string): E
}

/**
 * Contains the error value.
 *
 * @example
 *
 * ```ts
 * Err("missing").isErr(); // true
 * Err().toObject(); // { isOk: false, error: undefined }
 * ```
 */
export function Err(): Err
export function Err<E>(error: E): Err<E>
export function Err<E>(error?: E): Err<E | undefined> {
  return new ErrImpl(error)
}

class ErrImpl<E> extends ResultImpl<never, E> {
  public readonly [symbols.tag] = 'Err'

  public constructor(error: E) {
    super(false, error)
  }

  protected variant(): Err<E> {
    return this
  }

  public *[Symbol.iterator](): Generator<Err<E, never>, never> {
    yield this
    throw new Panic('Do not use this generator outside of a try block')
  }

  /**
   * Returns the contained `Err` value after narrowing.
   *
   * This method is only available on an `Err` variant and has no panic path.
   *
   * @example
   *
   * ```ts
   * const result: Result<number, string> = Err("missing");
   * if (result.isErr()) {
   *   result.unwrapErr(); // "missing"
   * }
   * ```
   */
  public unwrapErr(): E {
    return this.wrapped
  }
}

function handlePanic(cause: unknown) {
  if (cause instanceof Panic) {
    throw cause
  }
  return cause
}

function handleCaughtError(cause: unknown) {
  return parseError(handlePanic(cause))
}

/**
 * `Result` is a type that represents either success (`Ok`) or failure (`Err`).
 *
 * `Result<T, E>` is the type used for returning errors. It is a discriminated union with the variants, `Ok<T>`, representing success and containing a value, and `Err<E>`, representing error and containing an error value.
 *
 * Functions return `Result` whenever errors are expected and recoverable.
 */
export type Result<T, E> = Ok<T, E> | Err<E, T>

export namespace Result {
  /**
   * Tries to execute a function and returns the result as a `Result`.
   *
   * Returns `Ok(value)` on success or `Err(Error)` if the function throws.
   * A thrown `Panic` is rethrown rather than converted to `Err`.
   *
   * @throws {Panic} Rethrows a `Panic` from the callback.
   *
   * @example
   *
   * ```ts
   * // const result: Result<number, Error>
   * const result = Result.fromThrowable(() => 42);
   * assert.deepEqual(result, Ok(42));
   *
   * const failed = Result.fromThrowable(() => {
   *   throw new Error("read failed");
   * });
   * assert.equal(failed.isErr(), true);
   * ```
   */
  export function fromThrowable<T>(f: () => T): Result<T, Error> {
    try {
      return Ok(f())
    } catch (error) {
      return Err(handleCaughtError(error))
    }
  }

  /**
   * Tries to resolve a promise and returns the result as a `AsyncResult`.
   *
   * Resolves to `Ok(value)` on fulfillment or `Err(Error)` on rejection.
   * A rejected `Panic` remains a rejection rather than becoming an `Err`.
   *
   * @example
   *
   * ```ts
   * // const result: AsyncResult<number, Error>
   * const result = Result.fromPromise(Promise.resolve(42));
   * assert.deepEqual(await result, Ok(42));
   * ```
   */
  export function fromPromise<T>(promise: Promise<T>): AsyncResult<T, Error> {
    return new AsyncResult(
      promise.then(
        (value) => Ok(value),
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection values are converted to Error at this boundary.
        (error: unknown) => Err(handleCaughtError(error)),
      ),
    )
  }
}
