import { TZDate } from '@date-fns/tz'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { format } from 'date-fns'
import Decimal from 'decimal.js'
import { z } from 'zod'
import { getBrowserTimezone } from '../../utils/timezone'

export interface BalanceDataPoint {
  timestamp: string
  totalBalance: string
  btcPrice?: string
}

export interface MonthlyChange {
  /** "Oct" */
  label: string
  /** "Oct 2025" */
  labelWithYear: string
  change: number
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
  // z.number() rejects infinities; this normalizer passes them through.
  z.union([z.number(), z.literal([Infinity, -Infinity])]).transform((value) => String(Math.floor(value))),
])

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- This normalization boundary accepts untrusted balance values and returns a safe string.
export function toSatoshisString(value: unknown): string {
  if (value === null || value === undefined) {
    return '0'
  }
  const scalar = parseUnknown(scalarBalance, value)
  if (scalar.isOk()) {
    return scalar.value()
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
      labelWithYear: monthStart.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      change,
      key,
    })
  }

  return changes
}

export interface FlowTotals {
  inBtc: Decimal
  outBtc: Decimal
}

/**
 * Approximate BTC in and out over a range from consecutive balances: rises count
 * as in and drops as out. Changes within one interval net together, so this is
 * an estimate rather than a transaction total. In minus out equals the net change.
 */
export function getFlowTotals(data: BalanceDataPoint[]): FlowTotals {
  const points = parseBalancePoints(data)
  let inSats = new Decimal(0)
  let outSats = new Decimal(0)
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1]
    const current = points[index]
    if (!previous || !current) {
      continue
    }
    const delta = current.balanceSats.minus(previous.balanceSats)
    if (delta.gt(0)) {
      inSats = inSats.plus(delta)
    } else {
      outSats = outSats.plus(delta.abs())
    }
  }
  return { inBtc: inSats.div(100_000_000), outBtc: outSats.div(100_000_000) }
}

/**
 * The label under a month's bar, or null to leave it blank. Up to twelve months
 * shows every month; longer ranges label every third, sixth, twelfth or 24th month,
 * counting back from the latest, so the labels never crowd. January carries its
 * year, as do the first label of a longer range, the first label of each later
 * year, and every label a year or more apart, so those wider labels get more room.
 */
export function getMonthTickLabel(months: MonthlyChange[], index: number): string | null {
  const step =
    months.length <= 12 ? 1 : ([3, 6, 12].find((every) => months.length / every <= (every < 12 ? 16 : 12)) ?? 24)
  const month = months[index]
  if (!month || (months.length - 1 - index) % step !== 0) {
    return null
  }
  const year = month.key.slice(0, 4)
  const previous = months[index - step]
  const showsYear =
    step >= 12 || month.key.endsWith('-01') || (previous === undefined ? step > 1 : previous.key.slice(0, 4) !== year)
  return showsYear ? `${month.label} \u2019${year.slice(-2)}` : month.label
}

/** Edge dates for the balance chart: the year appears only when it isn't the current one. */
export function formatAxisDate(ms: number, timezone: string, style: 'day' | 'month', now: Date = new Date()): string {
  const date = new TZDate(new Date(ms), timezone)
  if (style === 'month') {
    return format(date, 'MMM yyyy')
  }
  const sameYear = format(date, 'yyyy') === format(new TZDate(now, timezone), 'yyyy')
  return format(date, sameYear ? 'MMM d' : 'MMM d, yyyy')
}

/**
 * Axis labels stay short (two decimals from 1 BTC, otherwise four) but gain
 * decimals until the ticks read differently and each label is close enough to
 * its tick that evenly spaced gridlines read as even steps. The tooltip shows
 * the exact balance.
 */
export function getAxisDecimals(ticks: number[]): number {
  const step = ticks.length > 1 ? (Math.max(...ticks) - Math.min(...ticks)) / (ticks.length - 1) : 0
  for (let decimals = Math.max(...ticks) >= 1 ? 2 : 4; decimals < 8; decimals++) {
    // Compared as drawn, since rounding there can differ from a plain toFixed. Labels this
    // close to evenly spaced ticks also always read differently.
    const isClose = ticks.every(
      (tick) => Math.abs(Number(formatAxisBtc(tick, decimals).replaceAll(',', '')) - tick) <= step * 0.1,
    )
    if (isClose) {
      return decimals
    }
  }
  return 8
}

export interface BalanceAxis {
  ticks: number[]
  domain: [number, number]
}

/**
 * Y-axis ticks for a BTC balance: the padded bottom and top, rounded out to whole
 * satoshis and never below zero, and one midway between them. The domain spans
 * exactly the ticks, so none is drawn outside the plot.
 */
export function getBalanceAxis(values: number[]): BalanceAxis {
  const yMin = Math.min(...values)
  const yMax = Math.max(...values)
  const yPad = yMax === yMin ? Math.max(Math.abs(yMax) * 0.1, 0.00000001) : (yMax - yMin) * 0.15
  // A history that is zero throughout needs only the zero line.
  if (yMax === 0) {
    return { ticks: [0], domain: [0, yPad] }
  }
  const bottomSats = Math.max(0, Math.floor((yMin - yPad) * 100_000_000))
  const topSats = Math.ceil((yMax + yPad) * 100_000_000)
  const tickSats = new Set([bottomSats, Math.round((bottomSats + topSats) / 2), topSats])
  return {
    ticks: Array.from(tickSats, (sats) => sats / 100_000_000),
    domain: [bottomSats / 100_000_000, topSats / 100_000_000],
  }
}

export function formatAxisBtc(btc: number, decimals: number): string {
  return btc.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
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

function getMonthKey(date: Date, timezone: string = getBrowserTimezone()): string {
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
