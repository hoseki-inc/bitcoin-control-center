import { parseUnknown } from '@hoseki/packages/result'
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

export class PriceService {
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

    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd')

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
