import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { parseUnknown } from '@hoseki/packages/result'
import { eq, sql } from 'drizzle-orm'
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
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = extractUrl(input)
      if (url.includes('coinbase')) {
        return jsonResponse({ error: `leak ${secretCanary}` }, 500, `status ${secretCanary}`)
      }
      return jsonResponse({ error: [`EGeneral:Internal ${secretCanary}`] }, 200)
    }),
  )
  await stubRobinhoodHttps(() => ({
    status: 500,
    body: { detail: `rh-leak ${secretCanary}` },
  }))

  const cbErr = (await service.connectCoinbase({ apiKey: 'cb-key', secretKey: 'cb-secret' })).unwrapErr()
  const krErr = (await service.connectKraken({ apiKey: 'kr-key', secretKey: krakenSecret })).unwrapErr()
  const rhErr = (
    await service.connectRobinhood({ apiKey: 'rh-key', privateKeyBase64: robinhoodPrivateKey })
  ).unwrapErr()

  for (const err of [cbErr, krErr, rhErr]) {
    expect(err.message).not.toContain(secretCanary)
  }
  expect(logs.join('\n')).not.toContain(secretCanary)
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
  expect(workingB.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  const [workingRow] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, 'kr-race-working'))
  expect(workingRow?.externalAccountId).toBe('RACE-A')
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
  const krakenSecret = Buffer.from('kraken-secret').toString('base64')
  const robinhoodPrivateKey = generateRobinhoodPrivateKeyBase64()
  const now = new Date().toISOString()

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
  await stubRobinhoodHttps(() => ({
    status: 503,
    body: { detail: `rh-refresh ${secretCanary}` },
  }))

  const errors = [
    (await service.refreshBalance('cb-canary')).unwrapErr(),
    (await service.refreshBalance('kr-canary')).unwrapErr(),
    (await service.refreshBalance('rh-canary')).unwrapErr(),
    (await service.refreshBalance('st-canary')).unwrapErr(),
    (
      await service.connectKraken({
        apiKey: 'kr-new',
        secretKey: krakenSecret,
        replaceAccountId: 'kr-canary',
      })
    ).unwrapErr(),
  ]

  for (const err of errors) {
    expect(err.message).not.toContain(secretCanary)
  }
  expect(logs.join('\n')).not.toContain(secretCanary)
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
    expect(cbEntries.isOk()).toBe(true)

    const krEntries = await service.getKrakenTransactionEntries(['kr-ledger-warn'])
    expect(krEntries.isOk()).toBe(true)

    const output = logs.join('\n')
    expect(output).toContain('Failed to list Coinbase accounts')
    expect(output).toContain('Failed to fetch Coinbase transactions')
    expect(output).toContain('Failed to fetch Kraken ledgers')
    expect(output).not.toContain(secretCanary)
  },
)
