import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn, parseUnknown } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { getHTTPStatusCodeFromError } from '@trpc/server/http'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { createAppContext } from '../../context'
import * as env from '../../env'
import { appRouter } from '../../modules/trpc/router'

const HttpsRequestOptionsSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

async function setup(options?: { captureLogs?: boolean }) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-exchanges-router-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(env, 'loadEnv').mockReturnValue({ ...env.loadEnv(), DATA_DIR: directory })
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const logs: string[] = []
  const logger =
    options?.captureLogs === true
      ? pino(
          { level: 'debug' },
          new Writable({
            write(chunk, _encoding, callback) {
              logs.push(String(chunk))
              callback()
            },
          }),
        )
      : pino({ level: 'silent' })
  const app = (await createAppContext(logger, {})).unwrap()
  onTestFinished(() => {
    app.database.$client.close()
    app.electrumClient.disconnect()
  })
  return { app, exchanges: appRouter.createCaller({ app }).portalProve.exchanges, logs }
}

function jsonResponse(bodyJson: string, status = 200, statusText?: string): Response {
  return new Response(bodyJson, {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  })
}

function extractUrl(input: string | URL | Request): string {
  if (input instanceof Request) {
    return input.url
  }
  return input.toString()
}

function extractHeader(input: string | URL | Request, init: RequestInit | undefined, name: string): string {
  const fromInit = new Headers(init?.headers).get(name)
  if (fromInit !== null) {
    return fromInit
  }
  if (input instanceof Request) {
    return input.headers.get(name) ?? ''
  }
  return ''
}

function generateRobinhoodPrivateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  return privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32).toString('base64')
}

async function stubRobinhoodHttps(
  responder: (args: { path: string; apiKey: string }) => { status: number; body: string },
): Promise<void> {
  const server = http.createServer((req, res) => {
    const rawApiKey = req.headers['x-api-key']
    const apiKey = Array.isArray(rawApiKey) ? (rawApiKey[0] ?? '') : (rawApiKey ?? '')
    const reply = responder({ path: req.url ?? '', apiKey })
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
    const opts = parseUnknown(HttpsRequestOptionsSchema, first).expect('RequestOptions')
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
}

async function expectTrpcError(
  promise: Promise<object>,
  expected: { code: TRPCError['code']; httpStatus?: number; message?: string; forbiddenText?: string },
): Promise<void> {
  try {
    await promise
    expect.unreachable(`Expected TRPCError with code ${expected.code}`)
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError)
    if (err instanceof TRPCError) {
      expect(err.code).toBe(expected.code)
      if (expected.httpStatus !== undefined) {
        expect(getHTTPStatusCodeFromError(err)).toBe(expected.httpStatus)
      }
      if (expected.message !== undefined) {
        expect(err.message).toBe(expected.message)
      }
      if (expected.forbiddenText !== undefined) {
        expect(err.message).not.toContain(expected.forbiddenText)
      }
    }
  }
}

it('maps Coinbase and Kraken reconnect mismatches to CONFLICT and allows connecting as a new account', async () => {
  const { exchanges } = await setup()
  const krakenSecret = Buffer.from('secret').toString('base64')

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const cbKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      const krKey = extractHeader(input, init, 'API-Key')

      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse(
          JSON.stringify({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: cbKey === 'cb-b' ? 'port-b' : 'port-a',
            portfolio_type: 'DEFAULT',
          }),
        )
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-uuid-a')) {
        return jsonResponse(
          JSON.stringify({
            account: {
              uuid: 'cb-uuid-a',
              name: 'CB A',
              currency: 'BTC',
              available_balance: { value: '0.5', currency: 'BTC' },
              default: true,
              active: true,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
              deleted_at: null,
              type: 'ACCOUNT_TYPE_CRYPTO',
              ready: true,
              hold: { value: '0', currency: 'BTC' },
            },
          }),
        )
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-uuid-b')) {
        return jsonResponse(
          JSON.stringify({
            account: {
              uuid: 'cb-uuid-b',
              name: 'CB B',
              currency: 'BTC',
              available_balance: { value: '1.5', currency: 'BTC' },
              default: true,
              active: true,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
              deleted_at: null,
              type: 'ACCOUNT_TYPE_CRYPTO',
              ready: true,
              hold: { value: '0', currency: 'BTC' },
            },
          }),
        )
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        const isB = cbKey === 'cb-b'
        return jsonResponse(
          JSON.stringify({
            accounts: [
              {
                uuid: isB ? 'cb-uuid-b' : 'cb-uuid-a',
                name: isB ? 'CB B' : 'CB A',
                currency: 'BTC',
                available_balance: { value: isB ? '1.5' : '0.5', currency: 'BTC' },
                default: true,
                active: true,
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
                deleted_at: null,
                type: 'ACCOUNT_TYPE_CRYPTO',
                ready: true,
                hold: { value: '0', currency: 'BTC' },
              },
            ],
            has_next: false,
            cursor: '',
            size: 1,
          }),
        )
      }

      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse(JSON.stringify({ error: [], result: { XXBT: krKey === 'kr-b' ? '2.0' : '1.0' } }))
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse(
          JSON.stringify({ error: [], result: { iban: krKey === 'kr-b' ? 'KR-IBAN-B' : 'KR-IBAN-A' } }),
        )
      }
      return jsonResponse(JSON.stringify({ error: 'not found' }), 404)
    }),
  )

  const cbA = await exchanges.coinbase.connect({ apiKey: 'cb-a', secretKey: 'secret-a' })
  await expectTrpcError(
    exchanges.coinbase.connect({ apiKey: 'cb-b', secretKey: 'secret-b', replaceAccountId: cbA.id }),
    { code: 'CONFLICT', message: 'This key belongs to a different Coinbase account.' },
  )
  const cbB = await exchanges.coinbase.connect({ apiKey: 'cb-b', secretKey: 'secret-b' })
  expect(cbB.id).not.toBe(cbA.id)
  await expect(exchanges.coinbase.list()).resolves.toHaveLength(2)

  const krA = await exchanges.kraken.connect({ apiKey: 'kr-a', secretKey: krakenSecret })
  await expectTrpcError(
    exchanges.kraken.connect({ apiKey: 'kr-b', secretKey: krakenSecret, replaceAccountId: krA.id }),
    { code: 'CONFLICT', message: 'This key belongs to a different Kraken account.' },
  )
  const krB = await exchanges.kraken.connect({ apiKey: 'kr-b', secretKey: krakenSecret })
  expect(krB.id).not.toBe(krA.id)
  await expect(exchanges.kraken.list()).resolves.toHaveLength(2)
})

