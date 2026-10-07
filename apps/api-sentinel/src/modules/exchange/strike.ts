import { AsyncResult, Err, Ok } from '@hoseki/packages/result'
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
  new AsyncResult(
    (async () => {
      const response = await fetch('https://api.strike.me/v1/balances', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })

      if (response.status === 401) {
        return Err(new Error('Invalid Strike API key'))
      }
      if (response.status === 429) {
        return Err(new Error('Strike API rate limit exceeded. Try again later.'))
      }
      if (!response.ok) {
        return Err(new Error(`Strike API error: ${response.status} ${response.statusText}`))
      }

      const json: unknown = await response.json()
      const parsed = StrikeBalanceSchema.safeParse(json)
      if (!parsed.success) {
        return Err(new Error(`Invalid Strike API response: ${parsed.error.message}`))
      }

      const btcBalance = parsed.data.find((b) => b.currency === 'BTC')
      if (!btcBalance) {
        return Err(new Error('No BTC balance found in Strike account'))
      }

      // Convert from BTC string to satoshis
      const sats = BigInt(Math.round(Number(btcBalance.total) * 1e8))
      logger.debug({ sats: sats.toString() }, 'Fetched Strike BTC balance')
      return Ok(sats)
    })(),
  )

/**
 * Validate a Strike API key by attempting to fetch balances.
 */
export const validateStrikeApiKey = (apiKey: string, logger: Logger): AsyncResult<StrikeBalance[], Error> =>
  new AsyncResult(
    (async () => {
      const response = await fetch('https://api.strike.me/v1/balances', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      })

      if (response.status === 401) {
        return Err(new Error('Invalid Strike API key'))
      }
      if (!response.ok) {
        return Err(new Error(`Strike API error: ${response.status}`))
      }

      const json: unknown = await response.json()
      const parsed = StrikeBalanceSchema.safeParse(json)
      if (!parsed.success) {
        return Err(new Error(`Invalid Strike API response: ${parsed.error.message}`))
      }
      logger.info('Strike API key validated successfully')
      return Ok(parsed.data)
    })(),
  )
