import { Err, Ok, tryBlock } from '@hoseki/packages/result'
import type { AsyncResult, Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'

/** Settings keys for the current price source and fallbacks. */
export const PRICE_SOURCE_SETTING = 'price_source'
export const PRICE_FALLBACKS_SETTING = 'price_fallbacks_enabled'

/**
 * Price sources in fallback order. The first one available is the default: a self-hosted
 * mempool server when one is configured, otherwise Block.
 */
export const PRICE_SOURCES = ['mempool', 'block', 'mempool.space', 'coinbase', 'coingecko'] as const
export type PriceSourceName = (typeof PRICE_SOURCES)[number]

export interface SavedPriceSettings {
  source: PriceSourceName | undefined
  fallbacks: boolean
}

export interface PriceSourceOptions {
  selected: PriceSourceName
  fallbacks: boolean
  sources: Array<{ name: PriceSourceName; label: string }>
}

export interface BtcPrice {
  value: Decimal
  /** When the source set this price, measured against the source's own clock where it sends one. */
  asOf: Date
  source: PriceSourceName
  /** True when no allowed source answered and this is the last price found. */
  lastKnown: boolean
}

interface Quote {
  value: Decimal
  asOf?: Date
}

interface PriceSource {
  name: PriceSourceName
  label: string
  url: string
  read: (response: Response) => Promise<Quote | null>
}

/**
 * A moment measured on both clocks. The wall clock keeps running while a laptop sleeps; the
 * monotonic clock is unaffected when the wall clock is corrected. Elapsed time takes the larger.
 */
class Moment {
  private readonly wall = Date.now()
  private readonly monotonic = performance.now()

  public elapsed(): number {
    return Math.max(Date.now() - this.wall, performance.now() - this.monotonic, 0)
  }
}

/** The latest price a source supplied. */
interface Sample {
  value: Decimal
  source: PriceSourceName
  /** How old the price already was when fetched, by the source's clock. */
  ageAtFetch: number
  fetchedAt: Moment
}

interface Failure {
  error: Error
  failedAt: Moment
  /** Refusals, timeouts and bad answers wait before the source is asked again; network errors do not. */
  wait: boolean
}

interface PriceRequest {
  startedAt: Moment
  done: Promise<Result<Sample, PriceRequestError>>
  /** The answer once the request has finished. */
  answer: () => Result<Sample, PriceRequestError> | undefined
}

class PriceRequestError extends Error {
  public readonly wait: boolean

  public constructor(message: string, wait: boolean) {
    super(message)
    this.wait = wait
  }
}

const CACHE_TTL_MS = 60_000 // 60 seconds
// Asking a source again right after it refused, stalled or answered badly would keep a rate limit tripped.
const SOURCE_RETRY_MS = 30_000
// One request to a source; a stalled source must not stop the fallbacks.
const REQUEST_TIMEOUT_MS = 10_000
// However many sources stall, a caller gets an answer (the last known price or none) within this.
const LOOKUP_TIMEOUT_MS = 15_000
// With a usable cached price, wait this long per source request before trying the next source.
const LAST_KNOWN_WAIT_MS = 3_000
// Public quotes expire after 30 minutes; a self-hosted mempool normally updates only hourly.
const MAX_PRICE_AGE_MS = 30 * 60_000
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'

export function isPublicMempool(url: URL): boolean {
  return url.hostname === 'mempool.space' || url.hostname.endsWith('.mempool.space')
}

function ageOf(sample: Sample): number {
  return sample.ageAtFetch + sample.fetchedAt.elapsed()
}

function maxPriceAge(source: PriceSourceName): number {
  return source === 'mempool' ? 65 * 60_000 : MAX_PRICE_AGE_MS
}

function isRecent(sample: Sample): boolean {
  return ageOf(sample) < maxPriceAge(sample.source)
}

/** The useful part of a fetch failure: Node reports "fetch failed" and keeps the reason in `cause`. */
function describeFailure(error: Error): string {
  const { cause } = error
  if (!(cause instanceof Error)) {
    return error.message
  }
  // Refused on every address of a host such as localhost, Node reports an AggregateError with no message.
  const inner = cause instanceof AggregateError ? cause.errors.filter((item) => item instanceof Error) : []
  const reason = cause.message || inner.map((item: Error) => item.message).join('; ')
  return reason === '' ? error.message : `${error.message}: ${reason}`
}

const PositiveNumberSchema = z.number().positive().finite()
const DecimalStringSchema = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/)
const EpochSecondsSchema = z.number().int().positive()
const MempoolPriceSchema = z.object({ USD: PositiveNumberSchema, time: EpochSecondsSchema.optional() })
const BlockPriceSchema = z.object({
  amount: DecimalStringSchema,
  base: z.literal('BTC'),
  currency: z.literal('USD'),
  last_updated_at_in_utc_epoch_seconds: z
    .string()
    .regex(/^\d+$/)
    .transform((seconds) => Number(seconds))
    .optional(),
})
const CoinbasePriceSchema = z.object({
  data: z.object({ amount: DecimalStringSchema, currency: z.literal('USD') }),
})
const CoinGeckoPriceSchema = z.object({
  bitcoin: z.object({ usd: PositiveNumberSchema, last_updated_at: EpochSecondsSchema.optional() }),
})