it('maps Robinhood mismatch to CONFLICT and unverifiable reconnect to BAD_REQUEST', async () => {
  const { exchanges } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      if (apiKey === 'rh-unverifiable') {
        return { status: 403, body: JSON.stringify({ detail: 'Forbidden' }) }
      }
      return {
        status: 200,
        body: JSON.stringify({ account_number: apiKey === 'rh-b' ? 'rh-acct-b' : 'rh-acct-a', status: 'active' }),
      }
    }
    return { status: 200, body: JSON.stringify({ previous: null, next: null, results: [] }) }
  })

  const rhA = await exchanges.robinhood.connect({ apiKey: 'rh-a', privateKeyBase64, displayName: 'Robinhood A' })

  await expectTrpcError(
    exchanges.robinhood.connect({
      apiKey: 'rh-b',
      privateKeyBase64,
      displayName: 'Robinhood B',
      replaceAccountId: rhA.id,
    }),
    { code: 'CONFLICT', message: 'This key belongs to a different Robinhood account.' },
  )

  await expectTrpcError(
    exchanges.robinhood.connect({
      apiKey: 'rh-unverifiable',
      privateKeyBase64,
      displayName: 'Robinhood A',
      replaceAccountId: rhA.id,
    }),
    {
      code: 'BAD_REQUEST',
      message:
        "We couldn't confirm which Robinhood account this key belongs to. Turn on 'Read crypto accounts' for the key (or create a new key with it on) and try again.",
    },
  )

  const rhB = await exchanges.robinhood.connect({ apiKey: 'rh-b', privateKeyBase64, displayName: 'Robinhood B' })
  expect(rhB.id).not.toBe(rhA.id)
  await expect(exchanges.robinhood.list()).resolves.toHaveLength(2)
})

