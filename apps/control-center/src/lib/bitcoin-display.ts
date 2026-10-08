import { Decimal } from 'decimal.js'

/** Format a BTC balance with all 8 decimal places so amounts line up in columns. */
export function formatBitcoin(value: Decimal.Value): string {
  const [integer = '0', fraction = '00000000'] = new Decimal(value).toFixed(8).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction} BTC`
}
