import { generateKeyPairSync } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import { parseUnknown } from '@hoseki/packages/result'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { RobinhoodApiError, RobinhoodClient, RobinhoodResponseError, RobinhoodTransportError } from './index'

const RequestOptionsSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

function makeTestCredentials() {
  const { privateKey } = generateKeyPairSync('ed25519')
  const pkcs8Der = privateKey.export({ format: 'der', type: 'pkcs8' })
  // Last 32 bytes of Ed25519 PKCS#8 DER are the raw private seed
  const seed = pkcs8Der.subarray(pkcs8Der.length - 32)
  return {
    apiKey: 'rh-api-test-key',
    privateKeyBase64: seed.toString('base64'),
  }
}

interface CapturedRequest {
  path: string
  method: string
}

async function stubRobinhoodHttps(
  responder: (args: CapturedRequest) => { status: number; body: string; truncate?: boolean },
) {
  const requests: CapturedRequest[] = []
  const server = http.createServer((req, res) => {
    const captured = { path: req.url ?? '', method: req.method ?? 'GET' }
    requests.push(captured)
    const reply = responder(captured)
    if (reply.truncate === true) {
      res.writeHead(reply.status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(reply.body) + 100,
      })
      res.write(reply.body, () => {
        res.destroy()
      })
      return
    }
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(reply.body)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const { port } = parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener')

  const spy = vi.spyOn(https, 'request').mockImplementation((...args: Parameters<typeof https.request>) => {
    const [first, second] = args
    const opts = parseUnknown(RequestOptionsSchema, first).expect('RequestOptions')
    const callback = second instanceof Function ? second : undefined
    return http.request(
      {
        hostname: '127.0.0.1',
        port,
        protocol: 'http:',
        path: opts.path,
        method: opts.method,
        headers: opts.headers,
      },
      callback,
    )
  })

  onTestFinished(async () => {
    spy.mockRestore()
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err)
          return
        }
        resolve()
      })
    })
  })

  return requests
}

interface SilentRobinhoodSpy {
  requestedTimeouts: number[]
  timeoutFiredCount: number
  destroyErrors: Array<Error | undefined>
}

