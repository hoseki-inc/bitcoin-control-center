import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
import { type CachedQuote, type HistoryPoint, QuoteCache } from './quote_cache'

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

export interface DailyRatesOptions {
  /** Return saved prices of any age straight away, and refresh them in the background. */
  staleWhileRefreshing?: boolean
  /**
   * The required dates don't depend on wallet activity, such as evenly spaced chart days, so only
   * they need prices, rather than every day in the range.
   */
  requiredDaysOnly?: boolean
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
const DAY_MS = 86_400_000
/** A history is downloaded again after a day, or after an hour for a statement with days still settling. */
const SETTLING_DAYS = 2
const MAX_REQUEST_DAYS = 2 * 366
/** Rate-limited requests back off 0.5, 1, then 2 seconds before the source cools down. */
const MAX_ATTEMPTS = 4
const RETRY_BASE_MS = 500
/**
 * A statement waits for its prices, so its download keeps trying for about a minute before
 * falling back, and waits out a source that asks it to while there's time.
 */
const DOWNLOAD_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000]
/** How long a statement, or the chart's first load, waits for prices in all, across every source. */
const PRICE_BUDGET_MS = 60_000
/** Each attempt gets the time left before that deadline, within these; a full history is about 1 MB. */
const MIN_TIMEOUT_MS = 10_000
const MAX_TIMEOUT_MS = 60_000
/** The full history: every observation, each with this currency's price (or -1 when it has none). */
const historySchema = z.object({
  prices: z
    .array(z.object({ time: z.number().int().nonnegative().max(8_640_000_000_000) }).catchall(z.unknown()))
    .max(200_000),
})
const priceSchema = z.number().finite().positive()

/**
 * Daily Bitcoin prices for statements and the Home chart, from each source's full price history:
 * one request per currency, which names no dates.
 */
export class DailyRatesService {
  private readonly publicFallback: DailyRatesService | undefined
  private readonly allowPublicFallback: () => boolean | Promise<boolean>
  private readonly allowRequests: () => boolean | Promise<boolean>
  private readonly cache: QuoteCache
  private readonly mempoolApiUrl: string
  private readonly logger: Logger
  private readonly downloadRetryDelaysMs: readonly number[]
  private readonly priceBudgetMs: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly downloads = new Map<StatementQuoteCurrency, { patient: boolean; result: Promise<boolean> }>()
  private unavailableUntil = 0

  public constructor(deps: {
    db: SentinelDb
    logger: Logger
    mempoolApiUrl: string
    /** Read before each public request, so the Settings switch applies to statements in progress. */
    allowPublicFallback?: () => boolean | Promise<boolean>
    /** Read before each request to this source; the public fallback is bound to the switch above. */
    allowRequests?: () => boolean | Promise<boolean>
    /** Waits between a statement's download attempts; tests shorten them. */
    downloadRetryDelaysMs?: readonly number[]
    /** How long prices are waited for in all; tests shorten it. */
    priceBudgetMs?: number
    /** Waits out retries and cooldowns; tests replace it. */
    sleep?: (ms: number) => Promise<void>
  }) {
    this.logger = deps.logger.child({ module: 'daily-rates-service' })
    this.mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
    const provider = new URL(this.mempoolApiUrl)
    provider.username = ''
    provider.password = ''
    provider.search = ''
    provider.hash = ''
    const providerUrl = provider.toString().replace(/\/$/, '')
    const allowPublicFallback = deps.allowPublicFallback ?? (() => true)
    this.allowPublicFallback = allowPublicFallback
    this.allowRequests = deps.allowRequests ?? (() => true)
    this.downloadRetryDelaysMs = deps.downloadRetryDelaysMs ?? DOWNLOAD_RETRY_DELAYS_MS
    this.priceBudgetMs = deps.priceBudgetMs ?? PRICE_BUDGET_MS
    this.sleep = deps.sleep ?? sleep
    this.publicFallback =
      providerUrl === PUBLIC_MEMPOOL_URL
        ? undefined
        : new DailyRatesService({
            db: deps.db,
            logger: deps.logger,
            mempoolApiUrl: PUBLIC_MEMPOOL_URL,
            allowRequests: allowPublicFallback,
            downloadRetryDelaysMs: this.downloadRetryDelaysMs,
            sleep: this.sleep,
          })
    // Prices are kept by URL, without credentials.
    this.cache = new QuoteCache(deps.db, providerUrl)
  }

