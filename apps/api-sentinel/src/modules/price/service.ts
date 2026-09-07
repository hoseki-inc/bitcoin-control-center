import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import { Decimal } from 'decimal.js'
import type { Logger } from 'pino'
import { z } from 'zod'

export interface BtcPrice {
  value: Decimal
  asOf: Date
}

const CACHE_TTL_MS = 60_000 // 60 seconds

const historySchema = z.object({
  prices: z.array(z.tuple([z.number().finite().nonnegative(), z.number().finite().positive()])).min(2),
})

export type BitcoinPricePoint = { time: number; value: number }

export class PriceService {
  private historyCache: { points: BitcoinPricePoint[]; fetchedAt: number } | null = null

  public getBitcoinPriceHistory = asyncFn(async (): Promise<Result<BitcoinPricePoint[], Error>> => {
    if (this.historyCache && Date.now() - this.historyCache.fetchedAt < 300_000) return Ok(this.historyCache.points)
    let response: Response
    try {
      response = await fetch(
        'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily',
        { signal: AbortSignal.timeout(8_000) },
      )
    } catch {
      return Err(new Error('Bitcoin price history is unavailable'))
    }
    if (!response.ok) return Err(new Error('Bitcoin price history is unavailable'))
    const parsed = parseUnknown(historySchema, await response.json())
    if (parsed.isErr()) return Err(new Error('Invalid Bitcoin price history'))
    const points = parsed
      .unwrap()
      .prices.map(([time, value]) => ({ time: time / 1000, value }))
      .sort((a, b) => a.time - b.time)
    this.historyCache = { points, fetchedAt: Date.now() }
    return Ok(points)
  })

  private readonly logger: Logger
  private cached: { price: BtcPrice; fetchedAt: number } | null = null

  public constructor(deps: { logger: Logger }) {
    this.logger = deps.logger.child({ module: 'price-service' })
  }

  public getCurrentBtcPrice = asyncFn(async (): Promise<Result<BtcPrice, Error>> => {
    // Return cached value if fresh
    if (this.cached && Date.now() - this.cached.fetchedAt < CACHE_TTL_MS) {
      return Ok(this.cached.price)
    }

    let response: Response
    try {
      response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', {
        signal: AbortSignal.timeout(8_000),
      })
    } catch {
      return Err(new Error('Bitcoin price is unavailable'))
    }

    if (!response.ok) {
      return Err(new Error(`CoinGecko API error: ${response.status} ${response.statusText}`))
    }

    const json = (await response.json()) as { bitcoin?: { usd?: number } }
    const usd = json.bitcoin?.usd
    if (usd == null) {
      return Err(new Error('BTC price not found in CoinGecko response'))
    }

    const price: BtcPrice = {
      value: new Decimal(usd),
      asOf: new Date(),
    }

    this.cached = { price, fetchedAt: Date.now() }
    this.logger.debug({ usd }, 'Fetched BTC price from CoinGecko')
    return Ok(price)
  })
}
