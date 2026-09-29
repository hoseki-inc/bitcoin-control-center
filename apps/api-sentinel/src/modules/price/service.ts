import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'

/** Settings keys for the current price source and fallbacks. */
export const PRICE_SOURCE_SETTING = 'price_source'
export const PRICE_FALLBACKS_SETTING = 'price_fallbacks_enabled'

/** Price sources in fallback order. `mempool` is a self-hosted mempool server. */
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

interface LookupPlan {
  key: string
  sources: PriceSource[]
}

export interface BtcPrice {
  value: Decimal
  /** When the source set this price, or when it was fetched if the source gives no time. */
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

const CACHE_TTL_MS = 60_000 // 60 seconds
// Retrying a source on every query after a refusal would keep its rate limit tripped.
const SOURCE_RETRY_MS = 30_000
// A stalled source must not stop the fallbacks or hold up every price-dependent response.
const REQUEST_TIMEOUT_MS = 10_000
// However many sources stall, a lookup ends in time to answer with the last known price.
const LOOKUP_TIMEOUT_MS = 15_000
// The oldest price shown. mempool's own price can already be several minutes old when fetched.
const MAX_PRICE_AGE_MS = 30 * 60_000
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'

function isPublicMempool(url: string): boolean {
  if (!URL.canParse(url)) {
    return false
  }
  const { hostname } = new URL(url)
  return hostname === 'mempool.space' || hostname.endsWith('.mempool.space')
}

function isRecent(price: BtcPrice): boolean {
  return Date.now() - price.asOf.getTime() < MAX_PRICE_AGE_MS
}

const PositiveNumberSchema = z.number().positive().finite()
const DecimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/)
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
const CoinbasePriceSchema = z.object({ data: z.object({ amount: DecimalStringSchema, currency: z.literal('USD') }) })
const CoinGeckoPriceSchema = z.object({
  bitcoin: z.object({ usd: PositiveNumberSchema, last_updated_at: EpochSecondsSchema.optional() }),
})

function quote(value: Decimal, seconds: number | undefined): Quote | null {
  if (!value.isFinite() || value.lte(0)) {
    return null
  }
  return { value, asOf: seconds === undefined ? undefined : new Date(seconds * 1000) }
}

async function readMempoolPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(MempoolPriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(new Decimal(parsed.unwrap().USD), parsed.unwrap().time) : null
}

async function readBlockPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(BlockPriceSchema, await response.json().catch(() => null))
  if (parsed.isErr()) {
    return null
  }
  const { amount, last_updated_at_in_utc_epoch_seconds: seconds } = parsed.unwrap()
  return quote(new Decimal(amount), seconds)
}

async function readCoinbasePrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(CoinbasePriceSchema, await response.json().catch(() => null))
  return parsed.isOk() ? quote(new Decimal(parsed.unwrap().data.amount), undefined) : null
}

