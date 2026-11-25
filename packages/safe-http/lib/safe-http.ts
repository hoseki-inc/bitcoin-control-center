import { type AsyncResult, Err, Ok, Result } from '../../result/index.ts'
import { SafeHttpError, SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import type { Input, Options } from './types.ts'

const REQUEST_TIMEOUT_MS = 30_000

export class SafeHttp {
  private readonly defaults?: Options

  public constructor(options?: Options) {
    this.defaults = options
  }

  public get options(): Options {
    return { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...this.defaults }
  }

  public request(input: Input, options?: Options): AsyncResult<SafeResponse, SafeHttpError> {
    const init: Options = { ...this.defaults, ...options }
    if (init.signal === undefined) {
      init.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
    // Pass input and init directly to fetch rather than wrapping in an intermediate Request:
    // in Node/undici, an unreferenced Request can be GC'd with its dependent AbortSignal,
    // breaking timeout and caller abort propagation.
    return Result.fromPromise(fetch(input, init))
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
