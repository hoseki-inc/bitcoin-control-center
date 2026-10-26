import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { eq, sql } from 'drizzle-orm'
import pino, { type Logger } from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AppContext } from '../../context'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { statements } from '../../db/schema'
import { AuthService } from '../auth/service'
import { ControlCenterService } from '../control_center/service'
import { EtfService } from '../etf/service'
import { ExchangeService } from '../exchange/service'
import { ManualService } from '../manual/service'
import { DailyRatesService } from '../price/daily_rates'
import { PriceHistoryService } from '../price/history'
import { PriceService } from '../price/service'
import { appRouter } from '../trpc/router'
import { WalletBalanceService } from '../wallet_balances/service'
import type { AggregatedTransaction } from './mapper'
import { StatementMapper } from './mapper'
import { PriceLoadError, getRequiredRateDates, getStatementPeriods } from './rate_dates'
import { type GenerateStatementInput, StatementService, validateStatementInput } from './service'
import { TransactionLoadError } from './sources/types'

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
    vi.fn().mockImplementation(async (url: string) => {
      const timestamp = new URL(url).searchParams.get('timestamp')
      // Without a timestamp, the full history: one price a day up to now.
      const times =
        timestamp === null
          ? Array.from({ length: 1300 }, (_, i) => Math.floor(Date.now() / 86_400_000 - i) * 86_400)
          : [Number(timestamp)]
      return Response.json({
        prices: times.map((time) => ({ time, USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 })),
      })
    }),
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

  it('gives a failed statement a short message when there is no specific reason', async () => {
    await setup()
    const { service } = harness()
    const id = (await service.create(input)).unwrap()

    await service.fail(id)

    await expect(service.findById(id)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Statement generation failed.',
    })
  })

  it('fails statements left generating by a previous run and leaves finished ones alone', async () => {
    await setup()
    const { service } = harness()
    const interrupted = (await service.create(input)).unwrap()
    const failed = (await service.create(input)).unwrap()
    await service.fail(failed, 'Original failure')

    await expect(service.failInterrupted()).resolves.toBe(1)

    await expect(service.findById(interrupted)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Generation was interrupted.',
    })
    await expect(service.findById(failed)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: 'Original failure',
    })
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
    // One download of the full history serves every day the statement needs.
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('statement input validation', () => {
  const now = new Date('2026-09-08T12:00:00Z')
  it('accepts a timezone Intl.supportedValuesOf omits', () => {
    expect(validateStatementInput({ ...input, timezone: 'Asia/Kolkata' }, now).isOk()).toBe(true)
  })

  it('rejects an unknown timezone', () => {
    expect(validateStatementInput({ ...input, timezone: 'Not/AZone' }, now).unwrapErr().message).toBe(
      'Invalid statement timezone.',
    )
  })

  it('rejects a statement starting before prices are available', () => {
    const openingDate = new Date('2023-03-31T00:00:00Z')
    expect(validateStatementInput({ ...input, openingDate }, now).unwrapErr().message).toBe(
      'Statements must start on or after April 1, 2023.',
    )
  })
})

function statementCaller(service: StatementService, appLogger: Logger = logger) {
  const electrumConfig = { host: 'example.invalid', port: 50001, protocol: 'tcp' as const }
  const electrumClient = new ElectrumClient(electrumConfig)
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum: electrumClient })
  const deps = { db: database, logger }
  const exchangeService = new ExchangeService(deps)
  const manualService = new ManualService(deps)
  const etfService = new EtfService(deps)
  const priceService = new PriceService({
    logger,
    mempoolApiUrl: 'https://example.invalid',
    settings: () => ({ source: undefined, fallbacks: false }),
  })
  const walletBalanceService = new WalletBalanceService({ ...deps, onchainProvider })
  const app: AppContext = {
    env: {
      HOST: 'localhost',
      PORT: 3400,
      ELECTRUM_HOST: electrumConfig.host,
      ELECTRUM_PORT: electrumConfig.port,
      ELECTRUM_PROTOCOL: electrumConfig.protocol,
      BITCOIN_NETWORK: 'mainnet',
      DATA_DIR: directory,
      APP_DIR: directory,
      MEMPOOL_API_URL: 'https://example.invalid',
      LOG_LEVEL: 'error',
    },
    logger: appLogger,
    database,
    auth: new AuthService(database, appLogger, null),
    electrumClient,
    electrumConfig,
    onchainProvider,
    exchangeService,
    manualService,
    etfService,
    priceService,
    priceHistoryService: new PriceHistoryService({
      dailyRatesService: new DailyRatesService({ db: database, logger, mempoolApiUrl: 'https://example.invalid' }),
      priceService,
    }),
    network: Network.Mainnet,
    controlCenterService: new ControlCenterService({
      ...deps,
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      priceService,
      walletBalances: walletBalanceService,
    }),
    walletBalanceService,
    statementService: service,
    reconnectElectrum: async () => Ok(undefined),
    stopElectrum: () => {
      electrumClient.disconnect()
    },
    prepareElectrumConfig: (config) => Ok(config),
    getTorStatus: () => ({ state: 'unavailable' }),
    startTor: () => ({ state: 'unavailable' }),
    connectionProfiles: undefined,
    connectProfile: async () => Ok(undefined),
  }
  return appRouter.createCaller({ app }).portalProve.statement
}

