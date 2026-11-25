import { type KeyObject, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { asyncFn, parseUnknown } from '@hoseki/packages/result'
import { asc, eq, sql } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { openDrizzleDatabase } from '../../db/drizzle'
import { exchangeAccounts, exchangeBalanceSnapshots } from '../../db/schema'
import { Encrypted, generateEncryptionKey, initEncryption } from '../../lib/encrypted'
import { walletDetailLogOptions } from '../../log_redaction'
import {
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  ExchangeCredentialsRevokedError,
  ExchangeService,
  ExchangeUserError,
  ExchangeVerificationRetryableError,
  RobinhoodAccountUnverifiableError,
  type SupportedExchange,
} from './service'

const HttpsRequestOptionsSchema = z.object({
  path: z.string().optional(),
  method: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
})

async function setup(options?: { captureLogs?: boolean; logLevel?: 'debug' | 'info' }) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-exchange-'))
  const logs: string[] = []
  const level = options?.logLevel ?? 'debug'
  const logger =
    options?.captureLogs === true
      ? pino(
          { level, ...walletDetailLogOptions(level) },
          new Writable({
            write(chunk, _encoding, callback) {
              logs.push(String(chunk))
              callback()
            },
          }),
        )
      : pino({ level: 'silent' })
  const db = await openDrizzleDatabase(directory, logger)
  initEncryption(generateEncryptionKey())
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await db.insert(exchangeAccounts).values({
    id: 'exchange',
    provider: 'strike',
    displayName: 'Test account',
    encryptedCredentials: '{}',
  })
  return { db, service: new ExchangeService({ db, logger }), logs }
}

type JsonValue = string | number | boolean | null | undefined | { [key: string]: JsonValue } | JsonValue[]

function jsonResponse(body: JsonValue, status = 200, statusText?: string): Response {
  return new Response(JSON.stringify(body), {
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

interface MockCoinbaseAccount {
  uuid: string
  name: string
  currency: string
  available_balance: { value: string; currency: string }
  default: boolean
  active: boolean
  created_at: string
  updated_at: string
  deleted_at: null
  type: string
  ready: boolean
  hold: { value: string; currency: string }
  retail_portfolio_id?: string
}

function makeCoinbaseAccount(overrides: {
  uuid: string
  name: string
  currency?: string
  type?: string
  default?: boolean
  balance?: string
  retail_portfolio_id?: string
}): MockCoinbaseAccount {
  const account: MockCoinbaseAccount = {
    uuid: overrides.uuid,
    name: overrides.name,
    currency: overrides.currency ?? 'BTC',
    available_balance: { value: overrides.balance ?? '0.5', currency: overrides.currency ?? 'BTC' },
    default: overrides.default ?? true,
    active: true,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
    deleted_at: null,
    type: overrides.type ?? 'ACCOUNT_TYPE_CRYPTO',
    ready: true,
    hold: { value: '0', currency: overrides.currency ?? 'BTC' },
  }
  if (overrides.retail_portfolio_id !== undefined) {
    account.retail_portfolio_id = overrides.retail_portfolio_id
  }
  return account
}

function generateRobinhoodPrivateKeyBase64(): string {
  const { privateKey } = generateKeyPairSync('ed25519')
  const pkcs8Der = privateKey.export({ format: 'der', type: 'pkcs8' })
  return pkcs8Der.subarray(-32).toString('base64')
}

interface MockRobinhoodResponse {
  status: number
  body?: JsonValue
  rawBody?: string
  destroySocket?: boolean
}

async function stubRobinhoodHttps(
  responder: (args: { path: string; apiKey: string }) => MockRobinhoodResponse,
): Promise<void> {
  const server = http.createServer((req, res) => {
    const rawApiKey = req.headers['x-api-key']
    const apiKey = Array.isArray(rawApiKey) ? (rawApiKey[0] ?? '') : (rawApiKey ?? '')
    const reply = responder({ path: req.url ?? '', apiKey })
    if (reply.destroySocket === true) {
      res.destroy()
      return
    }
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(reply.rawBody ?? JSON.stringify(reply.body))
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

interface MockCredentialPayload {
  type: 'apiKey'
  data: Record<string, { blob: string }>
  portfolioUuid?: string
}

function makeEncryptedApiKeyJson(fields: Record<string, string>, portfolioUuid?: string): string {
  const data: Record<string, { blob: string }> = {}
  for (const [k, v] of Object.entries(fields)) {
    data[k] = { blob: Encrypted.encrypt(v).unwrap().blob }
  }
  const payload: MockCredentialPayload = {
    type: 'apiKey',
    data,
  }
  if (portfolioUuid !== undefined) {
    payload.portfolioUuid = portfolioUuid
  }
  return JSON.stringify(payload)
}

const transaction = {
  externalId: 'first',
  transactedAt: '2026-01-01',
  type: 'buy',
  amountBtc: '1',
  statementMonth: '2026-01',
}

function stubCoinbasePairFetch(): void {
  const acctAVault = makeCoinbaseAccount({
    uuid: 'cb-vault-a',
    name: 'BTC Vault A',
    type: 'ACCOUNT_TYPE_VAULT',
    default: false,
    balance: '2.0',
    retail_portfolio_id: 'portfolio-a',
  })
  const acctAPrimary = makeCoinbaseAccount({
    uuid: 'cb-btc-a',
    name: 'Account A BTC',
    type: 'ACCOUNT_TYPE_CRYPTO',
    default: true,
    balance: '1.25',
    retail_portfolio_id: 'portfolio-a',
  })
  const acctBPrimary = makeCoinbaseAccount({
    uuid: 'cb-btc-b',
    name: 'Account B BTC',
    type: 'ACCOUNT_TYPE_CRYPTO',
    default: true,
    balance: '9.99',
    retail_portfolio_id: 'portfolio-b',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')

      if (url.includes('/api/v3/brokerage/key_permissions')) {
        if (apiKey === 'cb-key-a-1' || apiKey === 'cb-key-a-2') {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'portfolio-a',
            portfolio_type: 'DEFAULT',
          })
        }
        if (apiKey === 'cb-key-same-uuid-other-portfolio') {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'portfolio-other',
            portfolio_type: 'CONSUMER',
          })
        }
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'portfolio-b',
          portfolio_type: 'DEFAULT',
        })
      }

      if (url.includes('/api/v3/brokerage/accounts/cb-btc-a')) {
        const balance = apiKey === 'cb-key-a-2' ? '1.50' : '1.25'
        return jsonResponse({ account: { ...acctAPrimary, available_balance: { value: balance, currency: 'BTC' } } })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-btc-b')) {
        return jsonResponse({ account: acctBPrimary })
      }

      if (url.includes('/api/v3/brokerage/accounts')) {
        if (apiKey === 'cb-key-a-1' || apiKey === 'cb-key-a-2' || apiKey === 'cb-key-same-uuid-other-portfolio') {
          if (url.includes('cursor=page2')) {
            return jsonResponse({ accounts: [acctAPrimary], has_next: false, cursor: '', size: 1 })
          }
          return jsonResponse({ accounts: [acctAVault], has_next: true, cursor: 'page2', size: 1 })
        }
        return jsonResponse({ accounts: [acctBPrimary], has_next: false, cursor: '', size: 1 })
      }

      return jsonResponse({ error: 'unexpected url' }, 404)
    }),
  )
}

function stubKrakenPairFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')

      if (url.endsWith('/0/private/Balance')) {
        const balance = apiKey === 'kr-key-b' ? '3.0' : apiKey === 'kr-key-a-2' ? '1.75' : '1.0'
        return jsonResponse({ error: [], result: { XXBT: balance } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        if (apiKey === 'kr-key-a-1') {
          return jsonResponse({ error: [], result: { iban: 'AA11 N84G 1234 5678' } })
        }
        if (apiKey === 'kr-key-a-2') {
          return jsonResponse({ error: [], result: { iban: 'aa11n84g12345678' } })
        }
        return jsonResponse({ error: [], result: { iban: 'BB22 N84G 9999 0000' } })
      }
      return jsonResponse({ error: ['EGeneral:Unknown method'] }, 404)
    }),
  )
}

async function stubRobinhoodFallbackHttps(): Promise<void> {
  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      if (apiKey === 'rh-key-a-primary' || apiKey === 'rh-key-a-rotated') {
        return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
      }
      if (apiKey === 'rh-key-b') {
        return { status: 200, body: { account_number: 'rh-acct-b', status: 'active' } }
      }
      return { status: 403, body: { detail: 'Forbidden' } }
    }

    if (path.startsWith('/api/v1/crypto/trading/holdings/')) {
      if (apiKey === 'rh-key-a-holdings-fallback') {
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                account_number: 'rh-acct-a',
                asset_code: 'BTC',
                total_quantity: '0.25',
                quantity_available_for_trading: '0.25',
              },
            ],
          },
        }
      }
      if (apiKey === 'rh-key-b-holdings-fallback') {
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                account_number: 'rh-acct-b',
                asset_code: 'BTC',
                total_quantity: '1.0',
                quantity_available_for_trading: '1.0',
              },
            ],
          },
        }
      }
      return { status: 200, body: { previous: null, next: null, results: [] } }
    }

    if (path.startsWith('/api/v1/crypto/trading/orders/')) {
      if (apiKey === 'rh-key-a-orders-fallback') {
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                id: 'ord-1',
                account_number: 'rh-acct-a',
                symbol: 'BTC-USD',
                side: 'buy',
                type: 'market',
                state: 'filled',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            ],
          },
        }
      }
      if (apiKey === 'rh-key-b-orders-fallback') {
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                id: 'ord-2',
                account_number: 'rh-acct-b',
                symbol: 'BTC-USD',
                side: 'buy',
                type: 'market',
                state: 'filled',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            ],
          },
        }
      }
      if (apiKey === 'rh-key-orders-403') {
        return { status: 403, body: { detail: 'Forbidden' } }
      }
      return { status: 200, body: { previous: null, next: null, results: [] } }
    }

    return { status: 404, body: { detail: 'Not found' } }
  })
}

it('completes an import atomically before a concurrent account deletion', async () => {
  const { service } = await setup()
  const [imported, removed] = await Promise.all([
    service.importStatementTransactions({ accountId: 'exchange', transactions: [transaction] }),
    service.removeAccount('exchange'),
  ])
  expect(imported.unwrap()).toEqual({ imported: 1, skipped: 0 })
  expect(removed.isOk()).toBe(true)
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual([])
})

it('returns not found if deletion is queued before the import, including empty imports', async () => {
  const { db, service } = await setup()
  // execute() queues the delete eagerly; query builders otherwise start when awaited.
  const removal = db.delete(exchangeAccounts).where(eq(exchangeAccounts.id, 'exchange')).execute()
  const [missing, empty] = await Promise.all([
    service.importStatementTransactions({ accountId: 'exchange', transactions: [transaction] }),
    service.importStatementTransactions({ accountId: 'exchange', transactions: [] }),
  ])
  await removal
  expect(missing.unwrapErr().message).toBe('Exchange account not found')
  expect(empty.unwrapErr().message).toBe('Exchange account not found')
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual([])
})

it('deduplicates concurrent imports and rolls back earlier rows if a later insert fails', async () => {
  const { db, service } = await setup()
  const input = { accountId: 'exchange', transactions: [transaction] }
  const [first, second] = await Promise.all([
    service.importStatementTransactions(input),
    service.importStatementTransactions(input),
  ])
  expect(first.unwrap()).toEqual({ imported: 1, skipped: 0 })
  expect(second.unwrap()).toEqual({ imported: 0, skipped: 1 })
  const before = await service.listStatementTransactions('exchange')
  await db.run(sql`CREATE TEMP TRIGGER fail_import BEFORE INSERT ON exchange_statement_txs
    WHEN NEW.external_id = 'fail'
    BEGIN SELECT RAISE(ABORT, 'Synthetic import failure'); END`)
  await expect(
    service.importStatementTransactions({
      accountId: 'exchange',
      transactions: [
        { ...transaction, externalId: 'second' },
        { ...transaction, externalId: 'fail' },
      ],
    }),
  ).rejects.toHaveProperty('cause.message', expect.stringContaining('Synthetic import failure'))
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual(before)
})

it('Coinbase: picks primary BTC wallet across pages and stores externalAccountId and portfolioUuid', async () => {
  const { db, service } = await setup()
  stubCoinbasePairFetch()

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-a-1', secretKey: 'secret-a-1' })).unwrap()
  expect(connected.displayName).toBe('Account A BTC')
  expect(connected.balanceSats).toBe('125000000')

  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(row?.externalAccountId).toBe('cb-btc-a')
  expect(JSON.parse(row?.encryptedCredentials ?? '{}')).toMatchObject({ portfolioUuid: 'portfolio-a' })
})

it('Coinbase: rejects reconnect with a different BTC wallet UUID without writing', async () => {
  const { db, service } = await setup()
  stubCoinbasePairFetch()

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-a-1', secretKey: 'secret-a-1' })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, connected.id))

  const mismatch = await service.connectCoinbase({
    apiKey: 'cb-key-b',
    secretKey: 'secret-b',
    replaceAccountId: connected.id,
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  expect(mismatch.unwrapErr().message).toBe('This key belongs to a different Coinbase account.')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
  const snapshotsAfter = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, connected.id))
  expect(snapshotsAfter).toEqual(snapshotsBefore)
})

it('Coinbase: rejects reconnect with a different portfolio_uuid without writing', async () => {
  const { db, service } = await setup()
  stubCoinbasePairFetch()

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-a-1', secretKey: 'secret-a-1' })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const mismatch = await service.connectCoinbase({
    apiKey: 'cb-key-same-uuid-other-portfolio',
    secretKey: 'secret-other',
    replaceAccountId: connected.id,
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  expect(mismatch.unwrapErr().message).toBe('This key belongs to a different Coinbase account.')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Coinbase: allows connecting a second account without replaceAccountId while leaving the first untouched', async () => {
  const { db, service } = await setup()
  stubCoinbasePairFetch()

  const first = (await service.connectCoinbase({ apiKey: 'cb-key-a-1', secretKey: 'secret-a-1' })).unwrap()
  const [rowABefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, first.id))

  const second = (await service.connectCoinbase({ apiKey: 'cb-key-b', secretKey: 'secret-b' })).unwrap()
  expect(second.id).not.toBe(first.id)
  expect(second.displayName).toBe('Account B BTC')

  const [rowAAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, first.id))
  expect(rowAAfter).toEqual(rowABefore)
})

it('Coinbase: allows matching reconnect and preserves id and createdAt', async () => {
  const { db, service } = await setup()
  stubCoinbasePairFetch()

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-a-1', secretKey: 'secret-a-1' })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const reconnected = (
    await service.connectCoinbase({
      apiKey: 'cb-key-a-2',
      secretKey: 'secret-a-2',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.id).toBe(connected.id)
  expect(reconnected.balanceSats).toBe('150000000')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter?.createdAt).toBe(rowBefore?.createdAt)
})

