import { TZDate } from '@date-fns/tz'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { endOfDay, subDays } from 'date-fns'

/**
 * Statements end at least this many days before today, so recent transactions have had
 * time to confirm. Transactions that are still pending are dated when they are fetched,
 * so they fall after the end date rather than inside the statement.
 */
export const STATEMENT_CLOSING_DELAY_DAYS = 2

/** The end of the latest day a statement may close on, in the statement's timezone. */
export function getLatestStatementClosingDate(now: Date, timezone: string): Result<Date, Error> {
  const latest = endOfDay(subDays(new TZDate(now, timezone), STATEMENT_CLOSING_DELAY_DAYS)).getTime()
  if (Number.isNaN(latest)) {
    return Err(new Error(`Unrecognized statement timezone: ${timezone}`))
  }
  return Ok(new Date(latest))
}
