import {
  DerivationPath,
  KeyExpression,
  KeyFingerprint,
  KeyOrigin,
  type Wallet,
  type Xpub,
} from '@hoseki/packages/bitcoin'
import { IndexMap } from '@hoseki/packages/collection'
import { Err, Ok, Result, parseUnknown } from '@hoseki/packages/result'
import { Slip132, WalletImporter } from '@hoseki/packages/wallet'
import { z } from 'zod'
import { browserLogger } from '../../logger'

type ParsedWalletExport = {
  label?: string // This might be a user-provided label, such as "Jimmy's Main Multisig Wallet"
  walletType?: string // This might be a clue about the wallet type, such as "Coldcard" or "BlueWallet"
  wallet: Wallet.Multisig
  keystoreMetadata: KeystoreMetadata[]
}
type KeystoreMetadata = {
  xpub: Xpub
  label: string // This might be a user-provided label, such as "Trezor (sticker)" - or we will make a label for them
  walletType?: string // This might be a clue about the key-signing device, such as "ledger" or "trezor"
}
type KeyExpressionWithMetadata = {
  keyExpression: KeyExpression
  metadata: {
    label: string
    walletType?: string
  }
}

export function parseWalletExport(jsonFileContents: string, fileType: string): Result<ParsedWalletExport, Error> {
  switch (fileType) {
    case 'application/json':
      return parseJsonWalletExport(jsonFileContents)
    case 'text/plain':
      return parseTxtWalletExport(jsonFileContents.split('\n'))
    default:
      return Err(new Error('Invalid file type'))
  }
}

function parseJsonWalletExport(jsonFileContents: string): Result<ParsedWalletExport, Error> {
  return Result.fromThrowable((): unknown => JSON.parse(jsonFileContents)).andThen((parsed) => {
    const specterDesktopResult = trySpecterDesktop(parsed)
    if (specterDesktopResult.isOk()) {
      return specterDesktopResult
    }

    const unchainedCaravanResult = tryUnchainedCaravan(parsed)
    if (unchainedCaravanResult.isOk()) {
      return unchainedCaravanResult
    }

    const electrumResult = tryElectrum(parsed)
    if (electrumResult.isOk()) {
      return electrumResult
    }

    return Err(new Error('Unknown wallet export format'))
  })
}

function parseTxtWalletExport(exportFileLines: string[] = []): Result<ParsedWalletExport, Error> {
  const bitcoinCoreResult = tryBitcoinCore(exportFileLines)
  if (bitcoinCoreResult.isOk()) {
    return bitcoinCoreResult
  }

  const genericMultisigResult = tryGenericMultisigSetup(exportFileLines)
  if (genericMultisigResult.isOk()) {
    return genericMultisigResult
  }

  const rawDescriptorResult = tryRawDescriptor(exportFileLines)
  if (rawDescriptorResult.isOk()) {
    return rawDescriptorResult
  }

  return Err(new Error('Unknown text wallet export format'))
}

//
// Bitcoin Core
//
function tryBitcoinCore(exportFileLines: string[]): Result<ParsedWalletExport, Error> {
  // Look for the descriptor line (after the comment)
  let descriptorLine: string | null = null
  let foundDescriptorComment = false

  for (const line of exportFileLines) {
    const trimmedLine = line.trim()

    // Check if this is the line which we expect to look like this:
    // # Receive and change descriptor (BIP389):
    if (trimmedLine.startsWith('#') && trimmedLine.includes('Receive and change descriptor')) {
      foundDescriptorComment = true
      continue
    }

    // If we found the descriptor comment and this line isn't empty or another comment this should be the descriptor
    if (foundDescriptorComment && trimmedLine && !trimmedLine.startsWith('#')) {
      descriptorLine = trimmedLine
      break
    }
  }

  if (!descriptorLine) {
    return Err(
      new Error(
        'No BIP389 descriptor found in file. Expected "# Receive and change descriptor (BIP389):" followed by a descriptor.',
      ),
    )
  }

  // Parse the descriptor using the existing wallet parser
  const multisigResult = WalletImporter.multisigFromDescriptor(descriptorLine)
  if (multisigResult.isErr()) {
    browserLogger.error(multisigResult.unwrapErr(), 'Error parsing Bitcoin Core descriptor')
    return Err(multisigResult.unwrapErr())
  }

  const multisigWallet = multisigResult.unwrap()

  // Extract keystore metadata from the parsed wallet file
  const keystoreMetadata: KeystoreMetadata[] = []
  for (const [i, keyExpression] of multisigWallet.keyExpressions.entries()) {
    keystoreMetadata.push({
      xpub: keyExpression.xpub,
      label: `Keystore ${i + 1}`,
    })
  }

  return Ok({
    walletType: 'Bitcoin Core',
    wallet: multisigWallet,
    keystoreMetadata,
  })
}