it('redacts raw provider errors so fake secrets never reach RPC errors or debug logs', async () => {
  const { exchanges, logs } = await setup({ captureLogs: true })
  const secretCanary = 'ROUTER_SECRET_CANARY_518293'
  const krakenSecret = Buffer.from('secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('coinbase')) {
        return jsonResponse(JSON.stringify({ error: `cb ${secretCanary}` }), 401, `cb-status ${secretCanary}`)
      }
      return jsonResponse(JSON.stringify({ error: [`EAPI:Invalid key ${secretCanary}`] }), 200)
    }),
  )
  await stubRobinhoodHttps(() => ({
    status: 401,
    body: JSON.stringify({ detail: `rh ${secretCanary}` }),
  }))

  await expectTrpcError(exchanges.coinbase.connect({ apiKey: 'cb-bad', secretKey: 'secret' }), {
    code: 'BAD_REQUEST',
    forbiddenText: secretCanary,
  })
  await expectTrpcError(exchanges.kraken.connect({ apiKey: 'kr-bad', secretKey: krakenSecret }), {
    code: 'BAD_REQUEST',
    forbiddenText: secretCanary,
  })
  await expectTrpcError(exchanges.robinhood.connect({ apiKey: 'rh-bad', privateKeyBase64: robinhoodPrivateKey }), {
    code: 'BAD_REQUEST',
    forbiddenText: secretCanary,
  })

  expect(logs.join('\n')).not.toContain(secretCanary)
})

it('maps Coinbase revoked-key refreshBalance to PRECONDITION_FAILED (HTTP 412) and updates list status to needs_reconnect', async () => {
  const { exchanges } = await setup()
  let revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (revoked) {
        return jsonResponse(JSON.stringify({ error: 'Unauthorized' }), 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse(
          JSON.stringify({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'port-a',
            portfolio_type: 'DEFAULT',
          }),
        )
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-uuid-a')) {
        return jsonResponse(
          JSON.stringify({
            account: {
              uuid: 'cb-uuid-a',
              name: 'CB A',
              currency: 'BTC',
              available_balance: { value: '0.5', currency: 'BTC' },
              default: true,
              active: true,
              created_at: '2025-01-01T00:00:00Z',
              updated_at: '2025-01-01T00:00:00Z',
              deleted_at: null,
              type: 'ACCOUNT_TYPE_CRYPTO',
              ready: true,
              hold: { value: '0', currency: 'BTC' },
            },
          }),
        )
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse(
          JSON.stringify({
            accounts: [
              {
                uuid: 'cb-uuid-a',
                name: 'CB A',
                currency: 'BTC',
                available_balance: { value: '0.5', currency: 'BTC' },
                default: true,
                active: true,
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
                deleted_at: null,
                type: 'ACCOUNT_TYPE_CRYPTO',
                ready: true,
                hold: { value: '0', currency: 'BTC' },
              },
            ],
            has_next: false,
            cursor: '',
            size: 1,
          }),
        )
      }
      return jsonResponse(JSON.stringify({ error: 'not found' }), 404)
    }),
  )

  const account = await exchanges.coinbase.connect({ apiKey: 'cb-a', secretKey: 'secret-a' })
  revoked = true

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
    message: 'Your Coinbase API key was rejected. Reconnect your account.',
  })

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
    message: 'Exchange credentials are unavailable or expired. Reconnect this exchange account.',
  })

  const listed = await exchanges.coinbase.list()
  expect(listed[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listed[0]?.balance).toBeNull()
})

it('maps Kraken revoked-key refreshBalance to PRECONDITION_FAILED (HTTP 412) and updates list status to needs_reconnect', async () => {
  const { exchanges } = await setup()
  const krakenSecret = Buffer.from('secret').toString('base64')
  let revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (revoked) {
        return jsonResponse(JSON.stringify({ error: ['EAPI:Invalid key'] }), 200)
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse(JSON.stringify({ error: [], result: { XXBT: '1.0' } }))
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse(JSON.stringify({ error: [], result: { iban: 'KR-IBAN-A' } }))
      }
      return jsonResponse(JSON.stringify({ error: ['unknown'] }), 404)
    }),
  )

  const account = await exchanges.kraken.connect({ apiKey: 'kr-a', secretKey: krakenSecret })
  revoked = true

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
    message: 'Your Kraken API key was rejected. Reconnect your account.',
  })

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
  })

  const listed = await exchanges.kraken.list()
  expect(listed[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listed[0]?.balance).toBeNull()
})

