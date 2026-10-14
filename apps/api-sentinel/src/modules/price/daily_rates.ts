import { createHash } from 'node:crypto'
import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
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
   * The required dates don't depend on wallet activity, such as evenly spaced chart days, so a
   * day-by-day fallback may request just them instead of every day in the range.
   */
  requestRequiredDays?: boolean
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
const DAY_MS = 86_400_000
/** Saved prices are downloaded again after a day; the last few days, still settling, after an hour. */
const SETTLING_DAYS = 2
const MAX_REQUEST_DAYS = 2 * 366
/** Rate-limited requests back off 0.5, 1, then 2 seconds before the source cools down. */
const MAX_ATTEMPTS = 4
const RETRY_BASE_MS = 500
/**
 * A statement waits for its prices, so its download keeps trying for about a minute before
 * falling back, and waits out a source that asks for up to a minute.
 */
const DOWNLOAD_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000]
const MAX_PATIENT_RETRY_AFTER_MS = 60_000
/** How long a statement waits for its prices in all, across every source it tries. */
const PRICE_BUDGET_MS = 60_000
/** A request's time limit; a full download is about 1 MB, so it gets longer on a slow connection. */
const REQUEST_TIMEOUT_MS = 10_000
const DOWNLOAD_TIMEOUT_MS = 60_000
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
/** The full history: every observation, each with this currency's price (or -1 when it has none). */
const historySchema = z.object({
  prices: z
    .array(z.object({ time: z.number().int().nonnegative().max(8_640_000_000_000) }).catchall(z.unknown()))
    .max(200_000),
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
  private readonly downloadRetryDelaysMs: readonly number[]
  private readonly priceBudgetMs: number
  private readonly inFlight = new Map<number, Promise<Result<void, Error>>>()
  private readonly downloads = new Map<
    StatementQuoteCurrency,
    { patient: boolean; result: Promise<Result<void, Error>> }
  >()
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
    /** Waits between a statement's download attempts; tests shorten them. */
    downloadRetryDelaysMs?: readonly number[]
    /** How long a statement waits for its prices in all; tests shorten it. */
    priceBudgetMs?: number
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
    this.downloadRetryDelaysMs = deps.downloadRetryDelaysMs ?? DOWNLOAD_RETRY_DELAYS_MS
    this.priceBudgetMs = deps.priceBudgetMs ?? PRICE_BUDGET_MS
    this.publicFallback =
      this.providerUrl === PUBLIC_MEMPOOL_URL
        ? undefined
        : new DailyRatesService({
            db: deps.db,
            logger: deps.logger,
            mempoolApiUrl: PUBLIC_MEMPOOL_URL,
            allowRequests: allowPublicFallback,
            downloadRetryDelaysMs: this.downloadRetryDelaysMs,
          })
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
      // A statement confirms every day in its range, never just the days it needs, so neither what
      // it asks for nor when it stops can show which days had activity. The chart's evenly spaced
      // days reveal nothing, so it confirms only those.
      const coverage =
        options.requestRequiredDays === true
          ? days
          : Array.from({ length: (end - start) / DAY_SECONDS + 1 }, (_, i) => start + i * DAY_SECONDS)
      // The chart's newest point is the live price, so its saved prices only need checking daily.
      // A statement checks days still settling every hour.
      const settling = utcDay(new Date()) - SETTLING_DAYS * DAY_SECONDS
      const maxAge = (day: number): number =>
        options.staleWhileRefreshing !== true && day >= settling ? HOUR_MS : DAY_MS
      if (options.staleWhileRefreshing === true) {
        const saved = await this.pick(days, quoteCurrency)
        if (saved) {
          void this.confirm(coverage, quoteCurrency, maxAge, { patient: false, deadline: Number.POSITIVE_INFINITY })
            .then((refreshed) => {
              if (refreshed.isErr()) {
                this.logger.warn('Could not refresh saved prices')
              }
            })
            .catch(() => {
              this.logger.warn('Could not refresh saved prices')
            })
          return Ok(toDailyRates(saved, quoteCurrency))
        }
      }
      // Only callers that show saved prices meanwhile skip the long retries.
      const patient = options.staleWhileRefreshing !== true
      const confirmed = await this.confirm(coverage, quoteCurrency, maxAge, {
        patient,
        deadline: patient ? Date.now() + this.priceBudgetMs : Number.POSITIVE_INFINITY,
      })
      if (confirmed.isErr()) {
        return Err(confirmed.unwrapErr())
      }
      const chosen = new Map(days.map((day) => [day, confirmed.unwrap().get(day)]))
      return Ok(toDailyRates(chosen, quoteCurrency))
    },
  )

  /**
   * Each day's closest saved quote within the window, or undefined if any day has none. With
   * `maxAge`, only quotes refreshed from a source within that time of now count.
   */
  private async pick(
    days: number[],
    currency: StatementQuoteCurrency,
    maxAge?: (day: number) => number,
  ): Promise<Map<number, CachedQuote> | undefined> {
    const now = Date.now()
    const chosen = new Map<number, CachedQuote>()
    for (const target of days) {
      const { oldest, newest } = quoteWindow(target, now)
      const quote = await this.cache.find(
        currency,
        target,
        oldest,
        newest,
        maxAge === undefined ? undefined : now - maxAge(target),
      )
      if (!quote) {
        return undefined
      }
      chosen.set(target, quote)
    }
    return chosen
  }

  /**
   * Confirms a quote for every day with a source: this one's full history, then this one day by
   * day, then the same from public mempool.space if Settings allows it. Asking a configured node
   * day by day comes before going public, so the node keeps its prices to itself.
   */
  private async confirm(
    days: number[],
    currency: StatementQuoteCurrency,
    maxAge: (day: number) => number,
    attempt: Attempt,
  ): Promise<Result<Map<number, CachedQuote>, Error>> {
    const strictest = Math.min(...days.map(maxAge))
    for (const source of [this, this.publicFallback]) {
      if (!source || (source !== this && !(await this.allowPublicFallback()))) {
        continue
      }
      if ((await source.ensureDownloaded(currency, strictest, attempt)).isOk()) {
        const fresh = await this.pick(days, currency, maxAge)
        if (fresh) {
          return Ok(fresh)
        }
      }
      // Day by day, every day must be confirmed by this source itself, not by a neighbour's or
      // another source's earlier answer.
      if (await source.lookUpEach(days, currency)) {
        const fresh = await this.pick(days, currency, maxAge)
        if (fresh) {
          return Ok(fresh)
        }
      }
    }
    return Err(new Error(`No confirmed ${currency} price for every day`))
  }

  /**
   * Looks up every day from this source, four at a time, without stopping early: when the lookups
   * stop never depends on which days they were for. True if every day found a quote.
   */
  private async lookUpEach(days: number[], currency: StatementQuoteCurrency): Promise<boolean> {
    let complete = true
    for (let i = 0; i < days.length; i += DailyRatesService.CONCURRENCY) {
      const results = await Promise.all(
        days.slice(i, i + DailyRatesService.CONCURRENCY).map(async (target) => this.getQuote(target, currency)),
      )
      complete &&= results.every((result) => result.isOk())
    }
    return complete
  }

  /** Downloads this source's full history in a currency unless the last download is recent enough. */
  private async ensureDownloaded(
    currency: StatementQuoteCurrency,
    maxAge: number,
    attempt: Attempt,
  ): Promise<Result<void, Error>> {
    const downloadedAt = await this.cache.downloadedAt(currency)
    if (downloadedAt !== undefined && Date.now() - downloadedAt < maxAge) {
      return Ok(undefined)
    }
    const running = this.downloads.get(currency)
    if (running) {
      const shared = await running.result
      // A statement that joined the chart's quick attempt tries again with its own patience.
      if (shared.isOk() || running.patient || !attempt.patient) {
        return shared
      }
    }
    const result = this.download(currency, attempt)
    const entry = { patient: attempt.patient, result }
    this.downloads.set(currency, entry)
    try {
      return await result
    } finally {
      if (this.downloads.get(currency) === entry) {
        this.downloads.delete(currency)
      }
    }
  }

  /** One request for every price this source has in a currency; it names no dates. */
  private async download(currency: StatementQuoteCurrency, attempt: Attempt): Promise<Result<void, Error>> {
    if (!(await this.allowRequests())) {
      return Err(new Error('Requests to this price source are turned off'))
    }
    // A statement waits out a short cooldown, such as one left by the chart's quick attempt.
    const cooldown = this.unavailableUntil - Date.now()
    if (cooldown > 0) {
      if (!attempt.patient || Date.now() + cooldown > attempt.deadline) {
        return Err(new Error('Mempool price source temporarily unavailable'))
      }
      await sleep(cooldown)
    }
    const response = await this.request(`${this.mempoolApiUrl}/api/v1/historical-price?currency=${currency}`, {
      cooldownOnRejection: false,
      retryDelaysMs: attempt.patient ? this.downloadRetryDelaysMs : undefined,
      deadline: attempt.deadline,
      // A slow connection can use the whole budget; the first attempt always gets a fair chance.
      timeoutMs: attempt.patient ? Math.max(REQUEST_TIMEOUT_MS, attempt.deadline - Date.now()) : DOWNLOAD_TIMEOUT_MS,
    })
    if (response.isErr()) {
      return Err(response.unwrapErr())
    }
    const parsed = parseUnknown(historySchema, response.unwrap())
    if (parsed.isErr()) {
      return Err(new Error('Invalid mempool price history response'))
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
      return Err(new Error(`The mempool price source has no ${currency} history`))
    }
    await this.cache.saveHistory(currency, points, now)
    return Ok(undefined)
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
    const response = await this.request(`${this.mempoolApiUrl}/api/v1/historical-price?timestamp=${target}`, {
      cooldownOnRejection: true,
      deadline: Number.POSITIVE_INFINITY,
      timeoutMs: REQUEST_TIMEOUT_MS,
    })
    if (response.isErr()) {
      return Err(response.unwrapErr())
    }
    const parsed = parseUnknown(responseSchema, response.unwrap())
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
    const settling = target >= utcDay(new Date()) - SETTLING_DAYS * DAY_SECONDS
    // Only a complete observation at the lookup time outside the last few days is settled, and even
    // that is looked up again after a day. Anything else may improve, so it's checked hourly.
    const settled = complete && !settling && point?.time === target
    await this.cache.save(target, point?.time ?? null, quotes, Date.now() + (settled ? DAY_MS : HOUR_MS))
    return Ok(undefined)
  }

  /**
   * GETs JSON from this source, backing off through brief rate limits, or through `retryDelaysMs`
   * when given, but never waiting past `deadline`. A failure puts the source in cooldown, except a
   * request the source rejects outright when `cooldownOnRejection` is off, as an older mempool
   * without full-history downloads would.
   */
  private async request(
    url: string,
    {
      cooldownOnRejection,
      retryDelaysMs,
      deadline,
      timeoutMs,
    }: { cooldownOnRejection: boolean; retryDelaysMs?: readonly number[]; deadline: number; timeoutMs: number },
  ): Promise<Result<unknown, Error>> {
    const attempts = retryDelaysMs ? retryDelaysMs.length + 1 : MAX_ATTEMPTS
    const maxRetryAfterMs = retryDelaysMs ? MAX_PATIENT_RETRY_AFTER_MS : 2_000
    const delay = (attempt: number): number => retryDelaysMs?.[attempt] ?? RETRY_BASE_MS * 2 ** attempt
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0 && !(await this.allowRequests())) {
        return Err(new Error('Requests to this price source are turned off'))
      }
      // Stop retrying once a concurrent request has put the source in cooldown, unless this is a
      // patient request with time left to wait it out.
      const cooldown = this.unavailableUntil - Date.now()
      if (attempt > 0 && cooldown > 0) {
        if (!retryDelaysMs || Date.now() + cooldown > deadline) {
          return Err(new Error('Mempool price source temporarily unavailable'))
        }
        await sleep(cooldown)
      }
      try {
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
          // Back off through brief rate limits, since one failed day fails the statement.
          // Respect long Retry-After windows without keeping a statement request asleep.
          if (
            retryable &&
            attempt < attempts - 1 &&
            Number.isFinite(retryMs) &&
            retryMs >= 0 &&
            retryMs <= maxRetryAfterMs &&
            Date.now() + retryMs <= deadline
          ) {
            await sleep(retryMs)
            continue
          }
          if (retryable || cooldownOnRejection) {
            // Concurrent failures keep the longest cooldown any of them asked for.
            this.unavailableUntil = Math.max(
              this.unavailableUntil,
              Date.now() + Math.max(30_000, Number.isFinite(retryMs) ? Math.min(Math.max(0, retryMs), HOUR_MS) : 0),
            )
          }
          this.logger.warn({ status: response.status }, 'Configured mempool price source unavailable')
          return Err(new Error('Mempool historical pricing request failed'))
        }
        return Ok(await response.json())
      } catch {
        // Unreachable: try once more at once, or keep to the given schedule while time is left.
        if (retryDelaysMs && attempt < attempts - 1 && Date.now() + delay(attempt) <= deadline) {
          await sleep(delay(attempt))
          continue
        }
        if (!retryDelaysMs && attempt === 0) {
          continue
        }
        this.unavailableUntil = Math.max(this.unavailableUntil, Date.now() + 30_000)
        return Err(new Error('Unable to reach the configured mempool price source'))
      }
    }
    return Err(new Error('Mempool price source unavailable'))
  }
}

/** How long a price lookup may take, and whether it retries patiently, as a statement does. */
interface Attempt {
  patient: boolean
  deadline: number
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
