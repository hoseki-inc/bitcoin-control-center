import { createHash } from 'node:crypto'
import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import type Database from 'better-sqlite3'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'
import { type CachedQuote, QuoteCache } from './quote_cache'

export interface DailyRate {
  /** Actual observation time; this may be before or after the valuation day. */
  timestamp: Date
  /** Instance that supplied this observation, absent on legacy snapshots. */
  providerUrl?: string
  open: Decimal
  high: Decimal
  low: Decimal
  close: Decimal
}

export interface DailyRates {
  /** Keys are requested UTC valuation days, not necessarily observation days. */
  rates: Record<string, DailyRate>
  source: 'mempool'
  quoteCurrency: StatementQuoteCurrency
  /** Absent on legacy snapshots; do not infer it from today's configuration. */
  providerUrl?: string
  providerUrls?: string[]
}

/** Product limit for statement dates; mempool may have older, coarser prices. */
export const MIN_MEMPOOL_PRICE_DATE = new Date('2023-04-01T00:00:00Z')
export const MAX_QUOTE_DISTANCE_DAYS = 4
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'
const DAY_SECONDS = 86_400
const HOUR_MS = 3_600_000
const MAX_REQUEST_DAYS = 2 * 366
const responseSchema = z.object({
  prices: z
    .array(
      z.object({
        time: z.number().int().nonnegative().max(8_640_000_000_000),
        USD: z.unknown().optional(),
        CAD: z.unknown().optional(),
        GBP: z.unknown().optional(),
        EUR: z.unknown().optional(),
      }),
    )
    .max(1),
})
const priceSchema = z.number().finite().positive()

export class DailyRatesService {
  private readonly publicFallback: DailyRatesService | undefined
  private readonly cache: QuoteCache
  private readonly mempoolApiUrl: string
  private readonly providerUrl: string
  private readonly logger: Logger
  private readonly inFlight = new Map<number, Promise<Result<void, Error>>>()
  private unavailableUntil = 0
  private static readonly CONCURRENCY = 4

  public constructor(deps: {
    db: Database.Database
    logger: Logger
    mempoolApiUrl: string
    allowPublicFallback?: boolean
  }) {
    this.logger = deps.logger.child({ module: 'daily-rates-service' })
    this.mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
    const provider = new URL(this.mempoolApiUrl)
    provider.username = ''
    provider.password = ''
    provider.search = ''
    provider.hash = ''
    this.providerUrl = provider.toString().replace(/\/$/, '')
    this.publicFallback =
      this.providerUrl !== PUBLIC_MEMPOOL_URL && deps.allowPublicFallback !== false
        ? new DailyRatesService({ ...deps, mempoolApiUrl: PUBLIC_MEMPOOL_URL, allowPublicFallback: false })
        : undefined
    // Identify request receipts without storing credentials; all sources share price rows.
    this.cache = new QuoteCache(
      deps.db,
      createHash('sha256').update(this.mempoolApiUrl).digest('hex'),
      this.providerUrl,
    )
  }