describe('statement API currency contract', () => {
  function caller() {
    const { service, quotes } = harness()
    vi.spyOn(service, 'generateStatementData').mockImplementation(
      asyncFn(async (args) => {
        const dailyRates = (
          await quotes.getDailyRates(
            args.openingDate,
            args.closingDate,
            args.quoteCurrency,
            getRequiredRateDates(args.openingDate, args.closingDate, args.timezone, transactions),
          )
        ).unwrap()
        return Ok({ transactionMap: transactions, dailyRates })
      }),
    )
    return {
      service,
      api: statementCaller(service),
    }
  }
  it.each<StatementQuoteCurrency>(['USD', 'CAD', 'GBP', 'EUR'])(
    'generates and retrieves %s through the API',
    async (quoteCurrency) => {
      await setup()
      const { service, api } = caller()
      const args = { ...input, quoteCurrency }
      const created = await api.initiateGeneration(args)
      await vi.waitFor(async () => {
        await expect(service.findById(created.id)).resolves.toMatchObject({ status: 'completed' })
      })
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
      for (const format of ['custom', 'monthly'] as const) {
        const document = await api.retrieveDocumentData({ statementId: created.id, format })
        expect(document.quoteCurrency).toBe(quoteCurrency)
        const summary = document.format === 'custom' ? document.summary : document.months[0]?.summary
        if (!summary) {
          expect.fail('Expected a monthly summary')
        }
        const price = { USD: 60000, CAD: 81000, GBP: 47000, EUR: 55000 }[quoteCurrency]
        expect(summary.closingBalance.quoteValue.toNumber()).toBe(price * 0.9)
        expect(summary.closingBalance.rate.toNumber()).toBe(price)
      }
      expect(fetch).not.toHaveBeenCalled()
    },
  )
  it('defaults omitted currency to USD and rejects unsupported codes before creating a row', async () => {
    await setup()
    const { service, api } = caller()
    const invalid = { ...input, quoteCurrency: 'JPY' }
    // @ts-expect-error Deliberately send an unsupported currency to exercise API input validation.
    await expect(api.initiateGeneration(invalid)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(service.list()).resolves.toHaveLength(0)
    const created = await api.initiateGeneration(input)
    expect(created.quoteCurrency).toBe('USD')
    await vi.waitFor(async () => {
      await expect(service.findById(created.id)).resolves.toMatchObject({ status: 'completed' })
    })
  })
})

describe('statement failure messages', () => {
  it.each([
    {
      scenario: 'a transaction that could not be loaded',
      error: new TransactionLoadError('unavailable', `Failed to fetch transaction ${'a'.repeat(64)}: HTTP 404`),
      message: "Couldn't load all transactions.",
      logged: '"kind":"unavailable"',
    },
    {
      scenario: 'prices that could not be confirmed',
      error: new PriceLoadError('unavailable'),
      message: "Couldn't get Bitcoin prices for this statement. Check your connection and try again.",
      logged: '"kind":"unavailable"',
    },
    {
      scenario: 'any other failure',
      error: new Error('Account "Savings" must be verified before generating a statement'),
      message: 'Account "Savings" must be verified before generating a statement',
      logged: 'must be verified',
    },
  ])('shows $message for $scenario', async ({ error, message, logged }) => {
    await setup()
    const { service } = harness()
    vi.spyOn(service, 'generateStatementData').mockImplementation(asyncFn(async () => Err(error)))

    const { log, lines } = capturedLogger()
    const created = await statementCaller(service, log).initiateGeneration(input)

    await vi.waitFor(async () => {
      await expect(service.findById(created.id)).resolves.toMatchObject({ status: 'failed', errorMessage: message })
    })
    // The statement's id is what generation reports its progress against.
    expect(service.generateStatementData).toHaveBeenCalledWith(expect.anything(), created.id)
    expect(lines.join('')).toContain('Statement data generation failed')
    // A transaction failure logs only its kind, since its message can name a txid.
    expect(lines.join('')).toContain(logged)
    expect(lines.join('')).not.toContain('a'.repeat(64))
  })

  it('logs a statement that could not be saved', async () => {
    await setup()
    const { service, quotes } = harness()
    // Rates in another currency than the statement's, which saving refuses.
    vi.spyOn(service, 'generateStatementData').mockImplementation(
      asyncFn(async (args) => {
        const dailyRates = (
          await quotes.getDailyRates(
            args.openingDate,
            args.closingDate,
            'CAD',
            getRequiredRateDates(args.openingDate, args.closingDate, args.timezone, transactions),
          )
        ).unwrap()
        return Ok({ transactionMap: transactions, dailyRates })
      }),
    )
    const { log, lines } = capturedLogger()

    const created = await statementCaller(service, log).initiateGeneration(input)

    await vi.waitFor(async () => {
      await expect(service.findById(created.id)).resolves.toMatchObject({
        status: 'failed',
        errorMessage: 'Statement quote currency does not match its saved rates.',
      })
    })
    expect(lines.join('')).toContain('Statement could not be completed')
  })

  interface CapturedLog {
    log: Logger
    lines: string[]
  }

  function capturedLogger(): CapturedLog {
    const lines: string[] = []
    const log = pino(
      { level: 'info' },
      {
        write: (line: string) => {
          lines.push(line)
        },
      },
    )
    return { log, lines }
  }

  it('keeps an unexpected error message, which can hold query parameters, out of the logs', async () => {
    await setup()
    const { service } = harness()
    const { log, lines } = capturedLogger()
    // How a database error reports the values it was saving.
    const queryError = new Error('Failed query: update "statements" set ...\nparams: bc1qsecretaddress,deadbeeftxid')
    vi.spyOn(service, 'generateStatementData').mockImplementation(() => {
      throw queryError
    })

    const created = await statementCaller(service, log).initiateGeneration(input)

    await vi.waitFor(async () => {
      await expect(service.findById(created.id)).resolves.toMatchObject({ status: 'failed' })
    })
    const logged = lines.join('')
    expect(logged).toContain('Unhandled error in statement generation')
    expect(logged).not.toContain('bc1qsecretaddress')
    expect(logged).not.toContain('deadbeeftxid')
  })

  it('logs the error even when marking the statement failed fails too', async () => {
    await setup()
    const { service } = harness()
    const { log, lines } = capturedLogger()
    vi.spyOn(service, 'generateStatementData').mockImplementation(() => {
      throw new Error('Disk full')
    })
    vi.spyOn(service, 'fail').mockRejectedValue(
      new Error('Failed query: update "statements" set ...\nparams: bc1qsecretaddress'),
    )

    await statementCaller(service, log).initiateGeneration(input)

    await vi.waitFor(() => {
      expect(lines.join('')).toContain('Could not mark the statement as failed')
    })
    expect(lines.join('')).toContain('Unhandled error in statement generation')
    expect(lines.join('')).not.toContain('bc1qsecretaddress')
  })
})

it('persists mixed provider attribution and exposes it in both PDF formats after reopening', async () => {
  await setup()
  let { service, quotes } = harness()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async (urlString: string) => {
      // Daily prices from both sources, but the local one has CAD only until the opening date.
      const local = new URL(urlString).origin === 'http://local-mempool.test'
      const prices = []
      for (let time = opening.getTime() / 1000 - 10 * 86_400; time * 1000 <= Date.now(); time += 86_400) {
        const cad = local && time > opening.getTime() / 1000 ? -1 : 81000
        prices.push({ time, USD: 60000, CAD: cad, GBP: 47000, EUR: 55000 })
      }
      return Response.json({ prices })
    }),
  )
  const id = (await service.create({ ...input, quoteCurrency: 'CAD' })).unwrap()
  const dailyRates = (
    await quotes.getDailyRates(opening, closing, 'CAD', getRequiredRateDates(opening, closing, 'UTC', transactions))
  ).unwrap()
  expect((await service.complete(id, transactions, dailyRates)).isOk()).toBe(true)
  database.$client.close()
  database = await openDrizzleDatabase(directory, logger)
  service = harness().service
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  const loaded = await service.loadCompleted(id)
  if (!loaded) {
    expect.fail('Expected a completed statement')
  }
  expect(loaded.dailyRates).toEqual(dailyRates)
  const api = statementCaller(service)
  for (const format of ['custom', 'monthly'] as const) {
    const pdf = await api.retrieveDocumentData({ statementId: id, format })
    expect(pdf.quoteProviderUrls).toEqual(['http://local-mempool.test', 'https://mempool.space'])
    const summary = pdf.format === 'custom' ? pdf.summary : pdf.months[0]?.summary
    if (!summary) {
      expect.fail('Expected a monthly summary')
    }
    expect(summary.openingBalance.providerUrl).toBe('http://local-mempool.test')
    expect(summary.closingBalance.providerUrl).toBe('https://mempool.space')
  }
  expect(fetch).not.toHaveBeenCalled()
})