it('Coinbase: backfills legacy ID from a working old key and rejects mismatch without changing balance', async () => {
  const { db, service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-legacy-a',
    name: 'Legacy A',
    balance: '0.4',
    retail_portfolio_id: 'port-a',
  })
  const acctB = makeCoinbaseAccount({
    uuid: 'cb-legacy-b',
    name: 'Other B',
    balance: '0.9',
    retail_portfolio_id: 'port-b',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-working',
    provider: 'coinbase',
    displayName: 'Legacy Coinbase',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-working-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: apiKey === 'key-b' ? 'port-b' : 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: apiKey === 'key-b' ? [acctB] : [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const mismatch = await service.connectCoinbase({
    apiKey: 'key-b',
    secretKey: 'secret-b',
    replaceAccountId: 'cb-legacy-working',
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-working'))
  expect(row?.externalAccountId).toBe('cb-legacy-a')
  expect(row?.balanceSats).toBe('40000000')
  expect(JSON.parse(row?.encryptedCredentials ?? '{}')).toMatchObject({ portfolioUuid: 'port-a' })
})

it('Coinbase: fails closed when legacy old key returns 401 Unauthorized and row has no saved externalAccountId', async () => {
  const { db, service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-legacy-a',
    name: 'Legacy A',
    balance: '0.4',
    retail_portfolio_id: 'port-a',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-revoked',
    provider: 'coinbase',
    displayName: 'Legacy Revoked Coinbase',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-revoked-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'cb-legacy-revoked',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '40000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-revoked'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-revoked'))

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'old-revoked-key') {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const blocked = await service.connectCoinbase({
    apiKey: 'key-a-new',
    secretKey: 'secret-a-new',
    replaceAccountId: 'cb-legacy-revoked',
  })
  expect(blocked.isErr()).toBe(true)
  expect(blocked.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-revoked'))
  expect(rowAfter).toEqual(rowBefore)
  const snapshotsAfter = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-revoked'))
  expect(snapshotsAfter).toEqual(snapshotsBefore)
})

function ed25519SecretKey() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const pkcs8Der = privateKey.export({ format: 'der', type: 'pkcs8' })
  const spkiDer = publicKey.export({ format: 'der', type: 'spki' })
  const seed = pkcs8Der.subarray(16)
  const rawPublic = spkiDer.subarray(12)
  return {
    secretKey: Buffer.concat([seed, rawPublic]).toString('base64'),
    publicKey,
    pkcs8Pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    seed,
  }
}

const CdpJwtHeaderSchema = z.object({ alg: z.enum(['ES256', 'EdDSA']), kid: z.string() })

function verifyCdpBearerJwt(
  authorization: string,
  publicKey: KeyObject,
): { alg: 'ES256' | 'EdDSA'; kid: string } | null {
  if (!authorization.startsWith('Bearer ')) {
    return null
  }
  const parts = authorization.slice('Bearer '.length).split('.')
  const [header, payload, signature] = parts
  if (parts.length !== 3 || header === undefined || payload === undefined || signature === undefined) {
    return null
  }
  const headerParsed = parseUnknown(CdpJwtHeaderSchema, JSON.parse(Buffer.from(header, 'base64url').toString()))
  if (headerParsed.isErr()) {
    return null
  }
  const { alg, kid } = headerParsed.unwrap()
  if ((alg === 'EdDSA') !== (publicKey.asymmetricKeyType === 'ed25519')) {
    return null
  }
  const signingInput = Buffer.from(`${header}.${payload}`)
  const sigBytes = Buffer.from(signature, 'base64url')
  const ok =
    alg === 'EdDSA'
      ? verify(null, signingInput, publicKey, sigBytes)
      : verify('sha256', signingInput, { key: publicKey, dsaEncoding: 'ieee-p1363' }, sigBytes)
  return ok ? { alg, kid } : null
}

function stubCoinbaseCdpFetch(
  publicKey: KeyObject,
  options?: {
    account?: MockCoinbaseAccount
    portfolioUuid?: string
    onVerified?: (info: { alg: 'ES256' | 'EdDSA'; kid: string }) => void
  },
) {
  const acct =
    options?.account ??
    makeCoinbaseAccount({
      uuid: 'cb-cdp-btc-1',
      name: 'Coinbase BTC',
      balance: '0.75',
      retail_portfolio_id: options?.portfolioUuid ?? 'port-cdp',
    })
  const portfolioUuid = options?.portfolioUuid ?? acct.retail_portfolio_id ?? 'port-cdp'
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const auth = extractHeader(input, init, 'Authorization')
    const verified = verifyCdpBearerJwt(auth, publicKey)
    if (verified === null) {
      return jsonResponse({ error: 'Unauthorized' }, 401)
    }
    options?.onVerified?.(verified)
    const url = extractUrl(input)
    if (url.includes('/api/v3/brokerage/key_permissions')) {
      return jsonResponse({
        can_view: true,
        can_trade: false,
        can_transfer: false,
        portfolio_uuid: portfolioUuid,
        portfolio_type: 'DEFAULT',
      })
    }
    if (url.includes(`/api/v3/brokerage/accounts/${acct.uuid}`)) {
      return jsonResponse({ account: acct })
    }
    if (url.includes('/api/v3/brokerage/accounts')) {
      return jsonResponse({ accounts: [acct], has_next: false, cursor: '', size: 1 })
    }
    return jsonResponse({ error: 'unexpected' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

it('Coinbase: connects and refreshes with an Ed25519 secret key, storing coinbaseAuth cdp', async () => {
  const { db, service } = await setup()
  const ed = ed25519SecretKey()
  const algs: string[] = []
  const keyId = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0'
  stubCoinbaseCdpFetch(ed.publicKey, {
    onVerified: ({ alg, kid }) => {
      algs.push(alg)
      expect(kid).toBe(keyId)
    },
  })

  const connected = (
    await service.connectCoinbase({ apiKey: ` "${keyId}", `, secretKey: ` "${ed.secretKey}", ` })
  ).unwrap()
  expect(connected.balanceSats).toBe('75000000')
  expect(algs.length).toBeGreaterThan(0)
  expect(algs.every((a) => a === 'EdDSA')).toBe(true)

  const [stored] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(stored).toBeDefined()
  const storedJson = parseUnknown(
    z.object({ coinbaseAuth: z.literal('cdp').optional() }),
    JSON.parse(stored?.encryptedCredentials ?? '{}'),
  ).unwrap()
  expect(storedJson.coinbaseAuth).toBe('cdp')

  algs.length = 0
  const freshService = new ExchangeService({ db, logger: pino({ level: 'silent' }) })
  const refreshed = (await freshService.refreshBalance(connected.id)).unwrap()
  expect(refreshed.balanceSats).toBe('75000000')
  expect(algs).toEqual(['EdDSA'])
})

it.each([
  { variant: 'trailing quote', format: (secret: string) => `${secret}"` },
  { variant: 'trailing quote and comma', format: (secret: string) => `${secret}",` },
])('Coinbase: connects and refreshes Ed25519 key pasted with $variant', async ({ format }) => {
  const { service } = await setup()
  const ed = ed25519SecretKey()
  const algs: string[] = []
  const keyId = 'ed25519-unpaired-quote-key'
  stubCoinbaseCdpFetch(ed.publicKey, {
    onVerified: ({ alg, kid }) => {
      algs.push(alg)
      expect(kid).toBe(keyId)
    },
  })

  const connected = (await service.connectCoinbase({ apiKey: keyId, secretKey: format(ed.secretKey) })).unwrap()
  expect(connected.balanceSats).toBe('75000000')
  expect(algs.length).toBeGreaterThan(0)
  expect(algs.every((a) => a === 'EdDSA')).toBe(true)

  algs.length = 0
  const refreshed = (await service.refreshBalance(connected.id)).unwrap()
  expect(refreshed.balanceSats).toBe('75000000')
  expect(algs).toEqual(['EdDSA'])
})

it.each([
  {
    variant: 'quoted with escaped newlines',
    format: (pem: string) => `"${pem.replaceAll('\n', '\\n')}"`,
  },
  {
    variant: 'curly-quoted PEM',
    format: (pem: string) => `\u201c${pem.replaceAll('\n', '\\n')}\u201d`,
  },
  {
    variant: 'trailing comma',
    format: (pem: string) => `"${pem.replaceAll('\n', '\\n')}",`,
  },
  {
    variant: 'newlines turned into spaces',
    format: (pem: string) => pem.trim().replaceAll('\n', ' '),
  },
  {
    variant: 'CRLF newlines',
    format: (pem: string) => pem.replaceAll('\n', '\r\n'),
  },
])('Coinbase: connects and refreshes ECDSA key pasted as $variant', async ({ format }) => {
  const { service } = await setup()
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pem = ec.privateKey.export({ format: 'pem', type: 'sec1' }).toString()
  const keyName = 'organizations/00000000-0000-0000-0000-000000000000/apiKeys/ec-paste'
  stubCoinbaseCdpFetch(ec.publicKey)

  const connected = (await service.connectCoinbase({ apiKey: `"${keyName}",`, secretKey: format(pem) })).unwrap()
  expect(connected.balanceSats).toBe('75000000')
  const refreshed = (await service.refreshBalance(connected.id)).unwrap()
  expect(refreshed.balanceSats).toBe('75000000')
})

it('Coinbase: connects with PKCS#8 P-256 and PKCS#8 Ed25519 keys', async () => {
  const { service } = await setup()
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const ecPkcs8 = ec.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const seenAlgs: string[] = []
  stubCoinbaseCdpFetch(ec.publicKey, {
    onVerified: ({ alg }) => {
      seenAlgs.push(alg)
    },
  })
  const ecConnected = (await service.connectCoinbase({ apiKey: 'pkcs8-ec', secretKey: ecPkcs8 })).unwrap()
  expect(ecConnected.balanceSats).toBe('75000000')
  expect(seenAlgs.every((a) => a === 'ES256')).toBe(true)

  seenAlgs.length = 0
  const ed = ed25519SecretKey()
  stubCoinbaseCdpFetch(ed.publicKey, {
    account: makeCoinbaseAccount({
      uuid: 'cb-pkcs8-ed',
      name: 'Ed PKCS8',
      balance: '1.25',
      retail_portfolio_id: 'port-ed',
    }),
    onVerified: ({ alg }) => {
      seenAlgs.push(alg)
    },
  })
  const edConnected = (await service.connectCoinbase({ apiKey: 'pkcs8-ed', secretKey: ed.pkcs8Pem })).unwrap()
  expect(edConnected.balanceSats).toBe('125000000')
  expect(seenAlgs.every((a) => a === 'EdDSA')).toBe(true)
})

it('Coinbase: reconnects a saved ECDSA account using an Ed25519 key for the same portfolio', async () => {
  const { db, service } = await setup()
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const ecPem = ec.privateKey.export({ format: 'pem', type: 'sec1' }).toString()
  const ed = ed25519SecretKey()
  const acct = makeCoinbaseAccount({
    uuid: 'cb-shared-btc',
    name: 'Primary BTC',
    balance: '0.5',
    retail_portfolio_id: 'port-shared',
  })

  stubCoinbaseCdpFetch(ec.publicKey, { account: acct, portfolioUuid: 'port-shared' })
  const initial = (await service.connectCoinbase({ apiKey: 'ec-key-1', secretKey: ecPem })).unwrap()

  const refreshAlgs: string[] = []
  stubCoinbaseCdpFetch(ed.publicKey, {
    account: { ...acct, available_balance: { value: '0.8', currency: 'BTC' } },
    portfolioUuid: 'port-shared',
    onVerified: ({ alg }) => {
      refreshAlgs.push(alg)
    },
  })
  const reconnected = (
    await service.connectCoinbase({
      apiKey: 'ed-key-2',
      secretKey: ed.secretKey,
      replaceAccountId: initial.id,
    })
  ).unwrap()
  expect(reconnected.id).toBe(initial.id)
  expect(reconnected.balanceSats).toBe('80000000')

  refreshAlgs.length = 0
  const refreshed = (await service.refreshBalance(initial.id)).unwrap()
  expect(refreshed.balanceSats).toBe('80000000')
  expect(refreshAlgs).toEqual(['EdDSA'])

  const rows = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.provider, 'coinbase'))
  expect(rows).toHaveLength(1)
})

it('Coinbase: pre-existing unmarked ECDSA, legacy HMAC, and 64-byte base64 HMAC rows keep their existing auth on refresh', async () => {
  const { db, service } = await setup()
  const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const ecPem = ec.privateKey.export({ format: 'pem', type: 'sec1' }).toString()
  const ed = ed25519SecretKey()

  const recentIso = new Date().toISOString()
  const ecBlob = makeEncryptedApiKeyJson({ apiKey: 'unmarked-ec-key', secretKey: ecPem }, 'port-ec')
  const hmacBlob = makeEncryptedApiKeyJson(
    { apiKey: 'unmarked-hmac-key', secretKey: 'legacy-hmac-secret' },
    'port-hmac',
  )
  const base64HmacBlob = makeEncryptedApiKeyJson({ apiKey: 'unmarked-b64-key', secretKey: ed.secretKey }, 'port-b64')

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-unmarked-ec',
      provider: 'coinbase',
      displayName: 'Unmarked EC',
      encryptedCredentials: ecBlob,
      externalAccountId: 'acct-ec',
      balanceSats: '10000000',
      balanceAsOf: recentIso,
      credentialsConnectedAt: recentIso,
    },
    {
      id: 'cb-unmarked-hmac',
      provider: 'coinbase',
      displayName: 'Unmarked HMAC',
      encryptedCredentials: hmacBlob,
      externalAccountId: 'acct-hmac',
      balanceSats: '20000000',
      balanceAsOf: recentIso,
      credentialsConnectedAt: recentIso,
    },
    {
      id: 'cb-unmarked-b64-hmac',
      provider: 'coinbase',
      displayName: 'Unmarked B64 HMAC',
      encryptedCredentials: base64HmacBlob,
      externalAccountId: 'acct-b64',
      balanceSats: '30000000',
      balanceAsOf: recentIso,
      credentialsConnectedAt: recentIso,
    },
  ])

  const seenAuthModes: Record<string, string> = {}
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const auth = extractHeader(input, init, 'Authorization')
      const accessKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (url.includes('/accounts/acct-ec')) {
        const verified = verifyCdpBearerJwt(auth, ec.publicKey)
        expect(verified?.alg).toBe('ES256')
        seenAuthModes['acct-ec'] = 'ES256'
        return jsonResponse({ account: makeCoinbaseAccount({ uuid: 'acct-ec', name: 'EC', balance: '0.11' }) })
      }
      if (url.includes('/accounts/acct-hmac')) {
        expect(auth).toBe('')
        expect(accessKey).toBe('unmarked-hmac-key')
        seenAuthModes['acct-hmac'] = 'HMAC'
        return jsonResponse({ account: makeCoinbaseAccount({ uuid: 'acct-hmac', name: 'HMAC', balance: '0.22' }) })
      }
      if (url.includes('/accounts/acct-b64')) {
        expect(auth).toBe('')
        expect(accessKey).toBe('unmarked-b64-key')
        seenAuthModes['acct-b64'] = 'HMAC'
        return jsonResponse({ account: makeCoinbaseAccount({ uuid: 'acct-b64', name: 'B64', balance: '0.33' }) })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  expect((await service.refreshBalance('cb-unmarked-ec')).unwrap().balanceSats).toBe('11000000')
  expect((await service.refreshBalance('cb-unmarked-hmac')).unwrap().balanceSats).toBe('22000000')
  expect((await service.refreshBalance('cb-unmarked-b64-hmac')).unwrap().balanceSats).toBe('33000000')
  expect(seenAuthModes).toEqual({ 'acct-ec': 'ES256', 'acct-hmac': 'HMAC', 'acct-b64': 'HMAC' })

  const [ecAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-unmarked-ec'))
  const [hmacAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-unmarked-hmac'))
  const [b64After] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-unmarked-b64-hmac'))
  expect(ecAfter?.encryptedCredentials).toBe(ecBlob)
  expect(hmacAfter?.encryptedCredentials).toBe(hmacBlob)
  expect(b64After?.encryptedCredentials).toBe(base64HmacBlob)
})

it.each([
  {
    variant: 'missing leading quote with trailing quote and comma',
    format: (pem: string) => `${JSON.stringify(pem).slice(1)},`,
  },
  {
    variant: 'escaped newlines with trailing quote',
    format: (pem: string) => `${pem.replaceAll('\n', '\\n')}"`,
  },
])(
  'Coinbase: unmarked saved ECDSA row ($variant) works across refresh, transactions, and old-key identity backfill',
  async ({ format }) => {
    const { db, service } = await setup()
    const oldEc = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const oldEcPem = oldEc.privateKey.export({ format: 'pem', type: 'sec1' }).toString()
    const newEd = ed25519SecretKey()
    const recentIso = new Date().toISOString()

    const refreshBlob = makeEncryptedApiKeyJson({ apiKey: 'old-ec-key', secretKey: format(oldEcPem) }, 'port-legacy-ec')
    const backfillBlob = makeEncryptedApiKeyJson({ apiKey: 'old-ec-backfill', secretKey: format(oldEcPem) })

    await db.insert(exchangeAccounts).values([
      {
        id: 'cb-old-ec-refresh',
        provider: 'coinbase',
        displayName: 'Old EC Refresh',
        encryptedCredentials: refreshBlob,
        externalAccountId: 'acct-old-ec',
        balanceSats: '10000000',
        balanceAsOf: recentIso,
        credentialsConnectedAt: recentIso,
      },
      {
        id: 'cb-old-ec-backfill',
        provider: 'coinbase',
        displayName: 'Old EC Backfill',
        encryptedCredentials: backfillBlob,
        externalAccountId: null,
        balanceSats: '50000000',
        balanceAsOf: recentIso,
        credentialsConnectedAt: recentIso,
      },
    ])

    const verifiedCalls: Array<{ path: string; alg: 'ES256' | 'EdDSA'; kid: string }> = []
    const acct = makeCoinbaseAccount({
      uuid: 'acct-old-ec',
      name: 'Old EC BTC',
      balance: '0.45',
      retail_portfolio_id: 'port-legacy-ec',
    })
    const backfillAcct = makeCoinbaseAccount({
      uuid: 'acct-old-ec-backfill',
      name: 'Old EC Backfill BTC',
      balance: '0.6',
      retail_portfolio_id: 'port-backfill-ec',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = extractUrl(input)
        const parsedUrl = new URL(url)
        const auth = extractHeader(input, init, 'Authorization')
        const oldVerified = verifyCdpBearerJwt(auth, oldEc.publicKey)
        const newVerified = verifyCdpBearerJwt(auth, newEd.publicKey)
        const verified = oldVerified ?? newVerified
        if (verified === null) {
          return jsonResponse({ error: 'Unauthorized' }, 401)
        }
        verifiedCalls.push({ path: parsedUrl.pathname, alg: verified.alg, kid: verified.kid })

        if (parsedUrl.pathname === '/api/v3/brokerage/accounts/acct-old-ec') {
          return jsonResponse({ account: acct })
        }
        if (parsedUrl.pathname === '/api/v3/brokerage/accounts/acct-old-ec-backfill') {
          return jsonResponse({ account: backfillAcct })
        }
        if (parsedUrl.pathname === '/v2/accounts/acct-old-ec/transactions') {
          return jsonResponse({
            pagination: { next_uri: null },
            data: [
              {
                id: 'tx-ec-1',
                type: 'buy',
                status: 'completed',
                amount: { amount: '0.25', currency: 'BTC' },
                native_amount: { amount: '25000.00', currency: 'USD' },
                created_at: '2026-01-15T00:00:00Z',
                resource: 'transaction',
                resource_path: '/v2/accounts/acct-old-ec/transactions/tx-ec-1',
              },
            ],
          })
        }
        if (parsedUrl.pathname === '/api/v3/brokerage/accounts') {
          return jsonResponse({ accounts: [backfillAcct], has_next: false, cursor: '', size: 1 })
        }
        if (parsedUrl.pathname === '/api/v3/brokerage/key_permissions') {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'port-backfill-ec',
            portfolio_type: 'DEFAULT',
          })
        }
        return jsonResponse({ error: 'unexpected' }, 404)
      }),
    )

    const refreshed = (await service.refreshBalance('cb-old-ec-refresh')).unwrap()
    expect(refreshed.balanceSats).toBe('45000000')
    const [refreshRowAfter] = await db
      .select()
      .from(exchangeAccounts)
      .where(eq(exchangeAccounts.id, 'cb-old-ec-refresh'))
    expect(refreshRowAfter?.encryptedCredentials).toBe(refreshBlob)
    expect(verifiedCalls).toContainEqual({
      path: '/api/v3/brokerage/accounts/acct-old-ec',
      alg: 'ES256',
      kid: 'old-ec-key',
    })

    const txEntries = (await service.getCoinbaseTransactionEntries(['cb-old-ec-refresh'])).unwrap()
    expect(txEntries).toHaveLength(1)
    expect(txEntries[0]?.value).toBe(25000000n)
    expect(verifiedCalls).toContainEqual({
      path: '/v2/accounts/acct-old-ec/transactions',
      alg: 'ES256',
      kid: 'old-ec-key',
    })

    const reconnected = (
      await service.connectCoinbase({
        apiKey: 'new-ed-key',
        secretKey: newEd.secretKey,
        replaceAccountId: 'cb-old-ec-backfill',
      })
    ).unwrap()
    expect(reconnected.id).toBe('cb-old-ec-backfill')
    expect(reconnected.balanceSats).toBe('60000000')
    expect(verifiedCalls).toContainEqual({
      path: '/api/v3/brokerage/accounts',
      alg: 'ES256',
      kid: 'old-ec-backfill',
    })
    expect(verifiedCalls).toContainEqual({
      path: '/api/v3/brokerage/accounts',
      alg: 'EdDSA',
      kid: 'new-ed-key',
    })
  },
)

it.each([
  {
    label: 'broken PEM',
    apiKey: 'test-key-id',
    secretKey: '-----BEGIN EC PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEG',
  },
  {
    label: '64-byte base64 with mismatched halves',
    apiKey: 'test-key-id',
    secretKey: Buffer.concat([ed25519SecretKey().seed, Buffer.alloc(32, 0xcd)]).toString('base64'),
  },
  {
    label: 'P-384 PKCS#8 key',
    apiKey: 'test-key-id',
    secretKey: generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString(),
  },
  {
    label: 'JSON key export in apiKey',
    apiKey: JSON.stringify({ id: 'test-key-id', privateKey: ed25519SecretKey().secretKey }),
    secretKey: ed25519SecretKey().secretKey,
  },
  {
    label: 'PEM pasted into apiKey',
    apiKey: generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      .privateKey.export({ format: 'pem', type: 'sec1' })
      .toString(),
    secretKey: ed25519SecretKey().secretKey,
  },
])('Coinbase: returns format error with zero fetches and zero writes for $label', async ({ apiKey, secretKey }) => {
  const { db, service } = await setup()
  const fetchMock = vi.fn(async () => jsonResponse({ error: 'should not be called' }, 500))
  vi.stubGlobal('fetch', fetchMock)

  const res = await service.connectCoinbase({ apiKey, secretKey })
  expect(res.isErr()).toBe(true)
  const err = res.unwrapErr()
  expect(err).toBeInstanceOf(ExchangeUserError)
  expect(err).not.toBeInstanceOf(ExchangeCredentialsRevokedError)
  if (!(err instanceof ExchangeUserError)) {
    throw new Error('Expected ExchangeUserError')
  }
  expect(err.code).toBe('BAD_REQUEST')
  expect(err.message).toBe('This is not a valid API Key Secret. Copy it from Coinbase and paste it again.')
  expect(fetchMock).not.toHaveBeenCalled()

  const rows = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.provider, 'coinbase'))
  expect(rows).toHaveLength(0)
})

it('Coinbase: returns invalid-credentials error when Coinbase rejects a well-formed Ed25519 key with 401', async () => {
  const { service } = await setup()
  const ed = ed25519SecretKey()
  const fetchMock = vi.fn(async () => jsonResponse({ error: 'Unauthorized' }, 401))
  vi.stubGlobal('fetch', fetchMock)

  const res = await service.connectCoinbase({ apiKey: 'valid-format-key', secretKey: ed.secretKey })
  expect(res.isErr()).toBe(true)
  const err = res.unwrapErr()
  expect(err).toBeInstanceOf(ExchangeUserError)
  expect(err).not.toBeInstanceOf(ExchangeCredentialsRevokedError)
  if (!(err instanceof ExchangeUserError)) {
    throw new Error('Expected ExchangeUserError')
  }
  expect(err.code).toBe('BAD_REQUEST')
  expect(err.message).toContain('Invalid Coinbase API credentials.')
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

it('Coinbase: consults key_permissions when legacy old key gets 403 on accounts list, rejecting mismatch and allowing match', async () => {
  const { db, service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-legacy-a',
    name: 'Legacy A',
    balance: '0.4',
    retail_portfolio_id: 'port-a',
  })
  const acctB = makeCoinbaseAccount({
    uuid: 'cb-legacy-b',
    name: 'Other B',
    balance: '0.9',
    retail_portfolio_id: 'port-b',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-403-accounts',
    provider: 'coinbase',
    displayName: 'Legacy Coinbase 403',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-403-accounts-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'old-403-accounts-key') {
        if (url.includes('/api/v3/brokerage/key_permissions')) {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'port-a',
            portfolio_type: 'DEFAULT',
          })
        }
        return jsonResponse({ error: 'Forbidden' }, 403)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: apiKey === 'key-b' ? 'port-b' : 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-legacy-a')) {
        return jsonResponse({ account: acctA })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: apiKey === 'key-b' ? [acctB] : [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const mismatch = await service.connectCoinbase({
    apiKey: 'key-b',
    secretKey: 'secret-b',
    replaceAccountId: 'cb-legacy-403-accounts',
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const [rowAfterMismatch] = await db
    .select()
    .from(exchangeAccounts)
    .where(eq(exchangeAccounts.id, 'cb-legacy-403-accounts'))
  expect(rowAfterMismatch?.balanceSats).toBe('40000000')
  expect(JSON.parse(rowAfterMismatch?.encryptedCredentials ?? '{}')).toMatchObject({ portfolioUuid: 'port-a' })

  const matched = (
    await service.connectCoinbase({
      apiKey: 'key-a-new',
      secretKey: 'secret-a-new',
      replaceAccountId: 'cb-legacy-403-accounts',
    })
  ).unwrap()
  expect(matched.id).toBe('cb-legacy-403-accounts')
})

it('Coinbase: fails closed when legacy old key gets 403 on both accounts list and key_permissions', async () => {
  const { db, service } = await setup()
  const acctB = makeCoinbaseAccount({
    uuid: 'cb-legacy-b',
    name: 'Other B',
    balance: '0.9',
    retail_portfolio_id: 'port-b',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-403-both',
    provider: 'coinbase',
    displayName: 'Legacy Coinbase 403 Both',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-403-both-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-403-both'))

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'old-403-both-key') {
        return jsonResponse({ error: 'Forbidden' }, 403)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-b',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acctB], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const blocked = await service.connectCoinbase({
    apiKey: 'key-b',
    secretKey: 'secret-b',
    replaceAccountId: 'cb-legacy-403-both',
  })
  expect(blocked.isErr()).toBe(true)
  expect(blocked.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-403-both'))
  expect(rowAfter).toEqual(rowBefore)
})

it('Coinbase: fails closed on 503 during legacy old-key lookup and rejects mismatch when old key recovers', async () => {
  const { db, service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-legacy-a',
    name: 'Legacy A',
    balance: '0.4',
    retail_portfolio_id: 'port-a',
  })
  const acctB = makeCoinbaseAccount({
    uuid: 'cb-legacy-b',
    name: 'Other B',
    balance: '0.9',
    retail_portfolio_id: 'port-b',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-503',
    provider: 'coinbase',
    displayName: 'Legacy Coinbase',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-flaky-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'cb-legacy-503',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '40000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-503'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-503'))

  let oldKeyOutage = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'old-flaky-key' && oldKeyOutage) {
        return jsonResponse({ error: 'Service Unavailable' }, 503)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: apiKey === 'key-b' ? 'port-b' : 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: apiKey === 'key-b' ? [acctB] : [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const outageResult = await service.connectCoinbase({
    apiKey: 'key-b',
    secretKey: 'secret-b',
    replaceAccountId: 'cb-legacy-503',
  })
  expect(outageResult.isErr()).toBe(true)
  expect(outageResult.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

  const [rowAfterOutage] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-503'))
  expect(rowAfterOutage).toEqual(rowBefore)
  const snapshotsAfterOutage = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-503'))
  expect(snapshotsAfterOutage).toEqual(snapshotsBefore)

  oldKeyOutage = false
  const retryResult = await service.connectCoinbase({
    apiKey: 'key-b',
    secretKey: 'secret-b',
    replaceAccountId: 'cb-legacy-503',
  })
  expect(retryResult.isErr()).toBe(true)
  expect(retryResult.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
})

it('Coinbase: backfills missing account ID and portfolioUuid during refreshBalance', async () => {
  const { db, service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-legacy-a',
    name: 'Legacy A',
    balance: '0.4',
    retail_portfolio_id: 'port-a',
  })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-refresh',
    provider: 'coinbase',
    displayName: 'Legacy Refresh Coinbase',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-working-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '40000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-legacy-a')) {
        return jsonResponse({ account: acctA })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const refreshed = (await service.refreshBalance('cb-legacy-refresh')).unwrap()
  expect(refreshed.balanceSats).toBe('40000000')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-refresh'))
  expect(row?.externalAccountId).toBe('cb-legacy-a')
  expect(JSON.parse(row?.encryptedCredentials ?? '{}')).toMatchObject({ portfolioUuid: 'port-a' })
})

it('Kraken: stores normalized GetApiKeyInfo IBAN on initial connect', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const connected = (await service.connectKraken({ apiKey: 'kr-key-a-1', secretKey: secretBase64 })).unwrap()
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(row?.externalAccountId).toBe('AA11N84G12345678')
})

it('Kraken: allows new connect with null externalAccountId when GetApiKeyInfo fails', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '0.5' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: ['EGeneral:Permission denied'] })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const connected = (await service.connectKraken({ apiKey: 'kr-key-no-info', secretKey: secretBase64 })).unwrap()
  expect(connected.balanceSats).toBe('50000000')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(row?.externalAccountId).toBeNull()
})

it('Kraken: fails reconnect without writing when GetApiKeyInfo fails for the replacement key', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '1.0' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        if (apiKey === 'kr-key-no-info') {
          return jsonResponse({ error: ['EGeneral:Permission denied'] })
        }
        return jsonResponse({ error: [], result: { iban: 'AA11 N84G 1234 5678' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const connected = (await service.connectKraken({ apiKey: 'kr-key-a-1', secretKey: secretBase64 })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const failedReconnect = await service.connectKraken({
    apiKey: 'kr-key-no-info',
    secretKey: secretBase64,
    replaceAccountId: connected.id,
  })
  expect(failedReconnect.isErr()).toBe(true)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Kraken: rejects reconnect with a different IBAN without writing', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const connected = (await service.connectKraken({ apiKey: 'kr-key-a-1', secretKey: secretBase64 })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const mismatch = await service.connectKraken({
    apiKey: 'kr-key-b',
    secretKey: secretBase64,
    replaceAccountId: connected.id,
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  expect(mismatch.unwrapErr().message).toBe('This key belongs to a different Kraken account.')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Kraken: allows matching reconnect with different spacing and casing while preserving id and createdAt', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const connected = (await service.connectKraken({ apiKey: 'kr-key-a-1', secretKey: secretBase64 })).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const reconnected = (
    await service.connectKraken({
      apiKey: 'kr-key-a-2',
      secretKey: secretBase64,
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.id).toBe(connected.id)
  expect(reconnected.balanceSats).toBe('175000000')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter?.createdAt).toBe(rowBefore?.createdAt)
})

it('Kraken: allows connecting a second account without replaceAccountId', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const first = (await service.connectKraken({ apiKey: 'kr-key-a-1', secretKey: secretBase64 })).unwrap()
  const second = (await service.connectKraken({ apiKey: 'kr-key-b', secretKey: secretBase64 })).unwrap()
  expect(second.id).not.toBe(first.id)
  const [rowB] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, second.id))
  expect(rowB?.externalAccountId).toBe('BB22N84G99990000')
})

it('Kraken: backfills legacy IBAN from a working old key and rejects mismatch', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  await db.insert(exchangeAccounts).values({
    id: 'kr-legacy-working',
    provider: 'kraken',
    displayName: 'Kraken',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-old-working', secretKey: secretBase64 }),
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '0.6' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        const iban = apiKey === 'kr-key-b' ? 'BB99 N84G 0000 1111' : 'AA99 N84G 1111 2222'
        return jsonResponse({ error: [], result: { iban } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const mismatch = await service.connectKraken({
    apiKey: 'kr-key-b',
    secretKey: secretBase64,
    replaceAccountId: 'kr-legacy-working',
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-working'))
  expect(row?.externalAccountId).toBe('AA99N84G11112222')
  expect(row?.balanceSats).toBe('50000000')
})

it('Kraken: fails closed when legacy old key returns EAPI:Invalid key and row has no saved externalAccountId', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  await db.insert(exchangeAccounts).values({
    id: 'kr-legacy-revoked',
    provider: 'kraken',
    displayName: 'Kraken',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-old-revoked', secretKey: secretBase64 }),
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'kr-legacy-revoked',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '50000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-revoked'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'kr-legacy-revoked'))

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (apiKey === 'kr-old-revoked') {
        return jsonResponse({ error: ['EAPI:Invalid key'] })
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '0.6' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: [], result: { iban: 'AA99 N84G 1111 2222' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const blocked = await service.connectKraken({
    apiKey: 'kr-key-a',
    secretKey: secretBase64,
    replaceAccountId: 'kr-legacy-revoked',
  })
  expect(blocked.isErr()).toBe(true)
  expect(blocked.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-revoked'))
  expect(rowAfter).toEqual(rowBefore)
  const snapshotsAfter = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'kr-legacy-revoked'))
  expect(snapshotsAfter).toEqual(snapshotsBefore)
})

it('Kraken: fails closed on 503 during legacy old-key lookup and rejects mismatch when old key recovers', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  await db.insert(exchangeAccounts).values({
    id: 'kr-legacy-503',
    provider: 'kraken',
    displayName: 'Kraken',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-old-flaky', secretKey: secretBase64 }),
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'kr-legacy-503',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '50000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-503'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'kr-legacy-503'))

  let oldKeyOutage = true
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (apiKey === 'kr-old-flaky' && oldKeyOutage) {
        return jsonResponse({ error: ['EService:Unavailable'] }, 503)
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '0.6' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        const iban = apiKey === 'kr-key-b' ? 'BB99 N84G 0000 1111' : 'AA99 N84G 1111 2222'
        return jsonResponse({ error: [], result: { iban } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const outageResult = await service.connectKraken({
    apiKey: 'kr-key-b',
    secretKey: secretBase64,
    replaceAccountId: 'kr-legacy-503',
  })
  expect(outageResult.isErr()).toBe(true)
  expect(outageResult.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

  const [rowAfterOutage] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-503'))
  expect(rowAfterOutage).toEqual(rowBefore)
  const snapshotsAfterOutage = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'kr-legacy-503'))
  expect(snapshotsAfterOutage).toEqual(snapshotsBefore)

  oldKeyOutage = false
  const retryResult = await service.connectKraken({
    apiKey: 'kr-key-b',
    secretKey: secretBase64,
    replaceAccountId: 'kr-legacy-503',
  })
  expect(retryResult.isErr()).toBe(true)
  expect(retryResult.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
})

it('Kraken: backfills missing IBAN during refreshBalance', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  await db.insert(exchangeAccounts).values({
    id: 'kr-legacy-refresh',
    provider: 'kraken',
    displayName: 'Kraken',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-old-working', secretKey: secretBase64 }),
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '0.6' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: [], result: { iban: 'AA99 N84G 1111 2222' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const refreshed = (await service.refreshBalance('kr-legacy-refresh')).unwrap()
  expect(refreshed.balanceSats).toBe('60000000')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-legacy-refresh'))
  expect(row?.externalAccountId).toBe('AA99N84G11112222')
})

it('Robinhood: stores account_number from /accounts/ even when holdings are empty', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()

  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(row?.externalAccountId).toBe('rh-acct-a')
})

it('Robinhood: allows new connect with null externalAccountId when /accounts/ returns 500', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await stubRobinhoodHttps(({ path }) => {
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 500, body: { detail: 'Internal Server Error' } }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-500-accounts',
      privateKeyBase64,
      displayName: 'Robinhood New',
    })
  ).unwrap()

  expect(connected.balanceSats).toBe('0')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(row?.externalAccountId).toBeNull()
})

it('Robinhood: fails reconnect without writing when /accounts/ returns 500 for the replacement key', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      if (apiKey === 'rh-key-500-reconnect') {
        return { status: 500, body: { detail: 'Internal Server Error' } }
      }
      return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const connected = (
    await service.connectRobinhood({ apiKey: 'rh-key-a', privateKeyBase64, displayName: 'Robinhood A' })
  ).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const failed = await service.connectRobinhood({
    apiKey: 'rh-key-500-reconnect',
    privateKeyBase64,
    displayName: 'Robinhood A',
    replaceAccountId: connected.id,
  })
  expect(failed.isErr()).toBe(true)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Robinhood: rejects direct reconnect mismatch via /accounts/ without writing', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  const mismatch = await service.connectRobinhood({
    apiKey: 'rh-key-b',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: connected.id,
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  expect(mismatch.unwrapErr().message).toBe('This key belongs to a different Robinhood account.')

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Robinhood: falls back from /accounts/ 403 to holdings for reconnect verification', async () => {
  const { service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()

  const mismatch = await service.connectRobinhood({
    apiKey: 'rh-key-b-holdings-fallback',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: connected.id,
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const match = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-holdings-fallback',
      privateKeyBase64,
      displayName: 'Robinhood A',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(match.id).toBe(connected.id)
  expect(match.balanceSats).toBe('25000000')
})

it('Robinhood: falls back from /accounts/ 403 and empty holdings to orders for reconnect verification', async () => {
  const { service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()

  const mismatch = await service.connectRobinhood({
    apiKey: 'rh-key-b-orders-fallback',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: connected.id,
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const match = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-orders-fallback',
      privateKeyBase64,
      displayName: 'Robinhood A',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(match.id).toBe(connected.id)
})

it('Robinhood: refuses unverifiable reconnect when /accounts/ returns 403 and holdings and orders yield no ID', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const connected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()
  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  for (const key of ['rh-key-unverifiable', 'rh-key-orders-403']) {
    const unverifiable = await service.connectRobinhood({
      apiKey: key,
      privateKeyBase64,
      displayName: 'Robinhood Unverifiable',
      replaceAccountId: connected.id,
    })
    expect(unverifiable.isErr()).toBe(true)
    expect(unverifiable.unwrapErr()).toBeInstanceOf(RobinhoodAccountUnverifiableError)
    expect(unverifiable.unwrapErr().message).toBe(
      "We couldn't confirm which Robinhood account this key belongs to. Turn on 'Read crypto accounts' for the key (or create a new key with it on) and try again.",
    )
  }

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfter).toEqual(rowBefore)
})

it('Robinhood: allows connecting a second account without replaceAccountId', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  await stubRobinhoodFallbackHttps()

  const first = (
    await service.connectRobinhood({
      apiKey: 'rh-key-a-primary',
      privateKeyBase64,
      displayName: 'Robinhood A',
    })
  ).unwrap()
  const second = (
    await service.connectRobinhood({
      apiKey: 'rh-key-b',
      privateKeyBase64,
      displayName: 'Robinhood B',
    })
  ).unwrap()
  expect(second.id).not.toBe(first.id)
  const [rowB] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, second.id))
  expect(rowB?.externalAccountId).toBe('rh-acct-b')
})

it('Robinhood: backfills legacy account_number from a working old key and rejects mismatch', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await db.insert(exchangeAccounts).values({
    id: 'rh-legacy-working',
    provider: 'robinhood',
    displayName: 'Robinhood Legacy',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-working', privateKey: privateKeyBase64 }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return {
        status: 200,
        body: { account_number: apiKey === 'rh-key-b' ? 'rh-acct-b' : 'rh-acct-a', status: 'active' },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const mismatch = await service.connectRobinhood({
    apiKey: 'rh-key-b',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: 'rh-legacy-working',
  })
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-working'))
  expect(row?.externalAccountId).toBe('rh-acct-a')
  expect(row?.balanceSats).toBe('10000000')
})

it('Robinhood: fails closed when legacy old key returns 401 and row has no saved externalAccountId', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await db.insert(exchangeAccounts).values({
    id: 'rh-legacy-revoked',
    provider: 'robinhood',
    displayName: 'Robinhood Revoked',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-revoked', privateKey: privateKeyBase64 }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'rh-legacy-revoked',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '10000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-revoked'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'rh-legacy-revoked'))

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (apiKey === 'rh-old-revoked') {
      return { status: 401, body: { detail: 'Unauthorized' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const blocked = await service.connectRobinhood({
    apiKey: 'rh-key-a-new',
    privateKeyBase64,
    displayName: 'Robinhood A',
    replaceAccountId: 'rh-legacy-revoked',
  })
  expect(blocked.isErr()).toBe(true)
  expect(blocked.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-revoked'))
  expect(rowAfter).toEqual(rowBefore)
  const snapshotsAfter = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'rh-legacy-revoked'))
  expect(snapshotsAfter).toEqual(snapshotsBefore)
})

it('Robinhood: falls through to orders when legacy old key returns 403 on accounts and holdings, and fails closed when orders also returns 403', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await db.insert(exchangeAccounts).values([
    {
      id: 'rh-legacy-orders-fallback',
      provider: 'robinhood',
      displayName: 'Robinhood Orders Fallback',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-orders-only', privateKey: privateKeyBase64 }),
      externalAccountId: null,
      balanceSats: '10000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'rh-legacy-all-403',
      provider: 'robinhood',
      displayName: 'Robinhood All 403',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-forbidden', privateKey: privateKeyBase64 }),
      externalAccountId: null,
      balanceSats: '10000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    },
  ])

  const [all403Before] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-all-403'))

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (apiKey === 'rh-old-orders-only') {
      if (path.startsWith('/api/v1/crypto/trading/orders/')) {
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                id: 'ord-1',
                account_number: 'rh-acct-a',
                symbol: 'BTC-USD',
                side: 'buy',
                type: 'market',
                state: 'filled',
                created_at: '2025-01-01T00:00:00Z',
                updated_at: '2025-01-01T00:00:00Z',
              },
            ],
          },
        }
      }
      return { status: 403, body: { detail: 'Forbidden' } }
    }
    if (apiKey === 'rh-old-forbidden') {
      return { status: 403, body: { detail: 'Forbidden' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return {
        status: 200,
        body: { account_number: apiKey === 'rh-key-b' ? 'rh-acct-b' : 'rh-acct-a', status: 'active' },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const mismatch = await service.connectRobinhood({
    apiKey: 'rh-key-b',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: 'rh-legacy-orders-fallback',
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const [fallbackRow] = await db
    .select()
    .from(exchangeAccounts)
    .where(eq(exchangeAccounts.id, 'rh-legacy-orders-fallback'))
  expect(fallbackRow?.externalAccountId).toBe('rh-acct-a')

  const blocked = await service.connectRobinhood({
    apiKey: 'rh-key-a-new',
    privateKeyBase64,
    displayName: 'Robinhood A',
    replaceAccountId: 'rh-legacy-all-403',
  })
  expect(blocked.isErr()).toBe(true)
  expect(blocked.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [all403After] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-all-403'))
  expect(all403After).toEqual(all403Before)
})

it('Robinhood: fails closed on 503 during legacy old-key lookup and rejects mismatch when old key recovers', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await db.insert(exchangeAccounts).values({
    id: 'rh-legacy-503',
    provider: 'robinhood',
    displayName: 'Robinhood Legacy',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-flaky', privateKey: privateKeyBase64 }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'rh-legacy-503',
    timestamp: '2025-01-01T00:00:00.000Z',
    balanceSats: '10000000',
  })

  const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-503'))
  const snapshotsBefore = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'rh-legacy-503'))

  let oldKeyOutage = true
  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (apiKey === 'rh-old-flaky' && oldKeyOutage) {
      return { status: 503, body: { detail: 'Service Unavailable' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return {
        status: 200,
        body: { account_number: apiKey === 'rh-key-b' ? 'rh-acct-b' : 'rh-acct-a', status: 'active' },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const outageResult = await service.connectRobinhood({
    apiKey: 'rh-key-b',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: 'rh-legacy-503',
  })
  expect(outageResult.isErr()).toBe(true)
  expect(outageResult.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

  const [rowAfterOutage] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-503'))
  expect(rowAfterOutage).toEqual(rowBefore)
  const snapshotsAfterOutage = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'rh-legacy-503'))
  expect(snapshotsAfterOutage).toEqual(snapshotsBefore)

  oldKeyOutage = false
  const retryResult = await service.connectRobinhood({
    apiKey: 'rh-key-b',
    privateKeyBase64,
    displayName: 'Robinhood B',
    replaceAccountId: 'rh-legacy-503',
  })
  expect(retryResult.isErr()).toBe(true)
  expect(retryResult.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
})

it('Robinhood: backfills missing account_number during refreshBalance', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

  await db.insert(exchangeAccounts).values({
    id: 'rh-legacy-refresh',
    provider: 'robinhood',
    displayName: 'Robinhood Refresh',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old-working', privateKey: privateKeyBase64 }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  await stubRobinhoodHttps(({ path }) => {
    if (path.startsWith('/api/v1/crypto/trading/holdings/')) {
      return {
        status: 200,
        body: {
          previous: null,
          next: null,
          results: [
            {
              account_number: 'rh-acct-a',
              asset_code: 'BTC',
              total_quantity: '0.2',
              quantity_available_for_trading: '0.2',
            },
          ],
        },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const refreshed = (await service.refreshBalance('rh-legacy-refresh')).unwrap()
  expect(refreshed.balanceSats).toBe('20000000')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-refresh'))
  expect(row?.externalAccountId).toBe('rh-acct-a')
})

it('Coinbase: marks account needs_reconnect on 401 refresh and recovers after reconnect', async () => {
  const { service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-btc-a',
    name: 'Coinbase A',
    balance: '1.0',
    retail_portfolio_id: 'port-a',
  })
  let key1Revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'cb-key-1' && key1Revoked) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-btc-a')) {
        const balance = apiKey === 'cb-key-2' ? '1.5' : '1.0'
        return jsonResponse({ account: { ...acctA, available_balance: { value: balance, currency: 'BTC' } } })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-1', secretKey: 'secret-1' })).unwrap()

  key1Revoked = true
  const revokedRefresh = await service.refreshBalance(connected.id)
  expect(revokedRefresh.isErr()).toBe(true)
  expect(revokedRefresh.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listedExpired = await service.listAccounts('coinbase')
  expect(listedExpired[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listedExpired[0]?.balanceSats).toBeNull()

  const reconnected = (
    await service.connectCoinbase({
      apiKey: 'cb-key-2',
      secretKey: 'secret-2',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.connectionStatus).toBe('connected')
  expect(reconnected.balanceSats).toBe('150000000')

  const recoveredRefresh = (await service.refreshBalance(connected.id)).unwrap()
  expect(recoveredRefresh.connectionStatus).toBe('connected')
  expect(recoveredRefresh.balanceSats).toBe('150000000')
})

it('Coinbase: keeps account connected when refreshBalance hits a transient 503', async () => {
  const { service } = await setup()
  const acctA = makeCoinbaseAccount({
    uuid: 'cb-btc-a',
    name: 'Coinbase A',
    balance: '1.0',
    retail_portfolio_id: 'port-a',
  })
  let failRefresh = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (failRefresh) {
        return jsonResponse({ error: 'Service Unavailable' }, 503)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-btc-a')) {
        return jsonResponse({ account: acctA })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acctA], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const connected = (await service.connectCoinbase({ apiKey: 'cb-key-1', secretKey: 'secret-1' })).unwrap()

  failRefresh = true
  const failedRefresh = await service.refreshBalance(connected.id)
  expect(failedRefresh.isErr()).toBe(true)
  expect(failedRefresh.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listed = await service.listAccounts('coinbase')
  expect(listed[0]?.connectionStatus).toBe('connected')
  expect(listed[0]?.balanceSats).toBe('100000000')
})

const coinbaseDetailMismatches = [
  { field: 'account uuid', mutate: (a: MockCoinbaseAccount) => ({ ...a, uuid: 'cb-usd-wallet' }) },
  { field: 'account currency', mutate: (a: MockCoinbaseAccount) => ({ ...a, currency: 'USD' }) },
  {
    field: 'available_balance currency',
    mutate: (a: MockCoinbaseAccount) => ({ ...a, available_balance: { value: '25', currency: 'USD' } }),
  },
  {
    field: 'account uuid and USD currency',
    mutate: (a: MockCoinbaseAccount) => ({
      ...a,
      uuid: 'cb-usd-wallet',
      currency: 'USD',
      type: 'ACCOUNT_TYPE_FIAT',
      available_balance: { value: '25', currency: 'USD' },
      hold: { value: '0', currency: 'USD' },
    }),
  },
]

function stubCoinbaseDetailFetch(acct: MockCoinbaseAccount, detail: { reply: MockCoinbaseAccount }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes(`/api/v3/brokerage/accounts/${acct.uuid}`)) {
        return jsonResponse({ account: { ...detail.reply } })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acct], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )
}

it.each(coinbaseDetailMismatches)(
  'Coinbase: connect saves nothing when the detail reply has a different $field',
  async ({ mutate }) => {
    const { db, service } = await setup()
    const acct = makeCoinbaseAccount({
      uuid: 'cb-btc-a',
      name: 'Coinbase A',
      balance: '25',
      retail_portfolio_id: 'port-a',
    })
    stubCoinbaseDetailFetch(acct, { reply: mutate(acct) })

    const result = await service.connectCoinbase({ apiKey: 'cb-key-1', secretKey: 'secret-1' })

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toBeInstanceOf(ExchangeUserError)
    expect(result.unwrapErr().message).toBe(
      "Couldn't connect to Coinbase right now. Please check your credentials and try again.",
    )
    await expect(db.select().from(exchangeAccounts).where(eq(exchangeAccounts.provider, 'coinbase'))).resolves.toEqual(
      [],
    )
    await expect(db.select().from(exchangeBalanceSnapshots)).resolves.toEqual([])
  },
)

it.each(coinbaseDetailMismatches)(
  'Coinbase: reconnect leaves the row and snapshots unchanged when the detail reply has a different $field',
  async ({ mutate }) => {
    const { db, service } = await setup()
    const acct = makeCoinbaseAccount({
      uuid: 'cb-btc-a',
      name: 'Coinbase A',
      balance: '0.5',
      retail_portfolio_id: 'port-a',
    })
    const detail = { reply: acct }
    stubCoinbaseDetailFetch(acct, detail)
    const connected = (await service.connectCoinbase({ apiKey: 'cb-key-1', secretKey: 'secret-1' })).unwrap()
    const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
    const snapshotsBefore = await db.select().from(exchangeBalanceSnapshots)

    detail.reply = mutate({ ...acct, available_balance: { value: '25', currency: 'BTC' } })
    const result = await service.connectCoinbase({
      apiKey: 'cb-key-2',
      secretKey: 'secret-2',
      replaceAccountId: connected.id,
    })

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toBeInstanceOf(ExchangeUserError)
    expect(result.unwrapErr().message).toBe(
      "Couldn't connect to Coinbase right now. Please check your credentials and try again.",
    )
    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
    expect(rowAfter).toEqual(rowBefore)
    await expect(db.select().from(exchangeBalanceSnapshots)).resolves.toEqual(snapshotsBefore)
  },
)

it.each(coinbaseDetailMismatches)(
  'Coinbase: refreshBalance keeps the saved balance when the detail reply has a different $field',
  async ({ mutate }) => {
    const { db, service } = await setup()
    const acct = makeCoinbaseAccount({
      uuid: 'cb-btc-a',
      name: 'Coinbase A',
      balance: '0.5',
      retail_portfolio_id: 'port-a',
    })
    const detail = { reply: acct }
    stubCoinbaseDetailFetch(acct, detail)
    const connected = (await service.connectCoinbase({ apiKey: 'cb-key-1', secretKey: 'secret-1' })).unwrap()
    const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
    const snapshotsBefore = await db.select().from(exchangeBalanceSnapshots)

    detail.reply = mutate({ ...acct, available_balance: { value: '25', currency: 'BTC' } })
    const result = await service.refreshBalance(connected.id)

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toBeInstanceOf(ExchangeUserError)
    expect(result.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)
    expect(result.unwrapErr().message).toBe("Couldn't refresh your Coinbase balance right now. Please try again.")
    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
    expect(rowAfter).toEqual(rowBefore)
    await expect(db.select().from(exchangeBalanceSnapshots)).resolves.toEqual(snapshotsBefore)
    await expect(service.listAccounts('coinbase')).resolves.toMatchObject([
      { balanceSats: '50000000', connectionStatus: 'connected' },
    ])
  },
)

it.each(coinbaseDetailMismatches)(
  'Coinbase: refreshBalance on a legacy row keeps the saved balance when the detail reply has a different $field',
  async ({ mutate }) => {
    const { db, service } = await setup()
    const acct = makeCoinbaseAccount({
      uuid: 'cb-legacy-a',
      name: 'Legacy A',
      balance: '25',
      retail_portfolio_id: 'port-a',
    })
    stubCoinbaseDetailFetch(acct, { reply: mutate(acct) })
    await db.insert(exchangeAccounts).values({
      id: 'cb-legacy-refresh',
      provider: 'coinbase',
      displayName: 'Legacy Refresh Coinbase',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-working-key', secretKey: 'old-secret' }),
      externalAccountId: null,
      balanceSats: '40000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: new Date().toISOString(),
    })
    const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-refresh'))

    const result = await service.refreshBalance('cb-legacy-refresh')

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr()).toBeInstanceOf(ExchangeUserError)
    expect(result.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)
    expect(result.unwrapErr().message).toBe("Couldn't refresh your Coinbase balance right now. Please try again.")
    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-refresh'))
    expect(rowAfter).toEqual({ ...rowBefore, externalAccountId: 'cb-legacy-a' })
    await expect(db.select().from(exchangeBalanceSnapshots)).resolves.toEqual([])
  },
)

it("Coinbase: reconnect ignores the old key's portfolio from a detail reply for a different account uuid", async () => {
  const { db, service } = await setup()
  const acct = makeCoinbaseAccount({
    uuid: 'cb-btc-a',
    name: 'Coinbase A',
    balance: '0.5',
    retail_portfolio_id: 'port-a',
  })
  const otherAcct = makeCoinbaseAccount({
    uuid: 'cb-other',
    name: 'Other',
    balance: '25',
    retail_portfolio_id: 'port-other',
  })
  await db.insert(exchangeAccounts).values({
    id: 'cb-stored-uuid',
    provider: 'coinbase',
    displayName: 'Coinbase A',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: 'old-secret' }),
    externalAccountId: 'cb-btc-a',
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        if (apiKey === 'old-key') {
          return jsonResponse({ error: 'Forbidden' }, 403)
        }
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-a',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-btc-a')) {
        return jsonResponse({ account: apiKey === 'old-key' ? otherAcct : acct })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({ accounts: [acct], has_next: false, cursor: '', size: 1 })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const result = await service.connectCoinbase({
    apiKey: 'new-key',
    secretKey: 'new-secret',
    replaceAccountId: 'cb-stored-uuid',
  })

  expect(result.isOk()).toBe(true)
  expect(result.unwrap().balanceSats).toBe('50000000')
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-stored-uuid'))
  expect(JSON.parse(row?.encryptedCredentials ?? '{}')).toMatchObject({ portfolioUuid: 'port-a' })
})

it('Coinbase: overlapping legacy refreshes keep balance and snapshots tied to the pinned UUID', async () => {
  const { db, service } = await setup()
  vi.useFakeTimers({ toFake: ['Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const walletA = makeCoinbaseAccount({ uuid: 'wallet-A', name: 'A', default: false, balance: '0.5' })
  const walletB = makeCoinbaseAccount({ uuid: 'wallet-B', name: 'B', default: false, balance: '25' })
  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-overlap',
    provider: 'coinbase',
    displayName: 'Coinbase savings',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  let enteredFirstDetail: (() => void) | undefined
  let releaseFirstDetail: (() => void) | undefined
  const enteredPromise = new Promise<void>((resolve) => {
    enteredFirstDetail = resolve
  })
  const gatePromise = new Promise<void>((resolve) => {
    releaseFirstDetail = resolve
  })
  let listCalls = 0
  let paused = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const path = new URL(extractUrl(input)).pathname
      if (path.endsWith('/accounts')) {
        listCalls += 1
        const accounts = listCalls === 1 ? [walletA, walletB] : [walletB, walletA]
        return jsonResponse({ accounts, has_next: false, cursor: '', size: accounts.length })
      }
      if (path.endsWith('/wallet-A')) {
        if (!paused) {
          paused = true
          enteredFirstDetail?.()
          await gatePromise
        }
        return jsonResponse({ account: walletA })
      }
      if (path.endsWith('/wallet-B')) {
        return jsonResponse({ account: walletB })
      }
      if (path.endsWith('/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'common',
          portfolio_type: 'DEFAULT',
        })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const first = service.refreshBalance('cb-legacy-overlap')
  await enteredPromise
  const second = await service.refreshBalance('cb-legacy-overlap')
  vi.setSystemTime(new Date(Date.now() + 1000))
  releaseFirstDetail?.()
  const late = await first

  expect(second.isOk()).toBe(true)
  expect(late.isOk()).toBe(true)
  const [row] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-overlap'))
  const snapshots = await db.select().from(exchangeBalanceSnapshots)
  const expected = row?.externalAccountId === 'wallet-A' ? '50000000' : '2500000000'
  expect(row?.balanceSats).toBe(expected)
  expect(snapshots.length).toBeGreaterThan(0)
  expect(snapshots.every((s) => s.balanceSats === expected)).toBe(true)
  expect(row?.externalAccountId).toBe('wallet-A')
})

it('Coinbase: reconnects a matching replacement key after a detail outage and old-key retirement', async () => {
  const { db, service } = await setup()
  const walletA = makeCoinbaseAccount({ uuid: 'wallet-A', name: 'A', default: false, balance: '0.5' })
  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-outage',
    provider: 'coinbase',
    displayName: 'Coinbase savings',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: 'old-secret' }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  let retired = false
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(extractUrl(input)).pathname
      const isOldKey = extractHeader(input, init, 'CB-ACCESS-KEY') === 'old-key'
      if (isOldKey && retired) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (path.endsWith('/accounts')) {
        return jsonResponse({ accounts: [walletA], has_next: false, cursor: '', size: 1 })
      }
      if (path.endsWith('/wallet-A')) {
        return isOldKey ? jsonResponse({ error: 'Unavailable' }, 503) : jsonResponse({ account: walletA })
      }
      if (path.endsWith('/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'common',
          portfolio_type: 'DEFAULT',
        })
      }
      return jsonResponse({ error: 'unexpected' }, 404)
    }),
  )

  const outageRefresh = await service.refreshBalance('cb-legacy-outage')
  expect(outageRefresh.isErr()).toBe(true)
  expect(outageRefresh.unwrapErr().message).toBe("Couldn't refresh your Coinbase balance right now. Please try again.")
  const [afterOutage] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-outage'))

  retired = true
  const revokedRefresh = await service.refreshBalance('cb-legacy-outage')
  expect(revokedRefresh.isErr()).toBe(true)
  expect(revokedRefresh.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)
  await expect(service.listAccounts('coinbase')).resolves.toMatchObject([{ connectionStatus: 'needs_reconnect' }])

  const replacement = await service.connectCoinbase({
    apiKey: 'new-key',
    secretKey: 'new-secret',
    replaceAccountId: 'cb-legacy-outage',
  })
  expect(replacement.isOk()).toBe(true)
  expect(afterOutage?.externalAccountId).toBe('wallet-A')
  expect(replacement.unwrap().balanceSats).toBe('50000000')
})

it('Kraken: marks account needs_reconnect on EAPI:Invalid key refresh and recovers after reconnect', async () => {
  const { service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  let key1Revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (apiKey === 'kr-key-1' && key1Revoked) {
        return jsonResponse({ error: ['EAPI:Invalid key'] })
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: apiKey === 'kr-key-2' ? '2.0' : '1.0' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: [], result: { iban: 'AA11 N84G 1234 5678' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const connected = (await service.connectKraken({ apiKey: 'kr-key-1', secretKey: secretBase64 })).unwrap()

  key1Revoked = true
  const revokedRefresh = await service.refreshBalance(connected.id)
  expect(revokedRefresh.isErr()).toBe(true)
  expect(revokedRefresh.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listedExpired = await service.listAccounts('kraken')
  expect(listedExpired[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listedExpired[0]?.balanceSats).toBeNull()

  const reconnected = (
    await service.connectKraken({
      apiKey: 'kr-key-2',
      secretKey: secretBase64,
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.connectionStatus).toBe('connected')

  const recoveredRefresh = (await service.refreshBalance(connected.id)).unwrap()
  expect(recoveredRefresh.connectionStatus).toBe('connected')
  expect(recoveredRefresh.balanceSats).toBe('200000000')
})

it('Kraken: keeps account connected when refreshBalance hits a transient 503', async () => {
  const { service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  let failRefresh = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (failRefresh) {
        return jsonResponse({ error: ['EService:Unavailable'] }, 503)
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '1.0' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: [], result: { iban: 'AA11 N84G 1234 5678' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const connected = (await service.connectKraken({ apiKey: 'kr-key-1', secretKey: secretBase64 })).unwrap()

  failRefresh = true
  const failedRefresh = await service.refreshBalance(connected.id)
  expect(failedRefresh.isErr()).toBe(true)
  expect(failedRefresh.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listed = await service.listAccounts('kraken')
  expect(listed[0]?.connectionStatus).toBe('connected')
  expect(listed[0]?.balanceSats).toBe('100000000')
})

it('Robinhood: marks account needs_reconnect on 401 refresh and recovers after reconnect', async () => {
  const { service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  let key1Revoked = false

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (apiKey === 'rh-key-1' && key1Revoked) {
      return { status: 401, body: { detail: 'Unauthorized' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/holdings/')) {
      return {
        status: 200,
        body: {
          previous: null,
          next: null,
          results: [
            {
              account_number: 'rh-acct-a',
              asset_code: 'BTC',
              total_quantity: apiKey === 'rh-key-2' ? '0.8' : '0.4',
              quantity_available_for_trading: apiKey === 'rh-key-2' ? '0.8' : '0.4',
            },
          ],
        },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const connected = (
    await service.connectRobinhood({ apiKey: 'rh-key-1', privateKeyBase64, displayName: 'Robinhood' })
  ).unwrap()

  key1Revoked = true
  const revokedRefresh = await service.refreshBalance(connected.id)
  expect(revokedRefresh.isErr()).toBe(true)
  expect(revokedRefresh.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listedExpired = await service.listAccounts('robinhood')
  expect(listedExpired[0]?.connectionStatus).toBe('needs_reconnect')
  expect(listedExpired[0]?.balanceSats).toBeNull()

  const reconnected = (
    await service.connectRobinhood({
      apiKey: 'rh-key-2',
      privateKeyBase64,
      displayName: 'Robinhood',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.connectionStatus).toBe('connected')

  const recoveredRefresh = (await service.refreshBalance(connected.id)).unwrap()
  expect(recoveredRefresh.connectionStatus).toBe('connected')
  expect(recoveredRefresh.balanceSats).toBe('80000000')
})

it('Robinhood: keeps account connected when refreshBalance hits a transient 503', async () => {
  const { service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  let failRefresh = false

  await stubRobinhoodHttps(({ path }) => {
    if (failRefresh) {
      return { status: 503, body: { detail: 'Service Unavailable' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
    }
    if (path.startsWith('/api/v1/crypto/trading/holdings/')) {
      return {
        status: 200,
        body: {
          previous: null,
          next: null,
          results: [
            {
              account_number: 'rh-acct-a',
              asset_code: 'BTC',
              total_quantity: '0.4',
              quantity_available_for_trading: '0.4',
            },
          ],
        },
      }
    }
    return { status: 200, body: { previous: null, next: null, results: [] } }
  })

  const connected = (
    await service.connectRobinhood({ apiKey: 'rh-key-1', privateKeyBase64, displayName: 'Robinhood' })
  ).unwrap()

  failRefresh = true
  const failedRefresh = await service.refreshBalance(connected.id)
  expect(failedRefresh.isErr()).toBe(true)
  expect(failedRefresh.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listed = await service.listAccounts('robinhood')
  expect(listed[0]?.connectionStatus).toBe('connected')
  expect(listed[0]?.balanceSats).toBe('40000000')
})

it('Strike: marks account needs_reconnect on 401 refresh and recovers after reconnect', async () => {
  const { service } = await setup()
  let key1Revoked = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const auth = extractHeader(input, init, 'Authorization')
      if (auth === 'Bearer strike-key-1' && key1Revoked) {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      const total = auth === 'Bearer strike-key-2' ? '0.75' : '0.25'
      return jsonResponse([{ currency: 'BTC', total, available: total }])
    }),
  )

  const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()

  key1Revoked = true
  const revokedRefresh = await service.refreshBalance(connected.id)
  expect(revokedRefresh.isErr()).toBe(true)
  expect(revokedRefresh.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listedExpired = (await service.listAccounts('strike')).find((account) => account.id === connected.id)
  expect(listedExpired?.connectionStatus).toBe('needs_reconnect')
  expect(listedExpired?.balanceSats).toBeNull()

  const reconnected = (
    await service.connectStrike({
      apiKey: 'strike-key-2',
      displayName: 'Strike',
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.connectionStatus).toBe('connected')
  expect(reconnected.balanceSats).toBe('75000000')

  const recoveredRefresh = (await service.refreshBalance(connected.id)).unwrap()
  expect(recoveredRefresh.connectionStatus).toBe('connected')
  expect(recoveredRefresh.balanceSats).toBe('75000000')
})

it('Strike: keeps account connected when refreshBalance hits HTTP 403', async () => {
  const { service } = await setup()
  let keyForbidden = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (keyForbidden) {
        return jsonResponse({ error: 'Forbidden' }, 403)
      }
      return jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }])
    }),
  )

  const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()

  keyForbidden = true
  const forbiddenRefresh = await service.refreshBalance(connected.id)
  expect(forbiddenRefresh.isErr()).toBe(true)
  expect(forbiddenRefresh.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listed = (await service.listAccounts('strike')).find((account) => account.id === connected.id)
  expect(listed?.connectionStatus).toBe('connected')
  expect(listed?.balanceSats).toBe('25000000')

  keyForbidden = false
  const recovered = (await service.refreshBalance(connected.id)).unwrap()
  expect(recovered.connectionStatus).toBe('connected')
  expect(recovered.balanceSats).toBe('25000000')
})

it('Strike: keeps account connected when refreshBalance hits a transient 503', async () => {
  const { service } = await setup()
  let failRefresh = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (failRefresh) {
        return jsonResponse({ error: 'Service Unavailable' }, 503)
      }
      return jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }])
    }),
  )

  const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()

  failRefresh = true
  const failedRefresh = await service.refreshBalance(connected.id)
  expect(failedRefresh.isErr()).toBe(true)
  expect(failedRefresh.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

  const listed = (await service.listAccounts('strike')).find((account) => account.id === connected.id)
  expect(listed?.connectionStatus).toBe('connected')
  expect(listed?.balanceSats).toBe('25000000')
})

it('never leaks raw provider error text or secrets into returned errors or debug logs', async () => {
  const { service, logs } = await setup({ captureLogs: true })
  const secretCanary = 'CANARY_PROVIDER_SECRET_948271'
  const htmlCanary = 'CANARY_CONNECT_HTML_512903'
  const amountCanary = 'NaN_CANARY_CONNECT_617382'
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()
  let mode: 'error' | 'html' | 'amount' = 'error'

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (mode === 'html') {
        return new Response(`<html><body>${htmlCanary}</body></html>`, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      if (mode === 'amount') {
        if (url.includes('/api/v3/brokerage/accounts/cb-bad')) {
          return jsonResponse({ account: makeCoinbaseAccount({ uuid: 'cb-bad', name: 'BTC', balance: amountCanary }) })
        }
        if (url.includes('/api/v3/brokerage/accounts')) {
          return jsonResponse({
            accounts: [makeCoinbaseAccount({ uuid: 'cb-bad', name: 'BTC', balance: '0.1' })],
            has_next: false,
            cursor: '',
            size: 1,
          })
        }
        if (url.includes('/api/v3/brokerage/key_permissions')) {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'port-1',
            portfolio_type: 'DEFAULT',
          })
        }
        if (url.includes('strike')) {
          return jsonResponse([{ currency: 'BTC', total: amountCanary, available: amountCanary }])
        }
        return jsonResponse({ error: [], result: { XXBT: amountCanary } })
      }
      if (url.includes('coinbase')) {
        return jsonResponse({ error: `leak ${secretCanary}` }, 500, `status ${secretCanary}`)
      }
      if (url.includes('strike')) {
        return jsonResponse({ error: `strike-leak ${secretCanary}` }, 500, `status ${secretCanary}`)
      }
      return jsonResponse({ error: [`EGeneral:Internal ${secretCanary}`] }, 200)
    }),
  )
  await stubRobinhoodHttps(() => {
    if (mode === 'html') {
      return { status: 200, rawBody: `<html><body>${htmlCanary}</body></html>` }
    }
    if (mode === 'amount') {
      return { status: 200, body: { results: [{ asset_code: 'BTC', total_quantity: amountCanary }] } }
    }
    return { status: 500, body: { detail: `rh-leak ${secretCanary}` } }
  })

  const errors: Error[] = []
  for (const nextMode of ['error', 'html', 'amount'] as const) {
    mode = nextMode
    errors.push(
      (await service.connectCoinbase({ apiKey: 'cb-key', secretKey: 'cb-secret' })).unwrapErr(),
      (await service.connectKraken({ apiKey: 'kr-key', secretKey: krakenSecret })).unwrapErr(),
      (await service.connectRobinhood({ apiKey: 'rh-key', privateKeyBase64: robinhoodPrivateKey })).unwrapErr(),
      (await service.connectStrike({ apiKey: 'st-key', displayName: 'Strike' })).unwrapErr(),
    )
  }

  for (const err of errors) {
    expect(err.message).not.toContain(secretCanary)
    expect(err.message).not.toContain(htmlCanary)
    expect(err.message).not.toContain(amountCanary)
  }
  const output = logs.join('\n')
  expect(output).not.toContain(secretCanary)
  expect(output).not.toContain(htmlCanary)
  expect(output).not.toContain(amountCanary)
})

it('Strike: reconnect accepts replacement key while preserving id and statements and writing null externalAccountId', async () => {
  const { db, service } = await setup()

  await db.insert(exchangeAccounts).values({
    id: 'strike-existing',
    provider: 'strike',
    displayName: 'My Strike',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'strike-key-1' }),
    externalAccountId: 'legacy-strike-ref',
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })
  await service.importStatementTransactions({ accountId: 'strike-existing', transactions: [transaction] })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const auth = extractHeader(input, init, 'Authorization')
      const btcTotal = auth === 'Bearer strike-key-2' ? '0.75' : '0.10'
      return jsonResponse([{ currency: 'BTC', total: btcTotal, available: btcTotal }])
    }),
  )

  const reconnected = (
    await service.connectStrike({
      apiKey: 'strike-key-2',
      displayName: 'My Strike Reconnected',
      replaceAccountId: 'strike-existing',
    })
  ).unwrap()

  expect(reconnected.id).toBe('strike-existing')
  expect(reconnected.balanceSats).toBe('75000000')
  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'strike-existing'))
  expect(rowAfter?.externalAccountId).toBeNull()
  await expect(service.listStatementTransactions('strike-existing')).resolves.toHaveLength(1)
})

it('rejects reconnect when replaceAccountId does not exist', async () => {
  const { service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const missing = await service.connectKraken({
    apiKey: 'kr-key-a-1',
    secretKey: secretBase64,
    replaceAccountId: 'does-not-exist',
  })
  expect(missing.unwrapErr().message).toBe('Exchange account not found')
})

it('rejects reconnect when replaceAccountId belongs to a different exchange provider', async () => {
  const { service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  stubKrakenPairFetch()

  const crossProvider = await service.connectKraken({
    apiKey: 'kr-key-a-1',
    secretKey: secretBase64,
    replaceAccountId: 'exchange',
  })
  expect(crossProvider.unwrapErr().message).toBe('Cannot reconnect kraken credentials to a strike account')
})

it('handles concurrent legacy reconnects safely: revoked ID-less rows fail closed and working old key lets only the matching account succeed', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')
  const revokedCreds = makeEncryptedApiKeyJson({ apiKey: 'kr-dead-old-key', secretKey: secretBase64 })
  const workingCreds = makeEncryptedApiKeyJson({ apiKey: 'kr-live-old-key', secretKey: secretBase64 })

  await db.insert(exchangeAccounts).values([
    {
      id: 'kr-race-revoked',
      provider: 'kraken',
      displayName: 'Kraken',
      encryptedCredentials: revokedCreds,
      externalAccountId: null,
      balanceSats: '0',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    },
    {
      id: 'kr-race-working',
      provider: 'kraken',
      displayName: 'Kraken',
      encryptedCredentials: workingCreds,
      externalAccountId: null,
      balanceSats: '0',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    },
  ])

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (apiKey === 'kr-dead-old-key') {
        return jsonResponse({ error: ['EAPI:Invalid key'] })
      }
      if (url.endsWith('/0/private/Balance')) {
        return jsonResponse({ error: [], result: { XXBT: '1.0' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        const iban = apiKey === 'kr-race-b' ? 'RACE-B' : 'RACE-A'
        return jsonResponse({ error: [], result: { iban } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const [revokedA, revokedB] = await Promise.all([
    service.connectKraken({ apiKey: 'kr-race-a', secretKey: secretBase64, replaceAccountId: 'kr-race-revoked' }),
    service.connectKraken({ apiKey: 'kr-race-b', secretKey: secretBase64, replaceAccountId: 'kr-race-revoked' }),
  ])
  expect(revokedA.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)
  expect(revokedB.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)
  const [revokedRow] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-race-revoked'))
  expect(revokedRow?.encryptedCredentials).toBe(revokedCreds)
  expect(revokedRow?.externalAccountId).toBeNull()

  const [workingA, workingB] = await Promise.all([
    service.connectKraken({ apiKey: 'kr-race-a', secretKey: secretBase64, replaceAccountId: 'kr-race-working' }),
    service.connectKraken({ apiKey: 'kr-race-b', secretKey: secretBase64, replaceAccountId: 'kr-race-working' }),
  ])
  expect(workingA.isOk()).toBe(true)
  expect(workingB.isErr()).toBe(true)
  const workingBErr = workingB.unwrapErr()
  expect(workingBErr).toBeInstanceOf(ExchangeUserError)
  expect(workingBErr).not.toBeInstanceOf(ExchangeAccountMismatchError)
  if (workingBErr instanceof ExchangeUserError) {
    expect(workingBErr.code).toBe('INTERNAL_SERVER_ERROR')
    expect(workingBErr.message).toBe('Exchange account credentials changed during reconnect. Please try again.')
  }
  const [workingRow] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-race-working'))
  expect(workingRow?.externalAccountId).toBe('RACE-A')

  const postRaceMismatch = await service.connectKraken({
    apiKey: 'kr-race-b',
    secretKey: secretBase64,
    replaceAccountId: 'kr-race-working',
  })
  expect(postRaceMismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
})

it('Robinhood: fails closed when working legacy old key has empty holdings and orders after /accounts/ 403', async () => {
  const { db, service } = await setup()
  const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
  const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'rh-old-empty', privateKey: privateKeyBase64 })

  await db.insert(exchangeAccounts).values({
    id: 'rh-legacy-empty',
    provider: 'robinhood',
    displayName: 'Robinhood',
    encryptedCredentials: initialCredentials,
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  await stubRobinhoodHttps(({ path, apiKey }) => {
    if (apiKey === 'rh-old-empty') {
      if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
        return { status: 403, body: { detail: 'Forbidden' } }
      }
      return { status: 200, body: { previous: null, next: null, results: [] } }
    }
    if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
      return { status: 200, body: { account_number: 'rh-acct-b', status: 'active' } }
    }
    return {
      status: 200,
      body: {
        previous: null,
        next: null,
        results: [
          {
            account_number: 'rh-acct-b',
            asset_code: 'BTC',
            total_quantity: '2.0',
            quantity_available_for_trading: '2.0',
          },
        ],
      },
    }
  })

  const res = await service.connectRobinhood({
    apiKey: 'rh-new-b',
    privateKeyBase64,
    replaceAccountId: 'rh-legacy-empty',
  })
  expect(res.isErr()).toBe(true)
  expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'rh-legacy-empty'))
  expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
  expect(rowAfter?.balanceSats).toBe('10000000')
  expect(rowAfter?.externalAccountId).toBeNull()
  const snapshots = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'rh-legacy-empty'))
  expect(snapshots).toHaveLength(0)
})

it('Coinbase: fails closed on mixed IDs when stored row has only portfolioUuid and new key key_permissions returns 503', async () => {
  const { db, service } = await setup()
  const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'cb-old', secretKey: 'old-sec' }, 'port-a')

  await db.insert(exchangeAccounts).values({
    id: 'cb-portfolio-only-503',
    provider: 'coinbase',
    displayName: 'Coinbase A',
    encryptedCredentials: initialCredentials,
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'cb-old') {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({ error: 'Unavailable' }, 503)
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({
          accounts: [makeCoinbaseAccount({ uuid: 'wallet-b', name: 'Wallet B', balance: '2.0' })],
          has_next: false,
          cursor: '',
          size: 1,
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    }),
  )

  const res = await service.connectCoinbase({
    apiKey: 'cb-new-b',
    secretKey: 'new-sec',
    replaceAccountId: 'cb-portfolio-only-503',
  })
  expect(res.isErr()).toBe(true)
  expect(res.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-portfolio-only-503'))
  expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
  expect(rowAfter?.externalAccountId).toBeNull()
  expect(rowAfter?.balanceSats).toBe('50000000')
})

it('Coinbase: fails closed on mixed IDs when stored row has only portfolioUuid and new key yields no portfolio_uuid', async () => {
  const { db, service } = await setup()
  const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'cb-old', secretKey: 'old-sec' }, 'port-a')

  await db.insert(exchangeAccounts).values({
    id: 'cb-portfolio-only-null',
    provider: 'coinbase',
    displayName: 'Coinbase A',
    encryptedCredentials: initialCredentials,
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'cb-old') {
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: '',
          portfolio_type: 'DEFAULT',
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({
          accounts: [makeCoinbaseAccount({ uuid: 'wallet-b', name: 'Wallet B', balance: '2.0' })],
          has_next: false,
          cursor: '',
          size: 1,
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    }),
  )

  const res = await service.connectCoinbase({
    apiKey: 'cb-new-b',
    secretKey: 'new-sec',
    replaceAccountId: 'cb-portfolio-only-null',
  })
  expect(res.isErr()).toBe(true)
  expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-portfolio-only-null'))
  expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
  expect(rowAfter?.externalAccountId).toBeNull()
})

it('Coinbase: fails closed when working legacy old key returns empty accounts and no portfolio_uuid', async () => {
  const { db, service } = await setup()
  const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'cb-old-empty', secretKey: 'old-sec' })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-empty',
    provider: 'coinbase',
    displayName: 'Coinbase',
    encryptedCredentials: initialCredentials,
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'cb-old-empty') {
        if (url.includes('/api/v3/brokerage/key_permissions')) {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: '',
            portfolio_type: 'DEFAULT',
          })
        }
        return jsonResponse({ accounts: [], has_next: false, cursor: '', size: 0 })
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-b',
          portfolio_type: 'DEFAULT',
        })
      }
      return jsonResponse({
        accounts: [makeCoinbaseAccount({ uuid: 'wallet-b', name: 'Wallet B', retail_portfolio_id: 'port-b' })],
        has_next: false,
        cursor: '',
        size: 1,
      })
    }),
  )

  const res = await service.connectCoinbase({
    apiKey: 'cb-new-b',
    secretKey: 'new-sec',
    replaceAccountId: 'cb-legacy-empty',
  })
  expect(res.isErr()).toBe(true)
  expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-empty'))
  expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
  expect(rowAfter?.externalAccountId).toBeNull()
})

it('Coinbase: treats old-key key_permissions HTTP 403 as unverifiable rather than definitive key revocation', async () => {
  const { db, service } = await setup()
  const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'cb-old-403-perm', secretKey: 'old-sec' })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-perm-403',
    provider: 'coinbase',
    displayName: 'Coinbase',
    encryptedCredentials: initialCredentials,
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
      if (apiKey === 'cb-old-403-perm') {
        if (url.includes('/api/v3/brokerage/key_permissions')) {
          return jsonResponse({ error: 'Forbidden' }, 403)
        }
        return jsonResponse({ accounts: [], has_next: false, cursor: '', size: 0 })
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-b',
          portfolio_type: 'DEFAULT',
        })
      }
      return jsonResponse({
        accounts: [makeCoinbaseAccount({ uuid: 'wallet-b', name: 'Wallet B', retail_portfolio_id: 'port-b' })],
        has_next: false,
        cursor: '',
        size: 1,
      })
    }),
  )

  const res = await service.connectCoinbase({
    apiKey: 'cb-new-b',
    secretKey: 'new-sec',
    replaceAccountId: 'cb-legacy-perm-403',
  })
  expect(res.isErr()).toBe(true)
  expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-perm-403'))
  expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
  expect(rowAfter?.externalAccountId).toBeNull()
})

it.each(['coinbase', 'kraken', 'robinhood'] as const)(
  '%s: fails closed on reconnect for undecryptable restored row with no saved externalAccountId',
  async (provider) => {
    const { db, service } = await setup()
    const secretBase64 = Buffer.from('kraken-secret').toString('base64')
    const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()

    initEncryption(generateEncryptionKey())
    const undecryptableCredentials =
      provider === 'robinhood'
        ? makeEncryptedApiKeyJson({ apiKey: 'old-key', privateKey: privateKeyBase64 })
        : makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: secretBase64 })
    initEncryption(generateEncryptionKey())

    await db.insert(exchangeAccounts).values({
      id: `restored-${provider}`,
      provider,
      displayName: provider,
      encryptedCredentials: undecryptableCredentials,
      externalAccountId: null,
      balanceSats: '42000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    })

    if (provider === 'coinbase') {
      stubCoinbasePairFetch()
    } else if (provider === 'kraken') {
      stubKrakenPairFetch()
    } else {
      await stubRobinhoodHttps(({ path }) => {
        if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
          return { status: 200, body: { account_number: 'rh-acct-a', status: 'active' } }
        }
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                account_number: 'rh-acct-a',
                asset_code: 'BTC',
                total_quantity: '1.0',
                quantity_available_for_trading: '1.0',
              },
            ],
          },
        }
      })
    }

    const res =
      provider === 'coinbase'
        ? await service.connectCoinbase({
            apiKey: 'cb-key-a-1',
            secretKey: 'cb-secret-a',
            replaceAccountId: `restored-${provider}`,
          })
        : provider === 'kraken'
          ? await service.connectKraken({
              apiKey: 'kr-key-a-1',
              secretKey: secretBase64,
              replaceAccountId: `restored-${provider}`,
            })
          : await service.connectRobinhood({
              apiKey: 'rh-key-a-1',
              privateKeyBase64,
              replaceAccountId: `restored-${provider}`,
            })

    expect(res.isErr()).toBe(true)
    expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

    const [rowAfter] = await db
      .select()
      .from(exchangeAccounts)
      .where(eq(exchangeAccounts.id, `restored-${provider}`))
    expect(rowAfter?.encryptedCredentials).toBe(undecryptableCredentials)
    expect(rowAfter?.balanceSats).toBe('42000000')
    expect(rowAfter?.externalAccountId).toBeNull()
  },
)

