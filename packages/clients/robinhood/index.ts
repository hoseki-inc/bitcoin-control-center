import { createPrivateKey, sign } from 'node:crypto'
import https from 'node:https'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import { z } from 'zod'

const BASE_HOST = 'trading.robinhood.com'

// --- Zod Schemas ---

const RobinhoodHoldingSchema = z.object({
  account_number: z.string(),
  asset_code: z.string(),
  total_quantity: z.string(),
  quantity_available_for_trading: z.string(),
})

export type RobinhoodHolding = z.infer<typeof RobinhoodHoldingSchema>

const RobinhoodOrderSchema = z.object({
  id: z.string(),
  state: z.string(),
  symbol: z.string(),
  side: z.string(),
  type: z.string(),
  average_price: z.string().optional(),
  filled_asset_quantity: z.string().optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
})

export type RobinhoodOrder = z.infer<typeof RobinhoodOrderSchema>

function paginatedSchema<T extends z.ZodTypeAny>(itemSchema: T): z.ZodType<PaginatedResponse<z.infer<T>>> {
  return z.object({
    previous: z.string().nullable(),
    results: z.array(itemSchema),
    next: z.string().nullable(),
  }) as z.ZodType<PaginatedResponse<z.infer<T>>>
}

export interface PaginatedResponse<T> {
  previous: string | null
  results: T[]
  next: string | null
}

// --- Error ---

export class RobinhoodApiError extends Error {
  public readonly tag = 'RobinhoodApiError'
  public readonly status: number

  public constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// --- HTTP helper using native https (Node.js fetch/undici is blocked by Robinhood's CloudFront WAF) ---

function httpsRequest(options: {
  hostname: string
  path: string
  method: string
  headers: Record<string, string>
  body?: string
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: options.hostname,
        path: options.path,
        method: options.method,
        headers: options.headers,
      },
      (res) => {
        const chunks: Uint8Array[] = []
        res.on('data', (chunk: Uint8Array) => chunks.push(chunk))
        res.on('end', () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf-8'),
          })
        })
      },
    )
    req.on('error', reject)
    if (options.body) {
      req.write(options.body)
    }
    req.end()
  })
}

// --- Client ---

export interface RobinhoodClientConfig {
  apiKey: string
  privateKeyBase64: string
}

export class RobinhoodClient {
  private readonly apiKey: string
  private readonly privateKeyBase64: string

  public constructor(config: RobinhoodClientConfig) {
    this.apiKey = config.apiKey
    this.privateKeyBase64 = config.privateKeyBase64
  }

  /**
   * Sign a request using ED25519.
   * Message format: `{api_key}{timestamp}{path}{method}{body}`
   */
  private signRequest(timestamp: number, path: string, method: string, body: string): string {
    const message = `${this.apiKey}${timestamp}${path}${method}${body}`
    const privateKeyDer = new Uint8Array(Buffer.from(this.privateKeyBase64, 'base64'))

    // ED25519 private key seed is 32 bytes. Wrap it in PKCS#8 DER format for Node.js crypto.
    // PKCS#8 prefix for ED25519: 30 2e 02 01 00 30 05 06 03 2b 65 70 04 22 04 20
    const pkcs8Prefix = new Uint8Array(Buffer.from('302e020100300506032b657004220420', 'hex'))
    const pkcs8Der = new Uint8Array(pkcs8Prefix.length + privateKeyDer.length)
    pkcs8Der.set(pkcs8Prefix)
    pkcs8Der.set(privateKeyDer, pkcs8Prefix.length)

    const key = createPrivateKey({
      key: Buffer.from(pkcs8Der),
      format: 'der',
      type: 'pkcs8',
    })

    const messageBytes = new TextEncoder().encode(message)
    const signature = sign(null, messageBytes, key)
    return Buffer.from(signature.buffer, signature.byteOffset, signature.byteLength).toString('base64')
  }

