import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
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
// With a recent price to fall back on, a caller waits only this long for a fresher one.
const LAST_KNOWN_WAIT_MS = 3_000
// The oldest price shown. mempool's own price can already be several minutes old when fetched.
const MAX_PRICE_AGE_MS = 30 * 60_000
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'

function isPublicMempool(url: URL | null): boolean {
  return url !== null && (url.hostname === 'mempool.space' || url.hostname.endsWith('.mempool.space'))
}

function sourceNames(sources: PriceSource[]): string {
  return sources.map((source) => source.name).join(',')
}

function ageOf(sample: Sample): number {
  return sample.ageAtFetch + sample.fetchedAt.elapsed()
}

function isRecent(sample: Sample): boolean {
  return ageOf(sample) < MAX_PRICE_AGE_MS
}

/** The useful part of a fetch failure: Node reports "fetch failed" and keeps the reason in `cause`. */
function describeFailure(error: Error): string {
  return error.cause instanceof Error ? `${error.message}: ${error.cause.message}` : error.message
}

const PositiveNumberSchema = z.number().positive()
const PositiveDecimalStringSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((amount) => new Decimal(amount).gt(0))
const EpochSecondsSchema = z.number().int().positive()
const MempoolPriceSchema = z.object({ USD: PositiveNumberSchema, time: EpochSecondsSchema.optional() })
const BlockPriceSchema = z.object({
  amount: PositiveDecimalStringSchema,
  base: z.literal('BTC'),
  currency: z.literal('USD'),
  last_updated_at_in_utc_epoch_seconds: z
    .string()
    .regex(/^\d+$/)
    .transform((seconds) => Number(seconds))
    .optional(),
})
const CoinbasePriceSchema = z.object({
  data: z.object({ amount: PositiveDecimalStringSchema, currency: z.literal('USD') }),
})
const CoinGeckoPriceSchema = z.object({
  bitcoin: z.object({ usd: PositiveNumberSchema, last_updated_at: EpochSecondsSchema.optional() }),
})

