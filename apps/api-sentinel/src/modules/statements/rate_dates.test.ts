import { Decimal } from 'decimal.js'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { DailyRates } from '../price/daily_rates'
import { toDateKey } from '../price/daily_rates'
import { validateStatementRates } from './rate_dates'

const day = new Date('2026-08-01T00:00:00Z')
const fourDays = 4 * 86_400_000
function quotes(date: Date, timestamp: Date): DailyRates {
  const value = new Decimal(81000)
  return {
    source: 'mempool',
    quoteCurrency: 'CAD',
    rates: { [toDateKey(date)]: { timestamp, open: value, high: value, low: value, close: value } },
  }
}

function setup(): void {
  onTestFinished(() => {
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
}

describe('statement quote observation window', () => {
  it.each([-fourDays, 0, fourDays])('accepts an observation %s milliseconds from the valuation', (offset) => {
    setup()
    const rates = quotes(day, new Date(day.getTime() + offset))
    expect(validateStatementRates([day], rates).isOk()).toBe(true)
  })

  it.each([-fourDays - 1, fourDays + 1])(
    'rejects an observation just outside the window: %s milliseconds',
    (offset) => {
      setup()
      const rates = quotes(day, new Date(day.getTime() + offset))
      expect(validateStatementRates([day], rates).isErr()).toBe(true)
    },
  )

  it('rejects an observation that has not happened yet even when within four days of the valuation', () => {
    setup()
    const today = new Date('2026-09-08T00:00:00Z')
    const rates = quotes(today, new Date('2026-09-08T12:00:01Z'))
    expect(validateStatementRates([today], rates).isErr()).toBe(true)
  })

  it.each(['0', '-1'])('rejects a quote of %s', (price) => {
    setup()
    const value = new Decimal(price)
    const rates = quotes(day, day)
    rates.rates[toDateKey(day)] = { timestamp: day, open: value, high: value, low: value, close: value }
    expect(validateStatementRates([day], rates).isErr()).toBe(true)
  })

  it('rejects an invalid observation timestamp', () => {
    setup()
    expect(validateStatementRates([day], quotes(day, new Date(Number.NaN))).isErr()).toBe(true)
  })
})
