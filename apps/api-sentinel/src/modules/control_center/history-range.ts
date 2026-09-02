import { TZDate } from '@date-fns/tz'
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
  endsAtCurrentTime: boolean
}

interface ZonedDateParts {
  year: number
  month: number
  day: number
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const MAX_CUSTOM_RANGE_DAYS = 20 * 366

export function resolveHistoryRange(
  timeRange: TimeRange,
  customDateRange: CustomDateRange | undefined,
  timezone: Timezone,
  now: Date = new Date(),
): Result<ResolvedHistoryRange, Error> {
  const today = getZonedDateParts(now, timezone)

  if (customDateRange === undefined) {
    const daysBack = timeRangeToDays(timeRange)
    const startDay = addDaysToZonedDateParts(today, -daysBack)

    return Ok({
      start: zonedDateStart(startDay, timezone),
      end: now,
      dayStarts: getZonedDayStarts(startDay, today, timezone),
      isCustom: false,
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

  if (compareZonedDates(endDay, today) > 0) {
    return Err(new Error('End date cannot be in the future'))
  }

  const spanDays = calendarDayDistance(startDay, endDay)
  if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
    return Err(new Error('Custom date range cannot exceed 20 years'))
  }

  const endsToday = compareZonedDates(endDay, today) === 0
  return Ok({
    start: zonedDateStart(startDay, timezone),
    end: endsToday ? now : zonedDateEnd(endDay, timezone),
    dayStarts: getZonedDayStarts(startDay, endDay, timezone),
    isCustom: true,
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
    if (range.isCustom || currentTotalBalance <= 0n) return []

    return range.dayStarts.map((date) => ({
      timestamp: date.toISOString(),
      totalBalance: currentTotalBalance.toString(),
    }))
  }

  const sortedEntries = [...allEntries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  const historicalData: BalanceDataPoint[] = []
  let entryIndex = 0
  let runningBalance = 0n

  while (entryIndex < sortedEntries.length) {
    const entry = sortedEntries[entryIndex]
    if (!entry || entry.timestamp > range.start) break
    runningBalance += entry.value
    entryIndex += 1
  }

  for (const dayStart of range.dayStarts) {
    const dayEnd = getZonedEndOfDay(dayStart, timezone)
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

export function getHistoryAvailableFrom(allEntries: BalanceEntry[], timezone: Timezone): string | null {
  const earliestEntry = allEntries.reduce<BalanceEntry | null>((earliest, entry) => {
    if (!Number.isFinite(entry.timestamp.getTime())) return earliest
    if (earliest === null || entry.timestamp < earliest.timestamp) return entry
    return earliest
  }, null)

  return earliestEntry === null ? null : formatZonedDate(earliestEntry.timestamp, timezone)
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
      return 1825
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
  return new Date(new TZDate(parts.year, parts.month - 1, parts.day, timezone).getTime())
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
