import { TZDate, tzOffset } from '@date-fns/tz'
import { type Timezone } from '@hoseki/packages/schemas'
import { Err, Ok, type Result } from '@patina/core'

export type TimeRange = '7d' | '30d' | '90d' | '1y' | 'all'

export interface CustomDateRange {
  startDate: string
  endDate: string
}

export interface BalanceDataPoint {
  timestamp: string
  totalBalance: string
}

export interface BalanceEntry {
  timestamp: Date
  value: bigint
}

export interface ResolvedHistoryRange {
  start: Date
  end: Date
  dayStarts: Date[]
  isCustom: boolean
  isAll: boolean
  endsAtCurrentTime: boolean
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const BITCOIN_GENESIS_DAY: ZonedDateParts = { year: 2009, month: 1, day: 3 }

export function resolveHistoryRange(
  timeRange: TimeRange,
  customDateRange: CustomDateRange | undefined,
  timezone: Timezone,
  now: Date = new Date(),
): Result<ResolvedHistoryRange, Error> {
  const today = getZonedDateParts(now, timezone)

  if (customDateRange === undefined) {
    const startDay =
      timeRange === 'all' ? BITCOIN_GENESIS_DAY : addDaysToZonedDateParts(today, -timeRangeToDays(timeRange))

    return Ok({
      start: zonedDateStart(startDay, timezone),
      end: now,
      // For All, genesis is only an unbounded history lookup marker. The
      // displayed days are determined from the portfolio's actual entries.
      dayStarts: timeRange === 'all' ? [] : getZonedDayStarts(startDay, today, timezone),
      isCustom: false,
      isAll: timeRange === 'all',
      endsAtCurrentTime: true,
    })
  }

  const startDay = parseDateOnly(customDateRange.startDate)
  const endDay = parseDateOnly(customDateRange.endDate)
  if (startDay === null || endDay === null) {
    return Err(new Error('Custom dates must use the YYYY-MM-DD format'))
  }

  if (compareZonedDates(startDay, endDay) > 0) {
    return Err(new Error('Start date must be on or before end date'))
  }

  if (compareZonedDates(startDay, BITCOIN_GENESIS_DAY) < 0) {
    return Err(new Error('Start date cannot be before Bitcoin genesis'))
  }

  if (compareZonedDates(endDay, today) > 0) {
    return Err(new Error('End date cannot be in the future'))
  }

  const endsToday = compareZonedDates(endDay, today) === 0
  return Ok({
    start: zonedDateStart(startDay, timezone),
    end: endsToday ? now : zonedDateEnd(endDay, timezone),
    dayStarts: getZonedDayStarts(startDay, endDay, timezone),
    isCustom: true,
    isAll: false,
    endsAtCurrentTime: endsToday,
  })
}

export function buildHistoricalData(
  allEntries: BalanceEntry[],
  currentTotalBalance: bigint,
  range: ResolvedHistoryRange,
  timezone: Timezone,
): BalanceDataPoint[] {
  if (allEntries.length === 0) {
    if (range.isCustom || range.isAll || currentTotalBalance <= 0n) return []

    return range.dayStarts.map((date) => ({
      timestamp: date.toISOString(),
      totalBalance: currentTotalBalance.toString(),
    }))
  }

  const sortedEntries = [...allEntries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const firstActivity = sortedEntries.find((entry) => entry.value !== 0n && entry.timestamp <= range.end)
  if (range.isAll && firstActivity === undefined) return []

  // Include archived and selected accounts via the same entries used for the
  // balances. Zero-balance setup snapshots must not extend All into empty years.
  const start =
    range.isAll && firstActivity
      ? zonedDateStart(getZonedDateParts(firstActivity.timestamp, timezone), timezone)
      : range.start
  const dayStarts = range.isAll
    ? getZonedDayStarts(getZonedDateParts(start, timezone), getZonedDateParts(range.end, timezone), timezone)
    : range.dayStarts
  const historicalData: BalanceDataPoint[] = []
  let entryIndex = 0
  let runningBalance = 0n

  while (entryIndex < sortedEntries.length) {
    const entry = sortedEntries[entryIndex]
    if (!entry || entry.timestamp >= start) break
    runningBalance += entry.value
    entryIndex += 1
  }

  if (range.isCustom || range.isAll) appendHistoricalPoint(historicalData, start, runningBalance)

  for (const [index, dayStart] of dayStarts.entries()) {
    const nextDayStart = dayStarts[index + 1]
    // Reuse the resolved midnight, including DST's shorter/longer days.
    // Skipped calendar dates can share a start instant; keep the zoned fallback.
    const dayEnd =
      nextDayStart && nextDayStart > dayStart
        ? new Date(nextDayStart.getTime() - 1)
        : getZonedEndOfDay(dayStart, timezone)
    const pointTime = dayEnd > range.end ? range.end : dayEnd

    while (entryIndex < sortedEntries.length) {
      const entry = sortedEntries[entryIndex]
      if (!entry || entry.timestamp > pointTime) break
      runningBalance += entry.value
      entryIndex += 1
    }

    appendHistoricalPoint(historicalData, pointTime, runningBalance)
  }

  if (range.endsAtCurrentTime) {
    const latestPoint = historicalData.at(-1)
    if (latestPoint) latestPoint.totalBalance = currentTotalBalance.toString()
  }

  return historicalData
}

export function formatZonedDate(date: Date, timezone: Timezone): string {
  const parts = getZonedDateParts(date, timezone)
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.ceil((end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY))
}

function timeRangeToDays(timeRange: TimeRange): number {
  switch (timeRange) {
    case '7d':
      return 7
    case '30d':
      return 30
    case '90d':
      return 90
    case '1y':
      return 365
    case 'all':
      return 0
  }
}

function parseDateOnly(value: string): ZonedDateParts | null {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const candidate = new Date(Date.UTC(year, month - 1, day))

  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() + 1 !== month || candidate.getUTCDate() !== day) {
    return null
  }

  return { year, month, day }
}

function calendarDayDistance(start: ZonedDateParts, end: ZonedDateParts): number {
  const startMs = Date.UTC(start.year, start.month - 1, start.day)
  const endMs = Date.UTC(end.year, end.month - 1, end.day)
  return Math.round((endMs - startMs) / MILLISECONDS_PER_DAY)
}

function compareZonedDates(left: ZonedDateParts, right: ZonedDateParts): number {
  return calendarDayDistance(right, left)
}

function getZonedDayStarts(start: ZonedDateParts, end: ZonedDateParts, timezone: Timezone): Date[] {
  const dayCount = calendarDayDistance(start, end)
  const dayStarts: Date[] = []

  for (let dayOffset = 0; dayOffset <= dayCount; dayOffset += 1) {
    dayStarts.push(zonedDateStart(addDaysToZonedDateParts(start, dayOffset), timezone))
  }

  return dayStarts
}

function zonedDateStart(parts: ZonedDateParts, timezone: Timezone): Date {
  const wallClockTimestamp = Date.UTC(parts.year, parts.month - 1, parts.day)
  const sampleTimestamps = [
    wallClockTimestamp - 2 * MILLISECONDS_PER_DAY,
    wallClockTimestamp,
    wallClockTimestamp + 2 * MILLISECONDS_PER_DAY,
  ]
  const offsets = new Set(sampleTimestamps.map((timestamp) => tzOffset(timezone, new Date(timestamp))))
  const candidates = [...offsets]
    .filter(Number.isFinite)
    .map((offset) => new Date(wallClockTimestamp - offset * 60 * 1000))

  const exactMidnights = candidates.filter((candidate) => {
    const zonedDate = new TZDate(candidate, timezone)
    return (
      compareZonedDates(getZonedDateParts(candidate, timezone), parts) === 0 &&
      zonedDate.getHours() === 0 &&
      zonedDate.getMinutes() === 0 &&
      zonedDate.getSeconds() === 0 &&
      zonedDate.getMilliseconds() === 0
    )
  })

  if (exactMidnights.length > 0) {
    return new Date(Math.min(...exactMidnights.map((candidate) => candidate.getTime())))
  }

  // Some zones skip midnight (or, historically, an entire calendar date).
  // Use the first real instant that is not before the requested local date.
  const firstValidInstant = candidates
    .filter((candidate) => compareZonedDates(getZonedDateParts(candidate, timezone), parts) >= 0)
    .sort((left, right) => left.getTime() - right.getTime())[0]

  return firstValidInstant ?? new Date(wallClockTimestamp)
}

function zonedDateEnd(parts: ZonedDateParts, timezone: Timezone): Date {
  const nextDay = addDaysToZonedDateParts(parts, 1)
  return new Date(zonedDateStart(nextDay, timezone).getTime() - 1)
}

function getZonedEndOfDay(dayStart: Date, timezone: Timezone): Date {
  return zonedDateEnd(getZonedDateParts(dayStart, timezone), timezone)
}

function getZonedDateParts(date: Date, timezone: Timezone): ZonedDateParts {
  const zonedDate = new TZDate(date, timezone)
  return { year: zonedDate.getFullYear(), month: zonedDate.getMonth() + 1, day: zonedDate.getDate() }
}

function addDaysToZonedDateParts(parts: ZonedDateParts, days: number): ZonedDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days))
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  }
}

function appendHistoricalPoint(points: BalanceDataPoint[], timestamp: Date, balance: bigint): void {
  const isoTimestamp = timestamp.toISOString()
  const lastPoint = points[points.length - 1]

  if (lastPoint?.timestamp === isoTimestamp) {
    lastPoint.totalBalance = balance.toString()
    return
  }

  points.push({ timestamp: isoTimestamp, totalBalance: balance.toString() })
}
