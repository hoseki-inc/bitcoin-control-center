/**
 * Brand marks drawn in black disappear on dark glass. Vector marks have white variants
 * next to them (`*-dark.svg`); monochrome raster marks are drawn white with a filter.
 * Coloured marks (Coinbase, Kraken) read on both and stay as they are.
 */
const DARK_VARIANTS: Record<string, string> = {
  'hardware-wallets/trezor.svg': '/images/hardware-wallets/trezor-dark.svg',
  'hardware-wallets/ledger.svg': '/images/hardware-wallets/ledger-dark.svg',
  'hardware-wallets/coldcard.svg': '/images/hardware-wallets/coldcard-dark.svg',
  'hardware-wallets/keystone-logo.svg': '/images/hardware-wallets/keystone-logo-dark.svg',
  'exchanges/strike-logo.svg': '/images/exchanges/strike-logo-dark.svg',
}

const MONOCHROME_RASTER = ['exchanges/robinhood-lockup.png']

export function logoForMode(path: string, mode: 'light' | 'dark'): { src: string; filter?: string } {
  if (mode === 'light') {
    return { src: path }
  }
  // Match on the file's own path so CDN-hosted copies of the same mark are covered too.
  const variant = Object.entries(DARK_VARIANTS).find(([suffix]) => path.endsWith(suffix))
  if (variant !== undefined) {
    return { src: variant[1] }
  }
  if (MONOCHROME_RASTER.some((suffix) => path.endsWith(suffix))) {
    return { src: path, filter: 'brightness(0) invert(1)' }
  }
  return { src: path }
}
