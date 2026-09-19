import { type KeyExpression, Wallet } from '../bitcoin'
import { MultisigDescriptorParser, type MultisigProps, SinglesigDescriptorParser } from '../bitcoin/descriptor_parsers'
import { getChecksum } from '../bitcoin/descriptor_utils'
import { Err, Ok, type Result } from '../result'
import { pubKeyRegex, toCoreXpubString } from './slip-132'

/**
 * WalletImporter provides validation for wallets imported from external sources
 * (e.g., user-provided descriptors, wallet exports from Casa, Sparrow, etc.).
 *
 * This validation ensures that imported wallets have sufficient derivation paths
 * for signing operations, which is required to use the wallet in Bitcoin Control Center.
 *
 * Note: This validation is NOT needed for internal wallet operations or when
 * working with wallets created within Bitcoin Control Center.
 */
export class WalletImporter {
  /**
   * Import and validate a singlesig wallet from a descriptor.
   * Validates that the keystore has a derivation path for signing operations.
   *
   * @param descriptor - The output descriptor string
   * @returns Result containing the Singlesig wallet or an error
   *
   * @example
   * ```typescript
   * const result = WalletImporter.singlesigFromDescriptor("wpkh([fingerprint/84'/0'/0']xpub.../<0;1>/*)")
   * if (result.isOk()) {
   *   const wallet = result.unwrap()
   *   // Use wallet for signing operations
   * }
   * ```
   */
  public static singlesigFromDescriptor(descriptor: string): Result<Wallet.Singlesig, Error> {
    // Process descriptor: validate checksum (if present), strip it, and normalize SLIP-132 keys
    const processedDescriptor = this.processDescriptor(descriptor)
    if (processedDescriptor.isErr()) {
      return Err(processedDescriptor.unwrapErr())
    }

    const result = SinglesigDescriptorParser.parse(processedDescriptor.unwrap())
    if (result.isErr()) {
      return Err(result.unwrapErr())
    }
    const singlesigProps = result.unwrap()

    // Validate derivation path exists for signing
    const validationResult = this.assertKeystoreHasDerivationPath(singlesigProps.keyExpression)
    if (validationResult.isErr()) {
      return Err(validationResult.unwrapErr())
    }

    return Ok(Wallet.Singlesig.from(singlesigProps))
  }

  /**
   * Import and validate a multisig wallet from a descriptor.
   * Validates that sufficient keystores have derivation paths for signing operations.
   *
   * @param descriptor - The output descriptor string
   * @returns Result containing the Multisig wallet or an error
   *
   * @example
   * ```typescript
   * const result = WalletImporter.multisigFromDescriptor("wsh(sortedmulti(2,[fp1/path]xpub1/<0;1>/*,[fp2/path]xpub2/<0;1>/*))")
   * if (result.isOk()) {
   *   const wallet = result.unwrap()
   *   // Use wallet for signing operations
   * }
   * ```
   */
  public static multisigFromDescriptor(descriptor: string): Result<Wallet.Multisig, Error> {
    // Process descriptor: validate checksum (if present), strip it, and normalize SLIP-132 keys
    const processedDescriptor = this.processDescriptor(descriptor)
    if (processedDescriptor.isErr()) {
      return Err(processedDescriptor.unwrapErr())
    }

    const result = MultisigDescriptorParser.parse(processedDescriptor.unwrap())
    if (result.isErr()) {
      return Err(result.unwrapErr())
    }
    const multisigProps = result.unwrap()

    // Validate sufficient derivation paths for signing
    const validationResult = this.assertSufficientDerivationPaths(multisigProps.threshold, multisigProps.keyExpressions)
    if (validationResult.isErr()) {
      return Err(validationResult.unwrapErr())
    }

    return Wallet.Multisig.from(multisigProps)
  }

  /**
   * Import and validate a multisig wallet from properties.
   * This is useful when constructing a wallet from parsed wallet export files
   * where you already have the individual components.
   *
   * Validates that sufficient keystores have derivation paths for signing operations.
   *
   * @param props - Multisig wallet properties
   * @returns Result containing the Multisig wallet or an error
   *
   * @example
   * ```typescript
   * const result = WalletImporter.multisigFromProps({
   *   scriptType: 'p2wsh',
   *   threshold: 2,
   *   isSorted: true,
   *   keyExpressions: [keyExpr1, keyExpr2, keyExpr3]
   * })
   * ```
   */
  public static multisigFromProps(props: MultisigProps): Result<Wallet.Multisig, Error> {
    // Validate sufficient derivation paths before creating wallet
    const validationResult = this.assertSufficientDerivationPaths(props.threshold, props.keyExpressions)
    if (validationResult.isErr()) {
      return Err(validationResult.unwrapErr())
    }

    // Create wallet using core wallet constructor
    return Wallet.Multisig.from(props)
  }