function quote(value: Decimal.Value, seconds: number | undefined): Quote | null {
  const amount = new Decimal(value)
  const number = amount.toNumber()
  const asOf = seconds === undefined ? undefined : new Date(seconds * 1000)
  if (number <= 0 || !Number.isFinite(number) || (asOf && !Number.isFinite(asOf.getTime()))) {
    return null
  }
  return { value: amount, asOf }
}

async function readMempoolPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(MempoolPriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(parsed.unwrap().USD, parsed.unwrap().time) : null
}

async function readBlockPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(BlockPriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(parsed.unwrap().amount, parsed.unwrap().last_updated_at_in_utc_epoch_seconds) : null
}

async function readCoinbasePrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(CoinbasePriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(parsed.unwrap().data.amount, undefined) : null
}

async function readCoinGeckoPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(CoinGeckoPriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(parsed.unwrap().bitcoin.usd, parsed.unwrap().bitcoin.last_updated_at) : null
}

export function isPriceSourceName(value: string | undefined): value is PriceSourceName {
  return PRICE_SOURCES.some((source) => source === value)
}

/** Reads the saved price settings; fallbacks are allowed unless turned off. */
export async function readPriceSettings(
  getSetting: (key: string) => string | undefined | Promise<string | undefined>,
): Promise<SavedPriceSettings> {
  const source = await getSetting(PRICE_SOURCE_SETTING)
  return {
    source: isPriceSourceName(source) ? source : undefined,
    fallbacks: (await getSetting(PRICE_FALLBACKS_SETTING)) !== 'false',
  }
}

/** Resolves when the price settings change; `stop` releases the listener. */
interface SettingsChange {
  changed: Promise<void>
  hasChanged: () => boolean
  stop: () => void
}

/**
 * Current BTC/USD price from the source chosen in Settings, with the others as fallbacks when
 * allowed. Price requests carry no wallet data.
 *
 * - Each source keeps its latest price and last failure, and has at most one request in flight,
 *   whoever asked. A price is reused for 60 seconds after it was fetched.
 * - A source that refused, stalled or answered badly is skipped for 30 seconds. After a network
 *   error, the next caller asks it again.
 * - A caller waits at most 15 seconds in all. With a recent price to fall back on, it waits at most
 *   3 seconds for each source, counted from when that source's request started, then tries the
 *   next. A status check in Settings waits fully for the chosen source.
 * - When no allowed source answers, the newest recent price from an allowed source is returned,
 *   flagged `lastKnown`. A price is used for at most 30 minutes (65 for a self-hosted mempool,
 *   which updates hourly), measured by the source's clock where it sends one.
 * - Saving the settings restarts callers still waiting, under the new settings.
 */