  private async request<T>(path: string, schema: z.ZodType<T>, method = 'GET', body = ''): Promise<Result<T, Error>> {
    const timestamp = Math.floor(Date.now() / 1000)
    let signature: string
    try {
      signature = this.signRequest(timestamp, path, method, body)
    } catch (err) {
      return Err(new Error(`Failed to sign Robinhood API request: ${err instanceof Error ? err.message : String(err)}`))
    }

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'x-timestamp': String(timestamp),
      'x-signature': signature,
      Accept: 'application/json',
      'User-Agent': 'python-requests/2.31.0',
    }
    if (body) {
      headers['Content-Type'] = 'application/json; charset=utf-8'
    }

    let response: { status: number; body: string }
    try {
      response = await httpsRequest({
        hostname: BASE_HOST,
        path,
        method,
        headers,
        ...(body ? { body } : {}),
      })
    } catch (err) {
      return Err(new Error(`Failed to connect to Robinhood API: ${err instanceof Error ? err.message : String(err)}`))
    }

    if (response.status === 401 || response.status === 403) {
      return Err(
        new RobinhoodApiError(
          response.status,
          `Robinhood API auth failed (${response.status}): ${response.body || 'Unknown error'}`,
        ),
      )
    }
    if (response.status === 429) {
      return Err(new RobinhoodApiError(429, 'Robinhood API rate limit exceeded. Try again later.'))
    }
    if (response.status < 200 || response.status >= 300) {
      return Err(
        new RobinhoodApiError(
          response.status,
          `Robinhood API error: ${response.status}${response.body ? ` — ${response.body}` : ''}`,
        ),
      )
    }

    let responseBody: unknown
    try {
      responseBody = JSON.parse(response.body)
    } catch {
      return Err(new Error('Failed to parse Robinhood API response'))
    }

    const parsed = schema.safeParse(responseBody)
    if (!parsed.success) {
      return Err(new Error(`Invalid Robinhood API response: ${parsed.error.message}`))
    }

    return Ok(parsed.data)
  }

  private async paginate<T>(path: string, itemSchema: z.ZodType<T>): Promise<Result<T[], Error>> {
    const schema = paginatedSchema(itemSchema)
    const allResults: T[] = []
    let nextUrl: string | null = path

    while (nextUrl) {
      const fullPath: string = nextUrl.startsWith('http') ? nextUrl.replace(`https://${BASE_HOST}`, '') : nextUrl
      const result: Result<PaginatedResponse<T>, Error> = await this.request(fullPath, schema)
      if (result.isErr()) {
        return Err(result.unwrapErr())
      }

      const page: PaginatedResponse<T> = result.unwrap()
      allResults.push(...page.results)
      nextUrl = page.next
    }

    return Ok(allResults)
  }

  /**
   * Fetch all cryptocurrency holdings.
   */
  public getHoldings(): Promise<Result<RobinhoodHolding[], Error>> {
    return this.paginate<RobinhoodHolding>('/api/v1/crypto/trading/holdings/', RobinhoodHoldingSchema)
  }

  /**
   * Fetch BTC balance in satoshis.
   */
  public getBtcBalance = asyncFn(async (): Promise<Result<bigint, Error>> => {
    const holdingsResult = await this.getHoldings()
    if (holdingsResult.isErr()) {
      return Err(holdingsResult.unwrapErr())
    }

    const holdings = holdingsResult.unwrap()
    const btcHolding = holdings.find((h) => h.asset_code === 'BTC')
    if (!btcHolding) {
      return Ok(0n)
    }

    const sats = BigInt(Math.round(Number(btcHolding.total_quantity) * 1e8))
    return Ok(sats)
  })

  /**
   * Fetch orders with optional filtering.
   */
  public getOrders(opts?: { symbol?: string; state?: string }): Promise<Result<RobinhoodOrder[], Error>> {
    const params = new URLSearchParams()
    if (opts?.symbol) {
      params.append('symbol', opts.symbol)
    }
    if (opts?.state) {
      params.append('state', opts.state)
    }
    const query = params.toString()
    const path = query ? `/api/v1/crypto/trading/orders/?${query}` : '/api/v1/crypto/trading/orders/'
    return this.paginate<RobinhoodOrder>(path, RobinhoodOrderSchema)
  }

  /**
   * Fetch filled BTC orders.
   */
  public getBtcOrders(): Promise<Result<RobinhoodOrder[], Error>> {
    return this.getOrders({ symbol: 'BTC-USD', state: 'filled' })
  }
}
