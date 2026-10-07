import { AsyncResult } from './async_result'
import { Panic } from './error'
import type { Err, Result } from './result'
import type { InferErr, InferOk } from './util'

function closeGenerator(
  iterator: Generator<Err<unknown, never>, Result<unknown, unknown>>,
  result: Result<unknown, unknown>,
): void {
  let returned = iterator.return(result)
  while (returned.done !== true) {
    returned = iterator.return(result)
  }
}

async function closeAsyncGenerator(
  iterator: AsyncGenerator<Err<unknown, never>, Result<unknown, unknown>>,
  result: Result<unknown, unknown>,
): Promise<void> {
  let returned = await iterator.return(result)
  while (returned.done !== true) {
    returned = await iterator.return(result)
  }
}

/**
 * Creates a scope where you can use `yield*` directly to unwrap or propagate errors from a `Result`.
 *
 * This is trying to emulate Rust's `try_blocks` and `?` operator.
 *
 * Synchronous blocks return a `Result`; asynchronous blocks return an `AsyncResult`.
 * A short-circuiting `Err` closes the generator before it is returned, so `finally` cleanup runs and cleanup failures propagate.
 *
 * @example
 *
 * ```ts
 * const block = tryBlock(function* () {
 * 	const x = yield* Ok(1);
 * 	const y = yield* Ok(1);
 * 	return Ok(x + y);
 * });
 *
 * assert.equal(block.unwrapOr(undefined), 2);
 * ```
 */
export function tryBlock<Y extends Err<unknown, never>, R extends Result<unknown, unknown>>(
  scope: () => Generator<Y, R>,
): Result<InferOk<R>, InferErr<Y> | InferErr<R>>

/**
 * Creates an async scope where you can use `yield*` directly to unwrap or propagate errors from a `Result` or `AsyncResult`.
 *
 * This is trying to emulate Rust's `try_blocks` and `?` operator.
 *
 * Any thrown `Error` will be wrapped in a `Panic`.
 * A short-circuiting `Err` closes the generator and awaits its cleanup before it is returned, so `finally` cleanup runs.
 *
 * @example
 *
 * ```ts
 * const asyncNumber = AsyncOk(1);
 * const promisedNumber = Promise.resolve(Ok(1));
 *
 * const block = await tryBlock(async function* () {
 * 	const x = yield* Ok(1);
 * 	const y = yield* asyncNumber;
 * 	const z = yield* await promisedNumber;
 * 	return Ok(x + y + z);
 * });
 *
 * assert.equal(block.unwrapOr(undefined), 3);
 * ```
 */
export function tryBlock<Y extends Err<unknown, never>, R extends Result<unknown, unknown>>(
  scope: () => AsyncGenerator<Y, R>,
): AsyncResult<InferOk<R>, InferErr<Y> | InferErr<R>>
export function tryBlock(
  scope: () =>
    | Generator<Err<unknown, never>, Result<unknown, unknown>>
    | AsyncGenerator<Err<unknown, never>, Result<unknown, unknown>>,
): Result<unknown, unknown> | AsyncResult<unknown, unknown> {
  const iterator = scope()
  if (Symbol.asyncIterator in iterator) {
    const next = iterator.next()
    return new AsyncResult(
      next
        .then(async (result) => {
          if (result.done !== true) {
            await closeAsyncGenerator(iterator, result.value)
          }
          return result.value
        })
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Promise rejection values are unknown until checked and wrapped as an invariant failure.
        .catch((error: unknown) => {
          if (error instanceof Panic) {
            throw error
          }
          throw new Panic('Unexpected rejected promise in `tryBlock`: resolve the promise safely instead of throwing', {
            cause: error,
          })
        }),
    )
  }
  const result = iterator.next()
  if (result.done !== true) {
    closeGenerator(iterator, result.value)
  }
  return result.value
}