  public getDailyRates = asyncFn(
    async (
      openingDate: Date,
      closingDate: Date,
      quoteCurrency: StatementQuoteCurrency = 'USD',
      requiredDates?: Date[],
      options: DailyRatesOptions = {},
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
      // A statement prices every day in its range, not just the days it needs, so whether it falls
      // back to public mempool.space never depends on which days had activity. The chart's evenly
      // spaced days reveal nothing, so it prices only those.
      const coverage =
        options.requiredDaysOnly === true
          ? days
          : Array.from({ length: (end - start) / DAY_SECONDS + 1 }, (_, i) => start + i * DAY_SECONDS)
      // The chart's newest point is the live price, so its history only needs downloading daily.
      const settling = utcDay(new Date()) - SETTLING_DAYS * DAY_SECONDS
      const maxAge = options.staleWhileRefreshing !== true && coverage.some((day) => day >= settling) ? HOUR_MS : DAY_MS
      // Only statements retry patiently; the chart would rather show saved prices, or fail, sooner.
      const wait: Patience = {
        patient: options.staleWhileRefreshing !== true,
        deadline: Date.now() + this.priceBudgetMs,
      }
      if (options.staleWhileRefreshing === true) {
        // Recent prices come first, so a source offline for over a day doesn't hide another's.
        const saved = await this.pick(days, quoteCurrency, { maxAge })
        const older = await this.pick(
          days.filter((day) => !saved.has(day)),
          quoteCurrency,
        )
        for (const [target, quote] of older) {
          saved.set(target, quote)
        }
        if (saved.size === days.length) {
          void this.pick(coverage, quoteCurrency, { maxAge, wait })
            .then((refreshed) => {
              if (refreshed.size < coverage.length) {
                this.logger.warn('Could not refresh saved prices')
              }
            })
            .catch(() => {
              this.logger.warn('Could not refresh saved prices')
            })
          return Ok(toDailyRates(saved, quoteCurrency))
        }
      }
      const priced = await this.pick(coverage, quoteCurrency, { maxAge, wait })
      if (priced.size < coverage.length) {
        return Err(new Error(`No recent ${quoteCurrency} price for every day`))
      }
      return Ok(toDailyRates(new Map(days.map((day) => [day, priced.get(day)])), quoteCurrency))
    },
  )

  /**
   * Each day's closest quote within four days, from this source, then from public mempool.space for
   * any days left if Settings allows it. With `recent`, a source whose history is older than
   * `maxAge` is skipped, or with `wait`, downloads it again first and is skipped if it can't.
   * Without, saved prices of any age are used.
   */
  private async pick(
    days: number[],
    currency: StatementQuoteCurrency,
    recent?: { maxAge: number; wait?: Patience },
  ): Promise<Map<number, CachedQuote>> {
    const chosen = new Map<number, CachedQuote>()
    for (const source of [this, this.publicFallback]) {
      if (chosen.size === days.length) {
        break
      }
      if (!source || (source !== this && !(await this.allowPublicFallback()))) {
        continue
      }
      if (
        recent &&
        !(recent.wait
          ? await source.ensureDownloaded(currency, recent.maxAge, recent.wait)
          : await source.isRecent(currency, recent.maxAge))
      ) {
        continue
      }
      const now = Date.now()
      for (const target of days.filter((day) => !chosen.has(day))) {
        const { oldest, newest } = quoteWindow(target, now)
        const quote = await source.cache.find(currency, target, oldest, newest)
        if (quote) {
          chosen.set(target, quote)
        }
      }
    }
    return chosen
  }

  /** Whether this source downloaded its history in a currency within `maxAge`. */
  private async isRecent(currency: StatementQuoteCurrency, maxAge: number): Promise<boolean> {
    const downloadedAt = await this.cache.downloadedAt(currency)
    return downloadedAt !== undefined && Date.now() - downloadedAt < maxAge
  }

  /** Downloads this source's history in a currency unless it's recent enough. True if it is now. */
  private async ensureDownloaded(currency: StatementQuoteCurrency, maxAge: number, wait: Patience): Promise<boolean> {
    if (await this.isRecent(currency, maxAge)) {
      return true
    }
    for (let running = this.downloads.get(currency); running;) {
      const shared = await until(running.result, wait.deadline)
      // A statement that joined the chart's quick attempt tries again with its own patience,
      // joining another statement's retry if one has started.
      if (shared !== false || running.patient || !wait.patient) {
        return shared === true
      }
      const next = this.downloads.get(currency)
      running = next === running ? undefined : next
    }
    const result = this.download(currency, wait)
    const entry = { patient: wait.patient, result }
    this.downloads.set(currency, entry)
    try {
      return await result
    } finally {
      if (this.downloads.get(currency) === entry) {
        this.downloads.delete(currency)
      }
    }
  }

  /** One request for every price this source has in a currency, replacing its saved history. */
  private async download(currency: StatementQuoteCurrency, wait: Patience): Promise<boolean> {
    // A statement waits out a short cooldown, such as one left by the chart's quick attempt.
    // Checked again after waiting, since another currency's request may have extended it.
    for (
      let cooldown = this.unavailableUntil - Date.now();
      cooldown > 0;
      cooldown = this.unavailableUntil - Date.now()
    ) {
      if (!wait.patient || !fits(cooldown, wait.deadline)) {
        return false
      }
      await this.sleep(cooldown)
    }
    const response = await this.request(`${this.mempoolApiUrl}/api/v1/historical-price?currency=${currency}`, wait)
    if (response.isErr()) {
      return false
    }
    // Older mempools send every currency's history, whichever one the request names.
    const parsed = parseUnknown(historySchema, response.unwrap())
    if (parsed.isErr()) {
      return false
    }
    const now = Date.now()
    const earliest = utcDay(MIN_MEMPOOL_PRICE_DATE) - MAX_QUOTE_DISTANCE_DAYS * DAY_SECONDS
    const points: HistoryPoint[] = []
    for (const point of parsed.unwrap().prices) {
      const price = parseUnknown(priceSchema, point[currency])
      if (point.time >= earliest && point.time * 1000 <= now && price.isOk()) {
        points.push({ timestamp: point.time, price: new Decimal(price.unwrap()).toString() })
      }
    }
    if (points.length === 0) {
      return false
    }
    await this.cache.saveHistory(currency, points, now)
    return true
  }

