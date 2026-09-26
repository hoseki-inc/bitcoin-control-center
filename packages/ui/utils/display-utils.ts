import { formatSatsToBtc } from '.'
import { chunk } from '../../collection'

export function toBitcoinAmountDisplayValue(sats: string): string {
  return `${formatSatsToBtc(sats)} BTC`
}

export function toUsdAmountDisplayValue(amount: number | string): string {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: 'standard',
    maximumFractionDigits: 2,
  })

  const result = formatter
    .formatToParts(Number(amount))
    .filter((part) => part.type !== 'currency')
    .map((part) => part.value)
    .join('')

  return `${result} USD`
}

export function toXpubDisplayValue(xpubStr: string, mask = true): string {
  if (xpubStr.length <= 32) {
    return xpubStr
  }

  const chunks = chunk(xpubStr, 4)

  const result = chunks.map((group, i) => {
    if (i === 0 || i === 1) {
      return group.join('')
    }
    if (i === chunks.length - 1 || i === chunks.length - 2) {
      return group.join('')
    }
    return mask ? '****' : group.join('')
  })

  return result.join(' ')
}

/**
 * Returns a shortened xpub string: first 4, second 4, ..., second-to-last 4, last 4
 * Example: xpub1234567890abcd...wxyz5678
 */
export function toXpubShortDisplayValue(xpubStr: string): string {
  if (xpubStr.length <= 16) {
    return xpubStr
  }
  const first4 = xpubStr.slice(0, 4)
  const second4 = xpubStr.slice(4, 8)
  const secondLast4 = xpubStr.slice(-8, -4)
  const last4 = xpubStr.slice(-4)
  return `${first4} ${second4} ... ${secondLast4} ${last4}`
}
