import type { NetworkAccount, SingleSigAccount } from '../../bitcoin'

export const singlesigEncodings = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const
export type SingleSigEncoding = (typeof singlesigEncodings)[number]

export const labelsToEncodings: Record<string, SingleSigEncoding> = {
  'Legacy (P2PKH)': 'p2pkh',
  'Nested SegWit (P2SH)': 'p2sh-p2wpkh',
  'Native SegWit (P2WPKH)': 'p2wpkh',
  'Taproot (P2TR)': 'p2tr',
}

// Re-export from shared bitcoin package
export { SCRIPT_TYPE_LABELS as encodingsToLabels, formatScriptType } from '../../bitcoin/bitcoin_labels'

export type BitcoinInput = {
  variant: 'singlesig'
  data: NetworkAccount<SingleSigAccount>
  rawInput: string
  displayName: string
}

export const monoInputProps = {
  fontFamily: "'Geist Mono', monospace",
  fontSize: 12,
  _placeholder: {
    fontFamily: "'Geist Mono', monospace",
    fontSize: 12,
  },
}
