import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { AsyncResult, Ok } from '@hoseki/packages/result'
import Decimal from 'decimal.js'
import { expect, vi } from 'vitest'
import { exchangeAccounts, exchangeBalanceSnapshots, exchangeStatementTxs } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { Encrypted, initEncryption } from '../../lib/encrypted'
import { EtfService } from '../etf/service'
import { ExchangeService } from '../exchange/service'
import { ManualService } from '../manual/service'
import { PriceService } from '../price/service'
import { ControlCenterService } from './service'

type DatabaseFixture = Awaited<ReturnType<typeof setupServiceDatabase>>

interface ExchangeHistoryScenario {
  service: ControlCenterService
  input: Parameters<ControlCenterService['getData']>[0]
}

async function seedExchange(
  db: DatabaseFixture['db'],
  provider: 'strike' | 'robinhood',
  balance: string,
): Promise<void> {
  initEncryption('22'.repeat(32))
  const blob = Encrypted.encrypt('synthetic-test-key').expect('Test credential must encrypt').blob
  const credentials = JSON.stringify({ type: 'apiKey', data: { key: { blob } } })

  await db.insert(exchangeAccounts).values({
    id: 'exchange',
    provider,
    displayName: 'Savings',
    encryptedCredentials: credentials,
    balanceSats: balance,
    credentialsConnectedAt: new Date().toISOString(),
  })
}

async function seedImportedHistory(db: DatabaseFixture['db'], amounts: string[], lateAmounts: string[]): Promise<void> {
  const imports = [
    ...amounts.map((amount, index) => ({ amount, transactedAt: `2024-01-0${index + 1}T12:00:00.000Z` })),
    // After both snapshots, where snapshots are the source of truth
    ...lateAmounts.map((amount) => ({ amount, transactedAt: '2024-01-04T18:00:00.000Z' })),
  ]
  for (const [index, { amount, transactedAt }] of imports.entries()) {
    await db.insert(exchangeStatementTxs).values({
      id: `import-${index}`,
      accountId: 'exchange',
      externalId: `external-${index}`,
      transactedAt,
      type: amount.startsWith('-') ? 'withdrawal' : 'buy',
      amountBtc: amount,
      statementMonth: '2024-01',
    })
  }
}

async function seedSnapshots(db: DatabaseFixture['db'], firstBalance: string): Promise<void> {
  await db.insert(exchangeBalanceSnapshots).values([
    { accountId: 'exchange', timestamp: '2024-01-03T12:00:00.000Z', balanceSats: firstBalance },
    { accountId: 'exchange', timestamp: '2024-01-04T12:00:00.000Z', balanceSats: '150000000' },
  ])
}

async function createPortfolioService({ db, logger }: DatabaseFixture): Promise<ControlCenterService> {
  const onchainProvider = new ElectrumProvider(Network.Mainnet, {
    logger,
    electrum: new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' }),
  })
  const exchangeService = new ExchangeService({ db, logger })
  expect((await exchangeService.listAccounts())[0]?.connectionStatus, 'Exchange fixture must be connected').toBe(
    'connected',
  )

  const priceService = new PriceService({
    logger,
    mempoolApiUrl: 'https://example.invalid',
    settings: () => ({ source: undefined, fallbacks: false }),
  })
  vi.spyOn(priceService, 'getCurrentBtcPrice').mockImplementation(
    () =>
      new AsyncResult(
        (async () =>
          Ok({ value: new Decimal(40_000), asOf: new Date(), source: 'block' as const, lastKnown: false }))(),
      ),
  )

  return new ControlCenterService({
    db,
    logger,
    onchainProvider,
    exchangeService,
    priceService,
    manualService: new ManualService({ db, logger }),
    etfService: new EtfService({ db, logger }),
  })
}

export async function setupExchangeHistory(
  provider: 'strike' | 'robinhood',
  importedAmounts: string[],
  firstSnapshotBalance: string,
  lateImportedAmounts: string[] = [],
): Promise<ExchangeHistoryScenario> {
  const database = await setupServiceDatabase()
  await seedExchange(database.db, provider, '150000000')
  await seedImportedHistory(database.db, importedAmounts, lateImportedAmounts)
  await seedSnapshots(database.db, firstSnapshotBalance)

  return {
    service: await createPortfolioService(database),
    input: {
      exchangeAccountIds: ['exchange'],
      timezone: 'UTC',
      customDateRange: { startDate: '2024-01-01', endDate: '2024-01-04' },
    },
  }
}