//
// Generic Multisig Setup (Coldcard, BlueWallet, etc.)
//
function tryGenericMultisigSetup(exportFileLines: string[]): Result<ParsedWalletExport, Error> {
  let name: string | null = null
  let policy: { threshold: number; total: number } | null = null
  let derivation: DerivationPath | null = null
  let format: string | null = null
  const keystores: Array<{ fingerprint: KeyFingerprint; xpub: Xpub }> = []

  // Parse the file line by line
  for (const line of exportFileLines) {
    const trimmedLine = line.trim()

    // Skip comments and empty lines
    if (trimmedLine.startsWith('#') || !trimmedLine) {
      continue
    }

    // Fail if a seed phrase is included
    if (trimmedLine.startsWith('seed:')) {
      return Err(new Error('Seed phrase found in wallet export file. Wrong file type.'))
    }

    // Parse key-value pairs
    if (trimmedLine.includes(':')) {
      const splitParts = trimmedLine.split(':')
      const key = splitParts[0]
      if (!key) {
        continue
      }

      const valueParts = splitParts.slice(1)
      const value = valueParts.join(':').trim()

      switch (key.trim()) {
        case 'Name':
          name = value
          break
        case 'Policy': {
          // Parse "2 of 2" format
          const policyMatch = /^(\d+)\s+of\s+(\d+)$/.exec(value)
          if (policyMatch?.[1] && policyMatch[2]) {
            policy = {
              threshold: parseInt(policyMatch[1], 10),
              total: parseInt(policyMatch[2], 10),
            }
          }
          break
        }
        case 'Derivation': {
          const derivationPathResult = DerivationPath.fromString(value)
          if (derivationPathResult.isErr()) {
            browserLogger.error(
              derivationPathResult.unwrapErr(),
              `Error parsing derivation path: ${String(derivation)}`,
            )
            return Err(derivationPathResult.unwrapErr())
          }
          derivation = derivationPathResult.unwrap()
          break
        }
        case 'Format':
          format = value
          break
        default: {
          // Check if this is a fingerprint:xpub pair
          const fingerprintResult = KeyFingerprint(key)
          const xpubResult = Slip132.getXpubFromString(value)

          if (fingerprintResult.isOk() && xpubResult.isOk()) {
            keystores.push({
              fingerprint: fingerprintResult.unwrap(),
              xpub: xpubResult.unwrap(),
            })
          }
          break
        }
      }
    }
  }

  // Validate required fields
  if (!name) {
    return Err(new Error('Missing Name field in wallet file'))
  }
  if (!policy) {
    return Err(new Error('Missing or invalid Policy field in wallet file'))
  }
  if (!derivation) {
    return Err(new Error('Missing Derivation field in wallet file'))
  }
  if (!format) {
    return Err(new Error('Missing Format field in wallet file'))
  }
  if (keystores.length !== policy.total) {
    return Err(new Error(`Expected ${policy.total} keystores but found ${keystores.length}`))
  }

  // Map format to script type
  let scriptType: 'p2sh' | 'p2sh-p2wsh' | 'p2wsh'
  switch (format) {
    case 'P2WSH-P2SH':
      scriptType = 'p2sh-p2wsh'
      break
    case 'P2WSH':
      scriptType = 'p2wsh'
      break
    case 'P2SH':
      scriptType = 'p2sh'
      break
    default:
      return Err(new Error(`Unsupported Coldcard format: ${format}`))
  }

  // Try to detect wallet type from comments for better labeling
  let walletType = 'Unknown'
  for (const line of exportFileLines) {
    const trimmedLine = line.trim()
    if (trimmedLine.startsWith('#') && trimmedLine.toLowerCase().includes('coldcard')) {
      walletType = 'Coldcard'
      break
    } else if (
      trimmedLine.startsWith('#') &&
      (trimmedLine.toLowerCase().includes('blue wallet') || trimmedLine.toLowerCase().includes('bluewallet'))
    ) {
      walletType = 'BlueWallet'
      break
    } else if (trimmedLine.startsWith('#') && trimmedLine.toLowerCase().includes('sparrow')) {
      walletType = 'Sparrow'
      break
    }
  }

  const walletResult = WalletImporter.multisigFromProps({
    scriptType,
    threshold: policy.threshold,
    isSorted: true, // TODO: How do we determine the actual value of this?
    keyExpressions: keystores.map((k) => KeyExpression.from(k.xpub, KeyOrigin.from(k.fingerprint, derivation))),
  })

  if (walletResult.isErr()) {
    browserLogger.error(walletResult.unwrapErr(), 'Error parsing generic multisig setup')
    return Err(walletResult.unwrapErr())
  }

  const wallet = walletResult.unwrap()

  return Ok({
    label: name,
    walletType,
    wallet,
    keystoreMetadata: wallet.keyExpressions.map((k, i) => ({
      xpub: k.xpub,
      keyOrigin: k.keyOrigin,
      label: `Keystore ${i + 1}`,
    })),
  })
}

