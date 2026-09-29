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
// Retrying on every query after a refusal would keep a rate limit tripped.
const FAILURE_TTL_MS = 30_000

export class PriceService {
  private readonly logger: Logger
  private readonly mempoolApiUrl: string
  private cached: { price: BtcPrice; fetchedAt: number } | null = null
  private failed: { error: Error; failedAt: number } | null = null

  public constructor(deps: { logger: Logger; mempoolApiUrl: string }) {
    this.logger = deps.logger.child({ module: 'price-service' })
    this.mempoolApiUrl = deps.mempoolApiUrl.replace(/\/$/, '')
  }

  public getCurrentBtcPrice = asyncFn(async (): Promise<Result<BtcPrice, Error>> => {
    // Return cached value if fresh
    if (this.cached && Date.now() - this.cached.fetchedAt < CACHE_TTL_MS) {
      return Ok(this.cached.price)
    }
    if (this.failed && Date.now() - this.failed.failedAt < FAILURE_TTL_MS) {
      return Err(this.failed.error)
    }

    const result = await this.fetchPrice()
    if (result.isErr()) {
      this.failed = { error: result.unwrapErr(), failedAt: Date.now() }
      return result
    }

    const price = result.unwrap()
    this.cached = { price, fetchedAt: Date.now() }
    this.failed = null
    this.logger.debug({ usd: price.value.toString() }, 'Fetched BTC price from mempool.space')
    return Ok(price)
  })

  private async fetchPrice(): Promise<Result<BtcPrice, Error>> {
    let response: Response
    try {
      response = await fetch(`${this.mempoolApiUrl}/api/v1/prices`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Err(new Error(`mempool.space price request failed: ${message}`))
    }
    if (!response.ok) {
      return Err(new Error(`mempool.space price error: ${response.status} ${response.statusText}`))
    }

    const body: unknown = await response.json().catch(() => null)
    const parsed = parseUnknown(z.object({ USD: z.number().positive() }), body)
    if (parsed.isErr()) {
      return Err(new Error('BTC price not found in mempool.space response'))
    }

    return Ok({ value: new Decimal(parsed.unwrap().USD), asOf: new Date() })
  }
}