it('maps Robinhood revoked-key refreshBalance to PRECONDITION_FAILED (HTTP 412) and updates list status to needs_reconnect', async () => {
  const { exchanges } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  let revoked = false

  await stubRobinhoodHttps(({ path }) => {
    if (revoked) {
      return { status: 401, body: JSON.stringify({ detail: 'Invalid token' }) }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 200, body: JSON.stringify({ account_number: 'rh-acct-a', status: 'active' }) }
    }
    return { status: 200, body: JSON.stringify({ previous: null, next: null, results: [] }) }
  })

  const account = await exchanges.robinhood.connect({ apiKey: 'rh-a', privateKeyBase64, displayName: 'Robinhood A' })
  revoked = true

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
    message: 'Your Robinhood API key was rejected. Reconnect your account.',
  })

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
  })

  const listed = await exchanges.robinhood.list()
  expect(listed[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listed[0]?.balance).toBeNull()
})

it('maps retryable old-key verification failures to INTERNAL_SERVER_ERROR', async () => {
  const { exchanges } = await setup()
  const krakenSecret = Buffer.from('secret').toString('base64')
  let infoCalls = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse(JSON.stringify({ error: [], result: { XXBT: '1.0' } }))
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        infoCalls += 1
        if (apiKey === 'kr-a' && infoCalls === 1) {
          return jsonResponse(JSON.stringify({ error: ['EGeneral:Permission denied'] }))
        }
        if (apiKey === 'kr-a') {
          return jsonResponse(JSON.stringify({ error: ['EService:Unavailable'] }), 503)
        }
        return jsonResponse(JSON.stringify({ error: [], result: { iban: 'KR-IBAN-B' } }))
      }
      return jsonResponse(JSON.stringify({ error: ['unknown'] }), 404)
    }),
  )

  const krA = await exchanges.kraken.connect({ apiKey: 'kr-a', secretKey: krakenSecret })

  await expectTrpcError(
    exchanges.kraken.connect({ apiKey: 'kr-b', secretKey: krakenSecret, replaceAccountId: krA.id }),
    {
      code: 'INTERNAL_SERVER_ERROR',
      message: "Couldn't verify your existing Kraken account right now. Please try again.",
    },
  )
})

it('maps Strike revoked-key refreshBalance to PRECONDITION_FAILED (HTTP 412) and updates list status to needs_reconnect', async () => {
  const { exchanges } = await setup()
  let revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const auth = extractHeader(input, init, 'Authorization')
      if (auth === 'Bearer strike-a' && revoked) {
        return jsonResponse(JSON.stringify({ error: 'Unauthorized' }), 401)
      }
      const total = auth === 'Bearer strike-b' ? '0.6' : '0.3'
      return jsonResponse(JSON.stringify([{ currency: 'BTC', total, available: total }]))
    }),
  )

  const account = await exchanges.strike.connect({ apiKey: 'strike-a', displayName: 'Strike' })
  revoked = true

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
    message: 'Your Strike API key was rejected. Reconnect your account.',
  })

  await expectTrpcError(exchanges.refreshBalance({ accountId: account.id }), {
    code: 'PRECONDITION_FAILED',
    httpStatus: 412,
  })

  const listedExpired = await exchanges.strike.list()
  expect(listedExpired[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listedExpired[0]?.balance).toBeNull()

  const reconnected = await exchanges.strike.connect({
    apiKey: 'strike-b',
    displayName: 'Strike',
    replaceAccountId: account.id,
  })
  expect(reconnected.connectionStatus).toBe('connected')

  const refreshed = await exchanges.refreshBalance({ accountId: account.id })
  expect(refreshed.connectionStatus).toBe('connected')
  expect(refreshed.balanceSats).toBe('60000000')
})

it('maps raw validateStrikeApiKey errors in strike.connect through toConnectTrpcError without leaking details', async () => {
  const { exchanges, logs } = await setup({ captureLogs: true })
  const secretCanary = 'STRIKE_CONNECT_CANARY_882104'
  let mode: 'http500' | 'malformed' = 'http500'

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (mode === 'http500') {
        return jsonResponse(JSON.stringify({ detail: `strike ${secretCanary}` }), 500, `status ${secretCanary}`)
      }
      return jsonResponse(JSON.stringify({ unexpected: secretCanary }), 200)
    }),
  )

  await expectTrpcError(exchanges.strike.connect({ apiKey: 'strike-bad', displayName: 'Strike' }), {
    code: 'BAD_REQUEST',
    message: "Couldn't connect to Strike right now. Please check your credentials and try again.",
    forbiddenText: secretCanary,
  })

  mode = 'malformed'
  await expectTrpcError(exchanges.strike.connect({ apiKey: 'strike-bad', displayName: 'Strike' }), {
    code: 'BAD_REQUEST',
    message: "Couldn't connect to Strike right now. Please check your credentials and try again.",
    forbiddenText: secretCanary,
  })

  expect(logs.join('\n')).not.toContain(secretCanary)
})

