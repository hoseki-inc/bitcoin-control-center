import type { AsyncResult } from '@patina/core'
import { catchUnwindAsync } from './panic'

/**
 * Converts an AsyncResult to a Promise.
 *
 * This is useful when using `Promise.all()` with an array of AsyncResults.
 *
 * Unfortunately `patina` library cannot handle combining Results into a single Result yet.
 */
export async function asyncResultToPromise<T, E>(asyncResult: AsyncResult<T, E>): Promise<T> {
  const result = await asyncResult
  if (result.isErr()) {
    throw result.unwrapErr()
  }
  return result.unwrap()
}

/**
 * Combines an array of AsyncResults into a single AsyncResult.
 */
export function asyncResultAll<T>(asyncResults: AsyncResult<T, Error>[]): AsyncResult<T[], Error> {
  return catchUnwindAsync(() => Promise.all(asyncResults.map(asyncResultToPromise)))
}
