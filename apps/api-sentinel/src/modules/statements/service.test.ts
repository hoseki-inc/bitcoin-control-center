import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { eq, sql } from 'drizzle-orm'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { statements } from '../../db/schema'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import type { AggregatedTransaction } from './mapper'
import { StatementMapper } from './mapper'
import { getRequiredRateDates, getStatementPeriods } from './rate_dates'
import { type GenerateStatementInput, StatementService, validateStatementInput } from './service'

const logger = pino({ level: 'silent' })
const opening = new Date('2026-08-01T00:00:00Z')
const closing = new Date('2026-08-31T23:59:59Z')
const input: GenerateStatementInput = { claimIds: [], openingDate: opening, closingDate: closing, timezone: 'UTC' }
const transaction = (date: string, sats: bigint): AggregatedTransaction => ({
  address: '',
  hash: 'test',
  balanceChange: sats,
  block: 900000,
  transactedAt: new Date(date),
  confirmed: true,
  accountName: 'Wallet',
})
const transactions = {
  Wallet: {
    displayName: 'Wallet',
    transactions: [transaction('2026-07-01T12:00:00Z', 100000000n), transaction('2026-08-15T12:00:00Z', -10000000n)],
  },
}
let directory: string
let database: SentinelDb
function harness() {
  const quotes = new DailyRatesService({ db: database, logger, mempoolApiUrl: 'http://local-mempool.test' })
  return {
    quotes,
    service: new StatementService({
      db: database,
      logger,
      dailyRatesService: quotes,
      mempoolApiUrl: 'http://local-mempool.test',
      onchainProvider: new ElectrumProvider(Network.Mainnet, {
        logger,
        electrum: new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' }),
      }),
      exchangeService: new ExchangeService({ db: database, logger }),
    }),
  }
}
async function setup(): Promise<void> {
  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T12:00:00Z'))
  directory = mkdtempSync(join(tmpdir(), 'sentinel-statements-'))
  database = await openDrizzleDatabase(directory, logger)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (url: string) =>
      Response.json({
        prices: [
          {
            time: Number(new URL(url).searchParams.get('timestamp')),
            USD: 60000,
            CAD: 81000,
            GBP: 47000,
            EUR: 55000,
          },
        ],
      }),
    ),
  )
}

