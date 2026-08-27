import { Decimal } from 'decimal.js'

export function convertSatsToBtc(sats: number | string | Decimal): number {
  return new Decimal(sats).div(100_000_000).toNumber()
}

export function formatSatsToBtc(sats: number | string | Decimal): string {
  return new Decimal(sats).div(100_000_000).toFixed(8)
}

export function formatUsd(
  amount: number | string | Decimal,
  notation: Intl.NumberFormatOptions['notation'] = 'standard',
  options?: {
    minimumFractionDigits?: number
    maximumFractionDigits?: number
  },
): string {
  const parsedNumber = Decimal.isDecimal(amount) ? amount.toNumber() : Number(amount)
  if (isNaN(parsedNumber)) {
    return '$0.00'
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation,
    minimumFractionDigits: options?.minimumFractionDigits ?? 2,
    maximumFractionDigits: options?.maximumFractionDigits ?? 2,
  })

  return formatter.format(parsedNumber)
}

export const basicNumberFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatNumber(value: string): string {
  return basicNumberFormatter.format(parseFloat(value))
}