  public getDailyRates = asyncFn(
    async (
      openingDate: Date,
      closingDate: Date,
      quoteCurrency: StatementQuoteCurrency = 'USD',
      requiredDates?: Date[],
    ): Promise<Result<DailyRates, Error>> => {
      if (
        !Number.isFinite(openingDate.getTime()) ||
        !Number.isFinite(closingDate.getTime()) ||
        openingDate > closingDate
      ) {
        return Err(new Error('Statement dates must be valid and ordered'))
      }
      if (openingDate < MIN_MEMPOOL_PRICE_DATE) {
        return Err(new Error('Statements must start on or after April 1, 2023.'))
      }
      if (closingDate.getTime() > Date.now()) {
        return Err(new Error('Statement dates cannot be in the future.'))
      }
      const start = utcDay(openingDate)
      const end = utcDay(closingDate)
      if ((end - start) / DAY_SECONDS + 1 > MAX_REQUEST_DAYS) {
        return Err(new Error('Statement date range cannot exceed two years.'))
      }
      const requested =
        requiredDates ??
        Array.from({ length: (end - start) / DAY_SECONDS + 1 }, (_, i) => new Date((start + i * DAY_SECONDS) * 1000))
      if (requested.some((date) => !Number.isFinite(date.getTime()) || utcDay(date) < start || utcDay(date) > end)) {
        return Err(new Error('Required quote dates must be within the statement range.'))
      }
      const days = [...new Set(requested.map(utcDay))].sort((a, b) => a - b)
      const rates: Record<string, DailyRate> = {}
      for (let i = 0; i < days.length; i += DailyRatesService.CONCURRENCY) {
        const batch = days.slice(i, i + DailyRatesService.CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (target) => ({ target, result: await this.getQuoteWithFallback(target, quoteCurrency) })),
        )
        for (const { target, result } of results) {
          if (result.isErr()) {
            return Err(result.unwrapErr())
          }
          const quote = result.unwrap()
          const value = new Decimal(quote.price)
          rates[toDateKey(new Date(target * 1000))] = {
            timestamp: new Date(quote.timestamp * 1000),
            providerUrl: quote.providerUrl,
            open: value,
            high: value,
            low: value,
            close: value,
          }
        }
      }
      const providerUrls = [
        ...new Set(Object.values(rates).flatMap((rate) => (rate.providerUrl !== undefined ? [rate.providerUrl] : []))),
      ].sort()
      return Ok({
        rates,
        source: 'mempool',
        quoteCurrency,
        providerUrls,
        providerUrl: providerUrls.length === 1 ? providerUrls[0] : undefined,
      })
    },
  )

  private async getQuoteWithFallback(
    target: number,
    currency: StatementQuoteCurrency,
  ): Promise<Result<CachedQuote, Error>> {
    const primary = await this.getQuote(target, currency)
    if (primary.isOk()) {
      return primary
    }
    if (!this.publicFallback) {
      return Err(primary.unwrapErr())
    }
    const fallback = await this.publicFallback.getQuote(target, currency)
    if (fallback.isOk()) {
      return fallback
    }
    return Err(
      new Error(
        `No usable ${currency} quote for ${toDateKey(new Date(target * 1000))} within four days before or after the valuation date from either the configured mempool or public mempool.space. Please retry or choose a different period.`,
      ),
    )
  }

  private async getQuote(target: number, currency: StatementQuoteCurrency): Promise<Result<CachedQuote, Error>> {
    const now = Date.now()
    const oldest = target - MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS
    const newest = Math.min(target + MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS, Math.floor(now / 1000))
    // Mempool returns the observation at or before each requested timestamp.
    // Probe both sides before choosing, since the first usable quote may be farther away.
    const lookups = [target]
    for (let offset = 1; offset <= MAX_QUOTE_DISTANCE_DAYS; offset++) {
      lookups.push(target - offset * DAY_SECONDS)
      if (target + offset * DAY_SECONDS <= newest) {
        lookups.push(target + offset * DAY_SECONDS)
      }
    }
    const cached = this.cache.find(currency, target, oldest, newest)
    if (
      cached &&
      (cached.timestamp === target
        ? this.cache.hasFreshLookup(target, now)
        : lookups.every((lookup) => this.cache.hasFreshLookup(lookup, now)))
    ) {
      return Ok(cached)
    }
    for (const lookup of lookups) {
      if (!this.cache.isFresh(lookup, now)) {
        const fetched = await this.fetchDay(lookup)
        if (fetched.isErr()) {
          const available = this.cache.find(currency, target, oldest, newest)
          if (available) {
            return Ok(available)
          }
          return Err(
            new Error(
              `No usable ${currency} quote for ${toDateKey(new Date(target * 1000))}. The configured mempool source is unavailable; retry when it is reachable and has historical pricing.`,
            ),
          )
        }
      }
      const available = this.cache.find(currency, target, oldest, newest)
      // An exact match cannot be improved by looking farther away.
      if (available?.timestamp === target) {
        return Ok(available)
      }
    }
    const closest = this.cache.find(currency, target, oldest, newest)
    if (closest) {
      return Ok(closest)
    }
    return Err(
      new Error(
        `No ${currency} price within four days before or after ${toDateKey(new Date(target * 1000))}. The configured mempool source may not have historical pricing for this currency.`,
      ),
    )
  }

  private async fetchDay(target: number): Promise<Result<void, Error>> {
    const running = this.inFlight.get(target)
    if (running) {
      return running
    }
    if (Date.now() < this.unavailableUntil) {
      return Err(new Error('Mempool price source temporarily unavailable'))
    }
    const request = this.requestDay(target)
    this.inFlight.set(target, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(target)
    }
  }

  private async requestDay(target: number): Promise<Result<void, Error>> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${this.mempoolApiUrl}/api/v1/historical-price?timestamp=${target}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          const header = response.headers.get('retry-after')
          const retryMs =
            header === null ? 500 : /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - Date.now()
          // Respect long Retry-After windows without keeping a statement request asleep.
          if (retryable && attempt === 0 && Number.isFinite(retryMs) && retryMs >= 0 && retryMs <= 2_000) {
            await new Promise((resolve) => {
              setTimeout(resolve, retryMs)
            })
            continue
          }
          this.unavailableUntil =
            Date.now() + Math.max(30_000, Number.isFinite(retryMs) ? Math.min(Math.max(0, retryMs), HOUR_MS) : 0)
          this.logger.warn({ status: response.status }, 'Configured mempool price source unavailable')
          return Err(new Error('Mempool historical pricing request failed'))
        }
        const parsed = parseUnknown(responseSchema, await response.json())
        if (parsed.isErr()) {
          return Err(new Error('Invalid mempool historical price response'))
        }
        const point = parsed.unwrap().prices[0]
        if (point && (point.time > target || point.time * 1000 > Date.now())) {
          return Err(new Error('Mempool returned a quote after the lookup timestamp'))
        }
        const quotes: Partial<Record<StatementQuoteCurrency, string>> = {}
        if (point) {
          for (const currency of StatementQuoteCurrencySchema.options) {
            const price = parseUnknown(priceSchema, point[currency])
            if (price.isOk()) {
              quotes[currency] = new Decimal(price.unwrap()).toString()
            }
          }
        }
        const complete = Object.keys(quotes).length === StatementQuoteCurrencySchema.options.length
        const historical = target < utcDay(new Date())
        this.cache.save(
          target,
          point?.time ?? null,
          quotes,
          complete && historical ? Number.MAX_SAFE_INTEGER : Date.now() + HOUR_MS,
        )
        return Ok(undefined)
      } catch {
        if (attempt === 0) {
          continue
        }
        this.unavailableUntil = Date.now() + 30_000
        return Err(new Error('Unable to reach the configured mempool price source'))
      }
    }
    return Err(new Error('Mempool price source unavailable'))
  }
}

function utcDay(date: Date): number {
  return Math.floor(date.getTime() / (DAY_SECONDS * 1000)) * DAY_SECONDS
}

export function toDateKey(date: Date): string {
  return new Date(date.getTime()).toISOString().slice(0, 10)
}
