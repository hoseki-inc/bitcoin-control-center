import { AsyncResult } from './core/async_result'
import { parseError } from './core/error'
import { Err, Ok, type Result } from './core/result'

/**
 * Converts an AsyncResult to a Promise.
 *
 * This is useful when using `Promise.all()` with an array of AsyncResults.
 *
 * The core implementation cannot combine Results into a single Result yet.
 * Error payloads reject unchanged; other payloads reject with a TypeError retaining the original cause.
 */
export async function asyncResultToPromise<T, E>(asyncResult: AsyncResult<T, E>): Promise<T> {
  const result = await asyncResult
  if (result.isErr()) {
    throw parseError(result.unwrapErr())
  }
  return result.unwrap()
}

/**
 * Combines an array of AsyncResults into a single AsyncResult.
 * Resolves on the first settled Err without waiting for remaining inputs, preserving its typed payload.
 * Successful values retain input order; unexpected promise rejections propagate as rejections.
 */
export function asyncResultAll<T, E>(asyncResults: AsyncResult<T, E>[]): AsyncResult<T[], E> {
  return new AsyncResult(
    new Promise<Result<T[], E>>((resolve, reject) => {
      const pending = asyncResults.map(async (pendingResult) => {
        const result = await pendingResult
        if (result.isErr()) {
          resolve(Err(result.unwrapErr()))
        }
        return result
      })
      void Promise.all(pending).then((results) => {
        const values: T[] = []
        for (const result of results) {
          if (result.isErr()) {
            return
          }
          values.push(result.unwrap())
        }
        resolve(Ok(values))
      }, reject)
    }),
  )
}
