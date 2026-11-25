import { Coinbase } from '@hoseki/packages/clients/coinbase'
import { Kraken } from '@hoseki/packages/clients/kraken'
import { RobinhoodApiError } from '@hoseki/packages/clients/robinhood'
import { StrikeApiError } from './strike'

export type SupportedExchange = 'coinbase' | 'strike' | 'robinhood' | 'kraken'

export type ExchangeErrorCode =
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'PRECONDITION_FAILED'
  | 'NOT_FOUND'
  | 'INTERNAL_SERVER_ERROR'

export const EXCHANGE_DISPLAY_NAMES: Record<SupportedExchange, string> = {
  coinbase: 'Coinbase',
  kraken: 'Kraken',
  robinhood: 'Robinhood',
  strike: 'Strike',
}

export class ExchangeUserError extends Error {
  public readonly code: ExchangeErrorCode

  public constructor(message: string, code: ExchangeErrorCode = 'BAD_REQUEST') {
    super(message)
    this.name = 'ExchangeUserError'
    this.code = code
  }
}

export class ExchangeAccountMismatchError extends ExchangeUserError {
  public readonly tag = 'ExchangeAccountMismatch'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(`This key belongs to a different ${EXCHANGE_DISPLAY_NAMES[provider]} account.`, 'CONFLICT')
    this.name = 'ExchangeAccountMismatchError'
    this.provider = provider
  }
}

export class RobinhoodAccountUnverifiableError extends ExchangeUserError {
  public readonly tag = 'RobinhoodAccountUnverifiable'

  public constructor() {
    super(
      "We couldn't confirm which Robinhood account this key belongs to. Turn on 'Read crypto accounts' for the key (or create a new key with it on) and try again.",
      'BAD_REQUEST',
    )
    this.name = 'RobinhoodAccountUnverifiableError'
  }
}

export class ExchangeAccountUnverifiableError extends ExchangeUserError {
  public readonly tag = 'ExchangeAccountUnverifiable'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(
      `Couldn't confirm which ${EXCHANGE_DISPLAY_NAMES[provider]} account this reconnect belongs to. Connect it as a new account instead.`,
      'PRECONDITION_FAILED',
    )
    this.name = 'ExchangeAccountUnverifiableError'
    this.provider = provider
  }
}

export class ExchangeVerificationRetryableError extends ExchangeUserError {
  public readonly tag = 'ExchangeVerificationRetryable'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(
      `Couldn't verify your existing ${EXCHANGE_DISPLAY_NAMES[provider]} account right now. Please try again.`,
      'INTERNAL_SERVER_ERROR',
    )
    this.name = 'ExchangeVerificationRetryableError'
    this.provider = provider
  }
}

export class ExchangeCredentialsRevokedError extends ExchangeUserError {
  public readonly tag = 'ExchangeCredentialsRevoked'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(
      `Your ${EXCHANGE_DISPLAY_NAMES[provider]} API key was rejected. Reconnect your account.`,
      'PRECONDITION_FAILED',
    )
    this.name = 'ExchangeCredentialsRevokedError'
    this.provider = provider
  }
}

export class ExchangeRefreshTimeoutError extends ExchangeUserError {
  public readonly tag = 'ExchangeRefreshTimeout'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(
      `Couldn't refresh your ${EXCHANGE_DISPLAY_NAMES[provider]} balance right now. Please try again.`,
      'INTERNAL_SERVER_ERROR',
    )
    this.name = 'ExchangeRefreshTimeoutError'
    this.provider = provider
  }
}

export class ExchangeHistoryIncompleteError extends ExchangeUserError {
  public readonly tag = 'ExchangeHistoryIncomplete'
  public readonly provider: SupportedExchange

  public constructor(provider: SupportedExchange) {
    super(
      `Couldn't load the full transaction history from ${EXCHANGE_DISPLAY_NAMES[provider]}.`,
      'INTERNAL_SERVER_ERROR',
    )
    this.name = 'ExchangeHistoryIncompleteError'
    this.provider = provider
  }
}

export type ProviderFailureKind = 'revoked' | 'permission_denied' | 'transient'

export interface SafeProviderFailureMetadata {
  provider: SupportedExchange
  errorKind: string
  status?: number
}

export function classifyProviderFailure(provider: SupportedExchange, err: Error): ProviderFailureKind {
  if (provider === 'coinbase') {
    if (err instanceof Coinbase.ApiError && err.kind.name === 'Unauthorized') {
      if (err.kind.response.status === 401) {
        return 'revoked'
      }
      if (err.kind.response.status === 403) {
        return 'permission_denied'
      }
    }
    return 'transient'
  }
  if (provider === 'kraken') {
    if (err instanceof Kraken.ApiError) {
      if (err.kind.name === 'Unauthorized') {
        if (err.kind.response.status === 401) {
          return 'revoked'
        }
        if (err.kind.response.status === 403) {
          return 'permission_denied'
        }
      }
      if (err.kind.name === 'ErrorResponse' && err.kind.response.status === 200) {
        if (err.kind.errors.some((code) => code === 'EAPI:Invalid key' || code.startsWith('EAPI:Invalid key:'))) {
          return 'revoked'
        }
        if (
          err.kind.errors.some(
            (code) => code === 'EGeneral:Permission denied' || code.startsWith('EGeneral:Permission denied:'),
          )
        ) {
          return 'permission_denied'
        }
      }
    }
    return 'transient'
  }
  if (provider === 'robinhood') {
    if (err instanceof RobinhoodApiError) {
      if (err.status === 401) {
        return 'revoked'
      }
      if (err.status === 403) {
        return 'permission_denied'
      }
    }
    return 'transient'
  }
  if (err instanceof StrikeApiError) {
    if (err.status === 401) {
      return 'revoked'
    }
    if (err.status === 403) {
      return 'permission_denied'
    }
  }
  return 'transient'
}

export function describeSafeProviderFailure(provider: SupportedExchange, err: Error): SafeProviderFailureMetadata {
  if (err instanceof Coinbase.ApiError) {
    const status = 'response' in err.kind ? err.kind.response?.status : undefined
    return { provider, errorKind: err.kind.name, status }
  }
  if (err instanceof Kraken.ApiError) {
    const status = 'response' in err.kind ? err.kind.response?.status : undefined
    return { provider, errorKind: err.kind.name, status }
  }
  if (err instanceof RobinhoodApiError) {
    return { provider, errorKind: 'RobinhoodApiError', status: err.status }
  }
  if (err instanceof StrikeApiError) {
    return { provider, errorKind: 'StrikeApiError', status: err.status }
  }
  return { provider, errorKind: err.name || 'Error' }
}
