import { ErrorWithTag } from '@hoseki/packages/result'
import { type SafeResponse } from '@hoseki/packages/safe-http'

export namespace ApiErrorKind {
  export type NetworkUnreachable = { readonly name: 'NetworkUnreachable'; readonly error: Error }
  export function NetworkUnreachable(error: Error): NetworkUnreachable {
    return {
      name: 'NetworkUnreachable',
      error,
    } as const
  }

  export type Unauthorized = { readonly name: 'Unauthorized'; readonly response: SafeResponse }
  export function Unauthorized(response: SafeResponse): Unauthorized {
    return {
      name: 'Unauthorized',
      response,
    } as const
  }

  export type ErrorResponse = {
    readonly name: 'ErrorResponse'
    readonly errors: string[]
    readonly response: SafeResponse
  }
  export function ErrorResponse(errors: string[], response: SafeResponse): ErrorResponse {
    return {
      name: 'ErrorResponse',
      errors,
      response,
    } as const
  }

  export type ResponseNotAcceptable = {
    readonly name: 'ResponseNotAcceptable'
    readonly error: Error
    readonly response: SafeResponse
  }
  export function ResponseNotAcceptable(error: Error, response: SafeResponse): ResponseNotAcceptable {
    return {
      name: 'ResponseNotAcceptable',
      error,
      response,
    } as const
  }

  export type UnexpectedFailure = {
    readonly name: 'UnexpectedFailure'
    readonly error: Error | undefined
    readonly response: SafeResponse | undefined
  }
  export function UnexpectedFailure(input?: { error?: Error; response?: SafeResponse }): UnexpectedFailure {
    return {
      name: 'UnexpectedFailure',
      error: input?.error,
      response: input?.response,
    } as const
  }

  export type InvalidCredentials = { readonly name: 'InvalidCredentials'; readonly message: string }
  export function InvalidCredentials(message: string): InvalidCredentials {
    return {
      name: 'InvalidCredentials',
      message,
    } as const
  }

  export type ValidationError = { readonly name: 'ValidationError'; readonly error: Error }
  export function ValidationError(error: Error): ValidationError {
    return {
      name: 'ValidationError',
      error,
    } as const
  }
}

export type ApiErrorKindVariant = ReturnType<(typeof ApiErrorKind)[keyof typeof ApiErrorKind]>

export class ApiError extends ErrorWithTag {
  public readonly tag = 'KrakenError'
  public readonly kind: ApiErrorKindVariant

  constructor(kind: ApiErrorKindVariant, message: string) {
    super(message)
    this.kind = kind
  }
}