function quote(value: Decimal.Value, seconds: number | undefined): Quote {
  return { value: new Decimal(value), asOf: seconds === undefined ? undefined : new Date(seconds * 1000) }
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
export function readPriceSettings(getSetting: (key: string) => string | undefined): SavedPriceSettings {
  const source = getSetting(PRICE_SOURCE_SETTING)
  return {
    source: isPriceSourceName(source) ? source : undefined,
    fallbacks: getSetting(PRICE_FALLBACKS_SETTING) !== 'false',
  }
}

/** Resolves when the price settings change; `stop` releases the listener. */
interface SettingsChange {
  changed: Promise<void>
  stop: () => void
}

/**
 * Current BTC/USD price from the source chosen in Settings, with the others as fallbacks when
 * allowed. Each source keeps its own latest price and failure, and has at most one request in
 * flight, whoever asked; each caller keeps its own time limit. Price requests carry no wallet data.
 */
export class PriceService {
  private readonly logger: Logger
  private readonly sources: PriceSource[]
  private readonly settings: () => SavedPriceSettings
  private readonly requestTimeoutMs: number
  private readonly lookupTimeoutMs: number
  private readonly lastKnownWaitMs: number
  private readonly latest = new Map<PriceSourceName, Sample>()
  private readonly failures = new Map<PriceSourceName, Failure>()
  private readonly inflight = new Map<PriceSourceName, Promise<void>>()
  private readonly settingsListeners = new Set<() => void>()

  public constructor(deps: {
    logger: Logger
    mempoolApiUrl: string
    settings: () => SavedPriceSettings
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
    if (configured && (configured.username !== '' || configured.password !== '')) {
      // fetch refuses URLs with credentials, and its error would repeat the password in logs.
      configured.username = ''
      configured.password = ''
      this.logger.warn('Ignoring credentials in MEMPOOL_API_URL for price requests')
    }
    const mempoolApiUrl = (configured?.toString() ?? deps.mempoolApiUrl).replace(/\/$/, '')
    const definitions: Record<PriceSourceName, PriceSource | null> = {
      mempool: isPublicMempool(configured)
        ? null
        : {
            name: 'mempool',
            label: `Your mempool server (${configured?.host ?? mempoolApiUrl})`,
            url: `${mempoolApiUrl}/api/v1/prices`,
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
  public options(): PriceSourceOptions {
    const settings = this.settings()
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

  public getCurrentBtcPrice = asyncFn(async (): Promise<Result<BtcPrice, Error>> =>
    this.lookup(performance.now() + this.lookupTimeoutMs),
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

  private planSources(): PriceSource[] {
    const settings = this.settings()
    const selected = this.selectedSource(settings)
    return settings.fallbacks ? [selected, ...this.sources.filter((source) => source !== selected)] : [selected]
  }

  private watchSettings(): SettingsChange {
    let notify = (): void => undefined
    const changed = new Promise<void>((resolve) => {
      notify = resolve
    })
    this.settingsListeners.add(notify)
    return {
      changed,
      stop: () => {
        this.settingsListeners.delete(notify)
      },
    }
  }

  private async lookup(deadline: number): Promise<Result<BtcPrice, Error>> {
    for (;;) {
      const sources = this.planSources()
      const change = this.watchSettings()
      try {
        const outcome = await this.walk(sources, deadline, change.changed)
        if (outcome !== 'settings changed') {
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
    settingsChanged: Promise<void>,
  ): Promise<Result<BtcPrice, Error> | 'settings changed'> {
    const errors: string[] = []
    const planned = sourceNames(sources)
    const limit =
      this.lastKnown(sources) === undefined ? deadline : Math.min(deadline, performance.now() + this.lastKnownWaitMs)

    for (const source of sources) {
      const sample = this.latest.get(source.name)
      if (sample && sample.fetchedAt.elapsed() < CACHE_TTL_MS && isRecent(sample)) {
        return Ok(this.toPrice(sample, false))
      }
      const failure = this.failures.get(source.name)
      const failedSinceSample =
        failure !== undefined && (sample === undefined || failure.failedAt.elapsed() < sample.fetchedAt.elapsed())
      if (failure?.wait === true && failure.failedAt.elapsed() < SOURCE_RETRY_MS) {
        errors.push(failure.error.message)
        continue
      }

      const request = this.request(source)
      // Serve the source's own recent price while it refreshes, rather than making the caller wait.
      if (sample && isRecent(sample) && !failedSinceSample) {
        return Ok(this.toPrice(sample, false))
      }

      const remaining = limit - performance.now()
      if (remaining <= 0) {
        errors.push(`${source.label} not tried in time`)
        break
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      const outcome = await Promise.race([
        request.then(() =>
          sourceNames(this.planSources()) === planned ? ('answered' as const) : ('settings changed' as const),
        ),
        settingsChanged.then(() => 'settings changed' as const),
        new Promise<'out of time'>((resolve) => {
          timer = setTimeout(() => {
            resolve('out of time')
          }, remaining)
        }),
      ])
      clearTimeout(timer)
      if (outcome === 'settings changed') {
        return outcome
      }
      if (outcome === 'out of time') {
        // The request carries on and records its answer for the next caller.
        errors.push(`${source.label} did not answer in time`)
        break
      }

      const answered = this.latest.get(source.name)
      if (answered && answered !== sample) {
        return Ok(this.toPrice(answered, false))
      }
      errors.push(this.failures.get(source.name)?.error.message ?? `${source.label} gave no price`)
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
  private async request(source: PriceSource): Promise<void> {
    const running = this.inflight.get(source.name)
    if (running) {
      return running
    }
    const started = this.fetchSample(source).then((result) => {
      if (result.isOk()) {
        this.latest.set(source.name, result.unwrap())
        this.failures.delete(source.name)
      } else {
        const error = result.unwrapErr()
        this.failures.set(source.name, { error, failedAt: new Moment(), wait: error.wait })
        this.logger.warn({ source: source.name, err: error }, 'BTC price source failed')
      }
      this.inflight.delete(source.name)
    })
    this.inflight.set(source.name, started)
    return started
  }

  private async fetchSample(source: PriceSource): Promise<Result<Sample, PriceRequestError>> {
    const signal = AbortSignal.timeout(this.requestTimeoutMs)
    const timedOut = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new PriceRequestError(`no response within ${this.requestTimeoutMs / 1000} seconds`, true))
        },
        { once: true },
      )
    })
    try {
      // The signal also aborts a stalled body, but a reader's `.catch(() => null)` would then report it as
      // a malformed answer; the race reports it as a timeout.
      return await Promise.race([this.read(source, signal), timedOut])
    } catch (error) {
      const wait = error instanceof PriceRequestError && error.wait
      const reason = error instanceof Error ? describeFailure(error) : String(error)
      return Err(new PriceRequestError(`${source.label} price request failed: ${reason}`, wait))
    }
  }

  private async read(source: PriceSource, signal: AbortSignal): Promise<Result<Sample, PriceRequestError>> {
    const response = await fetch(source.url, { signal })
    if (!response.ok) {
      // Release the connection instead of leaving an unread body to garbage collection.
      await response.body?.cancel().catch(() => undefined)
      return Err(new PriceRequestError(`${source.label} price error: ${response.status} ${response.statusText}`, true))
    }

    // Age the price by the source's own clock where it sends one, so a wrong local clock does not reject it.
    const header = Date.parse(response.headers.get('date') ?? '')
    const sourceNow = Number.isNaN(header) ? Date.now() : header
    const quoted = await source.read(response)
    if (!quoted) {
      return Err(new PriceRequestError(`BTC price not found in ${source.label} response`, true))
    }

    // A timestamp ahead of the source's clock must not make a price look newer than it is.
    const ageAtFetch = Math.max(0, sourceNow - (quoted.asOf?.getTime() ?? sourceNow))
    if (ageAtFetch >= MAX_PRICE_AGE_MS) {
      const minutes = Math.round(ageAtFetch / 60_000)
      return Err(new PriceRequestError(`${source.label} price is ${minutes} minutes old`, true))
    }
    return Ok({ value: quoted.value, source: source.name, ageAtFetch, fetchedAt: new Moment() })
  }
}
