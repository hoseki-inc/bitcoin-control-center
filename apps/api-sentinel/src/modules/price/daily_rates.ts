import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DailyRate {
  timestamp: Date
  open: Decimal
  high: Decimal
  low: Decimal
  close: Decimal
}

export interface DailyRates {
  rates: Record<string, DailyRate>
  source: 'mempool'
}

/**
 * mempool.space historical price data available from April 2023.
 * Statements cannot have an opening date earlier than this.
 */
export const MIN_MEMPOOL_PRICE_DATE = new Date('2023-04-01T00:00:00Z')

// ─── Service ─────────────────────────────────────────────────────────────────

export class DailyRatesService {
  private readonly logger: Logger
  private readonly mempoolApiUrl: string

  /** Max concurrent API calls to mempool.space */
  private static readonly CONCURRENCY = 10

  public constructor(deps: { logger: Logger; mempoolApiUrl: string }) {
    this.logger = deps.logger.child({ module: 'daily-rates-service' })
    this.mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
  }

  /**
   * Fetch daily BTC/USD prices from mempool.space for a date range.
   * Makes one API call per day with concurrency limiting.
   */
  public getDailyRates = asyncFn(async (openingDate: Date, closingDate: Date): Promise<Result<DailyRates, Error>> => {
    if (openingDate < MIN_MEMPOOL_PRICE_DATE) {
      return Err(
        new Error(
          `Opening date ${toDateKey(openingDate)} is before mempool.space price data availability (April 2023). ` +
            'Please choose a more recent opening date.',
        ),
      )
    }

    // Build list of day timestamps (midnight UTC) for the range.
    // Pad one day before opening and include closing date.
    const days = getDayTimestamps(openingDate, closingDate)

    this.logger.info(
      { from: toDateKey(openingDate), to: toDateKey(closingDate), days: days.length, source: this.mempoolApiUrl },
      'Fetching daily BTC/USD rates from mempool.space',
    )

    const rates: Record<string, DailyRate> = {}
    const errors: string[] = []

    // Fetch in batches with concurrency limit
    for (let i = 0; i < days.length; i += DailyRatesService.CONCURRENCY) {
      const batch = days.slice(i, i + DailyRatesService.CONCURRENCY)
      const results = await Promise.allSettled(batch.map(async (ts) => this.fetchDayPrice(ts)))

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const { dateKey, rate } = result.value
          rates[dateKey] = rate
        } else if (result.status === 'rejected') {
          errors.push(String(result.reason))
        }
      }
    }

    if (Object.keys(rates).length === 0) {
      return Err(new Error(`No price data returned from mempool.space. Errors: ${errors.join('; ')}`))
    }

    // Fill forward any missing days (e.g., today if not yet available)
    fillForwardRates(rates, openingDate, closingDate)

    this.logger.info(
      { daysCount: Object.keys(rates).length, errors: errors.length },
      'Daily rates fetched from mempool.space',
    )

    return Ok({ rates, source: 'mempool' as const })
  })

  /**
   * Fetch price for a single day from mempool.space.
   * Returns null if the day has no data (pre-April 2023, future date, etc.).
   */
  private async fetchDayPrice(unixTimestamp: number): Promise<{ dateKey: string; rate: DailyRate } | null> {
    const url = `${this.mempoolApiUrl}/api/v1/historical-price?currency=USD&timestamp=${unixTimestamp}`
    const response = await fetch(url)

    if (!response.ok) {
      this.logger.warn({ status: response.status, timestamp: unixTimestamp }, 'mempool.space price fetch failed')
      return null
    }

    const parsed = parseUnknown(
      z.object({ prices: z.array(z.object({ time: z.number(), USD: z.number() })).optional() }),
      await response.json(),
    )
    if (parsed.isErr()) {
      return null
    }
    const json = parsed.unwrap()

    if (!json.prices || json.prices.length === 0) {
      return null
    }

    // API returns the nearest daily price point
    const pricePoint = json.prices[0]
    if (pricePoint === undefined || pricePoint.USD === 0 || Number.isNaN(pricePoint.USD)) {
      return null
    }

    const date = new Date(pricePoint.time * 1000)
    const dateKey = toDateKey(date)
    const price = new Decimal(pricePoint.USD)

    return {
      dateKey,
      rate: {
        timestamp: date,
        open: price,
        high: price,
        low: price,
        close: price,
      },
    }
  }
}

/** Format a Date as 'YYYY-MM-DD' */
export function toDateKey(date: Date): string {
  const key = date.toISOString().split('T')[0]
  if (key == null || key === '') {
    throw new Error('Invalid date format')
  }
  return key
}

/**
 * Build array of Unix timestamps (seconds) for each day in the range,
 * including one day before the opening date for boundary rate lookups.
 */
function getDayTimestamps(openingDate: Date, closingDate: Date): number[] {
  const oneDay = 86400
  const timestamps: number[] = []

  // Start one day before opening date (for opening balance rate)
  const start = new Date(openingDate)
  start.setUTCHours(0, 0, 0, 0)
  const startTs = Math.floor(start.getTime() / 1000) - oneDay

  const end = new Date(closingDate)
  end.setUTCHours(0, 0, 0, 0)
  const endTs = Math.floor(end.getTime() / 1000)

  for (let ts = startTs; ts <= endTs; ts += oneDay) {
    timestamps.push(ts)
  }

  return timestamps
}

/**
 * Fill forward missing daily rates. If a rate is missing for a specific day
 * (e.g., today if mempool hasn't updated yet), copy the nearest earlier rate.
 */
function fillForwardRates(rates: Record<string, DailyRate>, openingDate: Date, closingDate: Date): void {
  const oneDay = 86400_000
  let lastKnownRate: DailyRate | undefined

  const start = new Date(openingDate)
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date(closingDate)
  end.setUTCHours(23, 59, 59, 999)

  for (let t = start.getTime(); t <= end.getTime(); t += oneDay) {
    const key = toDateKey(new Date(t))
    if (rates[key]) {
      lastKnownRate = rates[key]
    } else if (lastKnownRate) {
      rates[key] = { ...lastKnownRate, timestamp: new Date(t) }
    }
  }
}
