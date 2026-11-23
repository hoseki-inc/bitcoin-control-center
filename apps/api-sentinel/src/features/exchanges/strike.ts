import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { Logger } from 'pino'
import { z } from 'zod'
import { type ValidatedSats, parseBtcBalanceSats } from './amounts'

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

export class StrikeTransportError extends Error {
  public readonly tag = 'StrikeTransportError'

  public constructor(message = 'Strike API request failed') {
    super(message)
    this.name = 'StrikeTransportError'
  }
}

export class StrikeResponseError extends Error {
  public readonly tag = 'StrikeResponseError'

  public constructor(message = 'Invalid Strike API response') {
    super(message)
    this.name = 'StrikeResponseError'
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
    return Err(new StrikeTransportError())
  }

  if (!response.ok) {
    return Err(new StrikeApiError(response.status, `Strike API error: ${response.status}`))
  }

  let json: unknown
  try {
    json = await response.json()
  } catch {
    return Err(new StrikeResponseError())
  }
  const parsed = parseUnknown(StrikeBalanceSchema, json)
  if (parsed.isErr()) {
    return Err(new StrikeResponseError())
  }
  return Ok(parsed.unwrap())
}

export const getStrikeBtcBalance = asyncFn(
  async (apiKey: string, logger: Logger): Promise<Result<ValidatedSats, Error>> => {
    const balances = await fetchStrikeBalances(apiKey)
    if (balances.isErr()) {
      return Err(balances.unwrapErr())
    }

    const btcBalance = balances.unwrap().find((b) => b.currency === 'BTC')
    if (!btcBalance) {
      return Err(new Error('No BTC balance found in Strike account'))
    }

    const sats = parseBtcBalanceSats(btcBalance.total)
    if (sats.isErr()) {
      return Err(sats.unwrapErr())
    }
    logger.debug({ sats: sats.unwrap() }, 'Fetched Strike BTC balance')
    return Ok(sats.unwrap())
  },
)

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