it('allows reconnecting an undecryptable restored row when saved externalAccountId matches and rejects mismatch', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  initEncryption(generateEncryptionKey())
  const undecryptableCredentials = makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: secretBase64 })
  initEncryption(generateEncryptionKey())

  await db.insert(exchangeAccounts).values({
    id: 'restored-kraken-with-id',
    provider: 'kraken',
    displayName: 'Kraken',
    encryptedCredentials: undecryptableCredentials,
    externalAccountId: 'AA11N84G12345678',
    balanceSats: '42000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
  })

  stubKrakenPairFetch()

  const mismatch = await service.connectKraken({
    apiKey: 'kr-key-b',
    secretKey: secretBase64,
    replaceAccountId: 'restored-kraken-with-id',
  })
  expect(mismatch.isErr()).toBe(true)
  expect(mismatch.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)

  const matched = await service.connectKraken({
    apiKey: 'kr-key-a-1',
    secretKey: secretBase64,
    replaceAccountId: 'restored-kraken-with-id',
  })
  expect(matched.isOk()).toBe(true)
  expect(matched.unwrap().id).toBe('restored-kraken-with-id')
  expect(matched.unwrap().connectionStatus).toBe('connected')
})

it.each([429, 503])(
  'Kraken: treats HTTP %i carrying EAPI:Invalid key as retryable during legacy old-key lookup',
  async (status) => {
    const { db, service } = await setup()
    const secretBase64 = Buffer.from('kraken-secret').toString('base64')
    const initialCredentials = makeEncryptedApiKeyJson({ apiKey: 'kr-old', secretKey: secretBase64 })

    await db.insert(exchangeAccounts).values({
      id: `kr-status-${status}`,
      provider: 'kraken',
      displayName: 'Kraken',
      encryptedCredentials: initialCredentials,
      externalAccountId: null,
      balanceSats: '15000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = extractUrl(input)
        const apiKey = extractHeader(input, init, 'API-Key')
        if (apiKey === 'kr-old') {
          return jsonResponse({ error: ['EAPI:Invalid key'] }, status)
        }
        if (url.endsWith('/0/private/Balance')) {
          return jsonResponse({ error: [], result: { XXBT: '2.0' } })
        }
        if (url.endsWith('/0/private/GetApiKeyInfo')) {
          return jsonResponse({ error: [], result: { iban: 'KR-IBAN-B' } })
        }
        return jsonResponse({ error: ['unknown'] }, 404)
      }),
    )

    const res = await service.connectKraken({
      apiKey: 'kr-new-b',
      secretKey: secretBase64,
      replaceAccountId: `kr-status-${status}`,
    })
    expect(res.isErr()).toBe(true)
    expect(res.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

    const [rowAfter] = await db
      .select()
      .from(exchangeAccounts)
      .where(eq(exchangeAccounts.id, `kr-status-${status}`))
    expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
    expect(rowAfter?.balanceSats).toBe('15000000')
    expect(rowAfter?.externalAccountId).toBeNull()
  },
)