describe('statement currency persistence', () => {
  it.each<StatementQuoteCurrency>(['USD', 'CAD', 'GBP', 'EUR'])(
    'retains %s and its exact rates after reopening, without a network',
    async (currency) => {
      await setup()
      let { service, quotes } = harness()
      const id = (await service.create({ ...input, quoteCurrency: currency })).unwrap()
      const dates = getRequiredRateDates(opening, closing, input.timezone, transactions)
      const rates = (await quotes.getDailyRates(opening, closing, currency, dates)).unwrap()
      // Both sides of the centered window survive completion and reload unchanged.
      const first = rates.rates['2026-08-01']
      const last = rates.rates['2026-08-31']
      if (!first || !last) {
        expect.fail('Expected both boundary rates')
      }
      first.timestamp = new Date('2026-07-28T00:00:00Z')
      last.timestamp = new Date('2026-09-04T00:00:00Z')
      expect((await service.complete(id, transactions, rates)).isOk()).toBe(true)
      const saved = await service.loadCompleted(id)
      database.$client.close()
      database = await openDrizzleDatabase(directory, logger)
      service = harness().service
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      const reloaded = await service.loadCompleted(id)
      expect(reloaded).toEqual(saved)
      expect((await service.findById(id))?.quoteCurrency).toBe(currency)
      expect(reloaded?.dailyRates.providerUrl).toBe('http://local-mempool.test')
      expect(reloaded?.dailyRates.quoteCurrency).toBe(currency)
      expect(reloaded?.transactionMap['Wallet']?.transactions[1]?.balanceChange).toBe(-10000000n)
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it('migrates a legacy statement to USD without rewriting its stored quote values', async () => {
    await setup()
    const { service } = harness()
    const id = (await service.create(input)).unwrap()
    const raw = JSON.stringify({
      rates: {
        '2026-08-01': {
          timestamp: opening.toISOString(),
          open: '45678.12345',
          high: '45678.12345',
          low: '45678.12345',
          close: '45678.12345',
        },
      },
      source: 'mempool',
    })
    await database
      .update(statements)
      .set({ status: 'completed', transactionMap: '{}', dailyRates: raw })
      .where(eq(statements.id, id))
    await database.run(sql`ALTER TABLE statements DROP COLUMN quote_currency`)
    await database.run(sql`ALTER TABLE statements DROP COLUMN error_message`)
    await database.run(sql`DELETE FROM _migrations WHERE name LIKE '%_statement_quote_currency'`)
    database.$client.close()
    database = await openDrizzleDatabase(directory, logger)
    const reloaded = await harness().service.loadCompleted(id)
    expect(reloaded?.row.quoteCurrency).toBe('USD')
    expect(reloaded?.dailyRates.quoteCurrency).toBe('USD')
    expect(reloaded?.dailyRates.providerUrl).toBeUndefined()
    expect(reloaded?.dailyRates.rates['2026-08-01']?.close.toString()).toBe('45678.12345')
    await expect(
      database.select({ dailyRates: statements.dailyRates }).from(statements).where(eq(statements.id, id)),
    ).resolves.toEqual([{ dailyRates: raw }])
  })

  it('refuses completion for missing required rates or a different quote currency', async () => {
    await setup()
    const { service, quotes } = harness()
    const id = (await service.create({ ...input, quoteCurrency: 'CAD' })).unwrap()
    const dates = getRequiredRateDates(opening, closing, 'UTC', transactions)
    const rates = (await quotes.getDailyRates(opening, closing, 'CAD', dates)).unwrap()
    expect((await service.complete(id, transactions, { ...rates, quoteCurrency: 'USD' })).isErr()).toBe(true)
    delete rates.rates['2026-08-15']
    expect((await service.complete(id, transactions, rates)).isErr()).toBe(true)
    expect((await service.findById(id))?.status).toBe('pending')
    await service.fail(id, 'No usable CAD quote for 2026-08-15.')
    expect((await service.findById(id))?.errorMessage).toContain('CAD')
  })

  it('completes a statement only once under concurrent requests', async () => {
    await setup()
    const { service, quotes } = harness()
    const id = (await service.create(input)).unwrap()
    const dates = getRequiredRateDates(opening, closing, 'UTC', transactions)
    const rates = (await quotes.getDailyRates(opening, closing, 'USD', dates)).unwrap()
    const results = await Promise.all([
      service.complete(id, transactions, rates),
      service.complete(id, transactions, rates),
    ])
    expect(results.filter((result) => result.isOk())).toHaveLength(1)
    expect(results.filter((result) => result.isErr())).toHaveLength(1)
    expect((await service.findById(id))?.status).toBe('completed')
  })

  it('does not complete a statement that failed while completion was being validated', async () => {
    await setup()
    const { service, quotes } = harness()
    const id = (await service.create(input)).unwrap()
    const dates = getRequiredRateDates(opening, closing, 'UTC', transactions)
    const rates = (await quotes.getDailyRates(opening, closing, 'USD', dates)).unwrap()
    const [completed] = await Promise.all([
      service.complete(id, transactions, rates),
      service.fail(id, 'Concurrent generation failure'),
    ])
    expect(completed.isErr()).toBe(true)
    await expect(service.findById(id)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Concurrent generation failure',
    })
    await expect(service.loadCompleted(id)).resolves.toBeNull()
  })

  it('collects only transaction and custom/monthly boundary days across DST', async () => {
    await setup()
    const start = new Date('2026-01-15T05:00:00Z')
    const end = new Date('2026-03-15T04:00:00Z')
    const txs = {
      Wallet: {
        displayName: 'Wallet',
        transactions: [
          transaction('2026-01-01T12:00:00Z', 10n),
          transaction('2026-02-10T12:00:00Z', 10n),
          transaction('2026-04-01T12:00:00Z', 10n),
        ],
      },
    }
    expect(
      getRequiredRateDates(start, end, 'America/New_York', txs).map((date) => date.toISOString().slice(0, 10)),
    ).toEqual(['2026-01-15', '2026-02-01', '2026-02-10', '2026-03-01', '2026-03-15'])
    const periods = getStatementPeriods(start, end, 'America/New_York')
    expect(new Date(periods[1]?.openingDate.getTime() ?? NaN).toISOString()).toBe('2026-02-01T05:00:00.000Z')
    expect(new Date(periods[2]?.closingDate.getTime() ?? NaN).toISOString()).toBe('2026-03-15T04:00:00.000Z')
  })

  it('all collected rates suffice for both custom and monthly documents', async () => {
    await setup()
    const { quotes } = harness()
    const start = new Date('2026-01-15T05:00:00Z')
    const end = new Date('2026-03-15T04:00:00Z')
    const txs = {
      Wallet: {
        displayName: 'Wallet',
        transactions: [
          transaction('2026-01-01T12:00:00Z', 100000000n),
          transaction('2026-02-10T12:00:00Z', -10000000n),
        ],
      },
    }
    const dates = getRequiredRateDates(start, end, 'America/New_York', txs)
    const dailyRates = (await quotes.getDailyRates(start, end, 'CAD', dates)).unwrap()
    const data = {
      id: 'test',
      createdAt: new Date(),
      status: 'completed' as const,
      counter: 1,
      timezone: 'America/New_York',
      openingDate: start,
      closingDate: end,
      user: { email: null, name: null, address: null },
      transactionMap: txs,
      dailyRates,
    }
    expect(new StatementMapper().toPdfStatement(data, 'custom').isOk()).toBe(true)
    expect(new StatementMapper().toPdfStatement(data, 'monthly').isOk()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(5)
  })
})

describe('statement timezone validation', () => {
  const now = new Date('2026-09-08T12:00:00Z')
  // Browsers can report aliases and fixed offsets that Intl.supportedValuesOf omits.
  it.each(['UTC', 'Asia/Kolkata', 'Asia/Calcutta', 'Europe/Kyiv', 'America/Nuuk', 'Etc/UTC', 'Etc/GMT+8'])(
    'accepts the runtime timezone %s',
    (timezone) => {
      expect(validateStatementInput({ ...input, timezone }, now).isOk()).toBe(true)
    },
  )

  it('rejects an unknown timezone', () => {
    expect(validateStatementInput({ ...input, timezone: 'Not/AZone' }, now).unwrapErr().message).toBe(
      'Invalid statement timezone.',
    )
  })
})
