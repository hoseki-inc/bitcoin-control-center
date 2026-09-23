import type { AsyncResult } from '@hoseki/packages/result'
import { catchUnwindAsync } from './panic'

/**
 * Converts an AsyncResult to a Promise.
 *
 * This is useful when using `Promise.all()` with an array of AsyncResults.
 *
 * Unfortunately `patina` library cannot handle combining Results into a single Result yet.
 */
export async function asyncResultToPromise<T>(asyncResult: AsyncResult<T, Error>): Promise<T> {
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
  return catchUnwindAsync(async () => Promise.all(asyncResults.map(asyncResultToPromise)))
}
