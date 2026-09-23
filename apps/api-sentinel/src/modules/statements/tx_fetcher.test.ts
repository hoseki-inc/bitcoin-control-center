import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { afterEach, assert, expect, it, vi } from 'vitest'
import { initDatabase } from '../../db'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { StatementService } from './service'
import { fetchTransactionEntries } from './tx_fetcher'

const logger = pino({ level: 'silent' })
const account = Wallets.singlesigNativeSegwitAccount
const txid = '1'.repeat(64)
const timestamp = 1704153600

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function setup(body: unknown, transactionIds = [txid]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body)),
  )
  const electrum = new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockResolvedValue(Ok(transactionIds.map((id) => ({ tx_hash: id, height: 800000 }))))
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: -1 })),
  )
  vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(
    asyncFn(async () => Ok({ height: 900000, hash: 'tip', timestamp: new Date() })),
  )
  return { account, onchainProvider, logger, mempoolApiUrl: 'https://example.invalid' }
}

it('accepts coinbase inputs and addressless outputs without changing balance calculation', async () => {
  const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
  assert(address)
  const result = await fetchTransactionEntries(
    setup({
      txid,
      vin: [{ prevout: null }, { prevout: { scriptpubkey_address: address.toString(), value: 25 } }],
      vout: [
        { scriptpubkey_address: address.toString(), value: 100 },
        { value: 0, scriptpubkey_type: 'op_return' },
      ],
      status: { confirmed: true, block_height: 800000, block_time: timestamp },
      extra: true,
    }),
  )
  expect(result.unwrap()).toEqual([
    expect.objectContaining({
      value: 75n,
      blockHeight: 800000,
      confirmed: true,
      timestamp: new Date(timestamp * 1000),
    }),
  ])
})

it.each([
  null,
  {},
  { txid, vin: 'invalid', vout: [], status: { confirmed: true } },
  { txid, vin: [], vout: [{ value: '100' }], status: { confirmed: true } },
  { txid, vin: [], status: { confirmed: true, block_height: 800000, block_time: timestamp } },
])('rejects malformed transaction responses: %j', async (body) => {
  const result = await fetchTransactionEntries(setup(body))
  expect(result.expectErr('malformed transaction data must fail').message).toBe(
    `Invalid transaction data returned from mempool.space for ${txid}`,
  )
})

it('rejects partial history when a later batch contains a malformed transaction', async () => {
  const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
  assert(address)
  const transactionIds = Array.from({ length: 11 }, (_, index) => (index + 1).toString(16).padStart(64, '0'))
  const invalidId = transactionIds.at(-1)
  assert(invalidId != null && invalidId !== '')
  const deps = setup(null, transactionIds)
  for (const id of transactionIds) {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        txid: id,
        vin: [{ prevout: null }],
        vout: id === invalidId ? undefined : [{ scriptpubkey_address: address.toString(), value: 100 }],
        status: { confirmed: true, block_height: 800000, block_time: timestamp },
      }),
    )
  }

  const result = await fetchTransactionEntries(deps)
  expect(fetch).toHaveBeenCalledTimes(11)
  expect(result.expectErr('partial history must fail').message).toBe(
    `Invalid transaction data returned from mempool.space for ${invalidId}`,
  )
})

it('stops statement generation when a known transaction fails validation', async () => {
  const deps = setup({ txid, vin: [], status: { confirmed: true } })
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-statement-validation-'))
  const database = initDatabase(directory, logger)
  try {
    database.db
      .prepare('INSERT INTO accounts (id, descriptor, display_name, status) VALUES (?, ?, ?, ?)')
      .run('re_clmx_test', account.toString(), 'Test wallet', 'verified')
    const dailyRatesService = new DailyRatesService(deps)
    const rates = vi
      .spyOn(dailyRatesService, 'getDailyRates')
      .mockImplementation(asyncFn(async () => Ok({ rates: {}, source: 'mempool' as const })))
    const service = new StatementService({
      ...deps,
      db: database.db,
      dailyRatesService,
      exchangeService: new ExchangeService({ db: database.db, logger }),
    })

    const result = await service.generateStatementData({
      claimIds: ['re_clmx_test'],
      openingDate: new Date('2024-01-01'),
      closingDate: new Date('2024-01-31'),
      timezone: 'UTC',
    })
    expect(result.expectErr('incomplete statement data must fail').message).toBe(
      `Invalid transaction data returned from mempool.space for ${txid}`,
    )
    expect(rates).not.toHaveBeenCalled()
  } finally {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each([
  { blockTime: undefined, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: 0, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: -1, expected: '1969-12-31T23:59:59.000Z' },
])('preserves the timestamp fallback for block_time=$blockTime', async ({ blockTime, expected }) => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'))
  const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
  assert(address)
  const result = await fetchTransactionEntries(
    setup({
      txid,
      vin: [{ prevout: null }],
      vout: [{ scriptpubkey_address: address.toString(), value: 100 }],
      status: { confirmed: true, block_height: 800000, block_time: blockTime },
    }),
  )
  expect(result.unwrap()).toEqual([expect.objectContaining({ timestamp: new Date(expected) })])
})