//
// Raw Descriptor
//
function tryRawDescriptor(exportFileLines: string[]): Result<ParsedWalletExport, Error> {
  // Filter out empty lines and trim whitespace
  const nonEmptyLines = exportFileLines.map((line) => line.trim()).filter((line) => line)

  // Check if there's exactly one non-empty line that we can check for a descriptor
  if (nonEmptyLines.length !== 1) {
    return Err(new Error('Raw descriptor file must contain exactly one non-empty line'))
  }
  const descriptorLine = nonEmptyLines[0]
  if (!descriptorLine) {
    return Err(new Error('Descriptor line is empty'))
  }

  // Parse the descriptor using the existing wallet parser
  const multisigResult = WalletImporter.multisigFromDescriptor(descriptorLine)
  if (multisigResult.isErr()) {
    browserLogger.error(multisigResult.unwrapErr(), 'Error parsing raw descriptor')
    return Err(multisigResult.unwrapErr())
  }

  const multisigWallet = multisigResult.unwrap()

  // Extract keystore metadata from the parsed wallet file
  const keystoreMetadata: KeystoreMetadata[] = []
  for (const [i, keyExpression] of multisigWallet.keyExpressions.entries()) {
    keystoreMetadata.push({
      xpub: keyExpression.xpub,
      label: `Keystore ${i + 1}`,
    })
  }

  return Ok({
    wallet: multisigWallet,
    keystoreMetadata,
  })
}

//
// Specter Desktop
//
const SpecterDesktopJsonFileSchema = z
  .object({
    label: z.string(),
    blockheight: z.number(),
    descriptor: z.string(), // TODO: schema for multisig descriptor
  })
  .pick({
    label: true,
    descriptor: true,
  })

