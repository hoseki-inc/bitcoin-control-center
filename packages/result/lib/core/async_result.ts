import { AsyncOption } from './async_option'
import { type Err, Result, type ResultMatch, type ResultMatchAsync } from './result'

/**
 * A promise that resolves to a `Result`.
 *
 * This class is useful for chaining multiple asynchronous operations that return a `Result`.
 *
 * Await and narrow the result to `Ok` before calling `unwrap()`.
 * Await and narrow the result to `Err` before calling `unwrapErr()`.
 */
export class AsyncResult<T, E> implements PromiseLike<Result<T, E>> {
  public readonly promise: Promise<Result<T, E>> | PromiseLike<Result<T, E>> | AsyncResult<T, E>

  /**
   * Wraps a promise of a `Result` for chaining before awaiting it.
   *
   * For a known variant, use `AsyncOk(value)` or `AsyncErr(error)`.
   * Use {@link fromPromise} for a promise of a plain value.
   *
   * @example
   *
   * ```ts
   * const pending: Promise<Result<number, string>> = Promise.resolve(Ok(2));
   * const result = new AsyncResult(pending);
   * await result; // Ok(2)
   * ```
   */
  public constructor(promise: Promise<Result<T, E>> | PromiseLike<Result<T, E>> | AsyncResult<T, E>) {
    this.promise = promise
  }

  /**
   * Converts a promise into an `AsyncResult`, resolving to `Ok(value)` on
   * fulfillment or `Err(Error)` on rejection.
   *
   * Non-Error rejections become a `TypeError` retaining the original cause.
   * A rejected `Panic` remains a rejection rather than becoming an `Err`.
   * This uses the same conversion as `Result.fromPromise` and accepts any `PromiseLike`.
   *
   * @example
   *
   * ```ts
   * const result = AsyncResult.fromPromise(Promise.resolve(42));
   * await result; // Ok(42)
   *
   * const failed = AsyncResult.fromPromise(Promise.reject(new Error("read failed")));
   * await failed; // Err(Error("read failed"))
   * ```
   */
  public static fromPromise<T>(promise: PromiseLike<T>): AsyncResult<Awaited<T>, Error> {
    return Result.fromPromise(Promise.resolve(promise))
  }

  /**
   * Executes a callback and awaits its return value, resolving to `Ok(value)`
   * on success or `Err(Error)` if the callback throws or its promise rejects.
   *
   * The callback runs in a promise microtask. Unlike `fromPromise(operation())`,
   * this also captures an operation that throws before returning a promise.
   * Non-Error failures become a `TypeError` retaining the original cause.
   * A thrown or rejected `Panic` remains a rejection rather than becoming an `Err`.
   *
   * @example
   *
   * ```ts
   * const result = AsyncResult.fromThrowable(async () => {
   *   const text = await readFile("/etc/someconfig.conf", "utf8");
   *   return text.trim();
   * });
   * const text = await result.unwrapOr("default configuration");
   * ```
   */
  public static fromThrowable<T>(f: () => T | PromiseLike<T>): AsyncResult<Awaited<T>, Error> {
    return AsyncResult.fromPromise(Promise.resolve().then(f))
  }

  /**
   * Awaits and delegates to the result through `yield*` inside an async try block.
   *
   * @example
   *
   * ```ts
   * const result = tryBlock(async function* () {
   *   const value = yield* AsyncOk(2);
   *   return Ok(value * 2);
   * });
   * await result; // Ok(4)
   * ```
   */
  public async *[Symbol.asyncIterator](): AsyncGenerator<Err<E, never>, T> {
    return yield* await this.promise
  }

  /**
   * Promise compatibility hook. Prefer `await` or the Result combinators in application code.
   */
  public then<A, B>(
    successCallback?: (res: Result<T, E>) => A | PromiseLike<A>,
    failureCallback?: (cause: unknown) => B | PromiseLike<B>,
  ): PromiseLike<A | B> {
    return this.promise.then(successCallback, failureCallback)
  }

  /**
   * Promise rejection compatibility hook. Use {@link orElse} or {@link orElseAsync} to handle `Err` values.
   */
  public catch<B = never>(rejectionCallback?: (cause: unknown) => B | PromiseLike<B>): PromiseLike<Result<T, E> | B> {
    return this.then<Result<T, E>, B>(undefined, rejectionCallback)
  }

