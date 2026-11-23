import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
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

export class StrikeApiError extends Error {
  public readonly status: number

  public constructor(status: number, message: string) {
    super(message)
    this.name = 'StrikeApiError'
    this.status = status
  }
}

async function fetchStrikeBalances(apiKey: string): Promise<Result<StrikeBalance[], Error>> {
  let response: Response
  try {
    response = await fetch('https://api.strike.me/v1/balances', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    })
  } catch {
    return Err(new Error('Strike API request failed'))
  }

  if (!response.ok) {
    return Err(new StrikeApiError(response.status, `Strike API error: ${response.status}`))
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return Err(new Error('Invalid Strike API response'))
  }
  const parsed = parseUnknown(StrikeBalanceSchema, json)
  if (parsed.isErr()) {
    return Err(new Error(`Invalid Strike API response: ${parsed.unwrapErr().message}`))
  }
  return Ok(parsed.unwrap())
}

export const getStrikeBtcBalance = asyncFn(async (apiKey: string, logger: Logger): Promise<Result<bigint, Error>> => {
  const balances = await fetchStrikeBalances(apiKey)
  if (balances.isErr()) {
    return Err(balances.unwrapErr())
  }

  const btcBalance = balances.unwrap().find((b) => b.currency === 'BTC')
  if (!btcBalance) {
    return Err(new Error('No BTC balance found in Strike account'))
  }

  const sats = BigInt(Math.round(Number(btcBalance.total) * 1e8))
  logger.debug({ sats: sats.toString() }, 'Fetched Strike BTC balance')
  return Ok(sats)
})

export const validateStrikeApiKey = asyncFn(
  async (apiKey: string, logger: Logger): Promise<Result<StrikeBalance[], Error>> => {
    const balances = await fetchStrikeBalances(apiKey)
    if (balances.isErr()) {
      return Err(balances.unwrapErr())
    }
    logger.info('Strike API key validated successfully')
    return Ok(balances.unwrap())
  },
)