function trySpecterDesktop(parsedJson: unknown): Result<ParsedWalletExport, Error> {
  const jsonParseResult = parseUnknown(SpecterDesktopJsonFileSchema, parsedJson)
  if (jsonParseResult.isOk()) {
    const specterDesktopJson = jsonParseResult.unwrap()

    let multisigResult = WalletImporter.multisigFromDescriptor(specterDesktopJson.descriptor)
    if (multisigResult.isErr()) {
      // Try to fix the descriptor by adding missing /<0;1>/* suffix
      browserLogger.warn(multisigResult.unwrapErr(), 'Initial descriptor parsing failed, attempting to fix')

      const fixedDescriptorResult = fixBrokenDescriptor(specterDesktopJson.descriptor)
      if (fixedDescriptorResult.isErr()) {
        browserLogger.error(fixedDescriptorResult.unwrapErr(), 'Failed to fix broken descriptor')
        return Err(multisigResult.unwrapErr()) // Return original error
      }

      const fixedDescriptor = fixedDescriptorResult.unwrap()
      browserLogger.info(`Attempting to parse fixed descriptor: ${fixedDescriptor}`)

      const fixedMultisigResult = WalletImporter.multisigFromDescriptor(fixedDescriptor)
      if (fixedMultisigResult.isErr()) {
        browserLogger.error(fixedMultisigResult.unwrapErr(), 'Fixed descriptor also failed to parse')
        return Err(multisigResult.unwrapErr()) // Return original error
      }

      // Use the fixed result
      multisigResult = fixedMultisigResult
    }

    const multisigWallet = multisigResult.unwrap()

    const keystoreMetadata: KeystoreMetadata[] = []
    for (const [i, keyExpression] of multisigWallet.keyExpressions.entries()) {
      keystoreMetadata.push({
        xpub: keyExpression.xpub,
        label: `Keystore ${i + 1}`,
      })
    }

    return Ok({
      label: specterDesktopJson.label,
      walletType: 'Specter Desktop',
      wallet: multisigWallet,
      keystoreMetadata,
    })
  } else {
    browserLogger.error(jsonParseResult.unwrapErr(), 'Error parsing SpecterDesktopJsonFileSchema')
    return Err(jsonParseResult.unwrapErr())
  }
}

const xpubPattern = new RegExp(`(${Slip132.pubKeyRegex.source})(?!\\/<0;1>\\/\\*)`, 'g')

// Helper function to fix broken descriptors by adding missing /<0;1>/* suffix
function fixBrokenDescriptor(descriptor: string): Result<string, Error> {
  // Split the descriptor to remove the old checksum
  const [descriptorWithoutChecksum] = descriptor.split('#')
  if (!descriptorWithoutChecksum) {
    return Err(new Error('Invalid descriptor format'))
  }

  // Inject /<0;1>/* after each xpub using regex, if it doesn't already have it
  const fixedDescriptor = descriptorWithoutChecksum.replace(xpubPattern, '$1/<0;1>/*')

  return Ok(fixedDescriptor)
}

//
// Unchained Caravan
//
const UnchainedCaravanJsonFileSchema = z
  .object({
    name: z.string(),
    uuid: z.string().nullish(),
    addressType: z.enum(['P2SH', 'P2SH_P2WSH', 'P2WSH']),
    network: z.enum(['mainnet', 'testnet']),
    startingAddressIndex: z.number(),
    client: z
      .object({
        type: z.string(),
      })
      .nullish(),
    quorum: z.object({
      requiredSigners: z.number(),
      totalSigners: z.number(),
    }),
    extendedPublicKeys: z.array(
      z.object({
        name: z.string(),
        bip32Path: z.string(),
        xpub: z.string(),
        xfp: z.string(),
        method: z.string().nullish(),
      }),
    ),
  })
  .pick({
    addressType: true,
    extendedPublicKeys: true,
    name: true,
    quorum: true,
  })

