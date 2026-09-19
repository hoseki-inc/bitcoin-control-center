import { type AsyncResult, Result } from '../../result/index.ts'
import { SafeBodyError, SafeBodyErrorKind } from './errors.ts'

export class SafeBody {
  public constructor(private originalBody: Body) {}

  public get body(): ReadableStream<Uint8Array> | null {
    return this.originalBody.body
  }

  public get bodyUsed(): boolean {
    return this.originalBody.bodyUsed
  }

  public arrayBuffer(): AsyncResult<ArrayBuffer, SafeBodyError> {
    return Result.fromPromise(this.originalBody.arrayBuffer()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read ArrayBuffer body', error),
    )
  }

  public blob(): AsyncResult<Blob, SafeBodyError> {
    return Result.fromPromise(this.originalBody.blob()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read Blob body', error),
    )
  }

  public formData(): AsyncResult<FormData, SafeBodyError> {
    return Result.fromPromise(this.originalBody.formData()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read FormData body', error),
    )
  }

  public json<T, E extends Error>(parse: (json: unknown) => Result<T, E>): AsyncResult<T, SafeBodyError> {
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

  public text(): AsyncResult<string, SafeBodyError> {
    return Result.fromPromise(this.originalBody.text()).mapErr(
      (error) => new SafeBodyError(SafeBodyErrorKind.Unreadable, 'Failed to read text body', error),
    )
  }
}
