import { ErrorWithTag } from '@hoseki/packages/result'
import { type SafeResponse } from '@hoseki/packages/safe-http'

export namespace ErrorKind {
  export function Unauthorized(response: SafeResponse): {
    readonly name: 'Unauthorized'
    readonly response: SafeResponse
  } {
    return {
      name: 'Unauthorized',
      response,
    } as const
  }

  export function UnexpectedFailure(args?: { error?: Error; response?: SafeResponse }): {
    readonly name: 'UnexpectedFailure'
    readonly error?: Error
    readonly response?: SafeResponse
  } {
    return {
      name: 'UnexpectedFailure',
      error: args?.error,
      response: args?.response,
    } as const
  }

  export function NetworkUnreachable(error: Error): {
    readonly name: 'NetworkUnreachable'
    readonly error: Error
  } {
    return {
      name: 'NetworkUnreachable',
      error,
    } as const
  }

  export function ResponseNotAcceptable(
    error: Error,
    response: SafeResponse,
  ): {
    readonly name: 'ResponseNotAcceptable'
    readonly error: Error
    readonly response: SafeResponse
  } {
    return {
      name: 'ResponseNotAcceptable',
      error,
      response,
    } as const
  }

  export function ErrorResponse<T>(
    data: T,
    response: SafeResponse,
  ): {
    readonly name: 'ErrorResponse'
    readonly data: T
    readonly response: SafeResponse
  } {
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

  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.kind = kind
  }
}
