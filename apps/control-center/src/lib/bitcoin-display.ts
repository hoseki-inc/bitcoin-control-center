import { Decimal } from 'decimal.js'

/** Format a BTC balance without changing its stored denomination. */
export function formatBitcoin(value: Decimal.Value): string {
  const amount = new Decimal(value).toFixed(8).replace(/\.?0+$/, '')
  const [integer = '0', fraction] = amount.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}${fraction ? `.${fraction}` : ''} BTC`
}