it('sanitizes thrown transport errors and invalid header API keys in strike.connect and coinbase.connect without leaking secrets', async () => {
  const { exchanges, logs } = await setup({ captureLogs: true })
  const strikeThrownCanary = 'STRIKE_THROWN_CANARY_991122'
  const strikeHeaderCanary = 'STRIKE_HEADER_KEY_CANARY_334455'
  const coinbaseHeaderCanary = 'CB_HEADER_KEY_CANARY_774422'

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError(`transport failure ${strikeThrownCanary}`)
    }),
  )

  await expectTrpcError(exchanges.strike.connect({ apiKey: 'strike-key', displayName: 'Strike' }), {
    code: 'BAD_REQUEST',
    message: "Couldn't connect to Strike right now. Please check your credentials and try again.",
    forbiddenText: strikeThrownCanary,
  })

  vi.unstubAllGlobals()
  await expectTrpcError(
    exchanges.strike.connect({ apiKey: `${strikeHeaderCanary}\r\ninjected`, displayName: 'Strike' }),
    {
      code: 'BAD_REQUEST',
      message: "Couldn't connect to Strike right now. Please check your credentials and try again.",
      forbiddenText: strikeHeaderCanary,
    },
  )

  await expectTrpcError(
    exchanges.coinbase.connect({ apiKey: `${coinbaseHeaderCanary}\r\ninjected`, secretKey: 'coinbase-secret' }),
    {
      code: 'BAD_REQUEST',
      message: "Couldn't connect to Coinbase right now. Please check your credentials and try again.",
      forbiddenText: coinbaseHeaderCanary,
    },
  )

  await expectTrpcError(
    exchanges.coinbase.connect({ apiKey: `${coinbaseHeaderCanary}\u0100`, secretKey: 'coinbase-secret' }),
    {
      code: 'BAD_REQUEST',
      message: "Couldn't connect to Coinbase right now. Please check your credentials and try again.",
      forbiddenText: coinbaseHeaderCanary,
    },
  )

  const combinedLogs = logs.join('\n')
  expect(combinedLogs).not.toContain(strikeThrownCanary)
  expect(combinedLogs).not.toContain(strikeHeaderCanary)
  expect(combinedLogs).not.toContain(coinbaseHeaderCanary)
})

it('catches unexpected thrown exceptions at the router boundary for connect and refresh mutations without leaking secrets', async () => {
  const { app, exchanges, logs } = await setup({ captureLogs: true })
  const canary = 'ROUTER_THROW_BOUNDARY_CANARY_619204'

  vi.spyOn(app.exchangeService, 'connectCoinbase').mockImplementation(async () => {
    throw new Error(`unexpected coinbase throw ${canary}`)
  })
  vi.spyOn(app.exchangeService, 'connectStrike').mockImplementation(async () => {
    throw new Error(`unexpected strike throw ${canary}`)
  })
  vi.spyOn(app.exchangeService, 'refreshBalance').mockImplementation(async () => {
    throw new Error(`unexpected refresh throw ${canary}`)
  })

  await expectTrpcError(exchanges.coinbase.connect({ apiKey: 'k', secretKey: 's' }), {
    code: 'BAD_REQUEST',
    message: "Couldn't connect to Coinbase right now. Please check your credentials and try again.",
    forbiddenText: canary,
  })
  await expectTrpcError(exchanges.strike.connect({ apiKey: 'k', displayName: 'Strike' }), {
    code: 'BAD_REQUEST',
    message: "Couldn't connect to Strike right now. Please check your credentials and try again.",
    forbiddenText: canary,
  })
  await expectTrpcError(exchanges.refreshBalance({ accountId: 'acct-1' }), {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to refresh exchange balance. Please try again.',
    forbiddenText: canary,
  })

  expect(logs.join('\n')).not.toContain(canary)
})
