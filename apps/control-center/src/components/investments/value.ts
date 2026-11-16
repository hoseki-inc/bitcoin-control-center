import Decimal from 'decimal.js'

/** Accept dollars with up to two decimal places and store an exact number of cents. */
export function dollarsToCents(value: string): string | null {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    return null
  }
  const cents = new Decimal(value).mul(100)
  return cents.lte(Number.MAX_SAFE_INTEGER) ? cents.toFixed(0) : null
}

export function formatInvestmentValue(cents: string): string {
  const [whole = '0', fraction = '00'] = new Decimal(cents).div(100).toFixed(2).split('.')
  return `$${BigInt(whole).toLocaleString('en-US')}.${fraction}`
}

export function formatValuationDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}