function tryUnchainedCaravan(parsedJson: unknown): Result<ParsedWalletExport, Error> {
  const jsonParseResult = parseUnknown(UnchainedCaravanJsonFileSchema, parsedJson)

  if (jsonParseResult.isErr()) {
    browserLogger.error(jsonParseResult.unwrapErr(), 'Error parsing UnchainedCaravanJsonFileSchema')
    return Err(jsonParseResult.unwrapErr())
  }

  const caravanJson = jsonParseResult.unwrap()

  // Map addressType to scriptType
  const scriptTypeMap = {
    P2SH: 'p2sh' as const,
    P2SH_P2WSH: 'p2sh-p2wsh' as const,
    P2WSH: 'p2wsh' as const,
  }
  const scriptType = scriptTypeMap[caravanJson.addressType]

  const keystoresWithMeta = new IndexMap<Xpub, KeyExpressionWithMetadata>()

  for (const key of caravanJson.extendedPublicKeys) {
    const xpubResult = Slip132.getXpubFromString(key.xpub)
    if (xpubResult.isErr()) {
      browserLogger.error(xpubResult.unwrapErr(), `Error parsing xpub: ${key.xpub}`)
      return Err(xpubResult.unwrapErr())
    }

    const fingerprintResult = KeyFingerprint(key.xfp)
    if (fingerprintResult.isErr()) {
      browserLogger.error(fingerprintResult.unwrapErr(), `Error parsing fingerprint: ${key.xfp}`)
      return Err(fingerprintResult.unwrapErr())
    }

    const derivationPathResult = DerivationPath.fromString(key.bip32Path)
    if (derivationPathResult.isErr()) {
      browserLogger.error(derivationPathResult.unwrapErr(), `Error parsing derivation path: ${key.bip32Path}`)
      return Err(derivationPathResult.unwrapErr())
    }

    const xpub = xpubResult.unwrap()
    keystoresWithMeta.set(xpub, {
      keyExpression: KeyExpression.from(
        xpub,
        KeyOrigin.from(fingerprintResult.unwrap(), derivationPathResult.unwrap()),
      ),
      metadata: {
        label: key.name,
        walletType: key.method ?? undefined,
      },
    })
  }

  const walletResult = WalletImporter.multisigFromProps({
    scriptType,
    threshold: caravanJson.quorum.requiredSigners,
    isSorted: true, // TODO: How do we determine the actual value of this?
    keyExpressions: Array.from(keystoresWithMeta.values()).map((k) => k.keyExpression),
  })

  if (walletResult.isErr()) {
    browserLogger.error(walletResult.unwrapErr(), 'Error parsing Unchained Caravan wallet')
    return Err(walletResult.unwrapErr())
  }

  const wallet = walletResult.unwrap()

  return Ok({
    label: caravanJson.name,
    walletType: 'Unchained Caravan',
    wallet,
    keystoreMetadata: Array.from(keystoresWithMeta.values()).map((k) => ({
      xpub: k.keyExpression.xpub,
      label: k.metadata.label,
      walletType: k.metadata.walletType,
    })),
  })
}

