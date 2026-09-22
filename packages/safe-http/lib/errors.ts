import { ErrorWithCause, ErrorWithTag } from '../../result/index.ts'
import type { SafeResponse } from './response.ts'

export enum SafeBodyErrorKind {
  Malformed,
  Unreadable,
}

export class SafeBodyError extends ErrorWithCause<Error> {
  public readonly tag = 'SafeBodyError'
  public readonly kind: SafeBodyErrorKind

  public constructor(kind: SafeBodyErrorKind, message: string, cause: Error) {
    super(message, { cause })
    this.kind = kind
  }
}

export enum SafeHttpErrorKind {
  NotFound,
  NetworkUnreachable,
  ErrorResponse,
}

export type SafeHttpErrorKindVariant =
  | {
      value: SafeHttpErrorKind.ErrorResponse
      cause: SafeResponse
    }
  | {
      value: SafeHttpErrorKind.NetworkUnreachable
      cause: Error
    }
  | {
      value: SafeHttpErrorKind.NotFound
      cause: SafeResponse
    }

export class SafeHttpError extends ErrorWithTag {
  public readonly tag = 'SafeHttpError'
  public readonly kind: SafeHttpErrorKindVariant

  public constructor(options: SafeHttpErrorKindVariant & { message: string }) {
    const { message, ...kind } = options
    super(message)
    this.kind = kind
  }
}
