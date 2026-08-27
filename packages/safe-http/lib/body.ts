import { type AsyncResult, Result } from '../../result/index.ts'
import { SafeBodyError, SafeBodyErrorKind } from './errors.ts'

export class SafeBody {
  constructor(private originalBody: Body) {}

  get body(): ReadableStream<Uint8Array> | null {
    return this.originalBody.body
  }

  get bodyUsed(): boolean {
    return this.originalBody.bodyUsed
  }

  arrayBuffer(): AsyncResult<ArrayBuffer, SafeBodyError> {
    return Result.fromPromise(this.originalBody.arrayBuffer()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read ArrayBuffer body', error),
    )
  }

  blob(): AsyncResult<Blob, SafeBodyError> {
    return Result.fromPromise(this.originalBody.blob()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read Blob body', error),
    )
  }

  formData(): AsyncResult<FormData, SafeBodyError> {
    return Result.fromPromise(this.originalBody.formData()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read FormData body', error),
    )
  }

  json<T, E extends Error>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parse: (json: any) => Result<T, E>,
  ): AsyncResult<T, SafeBodyError> {
    return Result.fromPromise(this.originalBody.json())
      .mapErr((error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read JSON body', error))
      .andThen(parse)
      .mapErr((error) => {
        if (error instanceof SafeBodyError) {
          return error
        }
        return new SafeBodyError(SafeBodyErrorKind.Malformed, 'Failed to parse JSON body', error)
      })
  }

  text(): AsyncResult<string, SafeBodyError> {
    return Result.fromPromise(this.originalBody.text()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read text body', error),
    )
  }
}