async function stubSilentRobinhood(options: { sendHeaders: boolean }): Promise<SilentRobinhoodSpy> {
  const server = http.createServer((_req, res) => {
    if (options.sendHeaders) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"results":[')
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  const { port } = parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener')

  const state: SilentRobinhoodSpy = {
    requestedTimeouts: [],
    timeoutFiredCount: 0,
    destroyErrors: [],
  }
  const spy = vi.spyOn(https, 'request').mockImplementation((...args: Parameters<typeof https.request>) => {
    const [first, second] = args
    const opts = parseUnknown(RequestOptionsSchema, first).expect('RequestOptions')
    const callback = second instanceof Function ? second : undefined
    const req = http.request(
      { hostname: '127.0.0.1', port, protocol: 'http:', path: opts.path, method: opts.method, headers: opts.headers },
      callback,
    )
    const destroyReq = req.destroy.bind(req)
    vi.spyOn(req, 'destroy').mockImplementation((err?: Error) => {
      state.destroyErrors.push(err)
      return destroyReq(err)
    })
    const setSocketTimeout = req.setTimeout.bind(req)
    vi.spyOn(req, 'setTimeout').mockImplementation((ms, onTimeout) => {
      state.requestedTimeouts.push(ms)
      return setSocketTimeout(50, () => {
        state.timeoutFiredCount += 1
        onTimeout?.()
      })
    })
    return req
  })

  onTestFinished(async () => {
    spy.mockRestore()
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })

  return state
}

describe('RobinhoodClient request timeout', () => {
  it.each([
    { reply: 'sends nothing', sendHeaders: false },
    { reply: 'sends headers then goes quiet', sendHeaders: true },
  ])('returns RobinhoodTransportError when Robinhood $reply', async ({ sendHeaders }) => {
    const spy = await stubSilentRobinhood({ sendHeaders })

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getHoldings()

    expect(spy.requestedTimeouts).toEqual([30_000])
    expect(spy.timeoutFiredCount).toBe(1)
    expect(spy.destroyErrors).toHaveLength(1)
    expect(spy.destroyErrors[0]?.message).toBe('Robinhood request timed out')
    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(RobinhoodTransportError)
    expect(err).not.toBeInstanceOf(RobinhoodApiError)
    expect(err.message).toBe('Failed to connect to Robinhood API')
  })
})

describe('RobinhoodClient', () => {
  it('fetches account_number from GET /api/v1/crypto/trading/accounts/', async () => {
    const requests = await stubRobinhoodHttps(() => ({
      status: 200,
      body: JSON.stringify({
        account_number: '123456789012',
        status: 'active',
        buying_power: '100.00',
        buying_power_currency: 'USD',
      }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getAccount()

    expect(result.isOk()).toBe(true)
    expect(result.unwrap()).toEqual({
      account_number: '123456789012',
      status: 'active',
      buying_power: '100.00',
      buying_power_currency: 'USD',
    })
    expect(requests).toEqual([{ method: 'GET', path: '/api/v1/crypto/trading/accounts/' }])
  })

  it('returns RobinhoodApiError with status 403 and omits raw provider body', async () => {
    const fakeSecret = 'RH_FAKE_SECRET_987654'
    await stubRobinhoodHttps(() => ({
      status: 403,
      body: JSON.stringify({ detail: `Forbidden ${fakeSecret}` }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getAccount()

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(RobinhoodApiError)
    if (err instanceof RobinhoodApiError) {
      expect(err.status).toBe(403)
    }
    expect(err.message).not.toContain(fakeSecret)
  })

  it('returns RobinhoodApiError with status 429 on rate limit', async () => {
    await stubRobinhoodHttps(() => ({
      status: 429,
      body: 'rate limited',
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getAccount()

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(RobinhoodApiError)
    if (err instanceof RobinhoodApiError) {
      expect(err.status).toBe(429)
    }
  })

  it('returns RobinhoodTransportError when a holdings response is cut off mid-body', { timeout: 5_000 }, async () => {
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: '{"results":[{"account_number":"123"',
      truncate: true,
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getHoldings()

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(RobinhoodTransportError)
    expect(err).not.toBeInstanceOf(RobinhoodApiError)
    expect(err.message).toBe('Failed to connect to Robinhood API')
  })

  it('returns an error when /accounts/ response is missing account_number', async () => {
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: JSON.stringify({ status: 'active' }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getAccount()

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().message).toContain('Invalid Robinhood API response')
  })

  it('parses optional account_number on orders from getOrders()', async () => {
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: JSON.stringify({
        previous: null,
        next: null,
        results: [
          {
            id: 'ord-1',
            account_number: '123456789012',
            state: 'filled',
            symbol: 'BTC-USD',
            side: 'buy',
            type: 'market',
            average_price: '65000.00',
            filled_asset_quantity: '0.01',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:01Z',
          },
        ],
      }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getOrders()

    expect(result.isOk()).toBe(true)
    expect(result.unwrap()[0]?.account_number).toBe('123456789012')
  })

  it('stops paging orders once an account_number is found', async () => {
    const requests = await stubRobinhoodHttps(({ path }) => {
      if (path.includes('cursor=page2')) {
        throw new Error('Should not fetch page 2 after finding account_number on page 1')
      }
      return {
        status: 200,
        body: JSON.stringify({
          previous: null,
          next: 'https://trading.robinhood.com/api/v1/crypto/trading/orders/?cursor=page2',
          results: [
            {
              id: 'ord-1',
              account_number: '123456789012',
              state: 'filled',
              symbol: 'BTC-USD',
              side: 'buy',
              type: 'market',
            },
          ],
        }),
      }
    })

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.findAccountNumberFromOrders()

    expect(result.unwrap()).toBe('123456789012')
    expect(requests).toHaveLength(1)
  })

  it('continues paging orders when earlier pages have no account_number', async () => {
    const requests = await stubRobinhoodHttps(({ path }) => {
      if (path.includes('cursor=page2')) {
        return {
          status: 200,
          body: JSON.stringify({
            previous: null,
            next: 'https://trading.robinhood.com/api/v1/crypto/trading/orders/?cursor=page3',
            results: [
              {
                id: 'ord-2',
                account_number: '999888777666',
                state: 'filled',
                symbol: 'BTC-USD',
                side: 'buy',
                type: 'market',
              },
            ],
          }),
        }
      }
      return {
        status: 200,
        body: JSON.stringify({
          previous: null,
          next: 'https://trading.robinhood.com/api/v1/crypto/trading/orders/?cursor=page2',
          results: [
            {
              id: 'ord-1',
              state: 'filled',
              symbol: 'BTC-USD',
              side: 'buy',
              type: 'market',
            },
          ],
        }),
      }
    })

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.findAccountNumberFromOrders()

    expect(result.unwrap()).toBe('999888777666')
    expect(requests).toHaveLength(2)
  })

  it('accepts orders with null average_price in getOrders() and findAccountNumberFromOrders()', async () => {
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: JSON.stringify({
        previous: null,
        next: null,
        results: [
          {
            id: 'ord-open-1',
            account_number: '555444333222',
            state: 'canceled',
            symbol: 'BTC-USD',
            side: 'buy',
            type: 'limit',
            average_price: null,
            filled_asset_quantity: '0',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:01Z',
          },
        ],
      }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())

    const orders = await client.getOrders()
    expect(orders.isOk()).toBe(true)
    expect(orders.unwrap()[0]?.average_price).toBeNull()
    expect(orders.unwrap()[0]?.account_number).toBe('555444333222')

    const accountNumber = await client.findAccountNumberFromOrders()
    expect(accountNumber.unwrap()).toBe('555444333222')
  })

  it('returns RobinhoodTransportError without echoing raw transport error canary', async () => {
    const canary = 'RH_TRANSPORT_CANARY_441122'
    const spy = vi.spyOn(https, 'request').mockImplementation(() => {
      throw new Error(`socket failed ${canary}`)
    })
    onTestFinished(() => {
      spy.mockRestore()
    })

    const client = new RobinhoodClient(makeTestCredentials())
    const result = await client.getAccount()

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(RobinhoodTransportError)
    expect(err.message).not.toContain(canary)
  })

  it('returns RobinhoodResponseError on invalid JSON and invalid schema without leaking body canaries', async () => {
    const htmlCanary = 'RH_HTML_CANARY_773311'
    const schemaCanary = 'RH_SCHEMA_CANARY_994411'
    let mode: 'html' | 'schema' = 'html'
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: mode === 'html' ? `<html>${htmlCanary}</html>` : JSON.stringify({ unexpected: schemaCanary }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    const htmlResult = await client.getAccount()
    expect(htmlResult.isErr()).toBe(true)
    expect(htmlResult.unwrapErr()).toBeInstanceOf(RobinhoodResponseError)
    expect(htmlResult.unwrapErr().message).not.toContain(htmlCanary)

    mode = 'schema'
    const schemaResult = await client.getAccount()
    expect(schemaResult.isErr()).toBe(true)
    expect(schemaResult.unwrapErr()).toBeInstanceOf(RobinhoodResponseError)
    expect(schemaResult.unwrapErr().message).not.toContain(schemaCanary)
  })

  it.each(['NaN', 'abc', '-0.1', '1e10000000'])(
    'getBtcBalance rejects malformed quantity %j with RobinhoodResponseError without throwing',
    async (quantity) => {
      await stubRobinhoodHttps(() => ({
        status: 200,
        body: JSON.stringify({
          previous: null,
          next: null,
          results: [
            {
              account_number: '123456789012',
              asset_code: 'BTC',
              total_quantity: quantity,
              quantity_available_for_trading: '0',
            },
          ],
        }),
      }))

      const client = new RobinhoodClient(makeTestCredentials())
      const result = await client.getBtcBalance()

      expect(result.isErr()).toBe(true)
      expect(result.unwrapErr()).toBeInstanceOf(RobinhoodResponseError)
      expect(result.unwrapErr().message).not.toContain(quantity)
    },
  )

  it('getBtcBalance converts valid decimal holdings to satoshis and returns 0n when absent', async () => {
    let includeBtc = true
    await stubRobinhoodHttps(() => ({
      status: 200,
      body: JSON.stringify({
        previous: null,
        next: null,
        results: includeBtc
          ? [
              {
                account_number: '123456789012',
                asset_code: 'BTC',
                total_quantity: '0.123456789',
                quantity_available_for_trading: '0.123456789',
              },
            ]
          : [],
      }),
    }))

    const client = new RobinhoodClient(makeTestCredentials())
    expect((await client.getBtcBalance()).unwrap()).toBe(12_345_679n)
    includeBtc = false
    expect((await client.getBtcBalance()).unwrap()).toBe(0n)
  })
})