  /**
   * GETs JSON from this source while a retry still fits before the deadline: a statement retries
   * patiently, waiting out a Retry-After, and the chart only backs off through brief rate limits.
   * A failure the source might recover from puts it in cooldown.
   */
  private async request(url: string, wait: Patience): Promise<Result<unknown, Error>> {
    const retryDelaysMs = wait.patient ? this.downloadRetryDelaysMs : undefined
    const attempts = retryDelaysMs ? retryDelaysMs.length + 1 : MAX_ATTEMPTS
    const maxRetryAfterMs = retryDelaysMs ? Number.POSITIVE_INFINITY : 2_000
    const delay = (attempt: number): number => retryDelaysMs?.[attempt] ?? RETRY_BASE_MS * 2 ** attempt
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Stop retrying once a concurrent request has put the source in cooldown, unless this is a
      // patient request with time left to wait it out.
      const cooldown = this.unavailableUntil - Date.now()
      if (attempt > 0 && cooldown > 0) {
        if (!retryDelaysMs || !fits(cooldown, wait.deadline)) {
          return Err(new Error('Price source temporarily unavailable'))
        }
        await this.sleep(cooldown)
      }
      // Checked after every wait, so turning a source off in Settings stops it at once.
      if (!(await this.allowRequests())) {
        return Err(new Error('Requests to this price source are turned off'))
      }
      try {
        const timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, wait.deadline - Date.now()))
        const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          const header = response.headers.get('retry-after')
          const retryMs =
            header === null
              ? delay(attempt)
              : /^\d+$/.test(header)
                ? Number(header) * 1000
                : Date.parse(header) - Date.now()
          // Respect long Retry-After windows without keeping a statement request asleep.
          if (
            retryable &&
            attempt < attempts - 1 &&
            Number.isFinite(retryMs) &&
            retryMs >= 0 &&
            retryMs <= maxRetryAfterMs &&
            fits(retryMs, wait.deadline)
          ) {
            await this.sleep(retryMs)
            continue
          }
          if (retryable) {
            // Concurrent failures keep the longest cooldown any of them asked for.
            this.unavailableUntil = Math.max(
              this.unavailableUntil,
              Date.now() + Math.max(30_000, Number.isFinite(retryMs) ? Math.min(Math.max(0, retryMs), HOUR_MS) : 0),
            )
          }
          this.logger.warn({ status: response.status }, 'Mempool price source unavailable')
          return Err(new Error('Price request failed'))
        }
        return Ok(await response.json())
      } catch {
        // Unreachable or too slow: try once more at once, or keep to the given schedule, while a
        // retry still fits.
        if (retryDelaysMs && attempt < attempts - 1 && fits(delay(attempt), wait.deadline)) {
          await this.sleep(delay(attempt))
          continue
        }
        if (!retryDelaysMs && attempt === 0 && fits(0, wait.deadline)) {
          continue
        }
        this.unavailableUntil = Math.max(this.unavailableUntil, Date.now() + 30_000)
        return Err(new Error('Unable to reach the price source'))
      }
    }
    return Err(new Error('Price source unavailable'))
  }
}

/** Whether a price lookup retries patiently, as a statement's does, and when it stops. */
interface Patience {
  patient: boolean
  deadline: number
}

/** Whether a request can still start after waiting `ms`, with its shortest time limit, before `deadline`. */
function fits(ms: number, deadline: number): boolean {
  return Date.now() + ms + MIN_TIMEOUT_MS <= deadline
}

/** The promise's value, or undefined if `deadline` passes first. */
async function until<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  let stop = (): void => {}
  const timeout = new Promise<undefined>((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, deadline - Date.now()))
    stop = () => {
      clearTimeout(timer)
    }
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    stop()
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function toDailyRates(chosen: Map<number, CachedQuote | undefined>, quoteCurrency: StatementQuoteCurrency): DailyRates {
  // Days are chosen in date order, so the rates keep that order.
  const rates: Record<string, DailyRate> = {}
  for (const [target, quote] of [...chosen].sort(([a], [b]) => a - b)) {
    if (quote) {
      rates[toDateKey(new Date(target * 1000))] = toDailyRate(quote)
    }
  }
  const providerUrls = [
    ...new Set(Object.values(rates).flatMap((rate) => (rate.providerUrl !== undefined ? [rate.providerUrl] : []))),
  ].sort()
  return {
    rates,
    source: 'mempool',
    quoteCurrency,
    providerUrls,
    providerUrl: providerUrls.length === 1 ? providerUrls[0] : undefined,
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
