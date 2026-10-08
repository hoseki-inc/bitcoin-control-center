import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import Decimal from 'decimal.js'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from './db/drizzle'
import { etfHoldings, exchangeAccounts, statements as statementTable } from './db/schema'
import { Encrypted, initEncryption } from './lib/encrypted'
import { EtfService } from './modules/etf/service'
import { ExchangeService } from './modules/exchange/service'
import { DailyRatesService } from './modules/price/daily_rates'
import { StatementService } from './modules/statements/service'

const logger = pino({ level: 'silent' })
let directory: string
let database: SentinelDb

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  directory = mkdtempSync(join(tmpdir(), 'sentinel-persisted-data-'))
  database = await openDrizzleDatabase(directory, logger)
  initEncryption('11'.repeat(32))

  await run()
}

async function accountWithCredentials(credentials: string) {
  await database.insert(exchangeAccounts).values({
    id: 'exchange',
    provider: 'kraken',
    displayName: 'Test account',
    encryptedCredentials: credentials,
    balanceSats: '100',
    createdAt: new Date().toISOString(),
  })
  return new ExchangeService({ db: database, logger }).listAccounts()
}

describe('stored exchange credentials', () => {
  it('keeps valid decryptable credentials connected', async () => {
    await withTestSetup(async () => {
      const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
      const accounts = await accountWithCredentials(JSON.stringify({ type: 'apiKey', data: { key: { blob } } }))
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
      await expect(accountWithCredentials(credentials)).resolves.toEqual([
        expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null, balanceAsOf: null }),
      ])
      const service = new ExchangeService({ db: database, logger })
      expect((await service.refreshBalance('exchange')).isErr()).toBe(true)
      expect((await service.getKrakenTransactionEntries()).unwrap()).toEqual([])
      await database.update(exchangeAccounts).set({ provider: 'coinbase' }).where(eq(exchangeAccounts.id, 'exchange'))
      expect((await service.getCoinbaseTransactionEntries()).unwrap()).toEqual([])
    })
  })

  it('rejects an unsupported credential type even when its blobs decrypt', async () => {
    await withTestSetup(async () => {
      const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
      await expect(accountWithCredentials(JSON.stringify({ type: 'oauth', data: { key: { blob } } }))).resolves.toEqual(
        [expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null })],
      )
    })
  })
})

describe('stored ETF tickers', () => {
  it.each(['UNKNOWN', 'toString'])('preserves supported holdings when a stored ticker is %s', async (ticker) => {
    await withTestSetup(async () => {
      const service = new EtfService({ db: database, logger })
      const account = (
        await service.createAccount({ displayName: 'Test ETF', holdings: [{ ticker: 'IBIT', shares: '10' }] })
      ).expect('Test ETF account should be created')
      const expectedBalance = await service.computeAccountBalance(account.id)
      expect(expectedBalance).toBeGreaterThan(0n)
      await database
        .insert(etfHoldings)
        .values({ id: 'unsupported', accountId: account.id, ticker, shares: '20', datePurchased: '2020-01-01' })

      await expect(service.computeAccountBalance(account.id)).resolves.toBe(expectedBalance)
      await expect(service.getAccumulationEntries([account.id])).resolves.toContainEqual({
        timestamp: new Date('2020-01-01'),
        value: 0n,
      })
    })
  })
})

describe('stored statement data', () => {
  function service(): StatementService {
    return new StatementService({
      db: database,
      logger,
      mempoolApiUrl: 'https://example.invalid',
      onchainProvider: new ElectrumProvider(Network.Mainnet, {
        logger,
        electrum: new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' }),
      }),
      dailyRatesService: new DailyRatesService({ db: database, logger, mempoolApiUrl: 'https://example.invalid' }),
      exchangeService: new ExchangeService({ db: database, logger }),
    })
  }

  it('assigns consecutive counters atomically and continues from the stored maximum', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const input = { claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' }
      await Promise.all([statements.create(input), statements.create(input), statements.create(input)])
      await expect(
        database.select({ counter: statementTable.counter }).from(statementTable).orderBy(statementTable.counter),
      ).resolves.toEqual([{ counter: 1 }, { counter: 2 }, { counter: 3 }])
      await database.update(statementTable).set({ counter: 10 }).where(eq(statementTable.counter, 3))
      const next = (await statements.create(input)).expect('pending statement')
      await expect(statements.findById(next)).resolves.toMatchObject({ counter: 11 })
    })
  })

  it('round-trips transaction amounts, dates, rates and additional stored fields', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const id = (
        await statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      ).expect('pending statement')
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
        quoteCurrency: 'USD' as const,
        rates: { '2024-01-02': { timestamp: date, open: price, high: price, low: price, close: price } },
      }
      expect((await statements.complete(id, transactions, dailyRates)).isOk()).toBe(true)
      const loaded = await statements.loadCompleted(id)
      expect(loaded?.transactionMap).toEqual(transactions)
      expect(loaded?.dailyRates).toEqual(dailyRates)
      expect((await statements.findById(id))?.status).toBe('completed')
    })
  })

  it('loads completed statements stored with display names as keys', async () => {
    await withTestSetup(async () => {
      const statements = service()
      const date = new Date('2024-01-02T00:00:00Z')
      const id = (
        await statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      ).expect('pending statement')
      await database
        .update(statementTable)
        .set({
          status: 'completed',
          dailyRates: JSON.stringify({ rates: {}, source: 'mempool' }),
          transactionMap: JSON.stringify({
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
        })
        .where(eq(statementTable.id, id))

      expect((await statements.loadCompleted(id))?.transactionMap).toEqual({
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
      const id = (
        await statements.create({ claimIds: [], openingDate: date, closingDate: date, timezone: 'UTC' })
      ).expect('pending statement')
      await database
        .update(statementTable)
        .set({
          status: 'completed',
          dailyRates: JSON.stringify({ rates: {}, source: 'mempool' }),
          transactionMap: '{"wallet":[null]}',
        })
        .where(eq(statementTable.id, id))
      await expect(statements.loadCompleted(id)).rejects.toThrow('Stored statement transactions are invalid')
    })
  })
})
