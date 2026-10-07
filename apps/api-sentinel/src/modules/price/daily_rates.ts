import { createHash } from 'node:crypto'
import type { AsyncResult } from '@hoseki/packages/result'
import { Err, Ok, type Result, tryBlock } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
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
const HOUR_SECONDS = 3_600
const HOUR_MS = 3_600_000
const MAX_REQUEST_DAYS = 2 * 366
/** Rate-limited requests back off 0.5, 1, then 2 seconds before the source cools down. */
const MAX_ATTEMPTS = 4
const RETRY_BASE_MS = 500
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
  private readonly allowPublicFallback: () => boolean | Promise<boolean>
  private readonly allowRequests: () => boolean | Promise<boolean>
  private readonly cache: QuoteCache
  private readonly mempoolApiUrl: string
  private readonly providerUrl: string
  private readonly logger: Logger
  private readonly inFlight = new Map<number, Promise<Result<void, Error>>>()
  private unavailableUntil = 0
  private static readonly CONCURRENCY = 4

  public constructor(deps: {
    db: SentinelDb
    logger: Logger
    mempoolApiUrl: string
    /** Read before each public request, so the Settings switch applies to statements in progress. */
    allowPublicFallback?: () => boolean | Promise<boolean>
    /** Read before each request to this source; the public fallback is bound to the switch above. */
    allowRequests?: () => boolean | Promise<boolean>
  }) {
    this.logger = deps.logger.child({ module: 'daily-rates-service' })
    this.mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
    const provider = new URL(this.mempoolApiUrl)
    provider.username = ''
    provider.password = ''
    provider.search = ''
    provider.hash = ''
    this.providerUrl = provider.toString().replace(/\/$/, '')
    const allowPublicFallback = deps.allowPublicFallback ?? (() => true)
    this.allowPublicFallback = allowPublicFallback
    this.allowRequests = deps.allowRequests ?? (() => true)
    this.publicFallback =
      this.providerUrl === PUBLIC_MEMPOOL_URL
        ? undefined
        : new DailyRatesService({
            db: deps.db,
            logger: deps.logger,
            mempoolApiUrl: PUBLIC_MEMPOOL_URL,
            allowRequests: allowPublicFallback,
          })
    // Identify request receipts without storing credentials; all sources share price rows.
    this.cache = new QuoteCache(
      deps.db,
      createHash('sha256').update(this.mempoolApiUrl).digest('hex'),
      this.providerUrl,
    )
  }

  public getDailyRates = (
    openingDate: Date,
    closingDate: Date,
    quoteCurrency: StatementQuoteCurrency = 'USD',
    requiredDates?: Date[],
  ): AsyncResult<DailyRates, Error> => {
    const { cache } = this
    const getQuoteWithFallback = async (target: number, currency: StatementQuoteCurrency) =>
      this.getQuoteWithFallback(target, currency)
    return tryBlock(async function* () {
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
      const chosen = new Map<number, CachedQuote>()
      for (let i = 0; i < days.length; i += DailyRatesService.CONCURRENCY) {
        const batch = days.slice(i, i + DailyRatesService.CONCURRENCY)
        const results = await Promise.all(
          batch.map(async (target) => ({ target, result: await getQuoteWithFallback(target, quoteCurrency) })),
        )
        // Choose each day's quote only once the whole batch has finished, from everything now
        // cached, so the choice depends on which requests succeeded rather than on when their
        // responses arrived. A day whose sources all failed can use a neighbour's nearby quote.
        const now = Date.now()
        for (const { target, result } of results) {
          const { oldest, newest } = quoteWindow(target, now)
          const quote = await cache.find(quoteCurrency, target, oldest, newest)
          if (quote) {
            chosen.set(target, quote)
          } else if (result.isOk()) {
            chosen.set(target, result.unwrap())
          } else {
            return Err(result.unwrapErr())
          }
        }
      }
      // Days are chosen in date order, so the rates keep that order.
      const rates: Record<string, DailyRate> = {}
      for (const [target, quote] of chosen) {
        rates[toDateKey(new Date(target * 1000))] = toDailyRate(quote)
      }
      const providerUrls = [
        ...new Set(Object.values(rates).flatMap((rate) => (rate.providerUrl !== undefined ? [rate.providerUrl] : []))),
      ].sort()
      return Ok<DailyRates>({
        rates,
        source: 'mempool',
        quoteCurrency,
        providerUrls,
        providerUrl: providerUrls.length === 1 ? providerUrls[0] : undefined,
      })
    })
  }

  private async getQuoteWithFallback(
    target: number,
    currency: StatementQuoteCurrency,
  ): Promise<Result<CachedQuote, Error>> {
    const primary = await this.getQuote(target, currency)
    if (primary.isOk()) {
      return primary
    }
    // Respect the Settings switch that keeps price requests to the chosen source.
    const publicFallback = (await this.allowPublicFallback()) ? this.publicFallback : undefined
    if (publicFallback) {
      const fallback = await publicFallback.getQuote(target, currency)
      if (fallback.isOk()) {
        return fallback
      }
    }
    if (!publicFallback) {
      return Err(primary.unwrapErr())
    }
    return Err(
      new Error(
        `No usable ${currency} quote for ${toDateKey(new Date(target * 1000))} within four days before or after the valuation date from either the configured mempool or public mempool.space. Please retry or choose a different period.`,
      ),
    )
  }

  private async getQuote(target: number, currency: StatementQuoteCurrency): Promise<Result<CachedQuote, Error>> {
    const now = Date.now()
    // Cache reads are asynchronous. Admit the first lookup before awaiting them,
    // so one immediate failure cannot cancel the other already-started days.
    const sourceAvailable = now >= this.unavailableUntil
    const { oldest, newest } = quoteWindow(target, now)
    // Mempool returns the observation at or before each requested timestamp.
    // Probe both sides before choosing, since the first usable quote may be farther away.
    const lookups = [target]
    for (let offset = 1; offset <= MAX_QUOTE_DISTANCE_DAYS; offset++) {
      lookups.push(target - offset * DAY_SECONDS)
      if (target + offset * DAY_SECONDS <= newest) {
        lookups.push(target + offset * DAY_SECONDS)
      }
    }
    // Mempool records prices hourly. When the window reaches today, also probe the latest
    // hour, since observations after today's midnight are otherwise never requested.
    const latestHour = Math.floor(newest / HOUR_SECONDS) * HOUR_SECONDS
    if (newest < target + MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS && !lookups.includes(latestHour)) {
      lookups.push(latestHour)
    }
    const cached = await this.cache.find(currency, target, oldest, newest)
    if (cached?.timestamp === target && (await this.cache.hasFreshLookup(target, now))) {
      return Ok(cached)
    }
    // Lookups this source already made are not repeated, so a completed search reuses the cache.
    for (const lookup of lookups) {
      if (!(await this.cache.isFresh(lookup, now))) {
        const fetched = await this.fetchDay(lookup, lookup !== target || !sourceAvailable)
        if (fetched.isErr()) {
          return Err(
            new Error(
              `No usable ${currency} quote for ${toDateKey(new Date(target * 1000))}. The mempool price source is unavailable; please retry later.`,
            ),
          )
        }
      }
      const available = await this.cache.find(currency, target, oldest, newest)
      // An exact match cannot be improved by looking farther away.
      if (available?.timestamp === target) {
        return Ok(available)
      }
    }
    // This source answered only if it supplied a nearby observation itself. An older quote cached
    // from another source must not stop the fallback from searching.
    const closest = await this.cache.find(currency, target, oldest, newest)
    if (closest && (await this.cache.hasOwnQuote(currency, oldest, newest))) {
      return Ok(closest)
    }
    return Err(
      new Error(
        `No ${currency} price within four days before or after ${toDateKey(new Date(target * 1000))}. The configured mempool source may not have historical pricing for this currency.`,
      ),
    )
  }

  private async fetchDay(target: number, checkCooldown = true): Promise<Result<void, Error>> {
    const running = this.inFlight.get(target)
    if (running) {
      return running
    }
    if (!(await this.allowRequests())) {
      return Err(new Error('Requests to this price source are turned off'))
    }
    // Another caller may have started this lookup while settings were loading.
    const admitted = this.inFlight.get(target)
    if (admitted) {
      return admitted
    }
    if (checkCooldown && Date.now() < this.unavailableUntil) {
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
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0 && !(await this.allowRequests())) {
        return Err(new Error('Requests to this price source are turned off'))
      }
      // Stop retrying once a concurrent request has put the source in cooldown.
      if (attempt > 0 && Date.now() < this.unavailableUntil) {
        return Err(new Error('Mempool price source temporarily unavailable'))
      }
      try {
        const response = await fetch(`${this.mempoolApiUrl}/api/v1/historical-price?timestamp=${target}`, {
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          const header = response.headers.get('retry-after')
          const retryMs =
            header === null
              ? RETRY_BASE_MS * 2 ** attempt
              : /^\d+$/.test(header)
                ? Number(header) * 1000
                : Date.parse(header) - Date.now()
          // Back off through brief rate limits, since one failed day fails the statement.
          // Respect long Retry-After windows without keeping a statement request asleep.
          if (retryable && attempt < MAX_ATTEMPTS - 1 && Number.isFinite(retryMs) && retryMs >= 0 && retryMs <= 2_000) {
            await new Promise((resolve) => {
              setTimeout(resolve, retryMs)
            })
            continue
          }
          // Concurrent failures keep the longest cooldown any of them asked for.
          this.unavailableUntil = Math.max(
            this.unavailableUntil,
            Date.now() + Math.max(30_000, Number.isFinite(retryMs) ? Math.min(Math.max(0, retryMs), HOUR_MS) : 0),
          )
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
        // Only a complete observation at the lookup time is final. An older one may
        // improve once the source fills gaps in its history.
        const settled = complete && historical && point?.time === target
        await this.cache.save(
          target,
          point?.time ?? null,
          quotes,
          settled ? Number.MAX_SAFE_INTEGER : Date.now() + HOUR_MS,
        )
        return Ok(undefined)
      } catch {
        if (attempt === 0) {
          continue
        }
        this.unavailableUntil = Math.max(this.unavailableUntil, Date.now() + 30_000)
        return Err(new Error('Unable to reach the configured mempool price source'))
      }
    }
    return Err(new Error('Mempool price source unavailable'))
  }
}

function toDailyRate(quote: CachedQuote): DailyRate {
  const value = new Decimal(quote.price)
  return {
    timestamp: new Date(quote.timestamp * 1000),
    providerUrl: quote.providerUrl,
    open: value,
    high: value,
    low: value,
    close: value,
  }
}

function quoteWindow(target: number, now: number) {
  return {
    oldest: target - MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS,
    newest: Math.min(target + MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS, Math.floor(now / 1000)),
  }
}

function utcDay(date: Date): number {
  return Math.floor(date.getTime() / (DAY_SECONDS * 1000)) * DAY_SECONDS
}

export function toDateKey(date: Date): string {
  return new Date(date.getTime()).toISOString().slice(0, 10)
}
