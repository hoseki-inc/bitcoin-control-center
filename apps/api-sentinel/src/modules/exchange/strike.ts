import type { AsyncResult } from '@hoseki/packages/result'
import { Err, Ok, Result, parseUnknown, tryBlock } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { z } from 'zod'

const StrikeBalanceSchema = z.array(
  z.object({
    currency: z.string(),
    total: z.string(),
    available: z.string(),
  }),
)

export interface StrikeBalance {
  currency: string
  total: string
  available: string
}

/**
 * Fetch BTC balance from Strike using an API key.
 * Returns balance in satoshis as a bigint, or an error.
 */
export const getStrikeBtcBalance = (apiKey: string, logger: Logger): AsyncResult<bigint, Error> =>
  tryBlock(async function* () {
    const response = yield* Result.fromPromise(
      fetch('https://api.strike.me/v1/balances', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }),
    )

    if (response.status === 401) {
      return Err(new Error('Invalid Strike API key'))
    }
    if (response.status === 429) {
      return Err(new Error('Strike API rate limit exceeded. Try again later.'))
    }
    if (!response.ok) {
      return Err(new Error(`Strike API error: ${response.status} ${response.statusText}`))
    }

    const json: unknown = yield* Result.fromPromise(response.json())
    const balances = yield* parseUnknown(StrikeBalanceSchema, json).mapErr(
      (error) => new Error(`Invalid Strike API response: ${error.cause.message}`),
    )

    const btcBalance = balances.find((b) => b.currency === 'BTC')
    if (!btcBalance) {
      return Err(new Error('No BTC balance found in Strike account'))
    }

    // Convert from BTC string to satoshis
    const sats = BigInt(Math.round(Number(btcBalance.total) * 1e8))
    logger.debug({ sats: sats.toString() }, 'Fetched Strike BTC balance')
    return Ok(sats)
  })

/**
 * Validate a Strike API key by attempting to fetch balances.
 */
export const validateStrikeApiKey = (apiKey: string, logger: Logger): AsyncResult<StrikeBalance[], Error> =>
  tryBlock(async function* () {
    const response = yield* Result.fromPromise(
      fetch('https://api.strike.me/v1/balances', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }),
    )

    if (response.status === 401) {
      return Err(new Error('Invalid Strike API key'))
    }
    if (!response.ok) {
      return Err(new Error(`Strike API error: ${response.status}`))
    }

    const json: unknown = yield* Result.fromPromise(response.json())
    const balances = yield* parseUnknown(StrikeBalanceSchema, json).mapErr(
      (error) => new Error(`Invalid Strike API response: ${error.cause.message}`),
    )
    logger.info('Strike API key validated successfully')
    return Ok(balances)
  })