export class PriceService {
  private readonly logger: Logger
  private readonly sources: PriceSource[]
  private readonly settings: () => SavedPriceSettings | Promise<SavedPriceSettings>
  private readonly requestTimeoutMs: number
  private readonly lookupTimeoutMs: number
  private readonly lastKnownWaitMs: number
  private readonly latest = new Map<PriceSourceName, Sample>()
  private readonly failures = new Map<PriceSourceName, Failure>()
  private readonly inflight = new Map<PriceSourceName, PriceRequest>()
  private readonly settingsListeners = new Set<() => void>()

  public constructor(deps: {
    logger: Logger
    mempoolApiUrl: string
    settings: () => SavedPriceSettings | Promise<SavedPriceSettings>
    requestTimeoutMs?: number
    lookupTimeoutMs?: number
    lastKnownWaitMs?: number
  }) {
    this.logger = deps.logger.child({ module: 'price-service' })
    this.settings = deps.settings
    this.requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.lookupTimeoutMs = deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS
    this.lastKnownWaitMs = deps.lastKnownWaitMs ?? LAST_KNOWN_WAIT_MS

    const configured = URL.canParse(deps.mempoolApiUrl) ? new URL(deps.mempoolApiUrl) : null
    const isWebUrl = configured?.protocol === 'http:' || configured?.protocol === 'https:'
    if (!isWebUrl) {
      // The value is not logged, since it may hold credentials.
      this.logger.warn('MEMPOOL_API_URL is not an http(s) URL, so it is not offered as a price source')
    }
    const selfHosted = isWebUrl && !isPublicMempool(configured) ? configured : null
    if (selfHosted && (selfHosted.username !== '' || selfHosted.password !== '')) {
      // fetch refuses URLs with credentials, and its error would repeat the password in logs.
      selfHosted.username = ''
      selfHosted.password = ''
      this.logger.warn('Ignoring credentials in MEMPOOL_API_URL for price requests')
    }
    const definitions: Record<PriceSourceName, PriceSource | null> = {
      mempool: selfHosted && {
        name: 'mempool',
        label: `Your mempool server (${selfHosted.host})`,
        url: `${selfHosted.toString().replace(/\/$/, '')}/api/v1/prices`,
        read: readMempoolPrice,
      },
      block: {
        name: 'block',
        label: 'Block',
        url: 'https://pricing.bitcoin.block.xyz/current-price',
        read: readBlockPrice,
      },
      'mempool.space': {
        name: 'mempool.space',
        label: 'mempool.space',
        url: `${PUBLIC_MEMPOOL_URL}/api/v1/prices`,
        read: readMempoolPrice,
      },
      coinbase: {
        name: 'coinbase',
        label: 'Coinbase',
        url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        read: readCoinbasePrice,
      },
      coingecko: {
        name: 'coingecko',
        label: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true',
        read: readCoinGeckoPrice,
      },
    }
    this.sources = PRICE_SOURCES.flatMap((name) => definitions[name] ?? [])
  }

  /** The sources available here and the one in use, for Settings. Makes no request. */
  public async options(): Promise<PriceSourceOptions> {
    const settings = await this.settings()
    return {
      selected: this.selectedSource(settings).name,
      fallbacks: settings.fallbacks,
      sources: this.sources.map(({ name, label }) => ({ name, label })),
    }
  }

  public isAvailable(name: PriceSourceName): boolean {
    return this.sources.some((source) => source.name === name)
  }

  /** Called after the price settings are saved, so callers still waiting follow the new choice at once. */
  public settingsUpdated(): void {
    for (const notify of this.settingsListeners) {
      notify()
    }
    this.settingsListeners.clear()
  }

  public getCurrentBtcPrice = ({ verifyPrimary = false }: { verifyPrimary?: boolean } = {}): AsyncResult<
    BtcPrice,
    Error
  > =>
    tryBlock(
      async function* (this: PriceService) {
        return this.lookup(performance.now() + this.lookupTimeoutMs, verifyPrimary)
      }.bind(this),
    )

  private selectedSource(settings: SavedPriceSettings): PriceSource {
    // A saved self-hosted choice uses the default if that server is no longer configured.
    const [first] = this.sources
    const selected = this.sources.find((source) => source.name === settings.source) ?? first
    if (!selected) {
      throw new Error('No price sources are configured')
    }
    return selected
  }

