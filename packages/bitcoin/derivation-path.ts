import { z } from 'zod'
import { type Result, parse } from '../result'

/**
 * Validates BIP32 derivation path format.
 *
 * Pattern breakdown:
 * - `^` - Start of string anchor
 * - `(m)` - Literal "m" prefix (master node, required)
 * - `(\/\d+['h]?)+` - One or more derivation steps, each consisting of:
 *   - `\/` - Forward slash separator
 *   - `\d+` - One or more digits (the derivation index)
 *   - `['h]?` - Optional hardened marker (either apostrophe `'` or `h`)
 * - `$` - End of string anchor
 *
 * Valid examples:
 * - `m/0` - Non-hardened step
 * - `m/0'` - Hardened step (apostrophe notation)
 * - `m/0h` - Hardened step (h notation)
 * - `m/44'/0'/0` - Standard BIP44 path
 * - `m/0/1/2'` - Multi-step path with mixed hardened/non-hardened
 *
 * Invalid examples:
 * - `0/1/2` - Missing "m" prefix
 * - `m/` - No derivation steps
 * - `m/0a` - Invalid character in index
 * - `m/0'/1h` - Mixed hardened notation (should be consistent)
 */
const regex = /^(m)(\/\d+['h]?)+$/
export const DerivationPathString = z
  .string()
  .refine((path) => regex.exec(path) !== null, {
    message: 'Invalid derivation path',
  })
  .brand('DerivationPathString')
export type DerivationPathString = z.infer<typeof DerivationPathString>

export interface DerivationStep {
  index: number
  hardened: boolean
}

/**
 * BIP32 derivation path. Always assumes root is the master node, `m` prefix is required.
 */
export class DerivationPath {
  public readonly steps: DerivationStep[]

  public constructor(steps: DerivationStep[]) {
    this.steps = steps
  }

  public static fromString(path: string): Result<DerivationPath, Error> {
    return parse(DerivationPathString, path).map((parsedPath) => DerivationPath.from(parsedPath))
  }

  public static from(path: DerivationPathString): DerivationPath {
    const steps = path
      .split('/')
      .slice(1)
      .map((step) => {
        const hardened = step.endsWith("'") || step.endsWith('h')
        const index = parseInt(hardened ? step.slice(0, -1) : step, 10)
        return { index, hardened }
      })
    return new DerivationPath(steps)
  }

  public toString(toApostropheNotation: boolean = false): DerivationPathString {
    const hardenedCharacter = toApostropheNotation ? "'" : 'h'
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Preserve constructor serialization, including legacy empty paths; external paths are validated by fromString.
    return `m/${this.steps.map((step) => `${step.index}${step.hardened ? hardenedCharacter : ''}`).join('/')}` as DerivationPathString
  }

  public toJSON(): DerivationPathString {
    return this.toString()
  }

  public [Symbol.for('nodejs.util.inspect.custom')](): string {
    return this.toString()
  }

  /**
   * Determines if a derivation path is standard according to BIP standards.
   *
   * Standard paths are defined in:
   * - BIP44 (Legacy singlesig): m/44'/0'/account'
   * - BIP49 (Nested SegWit singlesig): m/49'/0'/account'
   * - BIP84 (Native SegWit singlesig): m/84'/0'/account'
   * - BIP86 (Taproot singlesig): m/86'/0'/account'
   * - BIP45 (Legacy multisig): m/45'
   * - BIP48 (SegWit multisig): m/48'/0'/account'/script_type'
   *   where script_type is 1 for p2sh-p2wsh or 2 for p2wsh
   *
   * @returns true if the path conforms to BIP standards, false otherwise
   *
   * @example
   * m/49/0/1       // false - not hardened
   * m/49'/0'/1'    // true - standard BIP49
   * m/45'          // true - standard BIP45
   * m/48'/0'/0'/1' // true - standard BIP48 p2sh-p2wsh
   */
  public isStandardAccount(): boolean {
    const steps = this.steps

    // Empty path is non-standard
    if (steps.length === 0) {
      return false
    }

    const purpose = steps[0]
    if (!purpose) {
      return false
    }

    // Check for standard singlesig paths (BIP44, BIP49, BIP84, BIP86)
    // Pattern: m/purpose'/coin'/account'
    if (steps.length === 3) {
      const coin = steps[1]
      const account = steps[2]

      if (!coin || !account) {
        return false
      }

      // All three levels must be hardened for standard singlesig paths
      if (!purpose.hardened || !coin.hardened || !account.hardened) {
        return false
      }

      // Check if purpose matches a standard singlesig BIP
      const standardSinglesigPurposes = [44, 49, 84, 86]
      if (standardSinglesigPurposes.includes(purpose.index)) {
        // Coin type must be 0 (mainnet) or 1 (testnet)
        if (coin.index === 0 || coin.index === 1) {
          // Account can be any number >= 0
          if (account.index >= 0) {
            return true // Standard singlesig path
          }
        }
      }
    }

    // Check for BIP45 (Legacy multisig)
    // Pattern: m/45'
    if (steps.length === 1 && purpose.index === 45 && purpose.hardened) {
      return true // Standard BIP45 path
    }

    // Check for BIP48 (SegWit multisig)
    // Pattern: m/48'/coin'/account'/script_type'
    if (steps.length === 4 && purpose.index === 48 && purpose.hardened) {
      const coin = steps[1]
      const account = steps[2]
      const scriptType = steps[3]

      if (!coin || !account || !scriptType) {
        return false
      }

      // All levels must be hardened
      if (!coin.hardened || !account.hardened || !scriptType.hardened) {
        return false
      }

      // Coin type must be 0 (mainnet) or 1 (testnet)
      if (coin.index === 0 || coin.index === 1) {
        // Account can be any number >= 0
        if (account.index >= 0) {
          // Script type must be 1 (p2sh-p2wsh) or 2 (p2wsh)
          if (scriptType.index === 1 || scriptType.index === 2) {
            return true // Standard BIP48 path
          }
        }
      }
    }

    // If we get here, the path doesn't match any standard pattern
    return false
  }
}

export const derivationPathSchema = DerivationPathString.transform((path, ctx) => {
  const result = DerivationPath.fromString(path)
  if (result.isErr()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: result.unwrapErr().message,
    })
    return z.NEVER
  }
  return result.unwrap()
})
