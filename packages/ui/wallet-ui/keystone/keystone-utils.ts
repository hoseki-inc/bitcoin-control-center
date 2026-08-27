import { DerivationPath, Xpub } from '@hoseki/packages/bitcoin'
import { Err, Ok, Result, parseUnknown } from '@hoseki/packages/result'
import { Slip132 } from '@hoseki/packages/wallet'
import { CryptoAccount, URRegistryDecoder } from '@keystonehq/bc-ur-registry'
import { z } from 'zod'

// JSON format (for future multisig support or richer exports)
const KeystoneExportJsonSchema = z
  .object({
    xpub: Slip132.xpubStringSchema,
  })
  .passthrough()

/**
 * Keystone export data.
 * - Single-sig: device displays a raw zpub string.
 * - Multisig: device displays a UR:CRYPTO-ACCOUNT QR containing xpub + derivation path.
 */
export interface KeystoneExportFile {
  xpub: Xpub
  derivationPath: DerivationPath | null
  masterFingerprint: string | null
}

/**
 * Infers the BIP derivation path from a SLIP-132 prefix character.
 * zpub → BIP84, ypub → BIP49, xpub → BIP44.
 */
function inferDerivationPathFromPrefix(prefix: string): DerivationPath | null {
  switch (prefix) {
    case 'z':
    case 'v':
      return new DerivationPath([
        { index: 84, hardened: true },
        { index: 0, hardened: true },
        { index: 0, hardened: true },
      ])
    case 'y':
    case 'u':
      return new DerivationPath([
        { index: 49, hardened: true },
        { index: 0, hardened: true },
        { index: 0, hardened: true },
      ])
    case 'x':
    case 't':
      return new DerivationPath([
        { index: 44, hardened: true },
        { index: 0, hardened: true },
        { index: 0, hardened: true },
      ])
    default:
      return null
  }
}

/**
 * Parses a UR:CRYPTO-ACCOUNT string from a Keystone device (multisig export).
 * Extracts the first output descriptor's xpub, derivation path, and master fingerprint.
 */
function parseUrCryptoAccount(urString: string): Result<KeystoneExportFile, Error> {
  return Result.fromThrowable(() => {
    const decoder = new URRegistryDecoder()
    decoder.receivePart(urString.toLowerCase())

    if (!decoder.isComplete()) {
      throw new Error('UR data is incomplete (multi-part QR not fully scanned)')
    }
    if (!decoder.isSuccess()) {
      throw new Error('UR decoding failed')
    }

    const ur = decoder.resultUR()
    const cryptoAccount = CryptoAccount.fromCBOR(ur.cbor)

    const masterFingerprint = cryptoAccount.getMasterFingerprint().toString('hex').toLowerCase()
    const descriptors = cryptoAccount.getOutputDescriptors()

    if (descriptors.length === 0) {
      throw new Error('No output descriptors found in UR:CRYPTO-ACCOUNT')
    }

    // Use the first descriptor (Keystone typically exports one per QR)
    const descriptor = descriptors[0]
    if (!descriptor) {
      throw new Error('No output descriptors found in UR:CRYPTO-ACCOUNT')
    }
    const hdKey = descriptor.getHDKey()
    if (!hdKey) {
      throw new Error('No HD key found in output descriptor')
    }

    const xpubString = hdKey.getBip32Key()
    const xpubResult = Xpub.fromString(xpubString)
    if (xpubResult.isErr()) {
      throw new Error(`Invalid xpub in UR data: ${xpubResult.unwrapErr().message}`)
    }

    let derivationPath: DerivationPath | null = null
    const origin = hdKey.getOrigin()
    if (origin) {
      const pathStr = origin.getPath()
      if (pathStr) {
        const parsed = DerivationPath.fromString(`m/${pathStr}`)
        if (parsed.isOk()) {
          derivationPath = parsed.unwrap()
        }
      }
    }

    return {
      xpub: xpubResult.unwrap(),
      derivationPath,
      masterFingerprint,
    }
  })
}

/**
 * Parses a Keystone wallet export. Accepts:
 * - A raw xpub/zpub/ypub string (single-sig QR format)
 * - A UR:CRYPTO-ACCOUNT string (multisig QR format)
 * - A JSON object with an `xpub` field (fallback)
 */
export function parseKeystoneExport(input: string): Result<KeystoneExportFile, Error> {
  const trimmed = input.trim()

  // Try UR:CRYPTO-ACCOUNT format (multisig)
  if (trimmed.toUpperCase().startsWith('UR:CRYPTO-ACCOUNT/')) {
    return parseUrCryptoAccount(trimmed)
  }

  // Try as a raw xpub/zpub string (single-sig QR format)
  const xpubResult = Slip132.getXpubFromString(trimmed)
  if (xpubResult.isOk()) {
    const prefix = trimmed[0] ?? ''
    return Ok({
      xpub: xpubResult.unwrap(),
      derivationPath: inferDerivationPathFromPrefix(prefix),
      masterFingerprint: null,
    })
  }

  // Fall back to JSON parsing
  return Result.fromThrowable(() => JSON.parse(trimmed) as unknown)
    .andThen((parsed) => parseUnknown(KeystoneExportJsonSchema, parsed))
    .map((json) => ({ ...json, derivationPath: null, masterFingerprint: null }))
}

/**
 * Extracts the Bitcoin xpub from a Keystone export.
 */
export function getBitcoinXpubFromKeystoneExport(
  _derivationPath: DerivationPath,
  keystoneExport: KeystoneExportFile,
): Result<Xpub, Error> {
  if (keystoneExport.xpub) {
    return Ok(keystoneExport.xpub)
  }
  return Err(new Error('No xpub found in Keystone export'))
}
