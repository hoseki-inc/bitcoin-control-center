import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import type { CustomPdfStatement } from '@hoseki/packages/schemas'
import { Wallets } from '@hoseki/packages/testing'
import Decimal from 'decimal.js'
import pino, { type Logger } from 'pino'
import { expect, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { accounts, exchangeAccounts, exchangeBalanceSnapshots } from '../../db/schema'
import { Encrypted, initEncryption } from '../../lib/encrypted'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { StatementMapper } from './mapper'
import { type GenerateStatementInput, StatementService } from './service'

const openingDate = new Date('2024-01-01T00:00:00.000Z')
const closingDate = new Date('2024-01-31T23:59:59.999Z')
const transactionDate = new Date('2024-01-02T12:00:00.000Z')
const period = { openingDate, closingDate, timezone: 'UTC' }
const transactionStatus = { confirmed: true, block_height: 800000, block_time: transactionDate.getTime() / 1000 }
const mempoolApiUrl = 'https://example.invalid'

interface StatementScenario {
  service: StatementService
  input: GenerateStatementInput
}

function createWallet(account: SingleSigAccount, index: number) {
  return {
    id: `wallet-${index}`,
    account,
    address: account.receiveAddress(0, Network.Mainnet),
    txid: (index + 1).toString().repeat(64),
    value: (index + 1) * 100_000_000,
  }
}

type WalletFixture = ReturnType<typeof createWallet>

const savingsWallet = createWallet(Wallets.singlesigNativeSegwitAccount, 0)
const spendingWallet = createWallet(Wallets.singlesigNestedSegwitAccount, 1)
const wallets = [savingsWallet, spendingWallet]

async function createStatementDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-statement-regression-'))
  // Kept so tests can check what generation logs.
  const logs: string[] = []
  const logger = pino(
    { level: 'info' },
    {
      write: (line: string) => {
        logs.push(line)
      },
    },
  )
  const database = await openDrizzleDatabase(directory, logger)

  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })

    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  return { db: database, logger, logs }
}

function mockOnchainProvider(logger: Logger, emptySavingsHistory = false) {
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => {
      const wallet = wallets.find(
        (item) => addressToScripthash(item.address).expect('Fixture address must be valid') === scripthash,
      )
      if (wallet === undefined) {
        expect.fail('History request must target a fixture wallet')
      }
      if (emptySavingsHistory && wallet.id === savingsWallet.id) {
        return Ok([])
      }
      return Ok([{ tx_hash: wallet.txid, height: 800000 }])
    }),
  )

  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: -1 })),
  )
  vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(
    asyncFn(async () => Ok({ height: 900000, hash: 'tip', timestamp: closingDate })),
  )

  return onchainProvider
}

function depositResponse(wallet: WalletFixture): Response {
  return Response.json({
    txid: wallet.txid,
    vin: [{ prevout: null }],
    vout: [{ scriptpubkey_address: wallet.address.toString(), value: wallet.value }],
    status: transactionStatus,
  })
}

function mockTransactionRequests(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const wallet = wallets.find((item) => url.endsWith(item.txid))
      if (wallet === undefined) {
        expect.fail('Transaction request must target a fixture transaction')
      }
      return depositResponse(wallet)
    }),
  )
}

function mockDailyRates(db: SentinelDb, logger: Logger): DailyRatesService {
  const service = new DailyRatesService({ db, logger, mempoolApiUrl, downloadRetryDelaysMs: [1, 1, 1, 1] })
  const rate = new Decimal(40_000)
  const rates = Object.fromEntries(
    [openingDate, transactionDate, closingDate].map((date) => [
      date.toISOString().slice(0, 10),
      { timestamp: date, open: rate, high: rate, low: rate, close: rate },
    ]),
  )

  vi.spyOn(service, 'getDailyRates').mockImplementation(
    asyncFn(async () => Ok({ source: 'mempool' as const, quoteCurrency: 'USD' as const, rates })),
  )

  return service
}

async function createStatementHarness(emptySavingsHistory = false, sourceSelectable = false) {
  const { db, logger, logs } = await createStatementDatabase()
  const onchainProvider = mockOnchainProvider(logger, emptySavingsHistory)
  mockTransactionRequests()

  const exchangeService = new ExchangeService({ db, logger })
  const dailyRatesService = mockDailyRates(db, logger)
  const service = new StatementService({
    db,
    logger,
    onchainProvider,
    mempoolApiUrl,
    dailyRatesService,
    exchangeService,
    sourceSelectable,
    // Retries happen without real waits.
    sleep: async () => {},
  })

  return { service, db, exchangeService, onchainProvider, dailyRatesService, logs }
}

