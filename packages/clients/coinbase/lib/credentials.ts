import * as crypto from 'node:crypto'
import { Err, Ok, Result } from '@hoseki/packages/result'
import {
  CANONICAL_BASE64_PATTERN,
  cleanPastedText,
  extractAnyPem,
  hasPemBoundary,
  stripSingleUnpairedQuote,
} from './paste'

export interface AccessToken {
  variant: 'AccessToken'
  accessToken: string
}

export interface ApiKey {
  variant: 'ApiKey'
  key: string
  secret: string
}

export interface CdpKey {
  variant: 'CdpKey'
  name: string
  secret: string
}

export type Credentials = ApiKey | AccessToken | CdpKey

export type CdpSigningKey = {
  key: crypto.KeyObject
  alg: 'ES256' | 'EdDSA'
  normalizedSecret: string
}

export class CoinbaseKeyFormatError extends Error {
  public constructor(message: string) {
    super(message)
    this.name = 'CoinbaseKeyFormatError'
  }
}

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const ED25519_SPKI_PREFIX_LEN = 12

function decodeCanonicalBase64(value: string): Buffer | null {
  if (value.length === 0 || !CANONICAL_BASE64_PATTERN.test(value)) {
    return null
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    return null
  }
  return bytes
}

function parseEd25519Bytes(bytes: Buffer, normalizedSecret: string): Result<CdpSigningKey, CoinbaseKeyFormatError> {
  if (bytes.length !== 64) {
    return Err(new CoinbaseKeyFormatError('Invalid Ed25519 key length'))
  }
  const seed = bytes.subarray(0, 32)
  const expectedPublicKey = bytes.subarray(32, 64)
  const keyRes = Result.fromThrowable(() =>
    crypto.createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    }),
  )
  if (keyRes.isErr()) {
    return Err(new CoinbaseKeyFormatError('Invalid Ed25519 private key'))
  }
  const key = keyRes.value()
  const spkiRes = Result.fromThrowable(() => crypto.createPublicKey(key).export({ format: 'der', type: 'spki' }))
  if (spkiRes.isErr()) {
    return Err(new CoinbaseKeyFormatError('Invalid Ed25519 public key'))
  }
  const derivedPublicKey = spkiRes.value().subarray(ED25519_SPKI_PREFIX_LEN)
  if (derivedPublicKey.length !== 32 || !crypto.timingSafeEqual(derivedPublicKey, expectedPublicKey)) {
    return Err(new CoinbaseKeyFormatError('Invalid Ed25519 key pair'))
  }
  return Ok({ key, alg: 'EdDSA', normalizedSecret })
}

function parsePemSigningKey(cleaned: string): Result<CdpSigningKey, CoinbaseKeyFormatError> {
  const extracted = extractAnyPem(cleaned)
  if (extracted === null) {
    return Err(new CoinbaseKeyFormatError('Invalid PEM private key format'))
  }

  if (extracted.kind === 'ecdsa') {
    const keyRes = Result.fromThrowable(() => crypto.createPrivateKey(extracted.pem))
    if (keyRes.isErr()) {
      return Err(new CoinbaseKeyFormatError('Invalid EC private key'))
    }
    const key = keyRes.value()
    if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
      return Err(new CoinbaseKeyFormatError('Unsupported EC curve'))
    }
    return Ok({ key, alg: 'ES256', normalizedSecret: extracted.pem })
  }

  const keyRes = Result.fromThrowable(() => crypto.createPrivateKey(extracted.pem))
  if (keyRes.isErr()) {
    return Err(new CoinbaseKeyFormatError('Invalid PKCS#8 private key'))
  }
  const key = keyRes.value()
  if (key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1') {
    return Ok({ key, alg: 'ES256', normalizedSecret: extracted.pem })
  }
  if (key.asymmetricKeyType === 'ed25519') {
    return Ok({ key, alg: 'EdDSA', normalizedSecret: extracted.pem })
  }
  return Err(new CoinbaseKeyFormatError('Unsupported PKCS#8 private key algorithm'))
}

function isExportOrPemApiKey(value: string): boolean {
  return hasPemBoundary(value) || value.includes('"privateKey"') || value.includes('{') || value.includes('}')
}

function isInvalidCdpApiKey(value: string): boolean {
  return isExportOrPemApiKey(value) || value.includes('\n') || value.includes('\r')
}

export function parseCdpSigningKey(secret: string): Result<CdpSigningKey, CoinbaseKeyFormatError> {
  const cleaned = cleanPastedText(secret)
  if (hasPemBoundary(cleaned)) {
    return parsePemSigningKey(cleaned)
  }
  const bytes = decodeCanonicalBase64(cleaned)
  if (bytes?.length === 64) {
    return parseEd25519Bytes(bytes, cleaned)
  }
  const unquoted = stripSingleUnpairedQuote(cleaned)
  if (unquoted !== null) {
    const unquotedBytes = decodeCanonicalBase64(unquoted)
    if (unquotedBytes?.length === 64) {
      return parseEd25519Bytes(unquotedBytes, unquoted)
    }
  }
  return Err(new CoinbaseKeyFormatError('Unrecognized Coinbase CDP private key format'))
}

export function apiKeyCredentials(apiKey: string, secretKey: string): Result<ApiKey | CdpKey, CoinbaseKeyFormatError> {
  const cleanedApiKey = cleanPastedText(apiKey)
  if (isExportOrPemApiKey(cleanedApiKey)) {
    return Err(new CoinbaseKeyFormatError('Invalid Coinbase API key ID'))
  }

  const cleanedSecret = cleanPastedText(secretKey)
  if (hasPemBoundary(cleanedSecret)) {
    if (isInvalidCdpApiKey(cleanedApiKey)) {
      return Err(new CoinbaseKeyFormatError('Invalid Coinbase API key ID'))
    }
    return parsePemSigningKey(cleanedSecret).map((parsed) => ({
      variant: 'CdpKey',
      name: cleanedApiKey,
      secret: parsed.normalizedSecret,
    }))
  }

  const bytes = decodeCanonicalBase64(cleanedSecret)
  if (bytes?.length === 64) {
    if (isInvalidCdpApiKey(cleanedApiKey)) {
      return Err(new CoinbaseKeyFormatError('Invalid Coinbase API key ID'))
    }
    return parseEd25519Bytes(bytes, cleanedSecret).map((parsed) => ({
      variant: 'CdpKey',
      name: cleanedApiKey,
      secret: parsed.normalizedSecret,
    }))
  }

  const unquotedSecret = stripSingleUnpairedQuote(cleanedSecret)
  if (unquotedSecret !== null) {
    const unquotedBytes = decodeCanonicalBase64(unquotedSecret)
    if (unquotedBytes?.length === 64) {
      const edRes = parseEd25519Bytes(unquotedBytes, unquotedSecret)
      if (edRes.isOk()) {
        if (isInvalidCdpApiKey(cleanedApiKey)) {
          return Err(new CoinbaseKeyFormatError('Invalid Coinbase API key ID'))
        }
        return Ok({
          variant: 'CdpKey',
          name: cleanedApiKey,
          secret: edRes.value().normalizedSecret,
        })
      }
    }
  }

  return Ok({
    variant: 'ApiKey',
    key: apiKey,
    secret: secretKey,
  })
}
