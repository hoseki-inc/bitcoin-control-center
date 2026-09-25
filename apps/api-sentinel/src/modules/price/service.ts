import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
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

export type BitcoinPriceHistoryDays = 1 | 7 | 30 | 180 | 365

export type BitcoinPricePoint = { time: number; value: number }

export class PriceService {
  private readonly historyCache = new Map<BitcoinPriceHistoryDays, { points: BitcoinPricePoint[]; fetchedAt: number }>()

  public getBitcoinPriceHistory = asyncFn(
    async (days: BitcoinPriceHistoryDays = 7): Promise<Result<BitcoinPricePoint[], Error>> => {
      const cached = this.historyCache.get(days)
      if (cached && Date.now() - cached.fetchedAt < 300_000) {
        return Ok(cached.points)
      }
      let response: Response
      try {
        response = await fetch(
          `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
          { signal: AbortSignal.timeout(8_000) },
        )
      } catch {
        return Err(new Error('Bitcoin price history is unavailable'))
      }
      if (!response.ok) {
        return Err(new Error('Bitcoin price history is unavailable'))
      }
      const parsed = parseUnknown(historySchema, await response.json())
      if (parsed.isErr()) {
        return Err(new Error('Invalid Bitcoin price history'))
      }
      const points = parsed
        .unwrap()
        .prices.map(([time, value]) => ({ time: time / 1000, value }))
        .sort((a, b) => a.time - b.time)
      this.historyCache.set(days, { points, fetchedAt: Date.now() })
      return Ok(points)
    },
  )

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

    const parsed = parseUnknown(z.object({ bitcoin: z.object({ usd: z.number() }) }), await response.json())
    const usd = parsed.isOk() ? parsed.unwrap().bitcoin.usd : undefined
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
