import { Err, Ok, type Result } from '@hoseki/packages/result'
import Decimal from 'decimal.js'

const validatedSatsBrand: unique symbol = Symbol('validatedSats')

export type ValidatedSats = string & { readonly [validatedSatsBrand]: true }

const STRICT_DECIMAL_REGEX = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const CANONICAL_SATS_REGEX = /^(?:0|[1-9][0-9]*)$/
const SIGNED_CANONICAL_SATS_REGEX = /^-?(?:0|[1-9][0-9]*)$/
const STORED_BALANCE_SATS_REGEX = /^\d+$/
const HEADER_SAFE_API_KEY_REGEX = /^[\t\x20-\x7e]+$/
const MAX_BTC_MAGNITUDE = new Decimal(21_000_000)
const SATS_PER_BTC = new Decimal(1e8)

export class InvalidProviderAmountError extends Error {
  public readonly tag = 'InvalidProviderAmount'

  public constructor() {
    super('Invalid provider amount')
    this.name = 'InvalidProviderAmountError'
  }
}

function isValidatedSats(value: string): value is ValidatedSats {
  return CANONICAL_SATS_REGEX.test(value)
}

function parseStrictBtcDecimal(raw: string): Result<Decimal, InvalidProviderAmountError> {
  if (!STRICT_DECIMAL_REGEX.test(raw)) {
    return Err(new InvalidProviderAmountError())
  }
  let value: Decimal
  try {
    value = new Decimal(raw)
  } catch {
    return Err(new InvalidProviderAmountError())
  }
  if (!value.isFinite() || value.abs().gt(MAX_BTC_MAGNITUDE)) {
    return Err(new InvalidProviderAmountError())
  }
  return Ok(value)
}

function decimalToSignedSatsBigInt(value: Decimal): Result<bigint, InvalidProviderAmountError> {
  if (value.isZero()) {
    return Ok(0n)
  }
  const formatted = value.mul(SATS_PER_BTC).toFixed(0, Decimal.ROUND_HALF_UP)
  const normalized = formatted === '-0' ? '0' : formatted
  if (!SIGNED_CANONICAL_SATS_REGEX.test(normalized)) {
    return Err(new InvalidProviderAmountError())
  }
  return Ok(BigInt(normalized))
}

export function parseBtcBalanceSats(raw: string): Result<ValidatedSats, InvalidProviderAmountError> {
  const parsed = parseStrictBtcDecimal(raw)
  if (parsed.isErr()) {
    return Err(parsed.unwrapErr())
  }
  const value = parsed.unwrap()
  if (value.lt(0)) {
    return Err(new InvalidProviderAmountError())
  }
  const formatted = value.isZero() ? '0' : value.mul(SATS_PER_BTC).toFixed(0, Decimal.ROUND_HALF_UP)
  const normalized = formatted === '-0' ? '0' : formatted
  if (!isValidatedSats(normalized)) {
    return Err(new InvalidProviderAmountError())
  }
  return Ok(normalized)
}

export const ZERO_VALIDATED_SATS: ValidatedSats = parseBtcBalanceSats('0').expect('0 is a valid satoshi amount')

export function parseSignedBtcAmountToSats(raw: string): Result<bigint, InvalidProviderAmountError> {
  const parsed = parseStrictBtcDecimal(raw)
  if (parsed.isErr()) {
    return Err(parsed.unwrapErr())
  }
  return decimalToSignedSatsBigInt(parsed.unwrap())
}

export function parseSignedBtcNetToSats(amount: string, fee: string): Result<bigint, InvalidProviderAmountError> {
  const amountParsed = parseStrictBtcDecimal(amount)
  if (amountParsed.isErr()) {
    return Err(amountParsed.unwrapErr())
  }
  const feeParsed = parseStrictBtcDecimal(fee)
  if (feeParsed.isErr()) {
    return Err(feeParsed.unwrapErr())
  }
  const net = amountParsed.unwrap().sub(feeParsed.unwrap())
  if (!net.isFinite() || net.abs().gt(MAX_BTC_MAGNITUDE)) {
    return Err(new InvalidProviderAmountError())
  }
  return decimalToSignedSatsBigInt(net)
}

export function parseStoredBalanceSats(raw: string | null): string | null {
  if (raw === null || !STORED_BALANCE_SATS_REGEX.test(raw)) {
    return null
  }
  return raw
}

export function isHeaderSafeApiKey(value: string): boolean {
  return value.length > 0 && HEADER_SAFE_API_KEY_REGEX.test(value)
}