  private async planSources(): Promise<PriceSource[]> {
    const settings = await this.settings()
    const selected = this.selectedSource(settings)
    return settings.fallbacks ? [selected, ...this.sources.filter((source) => source !== selected)] : [selected]
  }

  private watchSettings(): SettingsChange {
    let hasChanged = false
    let notify = (): void => undefined
    const changed = new Promise<void>((resolve) => {
      notify = (): void => {
        hasChanged = true
        resolve()
      }
    })
    this.settingsListeners.add(notify)
    return {
      changed,
      hasChanged: () => hasChanged,
      stop: () => {
        this.settingsListeners.delete(notify)
      },
    }
  }

  private async lookup(deadline: number, verifyPrimary: boolean): Promise<Result<BtcPrice, Error>> {
    for (;;) {
      const change = this.watchSettings()
      try {
        const sources = await this.planSources()
        if (change.hasChanged()) {
          continue
        }
        const outcome = await this.walk(sources, deadline, change, verifyPrimary)
        if (outcome !== 'settings changed' && !change.hasChanged()) {
          return outcome
        }
      } finally {
        change.stop()
      }
    }
  }

  /** Tries the allowed sources in order, within the caller's deadline. */
  private async walk(
    sources: PriceSource[],
    deadline: number,
    settingsChange: SettingsChange,
    verifyPrimary: boolean,
  ): Promise<Result<BtcPrice, Error> | 'settings changed'> {
    const errors: string[] = []
    const hasLastKnown = this.lastKnown(sources) !== undefined
    // Requests this caller stopped waiting for, in order of preference.
    const late: PriceRequest[] = []

    for (const source of sources) {
      if (settingsChange.hasChanged()) {
        return 'settings changed'
      }
      const sample = this.latest.get(source.name)
      const failure = this.failures.get(source.name)
      // A status check in Settings asks the chosen source again rather than trusting its cached price.
      const checkingPrimary = verifyPrimary && source === sources[0]
      if (!checkingPrimary && !failure && sample && sample.fetchedAt.elapsed() < CACHE_TTL_MS && isRecent(sample)) {
        return Ok(this.toPrice(sample, false))
      }
      if (failure?.wait === true && failure.failedAt.elapsed() < SOURCE_RETRY_MS) {
        errors.push(failure.error.message)
        continue
      }
      if (performance.now() >= deadline) {
        errors.push(`${source.label} not tried in time`)
        break
      }

      const request = this.request(source)
      // Counted from the request's start, so a caller joining a stalled request does not wait again.
      const wait = hasLastKnown && !checkingPrimary ? this.lastKnownWaitMs - request.startedAt.elapsed() : Infinity
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        request.done,
        settingsChange.changed.then(() => 'settings changed' as const),
        new Promise<'out of time'>((resolve) => {
          timer = setTimeout(
            () => {
              resolve('out of time')
            },
            Math.min(deadline - performance.now(), wait),
          )
        }),
      ])
      clearTimeout(timer)
      if (outcome === 'settings changed' || settingsChange.hasChanged()) {
        return 'settings changed'
      }
      if (outcome === 'out of time') {
        // The request carries on and records its answer for later callers.
        errors.push(`${source.label} did not answer in time`)
        late.push(request)
        continue
      }
      if (outcome.isOk()) {
        return Ok(this.toPrice(outcome.unwrap(), false))
      }
      errors.push(outcome.unwrapErr().message)
    }

    // A source that answered after this caller moved on still supplies a current price.
    for (const request of late) {
      const answer = request.answer()
      // It may have aged past its limit while later sources were tried.
      if (answer?.isOk() === true && isRecent(answer.unwrap())) {
        return Ok(this.toPrice(answer.unwrap(), false))
      }
    }
    // A recent price is better than none while every allowed source is unavailable.
    const last = this.lastKnown(sources)
    if (last) {
      this.logger.warn({ source: last.source }, 'Using last known BTC price')
      return Ok(this.toPrice(last, true))
    }
    return Err(new Error(`No BTC price available: ${errors.join('; ')}`))
  }

  /** The newest recent price from an allowed source. */
  private lastKnown(sources: PriceSource[]): Sample | undefined {
    return sources
      .map((source) => this.latest.get(source.name))
      .filter((sample): sample is Sample => sample !== undefined && isRecent(sample))
      .sort((a, b) => ageOf(a) - ageOf(b))[0]
  }

  private toPrice(sample: Sample, lastKnown: boolean): BtcPrice {
    return { value: sample.value, source: sample.source, asOf: new Date(Date.now() - ageOf(sample)), lastKnown }
  }

  /** At most one request per source is in flight; its answer is recorded whoever is still waiting. */
  private request(source: PriceSource): PriceRequest {
    const running = this.inflight.get(source.name)
    if (running) {
      return running
    }
    const startedAt = new Moment()
    let answer: Result<Sample, PriceRequestError> | undefined
    const done = this.fetchSample(source)
      .then((result) => {
        answer = result
        if (result.isOk()) {
          this.latest.set(source.name, result.unwrap())
          this.failures.delete(source.name)
          // Which outside services were contacted stays auditable.
          this.logger.debug({ source: source.name }, 'Fetched BTC price')
        } else {
          const error = result.unwrapErr()
          this.failures.set(source.name, { error, failedAt: new Moment(), wait: error.wait })
          this.logger.warn({ source: source.name, err: error }, 'BTC price source failed')
        }
        return result
      })
      .finally(() => {
        this.inflight.delete(source.name)
      })
    const request = { startedAt, done, answer: () => answer }
    this.inflight.set(source.name, request)
    return request
  }

  private async fetchSample(source: PriceSource): Promise<Result<Sample, PriceRequestError>> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timedOut = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new PriceRequestError(`no response within ${this.requestTimeoutMs / 1000} seconds`, true))
      }, this.requestTimeoutMs)
    })
    try {
      // The signal also aborts a stalled body, but a reader's `.catch(() => null)` would then report it as
      // a malformed answer; the race reports it as a timeout.
      return await Promise.race([this.read(source, controller.signal), timedOut])
    } catch (error) {
      const wait = error instanceof PriceRequestError && error.wait
      const reason = error instanceof Error ? describeFailure(error) : String(error)
      return Err(new PriceRequestError(`${source.label} price request failed: ${reason}`, wait))
    } finally {
      clearTimeout(timer)
    }
  }

  private async read(source: PriceSource, signal: AbortSignal): Promise<Result<Sample, PriceRequestError>> {
    const response = await fetch(source.url, { signal })
    if (!response.ok) {
      // Release the connection instead of leaving an unread body to garbage collection.
      await response.body?.cancel().catch(() => undefined)
      return Err(new PriceRequestError(`${source.label} price error: ${response.status} ${response.statusText}`, true))
    }

    // Age the price by the source's own clock where it sends one (`Date`, plus `Age` when a cache held the
    // response), so a wrong local clock does not reject it.
    const fetchedAt = new Moment()
    const date = Date.parse(response.headers.get('date') ?? '')
    const age = response.headers.get('age')?.split(',')[0]?.trim() ?? ''
    const cacheAge = /^\d+$/.test(age) ? Number(age) * 1000 : 0
    const sourceNow = Number.isNaN(date) ? Date.now() : date + cacheAge
    const quoted = await source.read(response)
    if (!quoted) {
      return Err(new PriceRequestError(`BTC price not found in ${source.label} response`, true))
    }

    // A price is at least as old as the cached response carrying it, and a timestamp ahead of the source's
    // clock must not make it look newer than that.
    const ageAtFetch = quoted.asOf ? Math.max(cacheAge, sourceNow - quoted.asOf.getTime()) : cacheAge
    const sample = { value: quoted.value, source: source.name, ageAtFetch, fetchedAt }
    if (!isRecent(sample)) {
      const minutes = Math.round(ageOf(sample) / 60_000)
      return Err(new PriceRequestError(`${source.label} price is ${minutes} minutes old`, true))
    }
    return Ok(sample)
  }
}
