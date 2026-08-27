export const SCRIPT_TYPE_TO_DERIVATION_PATH = {
  p2pkh: "m/44'", // Legacy
  'p2sh-p2wpkh': "m/49'", // Nested SegWit
  p2wpkh: "m/84'", // Native SegWit
  p2tr: "m/86'", // Taproot
} as const

export const DERIVATION_PATH_TO_SCRIPT_TYPE = {
  "m/44'": 'p2pkh', // Legacy
  "m/49'": 'p2sh-p2wpkh', // Nested SegWit
  "m/84'": 'p2wpkh', // Native SegWit
  "m/86'": 'p2tr', // Taproot
} as const