  /**
   * Promise cleanup compatibility hook; not intended for routine application use.
   */
  public finally<Cleanup>(callback: () => Cleanup | PromiseLike<Cleanup>): PromiseLike<Result<T, E>> {
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
   * Awaits the result and calls the matching `Ok` or `Err` branch.
   *
   * Resolves to the branch's return value. A rejected wrapped promise bypasses both branches.
   *
   * Prefer {@link map} to transform a success, {@link andThen} to chain fallible
   * operations, or {@link unwrapOrElse} to supply a fallback. Use `yield*` inside
   * an async `tryBlock` for several dependent operations that propagate errors.
   * For branching with multiple statements or early returns, await the result
   * and narrow it with `isOk()` or `isErr()`.
   *
   * @example
   *
   * ```ts
   * const result = AsyncOk(2);
   * await result.match({
   *   Ok: (value) => value * 2,
   *   Err: () => 0,
   * }); // 4
   * ```
   */
  public async match<A, B>(matcher: ResultMatch<T, E, A, B>): Promise<A | B> {
    return (await this).match(matcher)
  }

  /**
   * Awaits the result and the callback for its `Ok` or `Err` branch.
   *
   * A rejected wrapped promise bypasses both callbacks.
   *
   * Prefer {@link mapAsync} to transform a success, {@link andThenAsync} to
   * chain fallible operations, or {@link orElseAsync} to recover from an error.
   * For multiple steps, use `yield*` inside an async `tryBlock`, or await the
   * result and narrow it with `isOk()` or `isErr()` before awaiting branch work.
   *
   * @example
   *
   * ```ts
   * const result = AsyncErr("missing");
   * await result.matchAsync({
   *   Ok: async () => 0,
   *   Err: async (error) => error.length,
   * }); // 7
   * ```
   */
  public async matchAsync<A, B>(matcher: ResultMatchAsync<T, E, A, B>): Promise<A | B> {
    return (await this).matchAsync(matcher)
  }

  /**
   * Converts from `AsyncResult<T, E>` to `AsyncOption<T>`.
   *
   * Converts a resolved `Ok(value)` to `Some(value)`, discarding the error, if any.
   * A resolved `Err` becomes `None`.
   *
   * @example
   *
   * ```ts
   * const x: AsyncResult<number, string> = AsyncOk(2);
   * assert.deepEqual(await x.ok(), Some(2));
   *
   * const y: AsyncResult<number, string> = AsyncErr("Nothing here");
   * assert.deepEqual(await y.ok(), None);
   * ```
   */
  public ok(): AsyncOption<T> {
    return new AsyncOption(this.then((result) => result.ok()))
  }

  /**
   * Converts from `AsyncResult<T, E>` to `AsyncOption<E>`.
   *
   * Converts a resolved `Err(error)` to `Some(error)`, discarding the success value, if any.
   * A resolved `Ok` becomes `None`.
   *
   * @example
   *
   * ```ts
   * const x: AsyncResult<number, string> = AsyncOk(2);
   * assert.deepEqual(await x.err(), None);
   *
   * const y: AsyncResult<number, string> = AsyncErr("Nothing here");
   * assert.deepEqual(await y.err(), Some("Nothing here"));
   * ```
   */
  public err(): AsyncOption<E> {
    return new AsyncOption(this.then((result) => result.err()))
  }

  /**
   * Calls `f` if the resolved result is `Ok`, otherwise preserves the original `Err`.
   *
   * This function can be used for control flow based on `Result` values.
   * The returned error type includes errors from both operations: `E | F`.
   *
   * @returns An `AsyncResult` containing the callback's result or the original `Err`.
   *
   * @example
   *
   * ```ts
   * function squareThenToString(x: number): Result<string, string> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString()).okOr("overflowed");
   * }
   *
   * const x = AsyncOk(2);
   * assert.deepEqual(await x.andThen(squareThenToString), Ok("4"));
   *
   * const y = AsyncOk(1_000_000);
   * assert.deepEqual(await y.andThen(squareThenToString), Err("overflowed"));
   *
   * const z = AsyncErr("not a number");
   * assert.deepEqual(await z.andThen(squareThenToString), Err("not a number"));
   * ```
   *
   * @example
   * Often used to chain fallible operations that may return `Err`.
   * Node's file metadata already contains the modification time.
   *
   * ```ts
   * const rootModifiedTime = await AsyncResult.fromPromise(stat("/"))
   *   .andThen((metadata) => Ok(metadata.mtime));
   * assert.equal(rootModifiedTime.isOk(), true);
   *
   * const shouldFail = await AsyncResult.fromPromise(stat("/bad/path"))
   *   .andThen((metadata) => Ok(metadata.mtime));
   * const error = shouldFail.expectErr("the nonexistent path should fail");
   * assert.equal("code" in error && error.code, "ENOENT");
   * ```
   */
  public andThen<U, F>(f: (value: T) => Result<U, F>): AsyncResult<U, E | F> {
    return new AsyncResult(this.then((result) => result.andThen((value) => f(value))))
  }

  /**
   * Calls and awaits `f` if the resolved result is `Ok`, otherwise preserves
   * the original `Err`.
   *
   * This function can be used for control flow based on `Result` values.
   * The returned error type includes errors from both operations: `E | F`.
   *
   * @returns An `AsyncResult` that awaits the callback's result for `Ok`.
   *
   * @example
   *
   * ```ts
   * async function squareThenToString(x: number): Promise<Result<string, string>> {
   *   // Use None if the square overflows the unsigned 32-bit range.
   *   const square: Option<number> =
   *     Number.isInteger(x) && x >= 0 && x * x <= 0xffff_ffff ? Some(x * x) : None;
   *   return square.map((value) => value.toString()).okOr("overflowed");
   * }
   *
   * const x = AsyncOk(2);
   * assert.deepEqual(await x.andThenAsync(squareThenToString), Ok("4"));
   *
   * const y = AsyncOk(1_000_000);
   * assert.deepEqual(await y.andThenAsync(squareThenToString), Err("overflowed"));
   *
   * const z = AsyncErr("not a number");
   * assert.deepEqual(await z.andThenAsync(squareThenToString), Err("not a number"));
   * ```
   *
   * @example
   * Chain a successful path lookup with an asynchronous metadata read.
   *
   * ```ts
   * const rootModifiedTime = await AsyncOk("/")
   *   .andThenAsync(async (path) => AsyncResult.fromPromise(stat(path)).map((metadata) => metadata.mtime));
   * assert.equal(rootModifiedTime.isOk(), true);
   *
   * const shouldFail = await AsyncOk("/bad/path")
   *   .andThenAsync(async (path) => AsyncResult.fromPromise(stat(path)).map((metadata) => metadata.mtime));
   * const error = shouldFail.expectErr("the nonexistent path should fail");
   * assert.equal("code" in error && error.code, "ENOENT");
   * ```
   */
  public andThenAsync<U, F>(f: (value: T) => Promise<Result<U, F>>): AsyncResult<U, E | F> {
    return new AsyncResult(this.then((result) => result.andThenAsync(async (value) => f(value))))
  }

  /**
   * Resolves to the contained `Ok` value.
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
   * @throws {Panic} Rejects when the result is `Err`, with the supplied message
   * and the error attached as `cause`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncErr("emergency failure");
   * await x.expect("Testing expect"); // Rejects with Panic("Testing expect").
   * ```
   *
   * @example
   * Recommended message style.
   *
   * ```ts
   * const path = await AsyncOption.fromNullish(process.env["IMPORTANT_PATH"])
   *   .okOr("IMPORTANT_PATH is missing")
   *   .expect("env variable IMPORTANT_PATH should be set by wrapper_script.sh");
   * ```
   */
  public async expect(message: string): Promise<T> {
    return (await this).expect(message)
  }

  /**
   * Resolves to the contained `Err` value.
   *
   * Use this mainly in tests or rare, explained assertions.
   *
   * @param message - Why the result should be `Err`.
   * @throws {Panic} Rejects when the result is `Ok`, with the supplied message
   * and the success value attached as `cause`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncOk(10);
   * await x.expectErr("Testing expectErr"); // Rejects with Panic("Testing expectErr"), cause: 10.
   * ```
   */
  public async expectErr(message: string): Promise<E> {
    return (await this).expectErr(message)
  }

  /**
   * Converts from `AsyncResult<Result<U, F>, E>` to `AsyncResult<U, E | F>`.
   *
   * Either outer or inner `Err` remains an `Err`; an outer `Ok(Ok(value))` becomes `Ok(value)`.
   *
   * @example
   *
   * ```ts
   * const x = AsyncOk(Ok("hello"));
   * assert.deepEqual(await x.flatten(), Ok("hello"));
   *
   * const y = AsyncOk(Err(6));
   * assert.deepEqual(await y.flatten(), Err(6));
   *
   * const z = AsyncErr<number, Result<string, number>>(6);
   * assert.deepEqual(await z.flatten(), Err(6));
   * ```
   *
   * @example
   * Flattening only removes one level of nesting at a time.
   *
   * ```ts
   * const x = AsyncOk(Ok(Ok("hello")));
   * assert.deepEqual(await x.flatten(), Ok(Ok("hello")));
   * assert.deepEqual(await x.flatten().flatten(), Ok("hello"));
   * ```
   */
  public flatten<U, F>(this: AsyncResult<Result<U, F>, E>): AsyncResult<U, E | F> {
    return new AsyncResult(this.then((result) => result.flatten()))
  }

  /**
   * Calls a function with the contained value if the resolved result is `Ok`.
   *
   * Resolves to the original result.
   *
   * @returns An `AsyncResult` containing the original result after inspection.
   *
   * @example
   *
   * ```ts
   * function parseNumber(text: string): Result<number, string> {
   *   const value = Number(text);
   *   return Number.isNaN(value) ? Err("not a number") : Ok(value);
   * }
   *
   * const parsed = AsyncOk("4").andThen(parseNumber);
   * const cubed = await parsed
   *   .inspect((value) => console.log(`original: ${value}`))
   *   .map((value) => value ** 3)
   *   .expect("input should be a number");
   * // Logs "original: 4"; cubed is 64.
   * ```
   */
  public inspect(f: (value: T) => void): AsyncResult<T, E> {
    return new AsyncResult(this.then((result) => result.inspect(f)))
  }

  /**
   * Calls an async function with the contained value if the resolved result is `Ok`.
   *
   * Resolves to a result with the original variant and value after the callback completes.
   *
   * @returns An `AsyncResult` that awaits inspection before continuing the chain.
   *
   * @example
   *
   * ```ts
   * function parseNumber(text: string): Result<number, string> {
   *   const value = Number(text);
   *   return Number.isNaN(value) ? Err("not a number") : Ok(value);
   * }
   *
   * const parsed = AsyncOk("4").andThen(parseNumber);
   * const cubed = await parsed
   *   .inspectAsync(async (value) => console.log(`original: ${value}`))
   *   .map((value) => value ** 3)
   *   .expect("input should be a number");
   * // Logs "original: 4"; cubed is 64 after inspection completes.
   * ```
   */
  public inspectAsync(f: (value: T) => Promise<void>): AsyncResult<T, E> {
    return new AsyncResult(this.then((result) => result.inspectAsync(f)))
  }

  /**
   * Calls a function with the contained error if the resolved result is `Err`.
   *
   * Resolves to the original result.
   *
   * @returns An `AsyncResult` containing the original result after inspection.
   *
   * @example
   *
   * ```ts
   * function read(): AsyncResult<string, Error> {
   *   return AsyncResult.fromPromise(readFile("address.txt", "utf8"))
   *     .inspectErr((error) => console.error(`failed to read file: ${error.message}`));
   * }
   * ```
   */
  public inspectErr(f: (error: E) => void): AsyncResult<T, E> {
    return new AsyncResult(this.then((result) => result.inspectErr(f)))
  }

  /**
   * Calls an async function with the contained error if the resolved result is `Err`.
   *
   * Resolves to a result with the original variant and value after the callback completes.
   *
   * @returns An `AsyncResult` that awaits inspection before continuing the chain.
   *
   * @example
   *
   * ```ts
   * function read(): AsyncResult<string, Error> {
   *   return AsyncResult.fromPromise(readFile("address.txt", "utf8"))
   *     .inspectErrAsync(async (error) => console.error(`failed to read file: ${error.message}`));
   * }
   * ```
   */
  public inspectErrAsync(f: (error: E) => Promise<void>): AsyncResult<T, E> {
    return new AsyncResult(this.then((result) => result.inspectErrAsync(f)))
  }

  /**
   * Maps an `AsyncResult<T, E>` to `AsyncResult<U, E>` by applying a function
   * to a contained `Ok` value, leaving an `Err` value untouched.
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
   *   const parsed = AsyncOk(line).andThen(parseNumber);
   *   const doubled = await parsed.map((value) => value * 2);
   *   if (doubled.isOk()) {
   *     console.log(doubled.unwrap()); // 2, 4, 6, 8
   *   }
   * }
   * ```
   */
  public map<U>(f: (value: T) => U): AsyncResult<U, E> {
    return new AsyncResult(this.then((result) => result.map(f)))
  }

  /**
   * Maps an `AsyncResult<T, E>` to `AsyncResult<U, E>` by applying an async function
   * to a contained `Ok` value, leaving an `Err` value untouched.
   *
   * This function can be used to compose the results of two functions.
   * The returned `AsyncResult` awaits the mapped value.
   *
   * @example
   *
   * ```ts
   * function parseNumber(line: string): Result<number, string> {
   *   const value = Number(line);
   *   return Number.isNaN(value) ? Err(`invalid number: ${line}`) : Ok(value);
   * }
   *
   * const lines = "1\n2\n3\n4\n";
   * for (const line of lines.trimEnd().split("\n")) {
   *   const parsed = AsyncOk(line).andThen(parseNumber);
   *   const doubled = await parsed.mapAsync(async (value) => value * 2);
   *   if (doubled.isOk()) {
   *     console.log(doubled.unwrap()); // 2, 4, 6, 8
   *   }
   * }
   * ```
   */
  public mapAsync<U>(f: (value: T) => Promise<U>): AsyncResult<U, E> {
    return new AsyncResult(this.then((result) => result.mapAsync(f)))
  }

  /**
   * Maps an `AsyncResult<T, E>` to `AsyncResult<T, F>` by applying a function
   * to a contained `Err` value, leaving an `Ok` value untouched.
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
   * const x: AsyncResult<number, number> = AsyncOk(2);
   * assert.deepEqual(await x.mapErr(stringify), Ok(2));
   *
   * const y: AsyncResult<number, number> = AsyncErr(13);
   * assert.deepEqual(await y.mapErr(stringify), Err("error code: 13"));
   * ```
   */
  public mapErr<F>(f: (error: E) => F): AsyncResult<T, F> {
    return new AsyncResult(this.then((result) => result.mapErr(f)))
  }

  /**
   * Maps an `AsyncResult<T, E>` to `AsyncResult<T, F>` by applying an async function
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
   * const x: AsyncResult<number, number> = AsyncOk(2);
   * assert.deepEqual(await x.mapErrAsync(stringify), Ok(2));
   *
   * const y: AsyncResult<number, number> = AsyncErr(13);
   * assert.deepEqual(await y.mapErrAsync(stringify), Err("error code: 13"));
   * ```
   */
  public mapErrAsync<F>(f: (error: E) => Promise<F>): AsyncResult<T, F> {
    return new AsyncResult(this.then((result) => result.mapErrAsync(f)))
  }

  /**
   * Resolves to the provided default (if `Err`), or applies a function to the
   * contained value (if `Ok`).
   *
   * Arguments passed to `mapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link mapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const x: AsyncResult<string, string> = AsyncOk("foo");
   * assert.equal(await x.mapOr(42, (v) => v.length), 3);
   *
   * const y: AsyncResult<string, string> = AsyncErr("bar");
   * assert.equal(await y.mapOr(42, (v) => v.length), 42);
   * ```
   */
  public async mapOr<A, B>(defaultValue: A, f: (value: T) => B): Promise<A | B> {
    return (await this).mapOr(defaultValue, f)
  }

  /**
   * Applies fallback function `defaultValue` to a contained `Err` value, or
   * function `f` to a contained `Ok` value, resolving to the callback's value.
   *
   * This function can be used to unpack a successful result while handling an error.
   * Only the callback for the current variant runs.
   *
   * @example
   *
   * ```ts
   * const k = 21;
   * const x: AsyncResult<string, string> = AsyncOk("foo");
   * assert.equal(await x.mapOrElse(() => k * 2, (v) => v.length), 3);
   *
   * const y: AsyncResult<string, string> = AsyncErr("bar");
   * assert.equal(await y.mapOrElse(() => k * 2, (v) => v.length), 42);
   * ```
   */
  public async mapOrElse<A, B>(defaultValue: (error: E) => A, f: (value: T) => B): Promise<A | B> {
    return (await this).mapOrElse(defaultValue, f)
  }

  /**
   * Calls `f` if the resolved result is `Err`, otherwise preserves the original `Ok`.
   *
   * This function can be used for control flow based on result values.
   *
   * Handles expected failures represented by `Err`. A rejected wrapped promise bypasses this callback.
   *
   * @example
   *
   * ```ts
   * function square(x: number): Result<number, number> {
   *   return Ok(x * x);
   * }
   *
   * function error(x: number): Result<number, number> {
   *   return Err(x);
   * }
   *
   * const x = AsyncOk<number, number>(2);
   * const y = AsyncErr<number, number>(3);
   * assert.deepEqual(await x.orElse(square).orElse(square), Ok(2));
   * assert.deepEqual(await x.orElse(error).orElse(square), Ok(2));
   * assert.deepEqual(await y.orElse(square).orElse(error), Ok(9));
   * assert.deepEqual(await y.orElse(error).orElse(error), Err(3));
   * ```
   */
  public orElse<U, F>(f: (error: E) => Result<U, F>): AsyncResult<T | U, F> {
    return new AsyncResult(this.then((thisResult) => thisResult.orElse((error) => f(error))))
  }

  /**
   * Calls and awaits `f` if the resolved result is `Err`, otherwise preserves
   * the original `Ok`.
   *
   * This function can be used for control flow based on result values.
   *
   * Handles expected failures represented by `Err`. A rejected wrapped promise bypasses this callback.
   *
   * @example
   *
   * ```ts
   * async function square(x: number): Promise<Result<number, number>> {
   *   return Ok(x * x);
   * }
   *
   * async function error(x: number): Promise<Result<number, number>> {
   *   return Err(x);
   * }
   *
   * const x = AsyncOk<number, number>(2);
   * const y = AsyncErr<number, number>(3);
   * assert.deepEqual(await x.orElseAsync(square).orElseAsync(square), Ok(2));
   * assert.deepEqual(await x.orElseAsync(error).orElseAsync(square), Ok(2));
   * assert.deepEqual(await y.orElseAsync(square).orElseAsync(error), Ok(9));
   * assert.deepEqual(await y.orElseAsync(error).orElseAsync(error), Err(3));
   * ```
   */
  public orElseAsync<U, F>(f: (error: E) => Promise<Result<U, F>>): AsyncResult<T | U, F> {
    return new AsyncResult(this.then((thisResult) => thisResult.orElseAsync(async (error) => f(error))))
  }

  /**
   * Resolves to the contained `Ok` value or a provided default.
   *
   * Arguments passed to `unwrapOr` are eagerly evaluated. If you are passing the
   * result of a function call, use {@link unwrapOrElse}, which is lazily evaluated.
   *
   * @example
   *
   * ```ts
   * const defaultValue = 2;
   * const x = AsyncOk(9);
   * assert.equal(await x.unwrapOr(defaultValue), 9);
   *
   * const y = AsyncErr("error");
   * assert.equal(await y.unwrapOr(defaultValue), defaultValue);
   * ```
   */
  public async unwrapOr<U>(defaultValue: U): Promise<T | U> {
    return (await this).unwrapOr(defaultValue)
  }

  /**
   * Resolves to the contained `Ok` value or computes it from a callback.
   *
   * The fallback runs only for `Err`.
   *
   * @example
   *
   * ```ts
   * function count(x: string): number {
   *   return x.length;
   * }
   *
   * const x = AsyncOk<number, string>(2);
   * assert.equal(await x.unwrapOrElse(count), 2);
   *
   * const y = AsyncErr<string, number>("foo");
   * assert.equal(await y.unwrapOrElse(count), 3);
   * ```
   */
  public async unwrapOrElse<U>(defaultValue: (error: E) => U): Promise<T | U> {
    return (await this).unwrapOrElse(defaultValue)
  }
}
