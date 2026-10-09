import { TZDate } from '@date-fns/tz'
import { format, isSameDay, isSameMonth, isSameYear } from 'date-fns'
import type { Timezone } from '../../schemas/timezone'

/**
 *
 * Formats a date range into a user-friendly string with redundancy reduction.
 *
 * The function automatically adjusts the format based on whether the dates share the same
 * month and/or year to avoid unnecessary repetition while maintaining clarity.
 *
 * @param {Date} openingDate - The start date of the range
 * @param {Date} closingDate - The end date of the range
 * @param {Timezone} timezone - The timezone the dates are shown in
 * @param {{ shortMonths?: boolean }} options - `shortMonths` abbreviates the end month too, e.g. "Jan 1 - Feb 28, 2025"
 * @returns {string} A formatted date range string
 *
 * @example
 * // Same day - returns single date format
 * formatDateRange(new Date('2025-01-01'), new Date('2025-01-01'))
 * // Returns: "Jan 1, 2025"
 *
 * @example
 * // Same month and year - uses abbreviated month names
 * formatDateRange(new Date('2025-01-01'), new Date('2025-01-31'))
 * // Returns: "Jan 1 - Jan 31, 2025"
 *
 * @example
 * // Different months, same year - uses abbreviated start month, full end month
 * formatDateRange(new Date('2025-01-01'), new Date('2025-02-28'))
 * // Returns: "Jan 1 - February 28, 2025"
 *
 * @example
 * // Different years - includes year for both dates, uses full end month name
 * formatDateRange(new Date('2024-01-01'), new Date('2025-02-28'))
 * // Returns: "Jan 1, 2024 - February 28, 2025"
 *
 */
export function formatDateRange(
  start: Date,
  end: Date,
  timezone?: Timezone,
  { shortMonths = false }: { shortMonths?: boolean } = {},
): string {
  const separator = '-'
  const endMonth = shortMonths ? 'MMM' : 'MMMM'

  const tzStart = new TZDate(start, timezone)
  const tzEnd = new TZDate(end, timezone)

  // Same day - return single date format
  if (isSameDay(tzStart, tzEnd)) {
    return format(tzStart, 'MMM d, yyyy')
  }

  if (isSameYear(tzStart, tzEnd)) {
    if (isSameMonth(tzStart, tzEnd)) {
      // Same month and year: "Jan 1 - 31, 2025"
      return `${format(tzStart, 'MMM d')} ${separator} ${format(tzEnd, 'd, yyyy')}`
    } else {
      // Different months, same year: "Jan 1 - February 31, 2025"
      return `${format(tzStart, 'MMM d')} ${separator} ${format(tzEnd, `${endMonth} d, yyyy`)}`
    }
  } else {
    // Different years: "Jan 1, 2024 - February 31, 2025"
    return `${format(tzStart, 'MMM d, yyyy')} ${separator} ${format(tzEnd, `${endMonth} d, yyyy`)}`
  }
}

/**
 * If `targetDate` is in the future, returns a user-friendly string indicating how long the `targetDate` is from now.
 * If `targetDate` is in the past, returns a user-friendly string indicating how long ago the `targetDate` was.
 *
 * @param {Date} targetDate - The date to compare to now, can be in the past or future
 * @param {Intl.RelativeTimeFormatOptions} options - Options to pass to the Intl.RelativeTimeFormat constructor
 * @returns {string} A string representing the relative time from now to the target date
 *
 * @example
 * ```ts
 * console.log(new Date()) // 2024-01-01
 * getRelativeTimeFromNow(new Date('2025-01-01'))
 * // Returns: "1 year"
 * ```
 *
 * @example
 * ```ts
 * console.log(new Date()) // 2025-01-01
 * getRelativeTimeFromNow(new Date('2024-01-01'))
 * // Returns: "1 year ago"
 * ```
 *
 * @example
 * ```ts
 * console.log(new Date()) // 2025-01-01
 * getRelativeTimeFromNow(new Date('2025-01-02'))
 * // Returns: "1 day"
 * ```
 *
 * @example
 * ```ts
 * console.log(new Date()) // 2025-01-01
 * getRelativeTimeFromNow(new Date('2025-01-11'))
 * // Returns: "next week"
 * ```
 */
export function getRelativeTimeFromNow(targetDate: Date, options?: Intl.RelativeTimeFormatOptions): string {
  // Calculate the difference in seconds between the given date and the current date
  const secondsDiff = Math.round((targetDate.getTime() - Date.now()) / 1000)

  // Array representing one minute, hour, day, week, month, etc. in seconds
  const unitsInSec = [60, 3600, 86400, 86400 * 7, 86400 * 30, 86400 * 365, Infinity] as const

  // Array equivalent to the above but in the string representation of the units
  const unitStrings = ['second', 'minute', 'hour', 'day', 'week', 'month', 'year'] as const

  // Find the appropriate unit based on the seconds difference
  const unitIndex = unitsInSec.findIndex((cutoff) => cutoff > Math.abs(secondsDiff))

  // Initialize Intl.RelativeTimeFormat
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', ...options })

  // Get the divisor to convert seconds to the appropriate unit
  const divisor = (unitIndex ? unitsInSec[unitIndex - 1] : 1) ?? unitsInSec[3]
  const unit = unitStrings[unitIndex] ?? unitStrings[3]

  // Format the relative time based on the calculated unit
  const relativeTime = rtf.format(Math.floor(secondsDiff / divisor), unit)

  return relativeTime
}