//
// Electrum
//
const ElectrumKeystoreSchema = z.object({
  xpub: z.string(),
  hw_type: z.string(),
  root_fingerprint: z.string(),
  label: z.string(),
  type: z.string(),
  derivation: z.string(),
})
const ElectrumJsonFileSchema = z
  .object({
    wallet_type: z
      .string()
      .transform((val, ctx) => {
        const match = /^(\d+)of(\d+)$/.exec(val)
        if (!match?.[1] || !match[2]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Invalid wallet_type format: ${val}`,
          })
          return z.NEVER
        }
        return {
          threshold: match[1],
          totalSigners: match[2],
        }
      })
      .pipe(
        z.object({
          threshold: z.coerce.number(),
          totalSigners: z.coerce.number(),
        }),
      ),
    use_encryption: z.boolean(),
  })
  .catchall(z.unknown()) // Allow any other property type
  .transform((json) => {
    const { wallet_type, use_encryption, ...others } = json

    // Filter to find only valid keystores
    const keystores = Object.values(others).filter((value): value is z.infer<typeof ElectrumKeystoreSchema> => {
      try {
        ElectrumKeystoreSchema.parse(value)
        return true
      } catch {
        return false
      }
    })

    return { wallet_type, use_encryption, keystores }
  })

function tryElectrum(parsedJson: unknown): Result<ParsedWalletExport, Error> {
  const jsonParseResult = parseUnknown(ElectrumJsonFileSchema, parsedJson)
  if (jsonParseResult.isErr()) {
    browserLogger.error(jsonParseResult.unwrapErr(), 'Error parsing ElectrumJsonFileSchema')
    return Err(jsonParseResult.unwrapErr())
  }

  const electrumJson = jsonParseResult.unwrap()

  const { threshold, totalSigners } = electrumJson.wallet_type

  if (electrumJson.keystores.length !== totalSigners) {
    return Err(new Error(`Expected ${totalSigners} keystores but found ${electrumJson.keystores.length}`))
  }

  // Create a map of xpubs to their key expressions and metadata, which we use to construct
  // the wallet and also the metadata
  const keystoresWithMeta = new IndexMap<Xpub, KeyExpressionWithMetadata>()
  for (const keystore of electrumJson.keystores) {
    const xpubResult = Slip132.getXpubFromString(keystore.xpub)
    if (xpubResult.isErr()) {
      browserLogger.error(xpubResult.unwrapErr(), `Error parsing xpub: ${keystore.xpub}`)
      return Err(xpubResult.unwrapErr())
    }

    const derivationPathResult = DerivationPath.fromString(keystore.derivation)
    if (derivationPathResult.isErr()) {
      browserLogger.error(derivationPathResult.unwrapErr(), `Error parsing derivation path: ${keystore.derivation}`)
      return Err(derivationPathResult.unwrapErr())
    }

    const fingerprintResult = KeyFingerprint(keystore.root_fingerprint)
    if (fingerprintResult.isErr()) {
      browserLogger.error(fingerprintResult.unwrapErr(), `Error parsing fingerprint: ${keystore.root_fingerprint}`)
      return Err(fingerprintResult.unwrapErr())
    }

    const xpub = xpubResult.unwrap()

    keystoresWithMeta.set(xpub, {
      keyExpression: KeyExpression.from(
        xpub,
        KeyOrigin.from(fingerprintResult.unwrap(), derivationPathResult.unwrap()),
      ),
      metadata: {
        label: keystore.label,
        walletType: keystore.hw_type,
      },
    })
  }

  // Determine script type from the xpub prefix (Electrum uses SLIP-132 prefixes)
  const firstXpub = electrumJson.keystores[0]?.xpub ?? ''

  let scriptType: 'p2sh' | 'p2sh-p2wsh' | 'p2wsh'
  if (firstXpub.startsWith('Y') || firstXpub.startsWith('U')) {
    // P2SH-P2WSH (nested segwit)
    scriptType = 'p2sh-p2wsh'
  } else if (firstXpub.startsWith('Z') || firstXpub.startsWith('V')) {
    // P2WSH (native segwit)
    scriptType = 'p2wsh'
  } else {
    // Default to P2SH for standard xpubs
    scriptType = 'p2sh'
  }

  const walletResult = WalletImporter.multisigFromProps({
    scriptType,
    threshold,
    isSorted: true, // TODO: Assume it's sorted for now
    keyExpressions: Array.from(keystoresWithMeta.values()).map((k) => k.keyExpression),
  })

  if (walletResult.isErr()) {
    browserLogger.error(walletResult.unwrapErr(), 'Error parsing Unchained Caravan wallet')
    return Err(walletResult.unwrapErr())
  }

  const wallet = walletResult.unwrap()

  return Ok({
    walletType: 'Electrum',
    wallet,
    keystoreMetadata: Array.from(keystoresWithMeta.values()).map((k) => ({
      xpub: k.keyExpression.xpub,
      label: k.metadata.label,
      walletType: k.metadata.walletType,
    })),
  })
}
