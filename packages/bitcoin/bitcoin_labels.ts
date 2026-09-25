import type { MultiSigAccountScriptType, SingleSigAccountScriptType } from './account_props'

/**
 * Human-readable labels for Bitcoin script types
 * Used across the application for displaying script types to users
 */
export const SCRIPT_TYPE_LABELS: Record<SingleSigAccountScriptType | MultiSigAccountScriptType, string> = {
  // Single-sig script types
  p2pkh: 'Legacy (P2PKH)',
  'p2sh-p2wpkh': 'Nested SegWit (P2SH)',
  p2wpkh: 'Native SegWit (P2WPKH)',
  p2tr: 'Taproot (P2TR)',
  // Multisig script types
  p2sh: 'Legacy (P2SH)',
  'p2sh-p2wsh': 'Nested SegWit (P2SH-P2WSH)',
  p2wsh: 'Native SegWit (P2WSH)',
} as const

/**
 * Format a script type into a user-friendly label
 *
 * @param scriptType - The script type to format
 * @returns A human-readable label for the script type
 *
 * @example
 * ```typescript
 * formatScriptType('p2wpkh') // 'Native SegWit (P2WPKH)'
 * formatScriptType('p2sh-p2wsh') // 'Nested SegWit (P2SH-P2WSH)'
 * ```
 */
export function formatScriptType(scriptType: SingleSigAccountScriptType | MultiSigAccountScriptType): string {
  return SCRIPT_TYPE_LABELS[scriptType]
}
