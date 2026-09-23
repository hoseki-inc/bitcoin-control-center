import type { Result } from '@hoseki/packages/result'
import { z } from 'zod'
import { parse } from '../result'
import type { DerivationPath, DerivationPathString } from './derivation-path'
import type { CheckedXpubString, Xpub } from './xpub'

/**
 * First 8 bytes of the SHA256 hash of the public key.
 * This is used to identify the key origin.
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki#key-identifiers
 */
export const keyFingerprintSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{8}$/)
  .brand('KeyFingerprint')
export type KeyFingerprint = z.infer<typeof keyFingerprintSchema>

export function KeyFingerprint(str: string): Result<KeyFingerprint, Error> {
  return parse(keyFingerprintSchema, str)
}

KeyFingerprint.DEFAULT = KeyFingerprint('00000000').expect('valid default fingerprint')

/**
 * Key origin information, consisting of:
 * - An open bracket [
 * - Exactly 8 hex characters for the fingerprint of the key where the derivation starts (see BIP 32 for details)
 * - Followed by zero or more /NUM or /NUMh path elements to indicate the unhardened or hardened derivation steps between the fingerprint and the key that follows.
 * - A closing bracket ]
 *
 * @see https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki#key-expressions
 */
export class KeyOrigin {
  public static from(fingerprint: KeyFingerprint, derivationPath: DerivationPath | null): KeyOrigin {
    return new KeyOrigin(fingerprint, derivationPath)
  }

  public readonly fingerprint: KeyFingerprint
  public readonly derivationPath: DerivationPath | null

  private constructor(fingerprint: KeyFingerprint, derivationPath: DerivationPath | null) {
    this.fingerprint = fingerprint
    this.derivationPath = derivationPath
  }

  private omitMasterNodeFromDerivationPath(derivationPath: DerivationPath) {
    return derivationPath.toString().substring(2)
  }

  /**
   * Returns a string representation of the keystore.
   * If derivation path is provided, output will be [derivation path]/xpub
   * If fingerprint is provided, output will be [fingerprint]/xpub
   * If both are provided, output will be [fingerprint/derivation path]/xpub
   */
  public toString(): string {
    let str = '[' + this.fingerprint
    if (this.derivationPath) {
      str += '/' + this.omitMasterNodeFromDerivationPath(this.derivationPath)
    }
    str += ']'
    return str
  }

  public toJSON(): {
    fingerprint: KeyFingerprint
    derivationPath: DerivationPathString | null
  } {
    return {
      fingerprint: this.fingerprint,
      derivationPath: this.derivationPath?.toString() ?? null,
    }
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}

/**
 * @see https://github.com/bitcoin/bips/blob/master/bip-0380.mediawiki#key-expressions
 */
export class KeyExpression {
  public static from(xpub: Xpub, keyOrigin: KeyOrigin | null): KeyExpression {
    return new KeyExpression(xpub, keyOrigin)
  }

  public readonly keyOrigin: KeyOrigin | null
  public readonly xpub: Xpub

  private constructor(xpub: Xpub, keyOrigin: KeyOrigin | null) {
    this.xpub = xpub
    this.keyOrigin = keyOrigin
  }

  public toString(): string {
    let str: string = this.xpub.toString()
    if (this.keyOrigin) {
      str = this.keyOrigin.toString() + str
    }
    return str
  }

  public toJSON(): {
    keyOrigin: ReturnType<typeof KeyOrigin.prototype.toJSON> | null
    xpub: CheckedXpubString
  } {
    return {
      keyOrigin: this.keyOrigin?.toJSON() ?? null,
      xpub: this.xpub.toString(),
    }
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }
}