it.each([429, 503])(
  'Kraken: keeps account connected when refreshBalance receives HTTP %i carrying EAPI:Invalid key',
  async (status) => {
    const { service } = await setup()
    const secretBase64 = Buffer.from('kraken-secret').toString('base64')
    let failRefresh = false

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = extractUrl(input)
        if (failRefresh) {
          return jsonResponse({ error: ['EAPI:Invalid key'] }, status)
        }
        if (url.endsWith('/0/private/Balance')) {
          return jsonResponse({ error: [], result: { XXBT: '1.0' } })
        }
        if (url.endsWith('/0/private/GetApiKeyInfo')) {
          return jsonResponse({ error: [], result: { iban: 'KR-IBAN-A' } })
        }
        return jsonResponse({ error: ['unknown'] }, 404)
      }),
    )

    const connected = (await service.connectKraken({ apiKey: 'kr-a', secretKey: secretBase64 })).unwrap()
    failRefresh = true

    const failed = await service.refreshBalance(connected.id)
    expect(failed.isErr()).toBe(true)
    expect(failed.unwrapErr()).not.toBeInstanceOf(ExchangeCredentialsRevokedError)

    const listed = (await service.listAccounts('kraken')).find((a) => a.id === connected.id)
    expect(listed?.connectionStatus).toBe('connected')
    expect(listed?.balanceSats).toBe('100000000')
  },
)

