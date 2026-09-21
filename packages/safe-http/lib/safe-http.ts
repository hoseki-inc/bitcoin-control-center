import { type AsyncResult, Err, Ok, Result } from '../../result/index.ts'
import { SafeHttpError, SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import type { Input, Options } from './types.ts'

export class SafeHttp {
  public constructor(public readonly options?: Options) {}

  public request(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    const request = new Request(input, { ...this.options, ...options })
    return Result.fromPromise(fetch(request))
      .mapErr(
        (error) =>
          new SafeHttpError({
            value: SafeHttpErrorKind.NetworkUnreachable,
            cause: error,
            message: 'Fetch failed',
          }),
      )
      .map((response) => new SafeResponse(response))
      .andThen((response) => {
        if (response.ok) {
          return Ok(response)
        }
        if (response.status === 404) {
          return Err(
            new SafeHttpError({
              value: SafeHttpErrorKind.NotFound,
              cause: response,
              message: 'Resource not found',
            }),
          )
        }
        return Err(
          new SafeHttpError({
            value: SafeHttpErrorKind.ErrorResponse,
            cause: response,
            message: 'Request failed',
          }),
        )
      })
  }

  public get(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'GET' })
  }

  public post(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'POST' })
  }

  public put(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'PUT' })
  }

  public patch(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'PATCH' })
  }

  public head(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'HEAD' })
  }

  public delete(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    return this.request(input, { ...options, method: 'DELETE' })
  }
}

export const safeHttp = new SafeHttp()
