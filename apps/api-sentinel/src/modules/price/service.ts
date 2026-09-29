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

export interface BtcPrice {
  value: Decimal
  /** When the source set this price, or when it was fetched if the source gives no time. */
  asOf: Date
  source: PriceSourceName
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
// mempool's own price can already be several minutes old when fetched.
const MAX_STALE_PRICE_MS = 30 * 60_000
const PUBLIC_MEMPOOL_URL = 'https://mempool.space'

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
  private cached: { price: BtcPrice; fetchedAt: number; settings: string } | null = null
  private readonly failures = new Map<PriceSourceName, { error: Error; failedAt: number }>()
  private pending: Promise<Result<BtcPrice, Error>> | null = null

  public constructor(deps: { logger: Logger; mempoolApiUrl: string; settings: () => SavedPriceSettings }) {
    this.logger = deps.logger.child({ module: 'price-service' })
    this.settings = deps.settings
    const mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
    const block: PriceSource = {
      name: 'block',
      label: 'Block',
      url: 'https://pricing.bitcoin.block.xyz/current-price',
      read: readBlockPrice,
    }
    const selfHosted: PriceSource | null =
      mempoolApiUrl === PUBLIC_MEMPOOL_URL
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

  /** The sources available here and the one in use, for Settings. */
  public options(): PriceSourceOptions {
    const { fallbacks } = this.settings()
    return {
      selected: this.selectedSource().name,
      fallbacks,
      sources: this.sources.map(({ name, label }) => ({ name, label })),
    }
  }

  /** The last price fetched, without making a request. */
  public lastPrice(): BtcPrice | null {
    return this.cached?.price ?? null
  }

  public getCurrentBtcPrice = asyncFn(async (): Promise<Result<BtcPrice, Error>> => {
    const selected = this.selectedSource()
    const { fallbacks } = this.settings()
    const key = `${selected.name}:${fallbacks}`
    // A changed setting takes effect on the next request rather than after the cache expires.
    const cached = this.cached
    if (cached?.settings === key && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return Ok(cached.price)
    }
    const sources = fallbacks ? [selected, ...this.sources.filter((source) => source !== selected)] : [selected]
    // The dashboard asks for the price from several queries at once; share one lookup.
    this.pending ??= this.refresh(sources, key).finally(() => {
      this.pending = null
    })
    return this.pending
  })

  private selectedSource(): PriceSource {
    const saved = this.settings().source
    // A saved self-hosted choice uses the default if that server is no longer configured.
    return this.sources.find((source) => source.name === saved) ?? this.defaultSource
  }

  private async refresh(sources: PriceSource[], key: string): Promise<Result<BtcPrice, Error>> {
    const errors: string[] = []

    for (const source of sources) {
      const failure = this.failures.get(source.name)
      if (failure && Date.now() - failure.failedAt < SOURCE_RETRY_MS) {
        errors.push(failure.error.message)
        continue
      }

      const result = await this.fetchPrice(source)
      if (result.isErr()) {
        const error = result.unwrapErr()
        this.failures.set(source.name, { error, failedAt: Date.now() })
        this.logger.warn({ source: source.name, err: error }, 'BTC price source failed')
        errors.push(error.message)
        continue
      }

      const price = result.unwrap()
      this.failures.delete(source.name)
      this.cached = { price, fetchedAt: Date.now(), settings: key }
      if (source !== sources[0]) {
        this.logger.info({ source: source.name, selected: sources[0]?.name }, 'Using fallback BTC price source')
      }
      return Ok(price)
    }

    // A recent price is better than none while every allowed source is unavailable.
    const last = this.cached?.price
    if (
      last !== undefined &&
      sources.some((source) => source.name === last.source) &&
      Date.now() - last.asOf.getTime() < MAX_STALE_PRICE_MS
    ) {
      this.logger.warn({ source: last.source }, 'Using last known BTC price')
      return Ok(last)
    }
    return Err(new Error(`No BTC price available: ${errors.join('; ')}`))
  }

  private async fetchPrice(source: PriceSource): Promise<Result<BtcPrice, Error>> {
    let response: Response
    try {
      response = await fetch(source.url)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Err(new Error(`${source.label} price request failed: ${message}`))
    }
    if (!response.ok) {
      return Err(new Error(`${source.label} price error: ${response.status} ${response.statusText}`))
    }

    const price = await source.read(response)
    if (!price) {
      return Err(new Error(`BTC price not found in ${source.label} response`))
    }

    // A source clock ahead of ours must not make a price look newer than it is.
    const fetchedAt = new Date()
    const asOf = price.asOf && price.asOf < fetchedAt ? price.asOf : fetchedAt
    return Ok({ value: price.value, asOf, source: source.name })
  }
}
