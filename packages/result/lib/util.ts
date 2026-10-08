import { AsyncOption } from './core/async_option'
import { AsyncResult } from './core/async_result'
import { None, Some } from './core/option'
import { Err, Ok } from './core/result'

/**
 * Creates an `AsyncResult` containing `Ok(value)`.
 *
 * The value is stored unchanged, including when it is a promise. Use
 * `AsyncResult.fromPromise` to await a promise and convert rejection to `Err`.
 *
 * @example
 *
 * ```ts
 * const result = AsyncOk(2).map((value) => value * 2);
 * await result; // Ok(4)
 * ```
 */
export function AsyncOk<T, E = never>(value: T): AsyncResult<T, E> {
  return new AsyncResult(Promise.resolve(Ok(value)))
}

/**
 * Creates an `AsyncResult` containing `Err(error)`.
 *
 * The error is stored unchanged. This creates a fulfilled result, not a rejected promise.
 *
 * @example
 *
 * ```ts
 * const result = AsyncErr("missing").orElse(() => Ok(2));
 * await result; // Ok(2)
 * ```
 */
export function AsyncErr<E, T = never>(error: E): AsyncResult<T, E> {
  return new AsyncResult(Promise.resolve(Err(error)))
}

/**
 * Creates an `AsyncOption` containing `Some(value)`.
 *
 * The value is stored unchanged, even when it is nullish or a promise. Use
 * `AsyncOption.fromNullish` to await a value and convert `null` or `undefined` to `None`.
 *
 * @example
 *
 * ```ts
 * const option = AsyncSome(2).map((value) => value * 2);
 * await option; // Some(4)
 * ```
 */
export function AsyncSome<T>(value: T): AsyncOption<T> {
  return new AsyncOption(Promise.resolve(Some(value)))
}

/**
 * Creates an `AsyncOption` containing `None`.
 *
 * @example
 *
 * ```ts
 * const option = AsyncNone<number>().orElse(() => Some(2));
 * await option; // Some(2)
 * ```
 */
export function AsyncNone<T = never>(): AsyncOption<T> {
  return new AsyncOption(Promise.resolve(None))
}
