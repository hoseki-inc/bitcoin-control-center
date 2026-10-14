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

/** What a statement shows when its prices can't be confirmed. Never names a date, which can be an activity day. */
export const PRICES_FAILED_MESSAGE =
  "Couldn't get Bitcoin prices for this statement. Check your connection and try again."

export type PriceLoadErrorKind = 'unavailable' | 'incomplete'

/** A statement's prices couldn't be fetched or confirmed; only its kind is logged. */
export class PriceLoadError extends Error {
  public override readonly name = 'PriceLoadError'
  public readonly kind: PriceLoadErrorKind

  public constructor(kind: PriceLoadErrorKind) {
    super(PRICES_FAILED_MESSAGE)
    this.kind = kind
  }
}

/** Only validate newly generated data; legacy completed snapshots remain unchanged. */
export function validateStatementRates(dates: Date[], dailyRates: DailyRates): Result<void, PriceLoadError> {
  for (const date of dates) {
    const key = toDateKey(date)
    const rate = dailyRates.rates[key]
    if (!rate || !rate.close.isFinite() || !rate.close.gt(0)) {
      return Err(new PriceLoadError('incomplete'))
    }
    const distance = Math.abs(date.getTime() - rate.timestamp.getTime())
    if (
      !Number.isFinite(distance) ||
      rate.timestamp.getTime() > Date.now() ||
      distance > MAX_QUOTE_DISTANCE_DAYS * 86_400_000
    ) {
      return Err(new PriceLoadError('incomplete'))
    }
  }
  return Ok(undefined)
}
