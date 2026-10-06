import { TZDate } from '@date-fns/tz'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { eachMonthOfInterval, endOfMonth } from 'date-fns'
import type { DailyRates } from '../price/daily_rates'
import { MAX_QUOTE_DISTANCE_DAYS, toDateKey } from '../price/daily_rates'
import type { StatementTransactions } from './service'

export interface StatementPeriod {
  openingDate: TZDate
  closingDate: TZDate
}

/** Shared by valuation-date collection and the monthly mapper, including DST boundaries. */
export function getStatementPeriods(openingDate: Date, closingDate: Date, timezone: string): StatementPeriod[] {
  const opening = new TZDate(openingDate, timezone)
  const closing = new TZDate(closingDate, timezone)
  const starts = eachMonthOfInterval({ start: opening, end: closing })
  return starts.map((start, index) => ({
    openingDate: index === 0 ? opening : start,
    closingDate: index === starts.length - 1 ? closing : endOfMonth(start),
  }))
}

export function getRequiredRateDates(
  openingDate: Date,
  closingDate: Date,
  timezone: string,
  transactionMap: StatementTransactions,
): Date[] {
  const dates = getStatementPeriods(openingDate, closingDate, timezone).flatMap((period) => [
    period.openingDate,
    period.closingDate,
  ])
  for (const { transactions } of Object.values(transactionMap)) {
    for (const tx of transactions) {
      if (tx.transactedAt >= openingDate && tx.transactedAt <= closingDate) {
        dates.push(new TZDate(tx.transactedAt, 'UTC'))
      }
    }
  }
  return [...new Set(dates.map(toDateKey))].sort().map((day) => new Date(day + 'T00:00:00Z'))
}

/** Only validate newly generated data; legacy completed snapshots remain unchanged. */
export function validateStatementRates(dates: Date[], dailyRates: DailyRates): Result<void, Error> {
  for (const date of dates) {
    const key = toDateKey(date)
    const rate = dailyRates.rates[key]
    if (!rate || !rate.close.isFinite() || !rate.close.gt(0)) {
      return Err(new Error(`No usable ${dailyRates.quoteCurrency} quote for ${key}.`))
    }
    const distance = Math.abs(date.getTime() - rate.timestamp.getTime())
    if (
      !Number.isFinite(distance) ||
      rate.timestamp.getTime() > Date.now() ||
      distance > MAX_QUOTE_DISTANCE_DAYS * 86_400_000
    ) {
      return Err(
        new Error(
          `The ${dailyRates.quoteCurrency} quote for ${key} must have an observation within four days before or after the valuation date, and no later than today.`,
        ),
      )
    }
  }
  return Ok(undefined)
}