it('refreshBalance does not overwrite replacement balance, credentials, or snapshots after concurrent reconnect', async () => {
  const { db, service } = await setup()
  const secretBase64 = Buffer.from('kraken-secret').toString('base64')

  let releaseStaleRefresh: (() => void) | undefined
  let staleRefreshStarted: (() => void) | undefined
  const staleStartedPromise = new Promise<void>((resolve) => {
    staleRefreshStarted = resolve
  })
  const staleGatePromise = new Promise<void>((resolve) => {
    releaseStaleRefresh = resolve
  })
  let pauseFirstRefresh = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const apiKey = extractHeader(input, init, 'API-Key')
      if (url.endsWith('/0/private/Balance')) {
        if (apiKey === 'kr-old' && pauseFirstRefresh) {
          pauseFirstRefresh = false
          staleRefreshStarted?.()
          await staleGatePromise
          return jsonResponse({ error: [], result: { XXBT: '1.0' } })
        }
        return jsonResponse({ error: [], result: { XXBT: apiKey === 'kr-new' ? '2.0' : '0.5' } })
      }
      if (url.endsWith('/0/private/GetApiKeyInfo')) {
        return jsonResponse({ error: [], result: { iban: 'KR-IBAN-SHARED' } })
      }
      return jsonResponse({ error: ['unknown'] }, 404)
    }),
  )

  const connected = (await service.connectKraken({ apiKey: 'kr-old', secretKey: secretBase64 })).unwrap()
  pauseFirstRefresh = true

  const staleRefreshPromise = service.refreshBalance(connected.id)
  await staleStartedPromise

  const reconnected = (
    await service.connectKraken({
      apiKey: 'kr-new',
      secretKey: secretBase64,
      replaceAccountId: connected.id,
    })
  ).unwrap()
  expect(reconnected.balanceSats).toBe('200000000')
  const [rowAfterReconnect] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))

  releaseStaleRefresh?.()
  const staleResult = await staleRefreshPromise
  expect(staleResult.isErr()).toBe(true)
  const staleErr = staleResult.unwrapErr()
  expect(staleErr).toBeInstanceOf(ExchangeUserError)
  if (staleErr instanceof ExchangeUserError) {
    expect(staleErr.code).toBe('CONFLICT')
  }

  const [rowAfterStale] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
  expect(rowAfterStale?.balanceSats).toBe('200000000')
  expect(rowAfterStale?.encryptedCredentials).toBe(rowAfterReconnect?.encryptedCredentials)

  const snapshots = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, connected.id))
  expect(snapshots.map((s) => s.balanceSats)).not.toContain('100000000')
})

it('Coinbase: concurrent portfolioUuid backfill does not defeat markCredentialsRevoked', async () => {
  const { db, service } = await setup()

  await db.insert(exchangeAccounts).values({
    id: 'cb-cas-race',
    provider: 'coinbase',
    displayName: 'Coinbase Race',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-race-key', secretKey: 'cb-race-secret' }),
    externalAccountId: 'cb-wallet-race',
    balanceSats: '50000000',
    balanceAsOf: '2025-01-01T00:00:00.000Z',
    credentialsConnectedAt: new Date().toISOString(),
  })

  let accountGetCalls = 0
  let releaseSecondGet: (() => void) | undefined
  let secondGetStarted: (() => void) | undefined
  const secondStartedPromise = new Promise<void>((resolve) => {
    secondGetStarted = resolve
  })
  const secondGatePromise = new Promise<void>((resolve) => {
    releaseSecondGet = resolve
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/api/v3/brokerage/accounts/cb-wallet-race')) {
        accountGetCalls += 1
        if (accountGetCalls === 1) {
          return jsonResponse({
            account: makeCoinbaseAccount({ uuid: 'cb-wallet-race', name: 'Coinbase Race', balance: '0.6' }),
          })
        }
        secondGetStarted?.()
        await secondGatePromise
        return jsonResponse({ error: 'Unauthorized' }, 401)
      }
      if (url.includes('/api/v3/brokerage/key_permissions')) {
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-race-backfilled',
          portfolio_type: 'DEFAULT',
        })
      }
      return jsonResponse({ error: 'not found' }, 404)
    }),
  )

  const refresh1 = service.refreshBalance('cb-cas-race')
  const refresh2 = service.refreshBalance('cb-cas-race')

  await secondStartedPromise
  const res1 = await refresh1
  expect(res1.isOk()).toBe(true)

  releaseSecondGet?.()
  const res2 = await refresh2
  expect(res2.isErr()).toBe(true)
  expect(res2.unwrapErr()).toBeInstanceOf(ExchangeCredentialsRevokedError)

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-cas-race'))
  expect(rowAfter?.encryptedCredentials).toContain('port-race-backfilled')
  expect(rowAfter?.encryptedCredentials).toContain('"credentialsRevoked":true')

  const listed = (await service.listAccounts('coinbase')).find((a) => a.id === 'cb-cas-race')
  expect(listed?.connectionStatus).toBe('needs_reconnect')
  expect(listed?.balanceSats).toBeNull()
})

