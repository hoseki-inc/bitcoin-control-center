import { Decimal } from 'decimal.js'

export type BitcoinDisplayUnit = 'symbol' | 'sats' | 'btc'

export function bitcoinDisplayUnit(value: unknown): BitcoinDisplayUnit {
  return value === 'symbol' || value === 'sats' ? value : 'btc'
}

/** Input is always BTC; only presentation changes, never stored balances. */
export function formatBitcoin(value: Decimal.Value, unit: BitcoinDisplayUnit): string {
  const btc = new Decimal(value)
  const amount = unit === 'sats' ? btc.mul(100_000_000).toFixed(0) : btc.toFixed(8).replace(/\.?0+$/, '')
  const [integer = '0', fraction] = amount.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const number = `${grouped}${fraction ? `.${fraction}` : ''}`
  return unit === 'symbol' ? `₿ ${number}` : `${number} ${unit === 'sats' ? 'sats' : 'BTC'}`
}