  /**
   * Process a descriptor by validating checksum (if present), stripping it, and normalizing SLIP-132 keys.
   *
   * This operation is necessary because:
   * - The `packages/bitcoin` descriptor parsers are core-only and only accept `xpub`/`tpub` format
   * - We need to validate checksums against the original descriptor before normalization, since
   *   normalizing SLIP-132 keys (ypub/Ypub/zpub/Zpub/upub/Upub/vpub/Vpub) to core format changes
   *   the descriptor content, which would invalidate the checksum
   * - This method serves as the boundary between wallet (which accepts SLIP-132) and bitcoin
   *   (which is core-only)
   *
   * @param descriptor - The original descriptor string (may contain checksum and SLIP-132 keys)
   * @returns Result containing the processed descriptor without checksum and with normalized keys
   */
  private static processDescriptor(descriptor: string): Result<string, Error> {
    const hashIndex = descriptor.indexOf('#')
    let processedDescriptor = descriptor

    // If checksum is present, validate it against the original descriptor
    if (hashIndex >= 0) {
      const bodyBeforeHash = descriptor.slice(0, hashIndex)
      const providedChecksum = descriptor.slice(hashIndex + 1)

      const computedChecksum = getChecksum(bodyBeforeHash)
      if (computedChecksum.isErr()) {
        return Err(new Error(`Failed to compute checksum: ${computedChecksum.unwrapErr().message}`))
      }

      if (computedChecksum.unwrap() !== providedChecksum) {
        return Err(
          new Error(`Invalid descriptor checksum: expected "${computedChecksum.unwrap()}", got "${providedChecksum}"`),
        )
      }

      // Strip checksum for further processing
      processedDescriptor = bodyBeforeHash
    }

    // Normalize SLIP-132 keys to core xpub/tpub format
    return this.normalizeSlip132KeysInDescriptor(processedDescriptor)
  }

  /**
   * Validate that a keystore has a derivation path for signing operations.
   */
  private static assertKeystoreHasDerivationPath(keyExpression: KeyExpression): Result<void, Error> {
    if (!keyExpression.keyOrigin?.derivationPath) {
      return Err(new Error('Cannot import wallet: keystore must have derivation path for signing'))
    }
    return Ok(undefined)
  }

  /**
   * Validate that sufficient keystores have derivation paths for signing.
   * For a multisig wallet with threshold M, at least M keystores must have derivation paths.
   *
   * @param threshold - The minimum number of signatures required
   * @param keyExpressions - All key expressions in the wallet
   * @returns Result indicating success or an error if validation fails
   */
  private static assertSufficientDerivationPaths(
    threshold: number,
    keyExpressions: KeyExpression[],
  ): Result<void, Error> {
    const withDerivationPath = keyExpressions.filter((ke) => Boolean(ke.keyOrigin?.derivationPath))

    if (withDerivationPath.length < threshold) {
      const countMessage =
        withDerivationPath.length === 0
          ? `none of ${keyExpressions.length} keystores have derivation paths`
          : `only ${withDerivationPath.length} of ${keyExpressions.length} keystores have derivation paths`
      return Err(new Error(`Cannot import wallet: ${countMessage} (minimum ${threshold} required for signing)`))
    }

    return Ok(undefined)
  }

  /**
   * Replace all occurrences of SLIP-132 extended pubkeys inside a descriptor with core `xpub`/`tpub` strings.
   * Strips any checksum suffix since the original checksum is invalid after normalization.
   *
   * @param descriptor - The descriptor string (checksum will be stripped if present)
   * @returns Result containing the normalized descriptor without checksum
   */
  private static normalizeSlip132KeysInDescriptor(descriptor: string): Result<string, Error> {
    const hashIndex = descriptor.indexOf('#')
    const body = hashIndex >= 0 ? descriptor.slice(0, hashIndex) : descriptor

    const re = new RegExp(pubKeyRegex.source, 'g')

    let out = ''
    let lastIndex = 0

    for (const match of body.matchAll(re)) {
      const matchedKey = match[0]
      const idx = match.index ?? -1
      if (idx < 0) {
        return Err(new Error('failed to locate xpub match index while normalizing descriptor'))
      }

      out += body.slice(lastIndex, idx)

      const converted = toCoreXpubString(matchedKey)
      if (converted.isErr()) {
        return Err(converted.unwrapErr())
      }
      out += converted.unwrap()

      lastIndex = idx + matchedKey.length
    }

    out += body.slice(lastIndex)

    return Ok(out)
  }
}
