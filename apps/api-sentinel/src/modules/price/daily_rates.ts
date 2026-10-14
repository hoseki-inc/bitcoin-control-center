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
 * falling back, and waits out a source that asks it to while there's time.
 */
const DOWNLOAD_RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000, 10_000, 20_000]
/** How long a statement, or the chart's first load, waits for prices in all, across every source. */
const PRICE_BUDGET_MS = 60_000
/**
 * A request's time limit is the time left before that deadline, but at least 10 seconds, and at
 * most 10 seconds for one day's price or a minute for a full history, which is about 1 MB.
 */
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
  private readonly sleep: (ms: number) => Promise<void>
  private readonly fillsGaps: boolean
  private readonly inFlight = new Map<number, Promise<Result<void, Error>>>()
  private readonly downloads = new Map<StatementQuoteCurrency, { patient: boolean; result: Promise<Download> }>()
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
    /** How long prices are waited for in all; tests shorten it. */
    priceBudgetMs?: number
    /** Waits out retries and cooldowns; tests replace it. */
    sleep?: (ms: number) => Promise<void>
    /** Set on the public fallback, whose downloads keep the configured source's recent prices. */
    fillsGaps?: boolean
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
    this.sleep = deps.sleep ?? sleep
    this.fillsGaps = deps.fillsGaps ?? false
    this.publicFallback =
      this.providerUrl === PUBLIC_MEMPOOL_URL
        ? undefined
        : new DailyRatesService({
            db: deps.db,
            logger: deps.logger,
            mempoolApiUrl: PUBLIC_MEMPOOL_URL,
            allowRequests: allowPublicFallback,
            downloadRetryDelaysMs: this.downloadRetryDelaysMs,
            sleep: this.sleep,
            fillsGaps: true,
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
      // Only statements retry patiently; the chart would rather show saved prices, or fail, sooner.
      const wait: Patience = {
        patient: options.staleWhileRefreshing !== true,
        deadline: Date.now() + this.priceBudgetMs,
      }
      if (options.staleWhileRefreshing === true) {
        const saved = await this.pick(days, quoteCurrency)
        if (saved.size === days.length) {
          void this.confirm(coverage, quoteCurrency, maxAge, wait)
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
      const confirmed = await this.confirm(coverage, quoteCurrency, maxAge, wait)
      if (confirmed.isErr()) {
        return Err(confirmed.unwrapErr())
      }
      const chosen = new Map(days.map((day) => [day, confirmed.unwrap().get(day)]))
      return Ok(toDailyRates(chosen, quoteCurrency))
    },
  )

  /**
   * Each day's closest saved quote within its window, leaving out days without one. With `maxAge`,
   * only quotes refreshed from a source within that time of now count.
   */
  private async pick(
    days: number[],
    currency: StatementQuoteCurrency,
    maxAge?: (day: number) => number,
  ): Promise<Map<number, CachedQuote>> {
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
      if (quote) {
        chosen.set(target, quote)
      }
    }
    return chosen
  }

  /**
   * Confirms a recent quote for every day with this source, then with public mempool.space if any
   * are left and Settings allows it, and uses the closest recent quote for each. A source confirms
   * days from its full history, or day by day if it can't send one, so a configured node is asked
   * day by day before going public, keeping its prices to itself.
   */
  private async confirm(
    days: number[],
    currency: StatementQuoteCurrency,
    maxAge: (day: number) => number,
    wait: Patience,
  ): Promise<Result<Map<number, CachedQuote>, Error>> {
    const strictest = Math.min(...days.map(maxAge))
    const confirmed = new Set<number>()
    for (const source of [this, this.publicFallback]) {
      if (!source || (source !== this && !(await this.allowPublicFallback()))) {
        continue
      }
      // A source looks up every day, not just those left, since it may have a closer price.
      const downloaded = await source.ensureDownloaded(currency, strictest, wait)
      const found =
        downloaded === 'saved'
          ? [...(await this.pick(days, currency, maxAge)).keys()]
          : downloaded === 'unsupported'
            ? await source.lookUpEach(days, currency, maxAge, wait.deadline)
            : []
      for (const day of found) {
        confirmed.add(day)
      }
      if (confirmed.size === days.length) {
        const fresh = await this.pick(days, currency, maxAge)
        if (fresh.size === days.length) {
          return Ok(fresh)
        }
      }
    }
    return Err(new Error(`No confirmed ${currency} price for every day`))
  }

  /**
   * Looks up every day from this source, four at a time, without stopping at a failure: when the
   * lookups stop depends on the time, never on which days they were for. Returns the days confirmed.
   */
  private async lookUpEach(
    days: number[],
    currency: StatementQuoteCurrency,
    maxAge: (day: number) => number,
    deadline: number,
  ): Promise<number[]> {
    const confirmed: number[] = []
    for (let i = 0; i < days.length && Date.now() < deadline; i += DailyRatesService.CONCURRENCY) {
      const found = await Promise.all(
        days
          .slice(i, i + DailyRatesService.CONCURRENCY)
          .map(async (target) => ((await this.getQuote(target, currency, maxAge(target), deadline)) ? [target] : [])),
      )
      confirmed.push(...found.flat())
    }
    return confirmed
  }

  /** Downloads this source's full history in a currency unless the last download is recent enough. */
  private async ensureDownloaded(currency: StatementQuoteCurrency, maxAge: number, wait: Patience): Promise<Download> {
    const downloadedAt = await this.cache.downloadedAt(currency)
    if (downloadedAt !== undefined && Date.now() - downloadedAt < maxAge) {
      return 'saved'
    }
    const running = this.downloads.get(currency)
    if (running) {
      const shared = await until(running.result, wait.deadline)
      if (shared === undefined) {
        return 'failed'
      }
      // A statement that joined the chart's quick attempt tries again with its own patience.
      if (shared !== 'failed' || running.patient || !wait.patient) {
        return shared
      }
    }
    const result = this.download(currency, maxAge, wait)
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

  /** One request for every price this source has in a currency; it names no dates. */
  private async download(currency: StatementQuoteCurrency, maxAge: number, wait: Patience): Promise<Download> {
    // A statement waits out a short cooldown, such as one left by the chart's quick attempt.
    const cooldown = this.unavailableUntil - Date.now()
    if (cooldown > 0) {
      if (!wait.patient || !fits(cooldown, wait.deadline)) {
        return 'failed'
      }
      await this.sleep(cooldown)
    }
    const response = await this.request(`${this.mempoolApiUrl}/api/v1/historical-price?currency=${currency}`, {
      cooldownOnRejection: false,
      retryDelaysMs: wait.patient ? this.downloadRetryDelaysMs : undefined,
      deadline: wait.deadline,
      maxTimeoutMs: DOWNLOAD_TIMEOUT_MS,
    })
    if (response.isErr()) {
      return response.unwrapErr() === 'rejected' ? 'unsupported' : 'failed'
    }
    const parsed = parseUnknown(historySchema, response.unwrap())
    if (parsed.isErr()) {
      return 'unsupported'
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
    // A source with no prices in this currency won't have them day by day either.
    if (points.length === 0) {
      return 'failed'
    }
    // Public prices only fill gaps and replace stale ones, never the configured source's recent prices.
    await this.cache.saveHistory(currency, points, now, this.fillsGaps ? now - maxAge : undefined)
    return 'saved'
  }

  /** Searches this source for a recent quote near one day, and says whether it found one. */
  private async getQuote(
    target: number,
    currency: StatementQuoteCurrency,
    maxAge: number,
    deadline: number,
  ): Promise<boolean> {
    const now = Date.now()
    const refreshedSince = now - maxAge
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
    const cached = await this.cache.find(currency, target, oldest, newest, refreshedSince)
    if (cached?.timestamp === target && (await this.cache.hasFreshLookup(target, now))) {
      return true
    }
    // Lookups this source already made are not repeated, so a completed search reuses the cache.
    // Their receipts can be up to a day old, so a day that must be fresher asks again.
    for (const lookup of lookups) {
      if (maxAge < DAY_MS || !(await this.cache.isFresh(lookup, now))) {
        if (Date.now() >= deadline) {
          return false
        }
        const fetched = await this.fetchDay(lookup, lookup !== target || !sourceAvailable, deadline)
        if (fetched.isErr()) {
          return false
        }
      }
      const available = await this.cache.find(currency, target, oldest, newest, refreshedSince)
      // An exact match cannot be improved by looking farther away.
      if (available?.timestamp === target) {
        return true
      }
    }
    // This source answered only if it supplied a nearby observation itself. A quote another
    // source saved must not stop the fallback from searching.
    return this.cache.hasOwnQuote(currency, oldest, newest, refreshedSince)
  }

  private async fetchDay(target: number, checkCooldown: boolean, deadline: number): Promise<Result<void, Error>> {
    const running = this.inFlight.get(target)
    if (running) {
      return running
    }
    if (checkCooldown && Date.now() < this.unavailableUntil) {
      return Err(new Error('Mempool price source temporarily unavailable'))
    }
    const request = this.requestDay(target, deadline)
    this.inFlight.set(target, request)
    try {
      return await request
    } finally {
      this.inFlight.delete(target)
    }
  }

  private async requestDay(target: number, deadline: number): Promise<Result<void, Error>> {
    const response = await this.request(`${this.mempoolApiUrl}/api/v1/historical-price?timestamp=${target}`, {
      cooldownOnRejection: true,
      deadline,
      maxTimeoutMs: REQUEST_TIMEOUT_MS,
    })
    if (response.isErr()) {
      return Err(new Error('Mempool historical pricing request failed'))
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
   * when given, while a retry still fits before `deadline`. A failure puts the source in cooldown,
   * except a request the source rejects outright when `cooldownOnRejection` is off, as an older
   * mempool without full-history downloads would.
   */
  private async request(
    url: string,
    {
      cooldownOnRejection,
      retryDelaysMs,
      deadline,
      maxTimeoutMs,
    }: { cooldownOnRejection: boolean; retryDelaysMs?: readonly number[]; deadline: number; maxTimeoutMs: number },
  ): Promise<Result<unknown, RequestFailure>> {
    const attempts = retryDelaysMs ? retryDelaysMs.length + 1 : MAX_ATTEMPTS
    const maxRetryAfterMs = retryDelaysMs ? Number.POSITIVE_INFINITY : 2_000
    const delay = (attempt: number): number => retryDelaysMs?.[attempt] ?? RETRY_BASE_MS * 2 ** attempt
    for (let attempt = 0; attempt < attempts; attempt++) {
      // Stop retrying once a concurrent request has put the source in cooldown, unless this is a
      // patient request with time left to wait it out.
      const cooldown = this.unavailableUntil - Date.now()
      if (attempt > 0 && cooldown > 0) {
        if (!retryDelaysMs || !fits(cooldown, deadline)) {
          return Err<RequestFailure>('failed')
        }
        await this.sleep(cooldown)
      }
      // Checked after every wait, so turning a source off in Settings stops it at once.
      if (!(await this.allowRequests())) {
        return Err<RequestFailure>('failed')
      }
      try {
        const timeoutMs = Math.min(maxTimeoutMs, Math.max(REQUEST_TIMEOUT_MS, deadline - Date.now()))
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
            fits(retryMs, deadline)
          ) {
            await this.sleep(retryMs)
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
          return Err<RequestFailure>(retryable ? 'failed' : 'rejected')
        }
        return Ok(await response.json())
      } catch {
        // Unreachable or too slow: try once more at once, or keep to the given schedule, while a
        // retry still fits.
        if (retryDelaysMs && attempt < attempts - 1 && fits(delay(attempt), deadline)) {
          await this.sleep(delay(attempt))
          continue
        }
        if (!retryDelaysMs && attempt === 0 && fits(0, deadline)) {
          continue
        }
        this.unavailableUntil = Math.max(this.unavailableUntil, Date.now() + 30_000)
        return Err<RequestFailure>('failed')
      }
    }
    return Err<RequestFailure>('failed')
  }
}

/** Whether a price lookup retries patiently, as a statement's does, and when it stops. */
interface Patience {
  patient: boolean
  deadline: number
}

/** A source refused the request, or it failed. */
type RequestFailure = 'rejected' | 'failed'

/**
 * How a full-history download went. `unsupported` means the source answered but refused it, or
 * sent something else, as an older mempool does, so asking it day by day may still work.
 */
type Download = 'saved' | 'unsupported' | 'failed'

/** Whether a request can still start after waiting `ms`, with its shortest time limit, before `deadline`. */
function fits(ms: number, deadline: number): boolean {
  return Date.now() + ms + REQUEST_TIMEOUT_MS <= deadline
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
