import { AsyncResult, Err, Ok, type Result } from '@patina/core'

function getErrorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unexpected thrown value'
}

function unknownToError(e: unknown): Error {
  return e instanceof Error ? e : new Error(getErrorMessage(e), { cause: e })
}

/**
 * Wraps a function in a Result and catches any thrown error, even Panics, emulating Rust's `catch_unwind`.
 */
export function catchUnwind<T>(fn: () => T): Result<T, Error> {
  try {
    return Ok(fn())
  } catch (e) {
    return Err(unknownToError(e))
  }
}

/**
 * Wraps a function in an AsyncResult and catches any thrown error, even Panics, emulating Rust's `catch_unwind`.
 */
export function catchUnwindAsync<T>(fn: () => Promise<T>): AsyncResult<T, Error> {
  return new AsyncResult(
    fn()
      .then((value) => {
        return Ok(value)
      })
      .catch((e: unknown) => {
        return Err(unknownToError(e))
      }),
  )
}
