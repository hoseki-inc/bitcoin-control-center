import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { accounts } from '../../db/schema'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { StatementService } from './service'
import { fetchTransactionEntries } from './tx_fetcher'

const logger = pino({ level: 'silent' })
const account = Wallets.singlesigNativeSegwitAccount
const txid = '1'.repeat(64)
const timestamp = 1704153600
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  await run()
}

function setup(body: JsonValue, transactionIds = [txid]) {
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
  await withTestSetup(async () => {
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
})

it.each([
  null,
  {},
  { txid, vin: 'invalid', vout: [], status: { confirmed: true } },
  { txid, vin: [], vout: [{ value: '100' }], status: { confirmed: true } },
  { txid, vin: [], status: { confirmed: true, block_height: 800000, block_time: timestamp } },
])('rejects malformed transaction responses: %j', async (body) => {
  await withTestSetup(async () => {
    const result = await fetchTransactionEntries(setup(body))
    expect(result.expectErr('malformed transaction data must fail').message).toBe(
      `Invalid transaction data returned from mempool.space for ${txid}`,
    )
  })
})

it('rejects partial history when a later batch contains a malformed transaction', async () => {
  await withTestSetup(async () => {
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
})

it('stops statement generation when a known transaction fails validation', async () => {
  await withTestSetup(async () => {
    const deps = setup({ txid, vin: [], status: { confirmed: true } })
    const directory = mkdtempSync(join(tmpdir(), 'sentinel-statement-validation-'))
    const database = await openDrizzleDatabase(directory, logger)
    try {
      await database
        .insert(accounts)
        .values({ id: 're_clmx_test', descriptor: account.toString(), displayName: 'Test wallet', status: 'verified' })
      const dailyRatesService = new DailyRatesService(deps)
      const rates = vi
        .spyOn(dailyRatesService, 'getDailyRates')
        .mockImplementation(asyncFn(async () => Ok({ rates: {}, source: 'mempool' as const })))
      const service = new StatementService({
        ...deps,
        db: database,
        dailyRatesService,
        exchangeService: new ExchangeService({ db: database, logger }),
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
      database.$client.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

it.each([
  { blockTime: undefined, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: 0, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: -1, expected: '1969-12-31T23:59:59.000Z' },
])('preserves the timestamp fallback for block_time=$blockTime', async ({ blockTime, expected }) => {
  await withTestSetup(async () => {
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
})