async function readCoinGeckoPrice(response: Response): Promise<Quote | null> {
  const parsed = parseUnknown(CoinGeckoPriceSchema, await response.json().catch(() => null))
  if (parsed.isErr()) {
    return null
  }
  const { usd, last_updated_at: seconds } = parsed.unwrap().bitcoin
  return quote(new Decimal(usd), seconds)
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

/**
 * Current BTC/USD price. The default source is the first available in PRICE_SOURCES: a
 * self-hosted mempool server, otherwise Block. With fallbacks allowed, the others
 * cover one that is down or rate limited, in that order. Price requests carry no wallet data.
 */
export class PriceService {
  private readonly logger: Logger
  private readonly sources: PriceSource[]
  private readonly defaultSource: PriceSource
  private readonly settings: () => SavedPriceSettings
  private readonly requestTimeoutMs: number
  private readonly lookupTimeoutMs: number
  private cached: { price: BtcPrice; fetchedAt: number; key: string } | null = null
  private readonly failures = new Map<PriceSourceName, { error: Error; failedAt: number }>()
  private pending: { key: string; result: Promise<Result<BtcPrice, Error>> } | null = null
  // Only the newest lookup may report a result or update the cache.
  private generation = 0

  public constructor(deps: {
    logger: Logger
    mempoolApiUrl: string
    settings: () => SavedPriceSettings
    requestTimeoutMs?: number
    lookupTimeoutMs?: number
  }) {
    this.logger = deps.logger.child({ module: 'price-service' })
    this.settings = deps.settings
    this.requestTimeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
    this.lookupTimeoutMs = deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS
    const mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
    const block: PriceSource = {
      name: 'block',
      label: 'Block',
      url: 'https://pricing.bitcoin.block.xyz/current-price',
      read: readBlockPrice,
    }
    const selfHosted: PriceSource | null = isPublicMempool(mempoolApiUrl)
      ? null
      : {
          name: 'mempool',
          label: `Your mempool server (${URL.canParse(mempoolApiUrl) ? new URL(mempoolApiUrl).host : mempoolApiUrl})`,
          url: `${mempoolApiUrl}/api/v1/prices`,
          read: readMempoolPrice,
        }
    this.defaultSource = selfHosted ?? block
    this.sources = [
      ...(selfHosted ? [selfHosted] : []),
      block,
      {
        name: 'mempool.space',
        label: 'mempool.space',
        url: `${PUBLIC_MEMPOOL_URL}/api/v1/prices`,
        read: readMempoolPrice,
      },
      {
        name: 'coinbase',
        label: 'Coinbase',
        url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
        read: readCoinbasePrice,
      },
      {
        name: 'coingecko',
        label: 'CoinGecko',
        url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_last_updated_at=true',
        read: readCoinGeckoPrice,
      },
    ]
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

  public getCurrentBtcPrice = asyncFn(async (): Promise<Result<BtcPrice, Error>> => this.lookup())

  private selectedSource(settings: SavedPriceSettings): PriceSource {
    // A saved self-hosted choice uses the default if that server is no longer configured.
    return this.sources.find((source) => source.name === settings.source) ?? this.defaultSource
  }

  private plan(): LookupPlan {
    const settings = this.settings()
    const selected = this.selectedSource(settings)
    return {
      key: `${selected.name}:${settings.fallbacks}`,
      sources: settings.fallbacks ? [selected, ...this.sources.filter((source) => source !== selected)] : [selected],
    }
  }

  private async lookup(): Promise<Result<BtcPrice, Error>> {
    const plan = this.plan()
    const cached = this.cached
    if (cached?.key === plan.key && Date.now() - cached.fetchedAt < CACHE_TTL_MS && isRecent(cached.price)) {
      return Ok(cached.price)
    }
    // The dashboard asks for the price from several queries at once; share one lookup per setting.
    let pending = this.pending
    if (pending?.key !== plan.key) {
      this.generation += 1
      const started = { key: plan.key, result: this.refresh(plan, this.generation) }
      const clear = (): void => {
        if (this.pending === started) {
          this.pending = null
        }
      }
      void started.result.then(clear, clear)
      this.pending = started
      pending = started
    }
    return pending.result
  }

  /** Whether a lookup may still report: it is the newest, and the settings have not changed since it began. */
  private isCurrent(plan: LookupPlan, generation: number): boolean {
    return generation === this.generation && this.plan().key === plan.key
  }

  private async refresh(plan: LookupPlan, generation: number): Promise<Result<BtcPrice, Error>> {
    const errors: string[] = []
    const deadline = performance.now() + this.lookupTimeoutMs

    for (const source of plan.sources) {
      // A superseded lookup hands over to the current one, so it never tries a source that is no
      // longer allowed, reports under old settings, or overwrites a newer price.
      if (!this.isCurrent(plan, generation)) {
        return this.lookup()
      }
      const remaining = deadline - performance.now()
      if (remaining <= 0) {
        errors.push(`${source.label} not tried: no price within ${this.lookupTimeoutMs / 1000} seconds`)
        break
      }
      const failure = this.failures.get(source.name)
      if (failure && Date.now() - failure.failedAt < SOURCE_RETRY_MS) {
        errors.push(failure.error.message)
        continue
      }

      const result = await this.fetchPrice(source, Math.ceil(Math.min(this.requestTimeoutMs, remaining)))
      if (result.isErr()) {
        this.failures.set(source.name, { error: result.unwrapErr(), failedAt: Date.now() })
        this.logger.warn({ source: source.name, err: result.unwrapErr() }, 'BTC price source failed')
      } else {
        this.failures.delete(source.name)
      }
      if (!this.isCurrent(plan, generation)) {
        return this.lookup()
      }
      if (result.isErr()) {
        errors.push(result.unwrapErr().message)
        continue
      }

      const price = result.unwrap()
      this.cached = { price, fetchedAt: Date.now(), key: plan.key }
      if (source !== plan.sources[0]) {
        this.logger.info({ source: source.name, selected: plan.sources[0]?.name }, 'Using fallback BTC price source')
      }
      return Ok(price)
    }

    // A recent price is better than none while every allowed source is unavailable.
    const last = this.cached?.price
    if (last !== undefined && plan.sources.some((source) => source.name === last.source) && isRecent(last)) {
      this.logger.warn({ source: last.source }, 'Using last known BTC price')
      return Ok({ ...last, lastKnown: true })
    }
    return Err(new Error(`No BTC price available: ${errors.join('; ')}`))
  }

  private async fetchPrice(source: PriceSource, timeoutMs: number): Promise<Result<BtcPrice, Error>> {
    const signal = AbortSignal.timeout(timeoutMs)
    const timedOut = new Promise<never>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => {
          reject(new Error(`no response within ${timeoutMs / 1000} seconds`))
        },
        { once: true },
      )
    })
    try {
      // The race also bounds reading the body, which a stalled source can hold open after the headers.
      return await Promise.race([this.request(source, signal), timedOut])
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Err(new Error(`${source.label} price request failed: ${message}`))
    }
  }

  private async request(source: PriceSource, signal: AbortSignal): Promise<Result<BtcPrice, Error>> {
    const response = await fetch(source.url, { signal })
    if (!response.ok) {
      // Release the connection instead of leaving an unread body to garbage collection.
      await response.body?.cancel().catch(() => undefined)
      return Err(new Error(`${source.label} price error: ${response.status} ${response.statusText}`))
    }

    const read = await source.read(response)
    if (!read) {
      return Err(new Error(`BTC price not found in ${source.label} response`))
    }

    // A source clock ahead of ours must not make a price look newer than it is.
    const fetchedAt = new Date()
    const price: BtcPrice = {
      value: read.value,
      asOf: read.asOf && read.asOf < fetchedAt ? read.asOf : fetchedAt,
      source: source.name,
      lastKnown: false,
    }
    if (!isRecent(price)) {
      const minutes = Math.round((fetchedAt.getTime() - price.asOf.getTime()) / 60_000)
      return Err(new Error(`${source.label} price is ${minutes} minutes old`))
    }
    return Ok(price)
  }
}