async function seedWallet(db: SentinelDb, wallet: WalletFixture, displayName: string): Promise<string> {
  await db
    .insert(accounts)
    .values({ id: wallet.id, descriptor: wallet.account.toString(), displayName, status: 'verified' })

  return wallet.id
}

async function seedExchange(
  db: SentinelDb,
  id: string,
  balance: string,
  displayName: string,
  provider: 'strike' | 'coinbase' = 'strike',
): Promise<string> {
  initEncryption('11'.repeat(32))
  const blob = Encrypted.encrypt('synthetic-test-key').expect('Synthetic credential must encrypt').blob
  const credentials = JSON.stringify({ type: 'apiKey', data: { key: { blob } } })

  await db.insert(exchangeAccounts).values({ id, provider, displayName, encryptedCredentials: credentials })
  await db
    .insert(exchangeBalanceSnapshots)
    .values({ accountId: id, timestamp: transactionDate.toISOString(), balanceSats: balance })

  return id
}

interface WalletScenario extends StatementScenario {
  db: SentinelDb
  onchainProvider: ElectrumProvider
  dailyRatesService: DailyRatesService
  logs: string[]
}

async function setupNamedWallets(
  firstName: string,
  secondName: string,
  sourceSelectable = false,
): Promise<WalletScenario> {
  const { service, db, onchainProvider, dailyRatesService, logs } = await createStatementHarness(
    false,
    sourceSelectable,
  )
  const claimIds = [await seedWallet(db, savingsWallet, firstName), await seedWallet(db, spendingWallet, secondName)]

  return { service, db, onchainProvider, dailyRatesService, logs, input: { ...period, claimIds } }
}

export async function setupDistinctWalletNames(): Promise<WalletScenario> {
  return setupNamedWallets('Savings', 'Spending')
}

/** Two wallets on desktop, where Settings can choose Electrum for statement lookups. */
export async function setupDesktopWallets(): Promise<WalletScenario> {
  return setupNamedWallets('Savings', 'Spending', true)
}

export async function setupDuplicateWalletNames(): Promise<StatementScenario> {
  return setupNamedWallets('Savings', 'Savings')
}

export async function setupEmptyNamedWallet(): Promise<StatementScenario> {
  const { service, db } = await createStatementHarness(true)
  const claimIds = [await seedWallet(db, savingsWallet, 'Savings'), await seedWallet(db, spendingWallet, 'Savings')]

  return { service, input: { ...period, claimIds } }
}

export async function setupWalletAndExchangeWithSameName(): Promise<StatementScenario> {
  const { service, db } = await createStatementHarness()
  const claimIds = [await seedWallet(db, savingsWallet, 'Strike')]
  const exchangeAccountIds = [await seedExchange(db, 'exchange-a', '200000000', 'Strike')]

  return { service, input: { ...period, claimIds, exchangeAccountIds } }
}

export async function setupTwoExchangeAccounts(): Promise<StatementScenario> {
  const { service, db } = await createStatementHarness()
  const exchangeAccountIds = [
    await seedExchange(db, 'exchange-a', '100000000', 'Savings'),
    await seedExchange(db, 'exchange-b', '200000000', 'Trading'),
  ]

  return { service, input: { ...period, claimIds: [], exchangeAccountIds } }
}

export async function setupTwoCoinbaseAccounts(): Promise<StatementScenario> {
  const { service, db, exchangeService } = await createStatementHarness()
  const exchangeAccountIds = [
    await seedExchange(db, 'coinbase-a', '100000000', 'Savings', 'coinbase'),
    await seedExchange(db, 'coinbase-b', '200000000', 'Trading', 'coinbase'),
  ]
  vi.spyOn(exchangeService, 'getCoinbaseTransactionEntries').mockImplementation(
    asyncFn(async (ids) => {
      if (ids?.length !== 1) {
        expect.fail('Coinbase history must be fetched separately for each account')
      }
      return Ok([{ timestamp: transactionDate, value: ids[0] === 'coinbase-a' ? 100_000_000n : 200_000_000n }])
    }),
  )

  return { service, input: { ...period, claimIds: [], exchangeAccountIds } }
}

export async function generateStatementPdf({ service, input }: StatementScenario): Promise<CustomPdfStatement> {
  const data = (await service.generateStatementData(input)).expect('Complete history must generate a statement')

  const statement = new StatementMapper()
    .toPdfStatement(
      {
        ...data,
        ...input,
        id: 'statement-test',
        createdAt: closingDate,
        status: 'completed',
        counter: 1,
        user: { email: null, name: null, address: null },
      },
      'custom',
    )
    .expect('Generated data must map to a PDF statement')
  if (statement.format === 'custom') {
    return statement
  }

  return expect.unreachable('Generated statement must use the custom format')
}
