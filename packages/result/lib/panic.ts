import { AsyncResult, Err, Ok, type Result } from '@hoseki/packages/result'

function getErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Unexpected thrown value'
}

function unknownToError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(getErrorMessage(cause), { cause })
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
      .catch((cause: unknown) => {
        return Err(unknownToError(cause))
      }),
  )
}