it.each([
  { provider: 'coinbase' as const, failureMode: '429' as const },
  { provider: 'coinbase' as const, failureMode: 'network' as const },
  { provider: 'coinbase' as const, failureMode: 'malformed' as const },
  { provider: 'kraken' as const, failureMode: '429' as const },
  { provider: 'kraken' as const, failureMode: 'network' as const },
  { provider: 'kraken' as const, failureMode: 'malformed' as const },
  { provider: 'robinhood' as const, failureMode: '429' as const },
  { provider: 'robinhood' as const, failureMode: 'network' as const },
  { provider: 'robinhood' as const, failureMode: 'malformed' as const },
])(
  '$provider: fails closed without writing when legacy old-key lookup hits $failureMode',
  async ({ provider, failureMode }) => {
    const { db, service } = await setup()
    const secretBase64 = Buffer.from('kraken-secret').toString('base64')
    const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
    const initialCredentials =
      provider === 'robinhood'
        ? makeEncryptedApiKeyJson({ apiKey: 'old-key', privateKey: privateKeyBase64 })
        : makeEncryptedApiKeyJson({ apiKey: 'old-key', secretKey: secretBase64 })

    const rowId = `fail-closed-${provider}-${failureMode}`
    await db.insert(exchangeAccounts).values({
      id: rowId,
      provider,
      displayName: provider,
      encryptedCredentials: initialCredentials,
      externalAccountId: null,
      balanceSats: '33000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    })

    if (provider === 'coinbase') {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = extractUrl(input)
          const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
          if (apiKey === 'old-key') {
            if (failureMode === '429') {
              return jsonResponse({ error: 'rate limited' }, 429)
            }
            if (failureMode === 'network') {
              throw new TypeError('fetch failed')
            }
            return new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          if (url.includes('/api/v3/brokerage/key_permissions')) {
            return jsonResponse({
              can_view: true,
              can_trade: false,
              can_transfer: false,
              portfolio_uuid: 'port-b',
              portfolio_type: 'DEFAULT',
            })
          }
          return jsonResponse({
            accounts: [makeCoinbaseAccount({ uuid: 'wallet-b', name: 'Wallet B', retail_portfolio_id: 'port-b' })],
            has_next: false,
            cursor: '',
            size: 1,
          })
        }),
      )
    } else if (provider === 'kraken') {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = extractUrl(input)
          const apiKey = extractHeader(input, init, 'API-Key')
          if (apiKey === 'old-key') {
            if (failureMode === '429') {
              return jsonResponse({ error: ['EAPI:Rate limit exceeded'] }, 429)
            }
            if (failureMode === 'network') {
              throw new TypeError('fetch failed')
            }
            return new Response('not-json', { status: 200, headers: { 'Content-Type': 'application/json' } })
          }
          if (url.endsWith('/0/private/Balance')) {
            return jsonResponse({ error: [], result: { XXBT: '2.0' } })
          }
          if (url.endsWith('/0/private/GetApiKeyInfo')) {
            return jsonResponse({ error: [], result: { iban: 'KR-IBAN-B' } })
          }
          return jsonResponse({ error: ['unknown'] }, 404)
        }),
      )
    } else {
      await stubRobinhoodHttps(({ path, apiKey }) => {
        if (apiKey === 'old-key') {
          if (failureMode === '429') {
            return { status: 429, body: { detail: 'Too many requests' } }
          }
          if (failureMode === 'network') {
            return { status: 500, destroySocket: true }
          }
          return { status: 200, rawBody: 'not-json' }
        }
        if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
          return { status: 200, body: { account_number: 'rh-acct-b', status: 'active' } }
        }
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                account_number: 'rh-acct-b',
                asset_code: 'BTC',
                total_quantity: '2.0',
                quantity_available_for_trading: '2.0',
              },
            ],
          },
        }
      })
    }

    const res =
      provider === 'coinbase'
        ? await service.connectCoinbase({ apiKey: 'new-key', secretKey: secretBase64, replaceAccountId: rowId })
        : provider === 'kraken'
          ? await service.connectKraken({ apiKey: 'new-key', secretKey: secretBase64, replaceAccountId: rowId })
          : await service.connectRobinhood({ apiKey: 'new-key', privateKeyBase64, replaceAccountId: rowId })

    expect(res.isErr()).toBe(true)
    expect(res.unwrapErr()).toBeInstanceOf(ExchangeVerificationRetryableError)

    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, rowId))
    expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
    expect(rowAfter?.balanceSats).toBe('33000000')
    expect(rowAfter?.externalAccountId).toBeNull()
    const snapshots = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, rowId))
    expect(snapshots).toHaveLength(0)
  },
)

it('never leaks raw provider error text or secrets during refreshBalance or old-key verification', async () => {
  const { db, service, logs } = await setup({ captureLogs: true })
  const secretCanary = 'REFRESH_VERIFY_CANARY_774411'
  const htmlCanary = 'REFRESH_HTML_CANARY_883322'
  const amountCanary = 'NaN_REFRESH_CANARY_992211'
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()
  const now = new Date().toISOString()
  let mode: 'error' | 'html' | 'amount' = 'error'

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-canary',
      provider: 'coinbase',
      displayName: 'Coinbase',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-old', secretKey: 'cb-sec' }),
      externalAccountId: 'cb-uuid-1',
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
    {
      id: 'kr-canary',
      provider: 'kraken',
      displayName: 'Kraken',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-old', secretKey: krakenSecret }),
      externalAccountId: null,
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
    {
      id: 'rh-canary',
      provider: 'robinhood',
      displayName: 'Robinhood',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'rh-old', privateKey: robinhoodPrivateKey }),
      externalAccountId: 'rh-acct-1',
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
    {
      id: 'st-canary',
      provider: 'strike',
      displayName: 'Strike',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'st-old' }),
      externalAccountId: null,
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
  ])

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      const krKey = extractHeader(input, init, 'API-Key')
      if (mode === 'html') {
        return new Response(`<html><body>${htmlCanary}</body></html>`, {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        })
      }
      if (mode === 'amount') {
        if (url.includes('coinbase')) {
          return jsonResponse({
            account: makeCoinbaseAccount({ uuid: 'cb-uuid-1', name: 'Coinbase', balance: amountCanary }),
          })
        }
        if (url.includes('strike')) {
          return jsonResponse([{ currency: 'BTC', total: amountCanary, available: amountCanary }])
        }
        return jsonResponse({ error: [], result: { XXBT: amountCanary } })
      }
      if (url.includes('coinbase')) {
        return jsonResponse({ error: `cb-refresh ${secretCanary}` }, 503, `cb-status ${secretCanary}`)
      }
      if (url.includes('strike')) {
        return jsonResponse({ error: `st-refresh ${secretCanary}` }, 503, `st-status ${secretCanary}`)
      }
      if (krKey === 'kr-new') {
        if (url.endsWith('/0/private/Balance')) {
          return jsonResponse({ error: [], result: { XXBT: '1.0' } })
        }
        return jsonResponse({ error: [], result: { iban: 'KR-IBAN-NEW' } })
      }
      return jsonResponse({ error: [`EGeneral:Internal ${secretCanary}`] }, 503)
    }),
  )
  await stubRobinhoodHttps(() => {
    if (mode === 'html') {
      return { status: 200, rawBody: `<html><body>${htmlCanary}</body></html>` }
    }
    if (mode === 'amount') {
      return { status: 200, body: { results: [{ asset_code: 'BTC', total_quantity: amountCanary }] } }
    }
    return { status: 503, body: { detail: `rh-refresh ${secretCanary}` } }
  })

  const errors: Error[] = []
  for (const nextMode of ['error', 'html', 'amount'] as const) {
    mode = nextMode
    errors.push(
      (await service.refreshBalance('cb-canary')).unwrapErr(),
      (await service.refreshBalance('kr-canary')).unwrapErr(),
      (await service.refreshBalance('rh-canary')).unwrapErr(),
      (await service.refreshBalance('st-canary')).unwrapErr(),
    )
    if (nextMode === 'error') {
      errors.push(
        (
          await service.connectKraken({
            apiKey: 'kr-new',
            secretKey: krakenSecret,
            replaceAccountId: 'kr-canary',
          })
        ).unwrapErr(),
      )
    }
  }

  for (const err of errors) {
    expect(err.message).not.toContain(secretCanary)
    expect(err.message).not.toContain(htmlCanary)
    expect(err.message).not.toContain(amountCanary)
  }
  const output = logs.join('\n')
  expect(output).not.toContain(secretCanary)
  expect(output).not.toContain(htmlCanary)
  expect(output).not.toContain(amountCanary)
})

it.each(['coinbase', 'kraken', 'robinhood'] as const)(
  '%s: never merges Account B into an ID-less Account A row whose old key is revoked',
  async (provider) => {
    const { db, service } = await setup()
    const secretBase64 = Buffer.from('kraken-secret').toString('base64')
    const privateKeyBase64 = generateRobinhoodPrivateKeyBase64()
    const rowId = `two-account-no-merge-${provider}`
    const initialCredentials =
      provider === 'robinhood'
        ? makeEncryptedApiKeyJson({ apiKey: 'acct-a-revoked', privateKey: privateKeyBase64 })
        : makeEncryptedApiKeyJson({ apiKey: 'acct-a-revoked', secretKey: secretBase64 })

    await db.insert(exchangeAccounts).values({
      id: rowId,
      provider,
      displayName: `${provider} Account A`,
      encryptedCredentials: initialCredentials,
      externalAccountId: null,
      balanceSats: '100000000',
      balanceAsOf: '2025-01-01T00:00:00.000Z',
      credentialsConnectedAt: '2025-01-01T00:00:00.000Z',
    })
    await db.insert(exchangeBalanceSnapshots).values({
      accountId: rowId,
      timestamp: '2025-01-01T00:00:00.000Z',
      balanceSats: '100000000',
    })

    if (provider === 'coinbase') {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = extractUrl(input)
          const apiKey = extractHeader(input, init, 'CB-ACCESS-KEY')
          if (apiKey === 'acct-a-revoked') {
            return jsonResponse({ error: 'Unauthorized' }, 401)
          }
          if (url.includes('/api/v3/brokerage/key_permissions')) {
            return jsonResponse({
              can_view: true,
              can_trade: false,
              can_transfer: false,
              portfolio_uuid: 'port-b',
              portfolio_type: 'DEFAULT',
            })
          }
          return jsonResponse({
            accounts: [
              makeCoinbaseAccount({
                uuid: 'cb-wallet-b',
                name: 'Account B',
                balance: '2.0',
                retail_portfolio_id: 'port-b',
              }),
            ],
            has_next: false,
            cursor: '',
            size: 1,
          })
        }),
      )
    } else if (provider === 'kraken') {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
          const url = extractUrl(input)
          const apiKey = extractHeader(input, init, 'API-Key')
          if (apiKey === 'acct-a-revoked') {
            return jsonResponse({ error: ['EAPI:Invalid key'] })
          }
          if (url.endsWith('/0/private/Balance')) {
            return jsonResponse({ error: [], result: { XXBT: '2.0' } })
          }
          if (url.endsWith('/0/private/GetApiKeyInfo')) {
            return jsonResponse({ error: [], result: { iban: 'KR-IBAN-B' } })
          }
          return jsonResponse({ error: ['unknown'] }, 404)
        }),
      )
    } else {
      await stubRobinhoodHttps(({ path, apiKey }) => {
        if (apiKey === 'acct-a-revoked') {
          return { status: 401, body: { detail: 'Unauthorized' } }
        }
        if (path.startsWith('/api/v1/crypto/trading/accounts/')) {
          return { status: 200, body: { account_number: 'rh-acct-b', status: 'active' } }
        }
        return {
          status: 200,
          body: {
            previous: null,
            next: null,
            results: [
              {
                account_number: 'rh-acct-b',
                asset_code: 'BTC',
                total_quantity: '2.0',
                quantity_available_for_trading: '2.0',
              },
            ],
          },
        }
      })
    }

    const res =
      provider === 'coinbase'
        ? await service.connectCoinbase({ apiKey: 'acct-b-key', secretKey: secretBase64, replaceAccountId: rowId })
        : provider === 'kraken'
          ? await service.connectKraken({ apiKey: 'acct-b-key', secretKey: secretBase64, replaceAccountId: rowId })
          : await service.connectRobinhood({
              apiKey: 'acct-b-key',
              privateKeyBase64,
              replaceAccountId: rowId,
            })

    expect(res.isErr()).toBe(true)
    expect(res.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)

    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, rowId))
    expect(rowAfter?.encryptedCredentials).toBe(initialCredentials)
    expect(rowAfter?.externalAccountId).toBeNull()
    expect(rowAfter?.balanceSats).toBe('100000000')

    const snapshotsAfter = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, rowId))
    expect(snapshotsAfter).toHaveLength(1)
    expect(snapshotsAfter[0]).toMatchObject({
      accountId: rowId,
      timestamp: '2025-01-01T00:00:00.000Z',
      balanceSats: '100000000',
    })
  },
)

it.each(['info', 'debug'] as const)(
  'never logs raw provider error details in Coinbase backfill/transactions or Kraken ledger warnings at %s level',
  async (logLevel) => {
    const { db, service, logs } = await setup({ captureLogs: true, logLevel })
    const secretCanary = 'TX_LOG_CANARY_603928'
    const krakenSecret = Buffer.from('kraken-secret').toString('base64')
    const now = new Date().toISOString()

    await db.insert(exchangeAccounts).values([
      {
        id: 'cb-backfill-warn',
        provider: 'coinbase',
        displayName: 'Coinbase Backfill',
        encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-backfill-key', secretKey: 'cb-sec' }),
        externalAccountId: null,
        balanceSats: '1000',
        balanceAsOf: now,
        credentialsConnectedAt: now,
      },
      {
        id: 'cb-tx-warn',
        provider: 'coinbase',
        displayName: 'Coinbase Tx',
        encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-tx-key', secretKey: 'cb-sec' }),
        externalAccountId: 'cb-uuid-tx',
        balanceSats: '1000',
        balanceAsOf: now,
        credentialsConnectedAt: now,
      },
      {
        id: 'kr-ledger-warn',
        provider: 'kraken',
        displayName: 'Kraken Ledger',
        encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-ledger-key', secretKey: krakenSecret }),
        externalAccountId: 'KR-IBAN-1',
        balanceSats: '1000',
        balanceAsOf: now,
        credentialsConnectedAt: now,
      },
    ])

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = extractUrl(input)
        if (url.includes('/api/v3/brokerage/accounts')) {
          return jsonResponse({ error: `cb-backfill ${secretCanary}` }, 403, `status ${secretCanary}`)
        }
        if (url.includes('/v2/accounts/cb-uuid-tx/transactions')) {
          return jsonResponse({ error: `cb-tx ${secretCanary}` }, 500, `status ${secretCanary}`)
        }
        return jsonResponse({ error: [`EGeneral:Internal ${secretCanary}`] }, 503, `status ${secretCanary}`)
      }),
    )

    const cbEntries = await service.getCoinbaseTransactionEntries(['cb-backfill-warn', 'cb-tx-warn'])
    expect(cbEntries.isErr()).toBe(true)

    const krEntries = await service.getKrakenTransactionEntries(['kr-ledger-warn'])
    expect(krEntries.isErr()).toBe(true)

    const output = logs.join('\n')
    expect(output).toContain('Failed to list Coinbase accounts')
    expect(output).toContain('Failed to fetch Coinbase transactions')
    expect(output).toContain('Failed to fetch Kraken ledgers')
    expect(output).not.toContain(secretCanary)
  },
)

const MALFORMED_BALANCES = ['NaN', 'Infinity', 'abc', '0x10', '-0.5', '1e10000000'] as const

const ALL_PROVIDERS: readonly SupportedExchange[] = ['coinbase', 'kraken', 'robinhood', 'strike']

const MALFORMED_CONNECT_CASES = ALL_PROVIDERS.flatMap((provider) =>
  MALFORMED_BALANCES.map((badValue) => ({ provider, badValue })),
)

it.each(MALFORMED_CONNECT_CASES)(
  'rejects malformed balance $badValue on $provider connect with INTERNAL_SERVER_ERROR and writes no row or snapshot',
  async ({ provider, badValue }) => {
    const { db, service } = await setup()
    const krakenSecret = Buffer.from('kraken-secret').toString('base64')
    const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()

    if (provider === 'robinhood') {
      await stubRobinhoodHttps(() => ({
        status: 200,
        body: { results: [{ asset_code: 'BTC', total_quantity: badValue, account_number: 'rh-acct-1' }] },
      }))
    } else {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = extractUrl(input)
          if (provider === 'coinbase') {
            if (url.includes('/api/v3/brokerage/accounts/cb-bad')) {
              return jsonResponse({ account: makeCoinbaseAccount({ uuid: 'cb-bad', name: 'BTC', balance: badValue }) })
            }
            if (url.includes('/api/v3/brokerage/accounts')) {
              return jsonResponse({
                accounts: [makeCoinbaseAccount({ uuid: 'cb-bad', name: 'BTC', balance: '0.1' })],
                has_next: false,
                cursor: '',
                size: 1,
              })
            }
            return jsonResponse({
              can_view: true,
              can_trade: false,
              can_transfer: false,
              portfolio_uuid: 'port-1',
              portfolio_type: 'DEFAULT',
            })
          }
          if (provider === 'kraken') {
            if (url.endsWith('/0/private/Balance')) {
              return jsonResponse({ error: [], result: { XXBT: badValue } })
            }
            return jsonResponse({ error: [], result: { iban: 'KR-1' } })
          }
          return jsonResponse([{ currency: 'BTC', total: badValue, available: badValue }])
        }),
      )
    }

    const result =
      provider === 'coinbase'
        ? await service.connectCoinbase({ apiKey: 'cb-k', secretKey: 'cb-s' })
        : provider === 'kraken'
          ? await service.connectKraken({ apiKey: 'kr-k', secretKey: krakenSecret })
          : provider === 'robinhood'
            ? await service.connectRobinhood({ apiKey: 'rh-k', privateKeyBase64: robinhoodPrivateKey })
            : await service.connectStrike({ apiKey: 'st-k', displayName: 'Strike' })

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(ExchangeUserError)
    if (err instanceof ExchangeUserError) {
      expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    }
    expect(err.message).not.toContain(badValue)

    const rows = await db.select().from(exchangeAccounts)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('exchange')
    const snapshots = await db.select().from(exchangeBalanceSnapshots)
    expect(snapshots).toHaveLength(0)
  },
)

it.each(MALFORMED_CONNECT_CASES)(
  'rejects malformed balance $badValue on $provider refresh with INTERNAL_SERVER_ERROR and preserves existing row and snapshots',
  async ({ provider, badValue }) => {
    const { db, service } = await setup()
    const krakenSecret = Buffer.from('kraken-secret').toString('base64')
    const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()
    const now = new Date().toISOString()
    const accountId = `malformed-refresh-${provider}`

    const encryptedCredentials =
      provider === 'strike'
        ? makeEncryptedApiKeyJson({ apiKey: 'st-k' })
        : provider === 'robinhood'
          ? makeEncryptedApiKeyJson({ apiKey: 'rh-k', privateKey: robinhoodPrivateKey })
          : makeEncryptedApiKeyJson({
              apiKey: `${provider}-k`,
              secretKey: provider === 'kraken' ? krakenSecret : 'cb-s',
            })

    await db.insert(exchangeAccounts).values({
      id: accountId,
      provider,
      displayName: `${provider} Account`,
      encryptedCredentials,
      externalAccountId: provider === 'strike' ? null : `${provider}-ext-1`,
      balanceSats: '40000000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    })
    await db.insert(exchangeBalanceSnapshots).values({
      accountId,
      timestamp: now,
      balanceSats: '40000000',
    })

    const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))
    const snapshotsBefore = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, accountId))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))

    if (provider === 'robinhood') {
      await stubRobinhoodHttps(() => ({
        status: 200,
        body: { results: [{ asset_code: 'BTC', total_quantity: badValue, account_number: 'rh-ext-1' }] },
      }))
    } else {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL | Request) => {
          const url = extractUrl(input)
          if (provider === 'coinbase') {
            if (url.includes('/api/v3/brokerage/accounts/coinbase-ext-1')) {
              return jsonResponse({
                account: makeCoinbaseAccount({ uuid: 'coinbase-ext-1', name: 'BTC', balance: badValue }),
              })
            }
            return jsonResponse({
              can_view: true,
              can_trade: false,
              can_transfer: false,
              portfolio_uuid: 'port-1',
              portfolio_type: 'DEFAULT',
            })
          }
          if (provider === 'kraken') {
            return jsonResponse({ error: [], result: { XXBT: badValue } })
          }
          return jsonResponse([{ currency: 'BTC', total: badValue, available: badValue }])
        }),
      )
    }

    const result = await service.refreshBalance(accountId)
    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(ExchangeUserError)
    if (err instanceof ExchangeUserError) {
      expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    }
    expect(err.message).not.toContain(badValue)

    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))
    const snapshotsAfter = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, accountId))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))

    expect(rowAfter).toEqual(rowBefore)
    expect(snapshotsAfter).toEqual(snapshotsBefore)

    const listed = (await service.listAccounts()).find((a) => a.id === accountId)
    expect(listed?.connectionStatus).toBe('connected')
    expect(listed?.balanceSats).toBe('40000000')
  },
)

