import { Err, Ok, type Result } from '@hoseki/packages/result'
import {
  EXCHANGE_DISPLAY_NAMES,
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  ExchangeUserError,
  type SupportedExchange,
} from './provider-errors'

const verifiedReconnectBrand: unique symbol = Symbol('verifiedReconnect')

export type CredentialMetadataChange = { credentialsRevoked: true } | { portfolioUuid: string }

export interface VerifiedReconnectIdentity {
  readonly [verifiedReconnectBrand]: 'replacement'
  readonly accountId: string
  readonly provider: SupportedExchange
  readonly existingExternalAccountId: string | null
  readonly nextExternalAccountId: string | null
  readonly nextPortfolioUuid: string | undefined
}

export interface ReconnectReplacementPayload {
  readonly displayName: string
  readonly encryptedCredentials: string
  readonly balanceSats: string
  readonly balanceAsOf: string
  readonly credentialsConnectedAt: string
}

export type VerifiedReconnect =
  | (VerifiedReconnectIdentity & {
      readonly kind: 'replacement'
      readonly payload: ReconnectReplacementPayload
    })
  | {
      readonly [verifiedReconnectBrand]: 'metadata'
      readonly kind: 'metadata'
      readonly accountId: string
      readonly previousCredentials: string
      readonly change: CredentialMetadataChange
    }

export interface ReconnectIdentityInput {
  accountId: string
  provider: SupportedExchange
  existingExternalAccountId: string | null | undefined
  existingPortfolioUuid: string | undefined
  incomingExternalAccountId: string | null | undefined
  incomingPortfolioUuid: string | undefined
}

function nonEmpty(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export function normalizeKrakenAccountId(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined
  }
  const normalized = value.replace(/\s+/g, '').toUpperCase()
  return normalized === '' ? undefined : normalized
}

export function verifyReconnectIdentity(
  input: ReconnectIdentityInput,
): Result<VerifiedReconnectIdentity, ExchangeUserError> {
  const existingExternalRaw = nonEmpty(input.existingExternalAccountId)
  const incomingExternalRaw = nonEmpty(input.incomingExternalAccountId)
  const existingPortfolioUuid = nonEmpty(input.existingPortfolioUuid)
  const incomingPortfolioUuid = nonEmpty(input.incomingPortfolioUuid)

  if (input.provider === 'strike') {
    return Ok({
      [verifiedReconnectBrand]: 'replacement',
      accountId: input.accountId,
      provider: input.provider,
      existingExternalAccountId: input.existingExternalAccountId ?? null,
      nextExternalAccountId: null,
      nextPortfolioUuid: existingPortfolioUuid ?? incomingPortfolioUuid,
    })
  }

  const existingNormalized =
    input.provider === 'kraken' ? normalizeKrakenAccountId(existingExternalRaw) : existingExternalRaw
  const incomingNormalized =
    input.provider === 'kraken' ? normalizeKrakenAccountId(incomingExternalRaw) : incomingExternalRaw

  let matchedIdentity = false
  if (existingNormalized !== undefined) {
    if (incomingNormalized === undefined) {
      return Err(
        new ExchangeUserError(
          `Cannot reconnect ${EXCHANGE_DISPLAY_NAMES[input.provider]} account without an account ID`,
          'BAD_REQUEST',
        ),
      )
    }
    if (existingNormalized !== incomingNormalized) {
      return Err(new ExchangeAccountMismatchError(input.provider))
    }
    matchedIdentity = true
  }

  if (input.provider === 'coinbase' && existingPortfolioUuid !== undefined) {
    if (incomingPortfolioUuid !== undefined) {
      if (existingPortfolioUuid !== incomingPortfolioUuid) {
        return Err(new ExchangeAccountMismatchError('coinbase'))
      }
      matchedIdentity = true
    } else if (!matchedIdentity) {
      return Err(new ExchangeAccountUnverifiableError('coinbase'))
    }
  }

  if (!matchedIdentity) {
    return Err(new ExchangeAccountUnverifiableError(input.provider))
  }

  return Ok({
    [verifiedReconnectBrand]: 'replacement',
    accountId: input.accountId,
    provider: input.provider,
    existingExternalAccountId: input.existingExternalAccountId ?? null,
    nextExternalAccountId: existingExternalRaw ?? incomingExternalRaw ?? null,
    nextPortfolioUuid: existingPortfolioUuid ?? incomingPortfolioUuid,
  })
}

export function createReconnectReplacement(
  identity: VerifiedReconnectIdentity,
  payload: ReconnectReplacementPayload,
): VerifiedReconnect {
  return { ...identity, kind: 'replacement', payload }
}

export function createCredentialMetadataChange(input: {
  accountId: string
  previousCredentials: string
  change: CredentialMetadataChange
}): VerifiedReconnect {
  return {
    [verifiedReconnectBrand]: 'metadata',
    kind: 'metadata',
    accountId: input.accountId,
    previousCredentials: input.previousCredentials,
    change: input.change,
  }
}
