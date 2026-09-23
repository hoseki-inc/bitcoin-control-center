import { Address, type DerivationPath, type Xpub, derivationPathSchema } from '@hoseki/packages/bitcoin'
import { HOSEKI_ASSETS_CDN_URL } from '@hoseki/packages/constants'
import { Err, Ok, Result, parseUnknown } from '@hoseki/packages/result'
import { bitcoinAddressString, bitcoinSinglesigAccountDescriptor } from '@hoseki/packages/schemas'
import { Slip132 } from '@hoseki/packages/wallet'
import { z } from 'zod'

const ColdcardBaseAccountSchema = z.object({
  xpub: Slip132.xpubStringSchema,
  deriv: derivationPathSchema,
})
export type ColdcardBaseAccount = z.infer<typeof ColdcardBaseAccountSchema>

const ColdcardSingleSigAccount = ColdcardBaseAccountSchema.extend({
  name: z.enum(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh']),
  desc: bitcoinSinglesigAccountDescriptor.optional(),
  first: bitcoinAddressString.optional(),
})
export type ColdcardSingleSigAccount = z.infer<typeof ColdcardSingleSigAccount>

const ColdcardMultiSigAccount = ColdcardBaseAccountSchema.extend({
  name: z.enum(['p2sh-p2wsh', 'p2wsh', 'p2sh']),
  desc: z.string().optional(), // we cannot parse a coldcard multisig account descriptor yet
})
export type ColdcardMultiSigAccount = z.infer<typeof ColdcardMultiSigAccount>

const ColdcardGenericJsonFileSchema = z.object({
  chain: z.literal('BTC'),
  account: z.number(),
  xpub: Slip132.xpubStringSchema,
  bip44: ColdcardSingleSigAccount,
  bip49: ColdcardSingleSigAccount.optional(),
  bip84: ColdcardSingleSigAccount.optional(),
  bip48_1: ColdcardMultiSigAccount.optional(),
  bip48_2: ColdcardMultiSigAccount.optional(),
  bip45: ColdcardMultiSigAccount.optional(),
})
export type ColdcardGenericJsonFile = z.infer<typeof ColdcardGenericJsonFileSchema>

export function parseGenericJsonFile(jsonFileContents: string): Result<ColdcardGenericJsonFile, Error> {
  return Result.fromThrowable((): unknown => JSON.parse(jsonFileContents)).andThen((parsed) =>
    parseUnknown(ColdcardGenericJsonFileSchema, parsed),
  )
}

export type ParsedSignatureFile = {
  message: string
  address: Address
  signature: string
}

export function parseSignatureFile(signedFileContents: string): Result<ParsedSignatureFile, Error> {
  const signedMessageLines = signedFileContents.split('\n')
  if (signedMessageLines.length < 5) {
    return Err(new Error('Invalid file contents'))
  }

  const message = signedMessageLines[1] ?? ''
  if (message.length === 0) {
    return Err(new Error('Invalid message'))
  }

  const addressStr = signedMessageLines[3] ?? ''
  const addressResult = Address.fromString(addressStr)
  if (addressResult.isErr()) {
    return Err(new Error('Invalid address'))
  }

  const signature = signedMessageLines[4] ?? ''
  if (signature.length === 0) {
    return Err(new Error('Invalid signature'))
  }

  return Ok({ message, address: addressResult.unwrap(), signature })
}

export const ColdcardModels = {
  'MK2/MK3': {
    name: 'MK2/MK3',
    imageSrc: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/coldcard-mk4.png`,
    imageAlt: 'Coldcard MK2/MK3',
  },
  MK4: {
    name: 'MK4',
    imageSrc: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/coldcard-mk4.png`,
    imageAlt: 'Coldcard MK4',
  },
  Q: {
    name: 'Q',
    imageSrc: `${HOSEKI_ASSETS_CDN_URL}/hardware-wallets/web-res/coldcard-q.png`,
    imageAlt: 'Coldcard Q',
  },
}

export type ColdcardModel = keyof typeof ColdcardModels
export const coldcardModelKeys = Object.keys(ColdcardModels).filter(isColdcardModel)
export function isColdcardModel(model: string): model is ColdcardModel {
  return Object.hasOwn(ColdcardModels, model)
}

/**
 * Extracts the Bitcoin xpub from a Coldcard export JSON based on the derivation path.
 *
 * @param derivationPath - The derivation path to match (e.g., "m/44h/0h/0h" or "m/44'/0'/0'")
 * @param coldcardJson - The parsed Coldcard JSON export data
 * @returns The Xpub for the matching derivation path
 * @returns Error if no xpub is found for the given derivation path
 *
 * @example
 * // For derivation path "m/44h/0h/0h" (BIP44), returns the xpub from bip44.xpub
 * // For derivation path "m/49h/0h/0h" (BIP49), returns the xpub from bip49.xpub
 * // For derivation path "m/84h/0h/0h" (BIP84), returns the xpub from bip84.xpub
 * // Also handles single quote notation: "m/44'/0'/0'" will match "m/44h/0h/0h"
 */
export function getBitcoinXpubFromColdcardExport(
  derivationPath: DerivationPath,
  coldcardJson: ColdcardGenericJsonFile,
): Result<Xpub, Error> {
  // Normalize the derivation path by replacing single quotes with 'h' for hardening
  const normalizedDerivationPath = derivationPath.toString().replace(/'/g, 'h')

  // Check all possible account types for a matching derivation path
  const accountTypes = [
    { key: 'bip44', account: coldcardJson.bip44 },
    { key: 'bip49', account: coldcardJson.bip49 },
    { key: 'bip84', account: coldcardJson.bip84 },
    { key: 'bip48_1', account: coldcardJson.bip48_1 },
    { key: 'bip48_2', account: coldcardJson.bip48_2 },
    { key: 'bip45', account: coldcardJson.bip45 },
  ]

  for (const { account } of accountTypes) {
    if (account) {
      const normalizedDeriv = account.deriv.toString().replace(/'/g, 'h')

      // Exact match
      if (normalizedDeriv === normalizedDerivationPath) {
        return Ok(account.xpub)
      }

      // Prefix match: the Coldcard export stores xpubs at the account level (e.g., m/45h)
      // but the multisig descriptor may specify a deeper origin (e.g., m/45h/0/0/0).
      // If the account path is a prefix, derive the remaining unhardened child indexes.
      if (normalizedDerivationPath.startsWith(normalizedDeriv + '/')) {
        const remainingPath = normalizedDerivationPath.slice(normalizedDeriv.length + 1)
        const childSteps = remainingPath.split('/')
        const hasHardenedChild = childSteps.some((s) => s.endsWith('h') || s.endsWith("'"))
        if (hasHardenedChild) {
          // Cannot derive hardened children from an xpub
          continue
        }

        let xpub = account.xpub
        for (const step of childSteps) {
          const index = parseInt(step, 10)
          if (isNaN(index)) {
            continue
          }
          xpub = xpub.derive(index)
        }
        return Ok(xpub)
      }
    }
  }

  // If no match is found, return an error
  return Err(new Error(`No xpub found for derivation path: ${derivationPath.toString()}`))
}