it.each(['network', 'html200', 'NaN', 'abc', 'injectedThrow'] as const)(
  'refreshAllBalances continues past failing Strike (%s) and refreshes healthy Kraken account',
  async (failureMode) => {
    const { db, service } = await setup()
    const krakenSecret = Buffer.from('kraken-secret').toString('base64')
    const now = new Date().toISOString()

    await db.insert(exchangeAccounts).values([
      {
        id: 'st-first',
        provider: 'strike',
        displayName: 'Strike Failing',
        encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'st-key' }),
        externalAccountId: null,
        balanceSats: '40000000',
        balanceAsOf: '2025-01-01T00:00:00.000Z',
        createdAt: '2025-01-01T00:00:00.000Z',
        credentialsConnectedAt: now,
      },
      {
        id: 'kr-second',
        provider: 'kraken',
        displayName: 'Kraken Healthy',
        encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-key', secretKey: krakenSecret }),
        externalAccountId: 'KR-IBAN-HEALTHY',
        balanceSats: '10000000',
        balanceAsOf: '2025-01-01T00:00:00.000Z',
        createdAt: '2025-01-02T00:00:00.000Z',
        credentialsConnectedAt: now,
      },
    ])
    await db.insert(exchangeBalanceSnapshots).values([
      { accountId: 'st-first', timestamp: '2025-01-01T00:00:00.000Z', balanceSats: '40000000' },
      { accountId: 'kr-second', timestamp: '2025-01-01T00:00:00.000Z', balanceSats: '10000000' },
    ])

    const [strikeBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'st-first'))
    let strikeCalled = false
    let krakenCalled = false

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = extractUrl(input)
        if (url.includes('strike')) {
          strikeCalled = true
          if (failureMode === 'network') {
            throw new TypeError('strike socket closed')
          }
          if (failureMode === 'html200') {
            return new Response('<html><body>502</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            })
          }
          return jsonResponse([{ currency: 'BTC', total: failureMode, available: failureMode }])
        }
        krakenCalled = true
        return jsonResponse({ error: [], result: { XXBT: '0.85' } })
      }),
    )

    if (failureMode === 'injectedThrow') {
      const originalRefresh = service.refreshBalance
      vi.spyOn(service, 'refreshBalance').mockImplementation(
        asyncFn(async (id: string) => {
          if (id === 'st-first') {
            strikeCalled = true
            throw new Error('injected unexpected rejection')
          }
          return originalRefresh(id)
        }),
      )
    }

    const res = await service.refreshAllBalances()
    expect(res.isOk()).toBe(true)
    expect(strikeCalled).toBe(true)
    expect(krakenCalled).toBe(true)

    const [strikeAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'st-first'))
    const [krakenAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-second'))
    const krakenSnapshots = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, 'kr-second'))

    expect(strikeAfter).toEqual(strikeBefore)
    expect(krakenAfter?.balanceSats).toBe('85000000')
    expect(krakenSnapshots).toHaveLength(2)
  },
)

it('refreshAllBalances handles empty accounts and sanitizes aggregate all-failed errors', async () => {
  const { db, service, logs } = await setup({ captureLogs: true })
  const emptyResult = await service.refreshAllBalances()
  expect(emptyResult.isOk()).toBe(true)

  const now = new Date().toISOString()
  const accountNameCanary = 'SECRET_ACCOUNT_LABEL_991188'
  const thrownCanary = 'SECRET_THROWN_MSG_445566'

  await db.insert(exchangeAccounts).values({
    id: 'st-only',
    provider: 'strike',
    displayName: accountNameCanary,
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'st-key' }),
    externalAccountId: null,
    balanceSats: '1000',
    balanceAsOf: now,
    credentialsConnectedAt: now,
  })

  vi.spyOn(service, 'refreshBalance').mockImplementation(
    asyncFn(async () => {
      throw new Error(`boom ${thrownCanary}`)
    }),
  )

  const failedResult = await service.refreshAllBalances()
  expect(failedResult.isErr()).toBe(true)
  const err = failedResult.unwrapErr()
  expect(err).toBeInstanceOf(ExchangeUserError)
  if (err instanceof ExchangeUserError) {
    expect(err.code).toBe('INTERNAL_SERVER_ERROR')
  }
  expect(err.message).not.toContain(accountNameCanary)
  expect(err.message).not.toContain(thrownCanary)
  expect(logs.join('\n')).not.toContain(thrownCanary)
})

it.each(['http503', 'http429', 'network', 'nanBalance'] as const)(
  'Coinbase: late detail GET failure (%s) on legacy ID-less reconnect writes nothing to row or snapshots',
  async (failureMode) => {
    const { db, service } = await setup()
    const now = '2025-01-01T00:00:00.000Z'
    const oldCreds = makeEncryptedApiKeyJson({ apiKey: 'cb-old-key', secretKey: 'cb-old-secret' })

    await db.insert(exchangeAccounts).values({
      id: 'cb-legacy-late',
      provider: 'coinbase',
      displayName: 'Coinbase Legacy',
      encryptedCredentials: oldCreds,
      externalAccountId: null,
      balanceSats: '50000000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    })
    await db.insert(exchangeBalanceSnapshots).values({
      accountId: 'cb-legacy-late',
      timestamp: now,
      balanceSats: '50000000',
    })

    const [rowBefore] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-late'))
    const snapshotsBefore = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-late'))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))

    let detailReached = false

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = extractUrl(input)
        if (url.includes('/api/v3/brokerage/accounts/cb-btc-1')) {
          detailReached = true
          if (failureMode === 'http503') {
            return jsonResponse({ error: 'service unavailable' }, 503)
          }
          if (failureMode === 'http429') {
            return jsonResponse({ error: 'rate limited' }, 429)
          }
          if (failureMode === 'network') {
            throw new TypeError('connection reset')
          }
          return jsonResponse({
            account: makeCoinbaseAccount({
              uuid: 'cb-btc-1',
              name: 'BTC Wallet',
              balance: 'NaN',
              retail_portfolio_id: 'port-same',
            }),
          })
        }
        if (url.includes('/api/v3/brokerage/accounts')) {
          return jsonResponse({
            accounts: [
              makeCoinbaseAccount({
                uuid: 'cb-btc-1',
                name: 'BTC Wallet',
                balance: '0.5',
                retail_portfolio_id: 'port-same',
              }),
            ],
            has_next: false,
            cursor: '',
            size: 1,
          })
        }
        if (url.includes('/api/v3/brokerage/key_permissions')) {
          return jsonResponse({
            can_view: true,
            can_trade: false,
            can_transfer: false,
            portfolio_uuid: 'port-same',
            portfolio_type: 'DEFAULT',
          })
        }
        return jsonResponse({ error: 'unknown' }, 404)
      }),
    )

    const result = await service.connectCoinbase({
      apiKey: 'cb-new-key',
      secretKey: 'cb-new-secret',
      replaceAccountId: 'cb-legacy-late',
    })

    expect(detailReached).toBe(true)
    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(ExchangeUserError)
    if (err instanceof ExchangeUserError) {
      expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    }

    const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-late'))
    const snapshotsAfter = await db
      .select()
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, 'cb-legacy-late'))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))

    expect(rowAfter).toEqual(rowBefore)
    expect(snapshotsAfter).toEqual(snapshotsBefore)
  },
)

it('Coinbase: late failure followed by successful retry on legacy ID-less row pins identity and updates balance in one step', async () => {
  const { db, service } = await setup()
  const now = '2025-01-01T00:00:00.000Z'
  const oldCreds = makeEncryptedApiKeyJson({ apiKey: 'cb-old-key', secretKey: 'cb-old-secret' })

  await db.insert(exchangeAccounts).values({
    id: 'cb-legacy-retry',
    provider: 'coinbase',
    displayName: 'Coinbase Legacy',
    encryptedCredentials: oldCreds,
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: now,
    credentialsConnectedAt: now,
  })
  await db.insert(exchangeBalanceSnapshots).values({
    accountId: 'cb-legacy-retry',
    timestamp: now,
    balanceSats: '50000000',
  })

  let failDetail = true

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/api/v3/brokerage/accounts/cb-btc-retry')) {
        if (failDetail) {
          return jsonResponse({ error: 'service unavailable' }, 503)
        }
        return jsonResponse({
          account: makeCoinbaseAccount({
            uuid: 'cb-btc-retry',
            name: 'BTC Wallet',
            balance: '0.9',
            retail_portfolio_id: 'port-retry',
          }),
        })
      }
      if (url.includes('/api/v3/brokerage/accounts')) {
        return jsonResponse({
          accounts: [
            makeCoinbaseAccount({
              uuid: 'cb-btc-retry',
              name: 'BTC Wallet',
              balance: '0.9',
              retail_portfolio_id: 'port-retry',
            }),
          ],
          has_next: false,
          cursor: '',
          size: 1,
        })
      }
      return jsonResponse({
        can_view: true,
        can_trade: false,
        can_transfer: false,
        portfolio_uuid: 'port-retry',
        portfolio_type: 'DEFAULT',
      })
    }),
  )

  const firstAttempt = await service.connectCoinbase({
    apiKey: 'cb-new-key',
    secretKey: 'cb-new-secret',
    replaceAccountId: 'cb-legacy-retry',
  })
  expect(firstAttempt.isErr()).toBe(true)

  const [rowAfterFirst] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-retry'))
  expect(rowAfterFirst?.externalAccountId).toBeNull()
  expect(rowAfterFirst?.encryptedCredentials).toBe(oldCreds)

  failDetail = false
  const secondAttempt = await service.connectCoinbase({
    apiKey: 'cb-new-key',
    secretKey: 'cb-new-secret',
    replaceAccountId: 'cb-legacy-retry',
  })
  expect(secondAttempt.isOk()).toBe(true)
  expect(secondAttempt.unwrap().balanceSats).toBe('90000000')

  const [rowAfterSecond] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-legacy-retry'))
  expect(rowAfterSecond?.externalAccountId).toBe('cb-btc-retry')
  expect(rowAfterSecond?.encryptedCredentials).toContain('port-retry')
  expect(rowAfterSecond?.balanceSats).toBe('90000000')
})

it('Coinbase: stale reconnect whose final detail GET finishes after a newer replacement cannot overwrite the newer generation', async () => {
  const { db, service } = await setup()
  const now = '2025-01-01T00:00:00.000Z'
  const oldCreds = makeEncryptedApiKeyJson({ apiKey: 'cb-gen1-key', secretKey: 'cb-gen1-secret' })

  await db.insert(exchangeAccounts).values({
    id: 'cb-stale-gen',
    provider: 'coinbase',
    displayName: 'Coinbase Gen1',
    encryptedCredentials: oldCreds,
    externalAccountId: null,
    balanceSats: '50000000',
    balanceAsOf: now,
    credentialsConnectedAt: now,
  })

  let releaseStaleDetail: (() => void) | undefined
  const staleDetailReached = new Promise<void>((resolve) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = extractUrl(input)
        const accessKey = extractHeader(input, init, 'CB-ACCESS-KEY')
        if (url.includes('/api/v3/brokerage/accounts/cb-btc-gen')) {
          if (accessKey === 'cb-stale-key') {
            resolve()
            await new Promise<void>((done) => {
              releaseStaleDetail = done
            })
            return jsonResponse({
              account: makeCoinbaseAccount({
                uuid: 'cb-btc-gen',
                name: 'Stale Name',
                balance: '0.1',
                retail_portfolio_id: 'port-gen',
              }),
            })
          }
          return jsonResponse({
            account: makeCoinbaseAccount({
              uuid: 'cb-btc-gen',
              name: 'Newer Name',
              balance: '1.25',
              retail_portfolio_id: 'port-gen',
            }),
          })
        }
        if (url.includes('/api/v3/brokerage/accounts')) {
          return jsonResponse({
            accounts: [
              makeCoinbaseAccount({
                uuid: 'cb-btc-gen',
                name: accessKey === 'cb-stale-key' ? 'Stale Name' : 'Newer Name',
                balance: '0.5',
                retail_portfolio_id: 'port-gen',
              }),
            ],
            has_next: false,
            cursor: '',
            size: 1,
          })
        }
        return jsonResponse({
          can_view: true,
          can_trade: false,
          can_transfer: false,
          portfolio_uuid: 'port-gen',
          portfolio_type: 'DEFAULT',
        })
      }),
    )
  })

  const stalePromise = service.connectCoinbase({
    apiKey: 'cb-stale-key',
    secretKey: 'cb-stale-secret',
    replaceAccountId: 'cb-stale-gen',
  })

  await staleDetailReached

  const newerResult = await service.connectCoinbase({
    apiKey: 'cb-newer-key',
    secretKey: 'cb-newer-secret',
    replaceAccountId: 'cb-stale-gen',
  })
  expect(newerResult.isOk()).toBe(true)

  releaseStaleDetail?.()
  const staleResult = await stalePromise
  expect(staleResult.isErr()).toBe(true)
  const staleErr = staleResult.unwrapErr()
  expect(staleErr).toBeInstanceOf(ExchangeUserError)
  if (staleErr instanceof ExchangeUserError) {
    expect(staleErr.code).toBe('INTERNAL_SERVER_ERROR')
    expect(staleErr.message).toBe('Exchange account credentials changed during reconnect. Please try again.')
  }

  const [rowAfter] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'cb-stale-gen'))
  expect(rowAfter?.displayName).toBe('Newer Name')
  expect(rowAfter?.balanceSats).toBe('125000000')
})

it('skips malformed Coinbase and Kraken history entries, keeps valid siblings, and omits canaries from logs', async () => {
  const { db, service, logs } = await setup({ captureLogs: true })
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const now = new Date().toISOString()
  const cbCanary = 'NaN_CB_HIST_CANARY_112233'
  const krCanary = 'abc_KR_HIST_CANARY_445566'
  const krFeeCanary = 'Infinity_KR_FEE_CANARY_778899'

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-hist',
      provider: 'coinbase',
      displayName: 'Coinbase History',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-k', secretKey: 'cb-s' }),
      externalAccountId: 'cb-uuid-hist',
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
    {
      id: 'kr-hist',
      provider: 'kraken',
      displayName: 'Kraken History',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-k', secretKey: krakenSecret }),
      externalAccountId: 'KR-IBAN-HIST',
      balanceSats: '1000',
      balanceAsOf: now,
      credentialsConnectedAt: now,
    },
  ])

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/v2/accounts/cb-uuid-hist/transactions')) {
        return jsonResponse({
          pagination: { next_uri: null },
          data: [
            {
              id: 'tx-1',
              type: 'buy',
              status: 'completed',
              amount: { amount: '0.5', currency: 'BTC' },
              native_amount: { amount: '30000', currency: 'USD' },
              created_at: '2025-01-01T00:00:00Z',
              resource: 'transaction',
              resource_path: '/v2/accounts/cb-uuid-hist/transactions/tx-1',
            },
            {
              id: 'tx-bad',
              type: 'buy',
              status: 'completed',
              amount: { amount: cbCanary, currency: 'BTC' },
              native_amount: { amount: '0', currency: 'USD' },
              created_at: '2025-01-02T00:00:00Z',
              resource: 'transaction',
              resource_path: '/v2/accounts/cb-uuid-hist/transactions/tx-bad',
            },
            {
              id: 'tx-2',
              type: 'send',
              status: 'completed',
              amount: { amount: '-0.1', currency: 'BTC' },
              native_amount: { amount: '-6000', currency: 'USD' },
              created_at: '2025-01-03T00:00:00Z',
              resource: 'transaction',
              resource_path: '/v2/accounts/cb-uuid-hist/transactions/tx-2',
            },
          ],
        })
      }
      return jsonResponse({
        error: [],
        result: {
          count: 4,
          ledger: {
            L1: {
              refid: 'R1',
              time: 1700000000,
              type: 'deposit',
              subtype: '',
              aclass: 'currency',
              asset: 'XXBT',
              amount: '0.5',
              fee: '0.01',
              balance: '0.49',
            },
            L2: {
              refid: 'R2',
              time: 1700000100,
              type: 'deposit',
              subtype: '',
              aclass: 'currency',
              asset: 'XXBT',
              amount: krCanary,
              fee: '0',
              balance: '0.49',
            },
            L3: {
              refid: 'R3',
              time: 1700000200,
              type: 'withdrawal',
              subtype: '',
              aclass: 'currency',
              asset: 'XXBT',
              amount: '-0.2',
              fee: krFeeCanary,
              balance: '0.29',
            },
            L4: {
              refid: 'R4',
              time: 1700000300,
              type: 'withdrawal',
              subtype: '',
              aclass: 'currency',
              asset: 'XXBT',
              amount: '-0.25',
              fee: '0.005',
              balance: '0.235',
            },
          },
        },
      })
    }),
  )

  const cbEntries = (await service.getCoinbaseTransactionEntries(['cb-hist'])).unwrap()
  expect(cbEntries.map((e) => e.value)).toEqual([50000000n, -10000000n])

  const krEntries = (await service.getKrakenTransactionEntries(['kr-hist'])).unwrap()
  expect(krEntries.map((e) => e.value)).toEqual([49000000n, -25500000n])

  const output = logs.join('\n')
  expect(output).toContain('Skipped Coinbase transaction with invalid amount')
  expect(output).toContain('Skipped Kraken ledger entry with invalid amount')
  expect(output).not.toContain(cbCanary)
  expect(output).not.toContain(krCanary)
  expect(output).not.toContain(krFeeCanary)
})

const RETRYABLE_CONNECT_CASES = ALL_PROVIDERS.flatMap((provider) =>
  (['http429', 'http503', 'network', 'html200'] as const).map((mode) => ({ provider, mode })),
)

it.each(RETRYABLE_CONNECT_CASES)(
  'maps $provider connect $mode failure to INTERNAL_SERVER_ERROR with retryable copy',
  async ({ provider, mode }) => {
    const { service } = await setup()
    const krakenSecret = Buffer.from('kraken-secret').toString('base64')
    const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()

    if (provider === 'robinhood') {
      await stubRobinhoodHttps(() => {
        if (mode === 'network') {
          return { status: 200, destroySocket: true }
        }
        if (mode === 'html200') {
          return { status: 200, rawBody: '<html><body>gateway</body></html>' }
        }
        return { status: mode === 'http429' ? 429 : 503, body: { detail: 'busy' } }
      })
    } else {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          if (mode === 'network') {
            throw new TypeError('network down')
          }
          if (mode === 'html200') {
            return new Response('<html><body>gateway</body></html>', {
              status: 200,
              headers: { 'Content-Type': 'text/html' },
            })
          }
          return jsonResponse({ error: ['unavailable'] }, mode === 'http429' ? 429 : 503)
        }),
      )
    }

    const result =
      provider === 'coinbase'
        ? await service.connectCoinbase({ apiKey: 'cb-k', secretKey: 'cb-s' })
        : provider === 'kraken'
          ? await service.connectKraken({ apiKey: 'kr-k', secretKey: krakenSecret })
          : provider === 'robinhood'
            ? await service.connectRobinhood({ apiKey: 'rh-k', privateKeyBase64: robinhoodPrivateKey })
            : await service.connectStrike({ apiKey: 'st-k', displayName: 'Strike' })

    expect(result.isErr()).toBe(true)
    const err = result.unwrapErr()
    expect(err).toBeInstanceOf(ExchangeUserError)
    if (err instanceof ExchangeUserError) {
      expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    }
    expect(err.message).toMatch(/^Couldn't connect to .+ right now\. Please try again\.$/)
  },
)

it.each<{ provider: SupportedExchange; mode: 'http401' | 'krakenInvalidKey' }>([
  { provider: 'coinbase', mode: 'http401' },
  { provider: 'kraken', mode: 'http401' },
  { provider: 'kraken', mode: 'krakenInvalidKey' },
  { provider: 'robinhood', mode: 'http401' },
  { provider: 'strike', mode: 'http401' },
])('maps $provider connect $mode credential rejection to BAD_REQUEST', async ({ provider, mode }) => {
  const { service } = await setup()
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()

  if (provider === 'robinhood') {
    await stubRobinhoodHttps(() => ({ status: 401, body: { detail: 'unauthorized' } }))
  } else {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        if (mode === 'krakenInvalidKey') {
          return jsonResponse({ error: ['EAPI:Invalid key'] }, 200)
        }
        return jsonResponse({ error: 'unauthorized' }, 401)
      }),
    )
  }

  const result =
    provider === 'coinbase'
      ? await service.connectCoinbase({ apiKey: 'cb-k', secretKey: 'cb-s' })
      : provider === 'kraken'
        ? await service.connectKraken({ apiKey: 'kr-k', secretKey: krakenSecret })
        : provider === 'robinhood'
          ? await service.connectRobinhood({ apiKey: 'rh-k', privateKeyBase64: robinhoodPrivateKey })
          : await service.connectStrike({ apiKey: 'st-k', displayName: 'Strike' })

  expect(result.isErr()).toBe(true)
  const err = result.unwrapErr()
  expect(err).toBeInstanceOf(ExchangeUserError)
  if (err instanceof ExchangeUserError) {
    expect(err.code).toBe('BAD_REQUEST')
  }
  if (provider === 'coinbase') {
    expect(err.message).toBe(
      'Invalid Coinbase API credentials. Check your API Key ID, Read permission, and IP settings in Coinbase.',
    )
  } else {
    expect(err.message).toMatch(/^Invalid .+ API credentials\. Check your key and permissions, then try again\.$/)
  }
})

