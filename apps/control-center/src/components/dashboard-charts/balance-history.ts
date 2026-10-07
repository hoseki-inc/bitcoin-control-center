import { TZDate } from '@date-fns/tz'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { getBrowserTimezone } from '../../utils/timezone'

export interface BalanceDataPoint {
  timestamp: string
  totalBalance: string
  btcPrice?: string
}

export interface MonthlyChange {
  label: string
  change: number
  absChange: number
  key: string
}

interface ParsedBalancePoint {
  timestampMs: number
  balanceSats: Decimal
  point: BalanceDataPoint
}

function isBalanceObject(value: unknown): value is object {
  return value !== null && typeof value === 'object'
}

interface BalanceStringifierReceiver {
  toString: unknown
}

interface CallableStringifier {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Third-party stringifiers can return arbitrary runtime values; the caller validates the result.
  call(thisArg: BalanceStringifierReceiver): unknown
}

function isCallableStringifier(value: unknown): value is CallableStringifier {
  return typeof value === 'function'
}

const scalarBalance = z.union([
  z.string().transform((value) => value.trim() || '0'),
  z.number().transform((value) => String(Math.floor(value))),
])

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This normalization boundary accepts untrusted balance values and returns a safe string.
export function toSatoshisString(value: unknown): string {
  if (value === null || value === undefined) {
    return '0'
  }
  const scalar = parseUnknown(scalarBalance, value)
  if (scalar.isOk()) {
    return scalar.unwrap()
  }
  if (isBalanceObject(value) && 'toString' in value) {
    // oxlint-disable-next-line typescript/unbound-method -- The call below explicitly supplies the original object as `this`.
    const stringifier = value.toString
    if (isCallableStringifier(stringifier)) {
      const content = stringifier.call(value)
      return parseUnknown(z.string(), content)
        .map((text) => text.trim() || '0')
        .unwrapOr('0')
    }
  }
  return '0'
}

export function withCurrentBalancePoint(
  data: BalanceDataPoint[],
  currentBalanceSats: number | string,
  now: Date = new Date(),
  timezone: string = getBrowserTimezone(),
): BalanceDataPoint[] {
  const points = parseBalancePoints(data).map((p) => p.point)
  const currentBalance = toSatoshisString(currentBalanceSats)
  const nowTimestamp = now.toISOString()

  if (points.length === 0) {
    return [{ timestamp: nowTimestamp, totalBalance: currentBalance }]
  }

  const latestPoint = points[points.length - 1]
  if (!latestPoint) {
    return [{ timestamp: nowTimestamp, totalBalance: currentBalance }]
  }

  const latestTimestampMs = new Date(latestPoint.timestamp).getTime()
  const latestMonthKey = getMonthKey(new Date(latestPoint.timestamp), timezone)
  const currentMonthKey = getMonthKey(now, timezone)
  const latestBalance = toSatoshisString(latestPoint.totalBalance)

  if (latestTimestampMs >= now.getTime()) {
    return [...points.slice(0, -1), { ...latestPoint, totalBalance: currentBalance }]
  }

  if (latestBalance === currentBalance && latestMonthKey === currentMonthKey) {
    return points
  }

  return [
    ...points,
    {
      timestamp: nowTimestamp,
      totalBalance: currentBalance,
      btcPrice: latestPoint.btcPrice,
    },
  ]
}

export function getMonthlyChanges(
  data: BalanceDataPoint[],
  maxMonths: number = 6,
  timezone: string = getBrowserTimezone(),
): MonthlyChange[] {
  const points = parseBalancePoints(data)
  if (points.length === 0) {
    return []
  }

  const monthKeys = uniqueMonthKeys(points, timezone).slice(-maxMonths)
  const changes: MonthlyChange[] = []

  for (const key of monthKeys) {
    const monthStart = monthStartFromKey(key, timezone)
    const nextMonthStart = nextMonthStartFromKey(key, timezone)
    const baseline = lastPointBefore(points, monthStart.getTime()) ?? firstPointBefore(points, nextMonthStart.getTime())
    const end = lastPointBefore(points, nextMonthStart.getTime())

    if (!baseline || !end || end.timestampMs < monthStart.getTime()) {
      continue
    }

    const change = Number(end.balanceSats.minus(baseline.balanceSats).div(100_000_000).toFixed(8))
    changes.push({
      label: monthStart.toLocaleDateString('en-US', { month: 'short' }),
      change,
      absChange: Math.abs(change),
      key,
    })
  }

  return changes
}

function parseBalancePoints(data: BalanceDataPoint[]): ParsedBalancePoint[] {
  return data
    .map((point) => {
      const timestampMs = new Date(point.timestamp).getTime()
      if (!Number.isFinite(timestampMs)) {
        return null
      }

      try {
        return {
          timestampMs,
          balanceSats: new Decimal(toSatoshisString(point.totalBalance)),
          point,
        }
      } catch {
        return null
      }
    })
    .filter((point): point is ParsedBalancePoint => point !== null)
    .sort((a, b) => a.timestampMs - b.timestampMs)
}

function uniqueMonthKeys(points: ParsedBalancePoint[], timezone: string): string[] {
  const seen = new Set<string>()
  const keys: string[] = []

  for (const point of points) {
    const key = getMonthKey(new Date(point.timestampMs), timezone)
    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    keys.push(key)
  }

  return keys
}

function lastPointBefore(points: ParsedBalancePoint[], timestampMs: number): ParsedBalancePoint | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const point = points[i]
    if (point && point.timestampMs < timestampMs) {
      return point
    }
  }

  return null
}

function firstPointBefore(points: ParsedBalancePoint[], timestampMs: number): ParsedBalancePoint | null {
  for (const point of points) {
    if (point.timestampMs < timestampMs) {
      return point
    }
  }

  return null
}

export function getMonthKey(date: Date, timezone: string = getBrowserTimezone()): string {
  const zonedDate = new TZDate(date, timezone)
  return `${zonedDate.getFullYear()}-${String(zonedDate.getMonth() + 1).padStart(2, '0')}`
}

function monthStartFromKey(key: string, timezone: string): Date {
  const [year, month] = key.split('-').map(Number)
  return new TZDate(year ?? 0, (month ?? 1) - 1, 1, timezone)
}

function nextMonthStartFromKey(key: string, timezone: string): Date {
  const [year, month] = key.split('-').map(Number)
  const monthIndex = month ?? 1
  const nextMonthIndex = monthIndex === 12 ? 1 : monthIndex + 1
  const nextMonthYear = monthIndex === 12 ? (year ?? 0) + 1 : (year ?? 0)
  return new TZDate(nextMonthYear, nextMonthIndex - 1, 1, timezone)
}
