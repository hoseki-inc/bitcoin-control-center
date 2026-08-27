import { AsyncResult, Err, Ok } from '@patina/core'

export function AsyncOk<T>(value: T): AsyncResult<T, never> {
  return new AsyncResult(Promise.resolve(Ok(value)))
}

export function AsyncErr<E>(error: E): AsyncResult<never, E> {
  return new AsyncResult(Promise.resolve(Err(error)))
}
