import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import Decimal from 'decimal.js'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { type SentinelDatabase, initDatabase } from './db'
import { Encrypted, initEncryption } from './lib/encrypted'
import { EtfService } from './modules/etf/service'
import { ExchangeService } from './modules/exchange/service'
import { DailyRatesService } from './modules/price/daily_rates'
import { StatementService } from './modules/statements/service'

const logger = pino({ level: 'silent' })
let directory: string
let database: SentinelDatabase

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  directory = mkdtempSync(join(tmpdir(), 'sentinel-persisted-data-'))
  database = initDatabase(directory, logger)
  initEncryption('11'.repeat(32))

  await run()
}

function accountWithCredentials(credentials: string) {
  database.db
    .prepare(
      'INSERT INTO exchange_accounts (id, provider, display_name, encrypted_credentials, balance_sats, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('exchange', 'kraken', 'Test account', credentials, '100', new Date().toISOString())
  return new ExchangeService({ db: database.db, logger }).listAccounts()
}

describe('stored exchange credentials', () => {
  it('keeps valid decryptable credentials connected', async () => {
    await withTestSetup(async () => {
      const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
      const accounts = accountWithCredentials(JSON.stringify({ type: 'apiKey', data: { key: { blob } } }))
      expect(accounts).toEqual([expect.objectContaining({ connectionStatus: 'connected', balanceSats: '100' })])
    })
  })

  it.each([
    ['invalid JSON', '{'],
    ['null', 'null'],
    ['unsupported credential type', JSON.stringify({ type: 'oauth', data: {} })],
    ['missing credential data', JSON.stringify({ type: 'apiKey' })],
    ['empty credential data', JSON.stringify({ type: 'apiKey', data: {} })],
    ['non-object credential data', JSON.stringify({ type: 'apiKey', data: 'invalid' })],
    ['missing blob', JSON.stringify({ type: 'apiKey', data: { key: {} } })],
    ['non-string blob', JSON.stringify({ type: 'apiKey', data: { key: { blob: 42 } } })],
    ['malformed ciphertext', JSON.stringify({ type: 'apiKey', data: { key: { blob: 'invalid' } } })],
  ])('requires reconnection for %s without exposing a stale balance', async (_label, credentials) => {
    await withTestSetup(async () => {
      expect(accountWithCredentials(credentials)).toEqual([
        expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null, balanceAsOf: null }),
      ])
      const service = new ExchangeService({ db: database.db, logger })
      expect((await service.refreshBalance('exchange')).isErr()).toBe(true)
      expect((await service.getKrakenTransactionEntries()).unwrap()).toEqual([])
      database.db.prepare('UPDATE exchange_accounts SET provider = ? WHERE id = ?').run('coinbase', 'exchange')
      expect((await service.getCoinbaseTransactionEntries()).unwrap()).toEqual([])
    })
  })

  it('rejects an unsupported credential type even when its blobs decrypt', async () => {
    await withTestSetup(async () => {
      const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
      expect(accountWithCredentials(JSON.stringify({ type: 'oauth', data: { key: { blob } } }))).toEqual([
        expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null }),
      ])
    })
  })
})

describe('stored ETF tickers', () => {
  it.each(['UNKNOWN', 'toString'])('preserves supported holdings when a stored ticker is %s', async (ticker) => {
    await withTestSetup(async () => {
      const service = new EtfService({ db: database.db, logger })
      const account = service
        .createAccount({ displayName: 'Test ETF', holdings: [{ ticker: 'IBIT', shares: '10' }] })
        .expect('Test ETF account should be created')
      const expectedBalance = service.computeAccountBalance(account.id)
      expect(expectedBalance).toBeGreaterThan(0n)
      database.db
        .prepare('INSERT INTO etf_holdings (id, account_id, ticker, shares, date_purchased) VALUES (?, ?, ?, ?, ?)')
        .run('unsupported', account.id, ticker, '20', '2020-01-01')

      expect(service.computeAccountBalance(account.id)).toBe(expectedBalance)
      expect(service.getAccumulationEntries([account.id])).toContainEqual({
        timestamp: new Date('2020-01-01'),
        value: 0n,
      })
    })
  })
})

describe('stored statement data', () => {
  function service(): StatementService {
    return new StatementService({
      db: database.db,
      logger,
      mempoolApiUrl: 'https://example.invalid',
      onchainProvider: new ElectrumProvider(Network.Mainnet, {
        logger,
        electrum: new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' }),
      }),
      dailyRatesService: new DailyRatesService({ logger, mempoolApiUrl: 'https://example.invalid' }),
      exchangeService: new ExchangeService({ db: database.db, logger }),
    })
  }

  it('round-trips transaction amounts, dates, rates and additional stored fields', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const id = statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      const transactions = {
        wallet: {
          displayName: 'Test wallet',
          transactions: [
            {
              address: 'synthetic-address',
              hash: 'synthetic-hash',
              balanceChange: -9007199254740993n,
              block: null,
              transactedAt: date,
              confirmed: false,
              accountName: 'Test wallet',
              extra: 'preserved',
            },
          ],
        },
      }
      const price = new Decimal('42000.12345678')
      const dailyRates = {
        source: 'mempool' as const,
        rates: { '2024-01-02': { timestamp: date, open: price, high: price, low: price, close: price } },
      }
      statements.complete(id, transactions, dailyRates)
      const loaded = statements.loadCompleted(id)
      expect(loaded?.transactionMap).toEqual(transactions)
      expect(loaded?.dailyRates).toEqual(dailyRates)
      expect(statements.findById(id)?.status).toBe('completed')
    })
  })

  it('loads completed statements stored with display names as keys', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const id = statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      statements.complete(id, {}, { rates: {}, source: 'mempool' })
      database.db.prepare('UPDATE statements SET transaction_map = ? WHERE id = ?').run(
        JSON.stringify({
          Savings: [
            {
              address: 'synthetic-address',
              hash: 'synthetic-hash',
              balanceChange: '100000000',
              block: null,
              transactedAt: date.toISOString(),
              confirmed: true,
              accountName: 'Savings',
            },
          ],
        }),
        id,
      )

      expect(statements.loadCompleted(id)?.transactionMap).toEqual({
        Savings: {
          displayName: 'Savings',
          transactions: [
            {
              address: 'synthetic-address',
              hash: 'synthetic-hash',
              balanceChange: 100000000n,
              block: null,
              transactedAt: date,
              confirmed: true,
              accountName: 'Savings',
            },
          ],
        },
      })
    })
  })

  it('rejects malformed stored transaction shapes before restoring value types', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const id = statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      statements.complete(id, {}, { rates: {}, source: 'mempool' })
      database.db.prepare('UPDATE statements SET transaction_map = ? WHERE id = ?').run('{"wallet":[null]}', id)
      expect(() => statements.loadCompleted(id)).toThrow('Stored statement transactions are invalid')
    })
  })
})
