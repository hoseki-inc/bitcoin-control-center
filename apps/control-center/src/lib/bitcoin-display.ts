import { Decimal } from 'decimal.js'

/** Format a BTC balance with all 8 decimal places so amounts line up in columns. */
export function formatBitcoin(value: Decimal.Value): string {
  return `${formatBitcoinNumber(value)} BTC`
}

/** A BTC amount without its unit ("0.21543450"), for a smaller "BTC" set beside it. */
export function formatBitcoinNumber(value: Decimal.Value): string {
  const [integer = '0', fraction = '00000000'] = new Decimal(value).toFixed(8).split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${grouped}.${fraction}`
}

/**
 * A signed BTC amount without its unit ("+0.21543450", "−0.01000000"). The sign
 * follows the amount as shown, so anything under half a satoshi reads as an unsigned 0.
 */
export function formatSignedBitcoinNumber(value: Decimal.Value): string {
  const shown = new Decimal(value).toDecimalPlaces(8, Decimal.ROUND_HALF_UP)
  const sign = shown.isZero() ? '' : shown.isNegative() ? '\u2212' : '+'
  return `${sign}${formatBitcoinNumber(shown.abs())}`
}

/** Whether a price can convert BTC to USD. */
export function isUsableBtcPrice(price: number | null): price is number {
  return price !== null && Number.isFinite(price) && price > 0
}

/**
 * USD at the given price, signed like the BTC it describes ("+$1,234.56", "−$0.50");
 * empty when there is no usable price. Gains and losses round alike, and an amount
 * too small to show in cents has no sign.
 */
export function formatSignedUsd(btc: Decimal.Value, btcPrice: number | null): string {
  if (!isUsableBtcPrice(btcPrice)) {
    return ''
  }
  const usd = new Decimal(btc).mul(btcPrice)
  const cents = usd.abs().mul(100).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
  const sign = cents.isZero() ? '' : usd.isNegative() ? '\u2212' : '+'
  return `${sign}$${cents.div(100).toNumber().toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
