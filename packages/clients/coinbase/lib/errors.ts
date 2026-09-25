import { ErrorWithTag } from '@hoseki/packages/result'
import type { SafeResponse } from '@hoseki/packages/safe-http'

export type UnauthorizedErrorKind = {
  readonly name: 'Unauthorized'
  readonly response: SafeResponse
}

export type UnexpectedFailureErrorKind = {
  readonly name: 'UnexpectedFailure'
  readonly error?: Error
  readonly response?: SafeResponse
}

export type NetworkUnreachableErrorKind = {
  readonly name: 'NetworkUnreachable'
  readonly error: Error
}

export type ResponseNotAcceptableErrorKind = {
  readonly name: 'ResponseNotAcceptable'
  readonly error: Error
  readonly response: SafeResponse
}

export type ResponseErrorKind<T> = {
  readonly name: 'ErrorResponse'
  readonly data: T
  readonly response: SafeResponse
}

export namespace ErrorKind {
  export function Unauthorized(response: SafeResponse): UnauthorizedErrorKind {
    return {
      name: 'Unauthorized',
      response,
    } as const
  }

  export function UnexpectedFailure(args?: { error?: Error; response?: SafeResponse }): UnexpectedFailureErrorKind {
    return {
      name: 'UnexpectedFailure',
      error: args?.error,
      response: args?.response,
    } as const
  }

  export function NetworkUnreachable(error: Error): NetworkUnreachableErrorKind {
    return {
      name: 'NetworkUnreachable',
      error,
    } as const
  }

  export function ResponseNotAcceptable(error: Error, response: SafeResponse): ResponseNotAcceptableErrorKind {
    return {
      name: 'ResponseNotAcceptable',
      error,
      response,
    } as const
  }

  export function ErrorResponse<T>(data: T, response: SafeResponse): ResponseErrorKind<T> {
    return {
      name: 'ErrorResponse',
      data,
      response,
    } as const
  }
}

export type ErrorKind = ReturnType<(typeof ErrorKind)[keyof typeof ErrorKind]>

export class ApiError extends ErrorWithTag {
  public readonly tag = 'CoinbaseError'
  public readonly kind: ErrorKind

  public constructor(kind: ErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}
