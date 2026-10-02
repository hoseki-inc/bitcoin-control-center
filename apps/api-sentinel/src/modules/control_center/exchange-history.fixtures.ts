import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import Decimal from 'decimal.js'
import { expect, vi } from 'vitest'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { Encrypted, initEncryption } from '../../lib/encrypted'
import { EtfService } from '../etf/service'
import { ExchangeService } from '../exchange/service'
import { ManualService } from '../manual/service'
import { PriceService } from '../price/service'
import { ControlCenterService } from './service'

type DatabaseFixture = ReturnType<typeof setupServiceDatabase>

interface ExchangeHistoryScenario {
  service: ControlCenterService
  input: Parameters<ControlCenterService['getData']>[0]
}

function seedExchange(db: DatabaseFixture['db'], provider: 'strike' | 'robinhood', balance: string): void {
  initEncryption('22'.repeat(32))
  const blob = Encrypted.encrypt('synthetic-test-key').expect('Test credential must encrypt').blob
  const credentials = JSON.stringify({ type: 'apiKey', data: { key: { blob } } })

  db.prepare(`INSERT INTO exchange_accounts
    (id, provider, display_name, encrypted_credentials, balance_sats, credentials_connected_at)
    VALUES ('exchange', ?, 'Savings', ?, ?, ?)`).run(provider, credentials, balance, new Date().toISOString())
}

function seedImportedHistory(db: DatabaseFixture['db'], amounts: string[], lateAmounts: string[]): void {
  const imports = [
    ...amounts.map((amount, index) => ({ amount, transactedAt: `2024-01-0${index + 1}T12:00:00.000Z` })),
    // After both snapshots, where snapshots are the source of truth
    ...lateAmounts.map((amount) => ({ amount, transactedAt: '2024-01-04T18:00:00.000Z' })),
  ]
  for (const [index, { amount, transactedAt }] of imports.entries()) {
    db.prepare(`INSERT INTO exchange_statement_txs
      (id, account_id, external_id, transacted_at, type, amount_btc, statement_month)
      VALUES (?, 'exchange', ?, ?, ?, ?, '2024-01')`).run(
      `import-${index}`,
      `external-${index}`,
      transactedAt,
      amount.startsWith('-') ? 'withdrawal' : 'buy',
      amount,
    )
  }
}

function seedSnapshots(db: DatabaseFixture['db'], firstBalance: string): void {
  const insert = db.prepare(`INSERT INTO exchange_balance_snapshots (account_id, timestamp, balance_sats)
    VALUES ('exchange', ?, ?)`)

  insert.run('2024-01-03T12:00:00.000Z', firstBalance)
  insert.run('2024-01-04T12:00:00.000Z', '150000000')
}

function createPortfolioService({ db, logger }: DatabaseFixture): ControlCenterService {
  const onchainProvider = new ElectrumProvider(Network.Mainnet, {
    logger,
    electrum: new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' }),
  })
  const exchangeService = new ExchangeService({ db, logger })
  expect(exchangeService.listAccounts()[0]?.connectionStatus, 'Exchange fixture must be connected').toBe('connected')

  const priceService = new PriceService({
    logger,
    mempoolApiUrl: 'https://example.invalid',
    settings: () => ({ source: undefined, fallbacks: false }),
  })
  vi.spyOn(priceService, 'getCurrentBtcPrice').mockImplementation(
    asyncFn(async () =>
      Ok({ value: new Decimal(40_000), asOf: new Date(), source: 'block' as const, lastKnown: false }),
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

export function setupExchangeHistory(
  provider: 'strike' | 'robinhood',
  importedAmounts: string[],
  firstSnapshotBalance: string,
  lateImportedAmounts: string[] = [],
): ExchangeHistoryScenario {
  const database = setupServiceDatabase()
  seedExchange(database.db, provider, '150000000')
  seedImportedHistory(database.db, importedAmounts, lateImportedAmounts)
  seedSnapshots(database.db, firstSnapshotBalance)

  return {
    service: createPortfolioService(database),
    input: {
      exchangeAccountIds: ['exchange'],
      timezone: 'UTC',
      customDateRange: { startDate: '2024-01-01', endDate: '2024-01-04' },
    },
  }
}