it('projects already-stored corrupt balance_sats as null in listAccounts and repairs on later refresh without deleting raw snapshots', async () => {
  const { db, service } = await setup()
  const now = new Date().toISOString()

  await db.insert(exchangeAccounts).values([
    {
      id: 'st-corrupt',
      provider: 'strike',
      displayName: 'Corrupt Strike',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'st-corrupt-key' }),
      externalAccountId: null,
      balanceSats: 'NaN',
      balanceAsOf: '2025-01-02T00:00:00.000Z',
      credentialsConnectedAt: now,
    },
    {
      id: 'st-healthy',
      provider: 'strike',
      displayName: 'Healthy Strike',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'st-healthy-key' }),
      externalAccountId: null,
      balanceSats: '40000000',
      balanceAsOf: '2025-01-02T00:00:00.000Z',
      credentialsConnectedAt: now,
    },
  ])
  await db.insert(exchangeBalanceSnapshots).values([
    { accountId: 'st-corrupt', timestamp: '2025-01-01T00:00:00.000Z', balanceSats: '10000000' },
    { accountId: 'st-corrupt', timestamp: '2025-01-02T00:00:00.000Z', balanceSats: 'NaN' },
    { accountId: 'st-corrupt', timestamp: '2025-01-03T00:00:00.000Z', balanceSats: '25000000' },
  ])

  const before = await service.listAccounts()
  const corruptDto = before.find((a) => a.id === 'st-corrupt')
  const healthyDto = before.find((a) => a.id === 'st-healthy')
  expect(corruptDto?.balanceSats).toBeNull()
  expect(corruptDto?.balanceAsOf).toBeNull()
  expect(healthyDto?.balanceSats).toBe('40000000')

  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse([{ currency: 'BTC', total: '0.3', available: '0.3' }])),
  )

  const repaired = (await service.refreshBalance('st-corrupt')).unwrap()
  expect(repaired.balanceSats).toBe('30000000')

  const after = await service.listAccounts()
  expect(after.find((a) => a.id === 'st-corrupt')?.balanceSats).toBe('30000000')

  const rawSnapshots = await db
    .select()
    .from(exchangeBalanceSnapshots)
    .where(eq(exchangeBalanceSnapshots.accountId, 'st-corrupt'))
    .orderBy(asc(exchangeBalanceSnapshots.timestamp))
  expect(rawSnapshots.map((s) => s.balanceSats)).toContain('NaN')
  expect(rawSnapshots).toHaveLength(4)
})

function makeCoinbaseTransaction(args: { id: string; amountBtc: string; createdAt: string }): JsonValue {
  return {
    id: args.id,
    type: 'buy',
    status: 'completed',
    amount: { amount: args.amountBtc, currency: 'BTC' },
    native_amount: { amount: '1000.00', currency: 'USD' },
    created_at: args.createdAt,
    resource: 'transaction',
    resource_path: `/v2/accounts/cb-uuid/transactions/${args.id}`,
  }
}

function makeKrakenLedgerEntry(args: { refid: string; time: number; amount: string; fee?: string }): JsonValue {
  return {
    refid: args.refid,
    time: args.time,
    type: 'deposit',
    aclass: 'currency',
    asset: 'XXBT',
    amount: args.amount,
    fee: args.fee ?? '0.0000',
    balance: args.amount,
  }
}

it('caches and deduplicates Coinbase and Kraken history, and refetches after the 10 minute TTL', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const baseTime = Date.parse('2026-06-01T12:00:00.000Z')
  vi.setSystemTime(baseTime)

  const { db, service } = await setup()
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const nowIso = new Date(baseTime).toISOString()

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-cache',
      provider: 'coinbase',
      displayName: 'Coinbase Cache',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-key', secretKey: 'cb-sec' }),
      externalAccountId: 'cb-uuid-cache',
      balanceSats: '10000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
    {
      id: 'kr-cache',
      provider: 'kraken',
      displayName: 'Kraken Cache',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-key', secretKey: krakenSecret }),
      externalAccountId: 'KR-CACHE-1',
      balanceSats: '20000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
  ])

  let cbFetches = 0
  let krFetches = 0
  let markCbStarted: (() => void) | undefined
  const cbStarted = new Promise<void>((resolve) => {
    markCbStarted = resolve
  })
  let markKrStarted: (() => void) | undefined
  const krStarted = new Promise<void>((resolve) => {
    markKrStarted = resolve
  })
  let releaseCb: (() => void) | undefined
  const cbGate = new Promise<void>((resolve) => {
    releaseCb = resolve
  })
  let releaseKr: (() => void) | undefined
  const krGate = new Promise<void>((resolve) => {
    releaseKr = resolve
  })

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/v2/accounts/cb-uuid-cache/transactions')) {
        cbFetches += 1
        if (cbFetches === 1) {
          markCbStarted?.()
          await cbGate
        }
        return jsonResponse({
          pagination: { next_uri: null },
          data: [makeCoinbaseTransaction({ id: 'tx-1', amountBtc: '0.1', createdAt: '2026-01-01T00:00:00.000Z' })],
        })
      }
      if (url.includes('/0/private/Ledgers')) {
        krFetches += 1
        if (krFetches === 1) {
          markKrStarted?.()
          await krGate
        }
        return jsonResponse({
          error: [],
          result: {
            count: 1,
            ledger: { L1: makeKrakenLedgerEntry({ refid: 'R1', time: 1767225600, amount: '0.2' }) },
          },
        })
      }
      return jsonResponse({}, 404)
    }),
  )

  const cbConcurrent1 = service.getCoinbaseTransactionEntries(['cb-cache'])
  const cbConcurrent2 = service.getCoinbaseTransactionEntries(['cb-cache'])
  const krConcurrent1 = service.getKrakenTransactionEntries(['kr-cache'])
  const krConcurrent2 = service.getKrakenTransactionEntries(['kr-cache'])

  await Promise.all([cbStarted, krStarted])
  expect(cbFetches).toBe(1)
  expect(krFetches).toBe(1)
  releaseCb?.()
  releaseKr?.()

  const [cb1, cb2, kr1, kr2] = await Promise.all([cbConcurrent1, cbConcurrent2, krConcurrent1, krConcurrent2])
  expect(cb1.unwrap()).toHaveLength(1)
  expect(cb2.unwrap()).toHaveLength(1)
  expect(kr1.unwrap()).toHaveLength(1)
  expect(kr2.unwrap()).toHaveLength(1)
  expect(cbFetches).toBe(1)
  expect(krFetches).toBe(1)

  // Subsequent reads within 10 minutes reuse cached entries without API calls.
  vi.setSystemTime(baseTime + 10 * 60_000)
  expect((await service.getCoinbaseTransactionEntries(['cb-cache'])).unwrap()).toHaveLength(1)
  expect((await service.getKrakenTransactionEntries(['kr-cache'])).unwrap()).toHaveLength(1)
  expect(cbFetches).toBe(1)
  expect(krFetches).toBe(1)

  // After 10 min + 1 ms, both refetch.
  vi.setSystemTime(baseTime + 10 * 60_000 + 1)
  expect((await service.getCoinbaseTransactionEntries(['cb-cache'])).unwrap()).toHaveLength(1)
  expect((await service.getKrakenTransactionEntries(['kr-cache'])).unwrap()).toHaveLength(1)
  expect(cbFetches).toBe(2)
  expect(krFetches).toBe(2)
})

it('returns Ok([]) with zero API calls when filterAccountIds is empty', async () => {
  const { db, service } = await setup()
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const nowIso = new Date().toISOString()

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-empty-filter',
      provider: 'coinbase',
      displayName: 'Coinbase',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-key', secretKey: 'cb-sec' }),
      externalAccountId: 'cb-uuid-empty',
      balanceSats: '10000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
    {
      id: 'kr-empty-filter',
      provider: 'kraken',
      displayName: 'Kraken',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-key', secretKey: krakenSecret }),
      externalAccountId: 'KR-EMPTY-1',
      balanceSats: '10000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
  ])

  const fetchMock = vi.fn(async () => jsonResponse({}, 500))
  vi.stubGlobal('fetch', fetchMock)

  expect((await service.getCoinbaseTransactionEntries([])).unwrap()).toEqual([])
  expect((await service.getKrakenTransactionEntries([])).unwrap()).toEqual([])
  expect(fetchMock).not.toHaveBeenCalled()
})

it('invalidates history cache on credential rotation, removeAccount, revocation, manual refreshBalance, and changed refreshAllBalances while keeping unchanged refreshAllBalances cached', async () => {
  const { db, service } = await setup()
  const nowIso = new Date().toISOString()

  await db.insert(exchangeAccounts).values({
    id: 'cb-inv',
    provider: 'coinbase',
    displayName: 'Coinbase Inv',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-key-1', secretKey: 'cb-sec-1' }, 'port-inv'),
    externalAccountId: 'cb-uuid-inv',
    balanceSats: '10000000',
    balanceAsOf: nowIso,
    credentialsConnectedAt: nowIso,
  })

  let txFetches = 0
  let balanceBtc = '0.1'
  let revokeBalance = false

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/v2/accounts/cb-uuid-inv/transactions')) {
        txFetches += 1
        return jsonResponse({
          pagination: { next_uri: null },
          data: [
            makeCoinbaseTransaction({ id: `tx-${txFetches}`, amountBtc: '0.1', createdAt: '2026-01-01T00:00:00.000Z' }),
          ],
        })
      }
      if (url.includes('/api/v3/brokerage/accounts/cb-uuid-inv')) {
        if (revokeBalance) {
          return jsonResponse({ error: 'unauthorized' }, 401)
        }
        return jsonResponse({
          account: makeCoinbaseAccount({
            uuid: 'cb-uuid-inv',
            name: 'BTC Wallet',
            balance: balanceBtc,
            retail_portfolio_id: 'port-inv',
          }),
        })
      }
      return jsonResponse({}, 404)
    }),
  )

  // Initial fetch populates cache.
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(1)

  // refreshAllBalances (via refreshBalanceForBatch) with unchanged balance (0.1 BTC = 10000000 sats) keeps history cache warm.
  expect((await service.refreshAllBalances()).isOk()).toBe(true)
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(1)

  // Direct refreshBalanceForBatch (used by recordAllSnapshots) with unchanged balance also keeps history cache warm.
  expect((await service.refreshBalanceForBatch({ id: 'cb-inv', exchange: 'coinbase' })).isOk()).toBe(true)
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(1)

  // refreshAllBalances (via refreshBalanceForBatch) with changed balance invalidates history cache.
  balanceBtc = '0.2'
  expect((await service.refreshAllBalances()).isOk()).toBe(true)
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(2)

  // Direct refreshBalanceForBatch with changed balance also invalidates history cache.
  balanceBtc = '0.3'
  expect((await service.refreshBalanceForBatch({ id: 'cb-inv', exchange: 'coinbase' })).isOk()).toBe(true)
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(3)

  // Manual 1-arg refreshBalance ALWAYS invalidates even when balance is unchanged.
  expect((await service.refreshBalance('cb-inv')).isOk()).toBe(true)
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(4)

  // Credential rotation changes cache key and refetches.
  const rotatedCreds = makeEncryptedApiKeyJson({ apiKey: 'cb-key-2', secretKey: 'cb-sec-2' }, 'port-inv')
  await db
    .update(exchangeAccounts)
    .set({
      encryptedCredentials: rotatedCreds,
    })
    .where(eq(exchangeAccounts.id, 'cb-inv'))
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(5)

  // Revocation invalidates history cache.
  revokeBalance = true
  const revokedRes = await service.refreshBalance('cb-inv')
  expect(revokedRes.isErr()).toBe(true)
  revokeBalance = false
  // Restore the exact pre-revocation encryptedCredentials string to confirm cache was explicitly invalidated on revocation.
  await db.update(exchangeAccounts).set({ encryptedCredentials: rotatedCreds }).where(eq(exchangeAccounts.id, 'cb-inv'))
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(6)

  // removeAccount invalidates cache.
  expect((await service.removeAccount('cb-inv')).isOk()).toBe(true)
  await db.insert(exchangeAccounts).values({
    id: 'cb-inv',
    provider: 'coinbase',
    displayName: 'Coinbase Inv',
    encryptedCredentials: rotatedCreds,
    externalAccountId: 'cb-uuid-inv',
    balanceSats: '30000000',
    balanceAsOf: nowIso,
    credentialsConnectedAt: nowIso,
  })
  expect((await service.getCoinbaseTransactionEntries(['cb-inv'])).unwrap()).toHaveLength(1)
  expect(txFetches).toBe(7)
})

it('never returns or caches partial pagination results, backs off for 30s, and serves stale-complete history if a later refresh fails mid-pagination', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  const baseTime = Date.parse('2026-06-01T12:00:00.000Z')
  vi.setSystemTime(baseTime)

  const { db, service } = await setup()
  const nowIso = new Date(baseTime).toISOString()

  await db.insert(exchangeAccounts).values({
    id: 'cb-partial',
    provider: 'coinbase',
    displayName: 'Coinbase Partial',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-key', secretKey: 'cb-sec' }),
    externalAccountId: 'cb-uuid-partial',
    balanceSats: '30000000',
    balanceAsOf: nowIso,
    credentialsConnectedAt: nowIso,
  })

  let failPage2 = true
  let page1Calls = 0
  let page2Calls = 0

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (!url.includes('/v2/accounts/cb-uuid-partial/transactions')) {
        return jsonResponse({}, 404)
      }
      if (url.includes('starting_after=tx-p1')) {
        page2Calls += 1
        if (failPage2) {
          return jsonResponse({ errors: [{ id: 'internal_server_error', message: 'boom' }] }, 500)
        }
        return jsonResponse({
          pagination: { next_uri: null },
          data: [makeCoinbaseTransaction({ id: 'tx-p2', amountBtc: '0.2', createdAt: '2026-02-01T00:00:00.000Z' })],
        })
      }
      page1Calls += 1
      return jsonResponse({
        pagination: { next_uri: '/v2/accounts/cb-uuid-partial/transactions?starting_after=tx-p1' },
        data: [makeCoinbaseTransaction({ id: 'tx-p1', amountBtc: '0.1', createdAt: '2026-01-01T00:00:00.000Z' })],
      })
    }),
  )

  // Page 1 succeeds + page 2 fails => Err(ExchangeHistoryIncompleteError), never partial entries.
  const firstFail = await service.getCoinbaseTransactionEntries(['cb-partial'])
  expect(firstFail.isErr()).toBe(true)
  expect(firstFail.unwrapErr().name).toBe('ExchangeHistoryIncompleteError')
  expect(page1Calls).toBe(1)
  expect(page2Calls).toBe(1)

  // Within 30s retry backoff => returns Err without hitting API again.
  vi.setSystemTime(baseTime + 29_999)
  const backedOff = await service.getCoinbaseTransactionEntries(['cb-partial'])
  expect(backedOff.isErr()).toBe(true)
  expect(page1Calls).toBe(1)
  expect(page2Calls).toBe(1)

  // After 30s, page 2 succeeds => returns complete 2-page history.
  failPage2 = false
  vi.setSystemTime(baseTime + 30_000)
  const complete = await service.getCoinbaseTransactionEntries(['cb-partial'])
  expect(complete.unwrap()).toHaveLength(2)
  expect(page1Calls).toBe(2)
  expect(page2Calls).toBe(2)

  // TTL expires (10 min + 1 ms) and page 2 fails again => serves previous complete 2-page history!
  failPage2 = true
  vi.setSystemTime(baseTime + 30_000 + 10 * 60_000 + 1)
  const staleFallback = await service.getCoinbaseTransactionEntries(['cb-partial'])
  expect(staleFallback.isOk()).toBe(true)
  expect(staleFallback.unwrap()).toHaveLength(2)
  expect(page1Calls).toBe(3)
  expect(page2Calls).toBe(3)

  // Within 30s backoff after stale fallback, continues serving stale-complete without hammering API.
  vi.setSystemTime(baseTime + 30_000 + 10 * 60_000 + 15_000)
  const staleBackedOff = await service.getCoinbaseTransactionEntries(['cb-partial'])
  expect(staleBackedOff.unwrap()).toHaveLength(2)
  expect(page1Calls).toBe(3)
  expect(page2Calls).toBe(3)
})

it('reuses cached Coinbase history on the very next read after backfilling a missing externalAccountId', async () => {
  const { db, service } = await setup()
  const nowIso = new Date().toISOString()

  await db.insert(exchangeAccounts).values({
    id: 'cb-backfill-cache',
    provider: 'coinbase',
    displayName: 'Coinbase Legacy',
    encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-key', secretKey: 'cb-sec' }),
    externalAccountId: null,
    balanceSats: '10000000',
    balanceAsOf: nowIso,
    credentialsConnectedAt: nowIso,
  })

  let listCalls = 0
  let txCalls = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('/api/v3/brokerage/accounts')) {
        listCalls += 1
        return jsonResponse({
          accounts: [makeCoinbaseAccount({ uuid: 'cb-uuid-discovered', name: 'BTC Wallet', balance: '0.1' })],
          has_next: false,
          cursor: '',
          size: 1,
        })
      }
      if (url.includes('/v2/accounts/cb-uuid-discovered/transactions')) {
        txCalls += 1
        return jsonResponse({
          pagination: { next_uri: null },
          data: [makeCoinbaseTransaction({ id: 'tx-1', amountBtc: '0.1', createdAt: '2026-01-01T00:00:00.000Z' })],
        })
      }
      return jsonResponse({}, 404)
    }),
  )

  expect((await service.getCoinbaseTransactionEntries(['cb-backfill-cache'])).unwrap()).toHaveLength(1)
  expect(listCalls).toBe(1)
  expect(txCalls).toBe(1)

  // Second call reads backfilled externalAccountId from DB and must still hit cache!
  expect((await service.getCoinbaseTransactionEntries(['cb-backfill-cache'])).unwrap()).toHaveLength(1)
  expect(listCalls).toBe(1)
  expect(txCalls).toBe(1)
})

it('isolates per-account history failures so healthy Coinbase and Kraken siblings still return entries', async () => {
  const { db, service } = await setup()
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const nowIso = new Date().toISOString()

  await db.insert(exchangeAccounts).values([
    {
      id: 'cb-healthy',
      provider: 'coinbase',
      displayName: 'Coinbase Healthy',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-good', secretKey: 'cb-sec' }),
      externalAccountId: 'cb-uuid-healthy',
      balanceSats: '15000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
    {
      id: 'cb-broken',
      provider: 'coinbase',
      displayName: 'Coinbase Broken',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'cb-bad', secretKey: 'cb-sec' }),
      externalAccountId: 'cb-uuid-broken',
      balanceSats: '5000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
    {
      id: 'kr-healthy',
      provider: 'kraken',
      displayName: 'Kraken Healthy',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-good', secretKey: krakenSecret }),
      externalAccountId: 'KR-HEALTHY',
      balanceSats: '25000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
    {
      id: 'kr-broken',
      provider: 'kraken',
      displayName: 'Kraken Broken',
      encryptedCredentials: makeEncryptedApiKeyJson({ apiKey: 'kr-bad', secretKey: krakenSecret }),
      externalAccountId: 'KR-BROKEN',
      balanceSats: '5000000',
      balanceAsOf: nowIso,
      credentialsConnectedAt: nowIso,
    },
  ])

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = extractUrl(input)
      if (url.includes('/v2/accounts/cb-uuid-healthy/transactions')) {
        return jsonResponse({
          pagination: { next_uri: null },
          data: [makeCoinbaseTransaction({ id: 'tx-ok', amountBtc: '0.15', createdAt: '2026-01-01T00:00:00.000Z' })],
        })
      }
      if (url.includes('/v2/accounts/cb-uuid-broken/transactions')) {
        return jsonResponse({ errors: [{ id: 'internal_server_error', message: 'boom' }] }, 500)
      }
      if (url.includes('/0/private/Ledgers')) {
        const apiKey = extractHeader(input, init, 'API-Key')
        if (apiKey === 'kr-good') {
          return jsonResponse({
            error: [],
            result: {
              count: 1,
              ledger: { L1: makeKrakenLedgerEntry({ refid: 'R-OK', time: 1767225600, amount: '0.25' }) },
            },
          })
        }
        return jsonResponse({ error: ['EService:Unavailable'] }, 503)
      }
      return jsonResponse({}, 404)
    }),
  )

  const cbMulti = await service.getCoinbaseTransactionEntries(['cb-healthy', 'cb-broken'])
  expect(cbMulti.isOk()).toBe(true)
  expect(cbMulti.unwrap()).toEqual([{ timestamp: new Date('2026-01-01T00:00:00.000Z'), value: 15_000_000n }])

  const krMulti = await service.getKrakenTransactionEntries(['kr-healthy', 'kr-broken'])
  expect(krMulti.isOk()).toBe(true)
  expect(krMulti.unwrap()).toEqual([{ timestamp: new Date(1767225600 * 1000), value: 25_000_000n }])

  // Single-account requests for a failing account still return Err.
  expect((await service.getCoinbaseTransactionEntries(['cb-broken'])).isErr()).toBe(true)
  expect((await service.getKrakenTransactionEntries(['kr-broken'])).isErr()).toBe(true)
})
