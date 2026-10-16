import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Account } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import type { Block, TransactionEntry } from '@hoseki/packages/bitcoin/onchain'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap } from '@hoseki/packages/collection'
import { AsyncResult, Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { createClient } from '@libsql/client/sqlite3'
import Decimal from 'decimal.js'
import { asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/libsql'
import pino from 'pino'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { accountHistorySyncs, accounts, balanceSnapshots } from '../../db/schema'
import { EtfService } from '../etf/service'
import { ExchangeService } from '../exchange/service'
import { ManualService } from '../manual/service'
import { PriceService } from '../price/service'
import { ControlCenterService } from './service'

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void }

const account = Wallets.singlesigNativeSegwitAccount
const accountId = 'test-account'
const now = new Date('2026-09-05T12:00:00.000Z')
const tip: Block = { height: 900_000, hash: 'old-tip', timestamp: new Date('2026-09-05T11:00:00.000Z') }
const nextTip: Block = { height: tip.height + 1, hash: 'next-tip', timestamp: new Date('2026-09-05T11:10:00.000Z') }
const customRange = { startDate: '2020-01-01', endDate: '2020-01-03' }

function entry(value: bigint, timestamp: string, blockHeight = 600_000): TransactionEntry {
  return {
    txid: Txid.fromString('1'.repeat(64)).unwrap(),
    address: Wallets.segwitAddress,
    value,
    timestamp: new Date(timestamp),
    confirmed: true,
    blockHeight,
  }
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-history-test-'))
  const logger = pino({ level: 'silent' })
  const db = await openDrizzleDatabase(directory, logger)
  await db.insert(accounts).values({ id: accountId, descriptor: account.toString(), displayName: 'Test wallet' })
  const onchainProvider = new ElectrumProvider(Network.Mainnet, {
    logger,
    electrum: new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' }),
  })
  const provider = {
    getBlocksTip: vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(asyncFn(async () => Ok(tip))),
    getBlock: vi.spyOn(onchainProvider, 'getBlock').mockImplementation(asyncFn(async () => Ok(tip))),
    getConfirmedAccountBalances: vi
      .spyOn(onchainProvider, 'getConfirmedAccountBalances')
      .mockImplementation(asyncFn(async () => Ok(new IndexMap<Account, bigint>([[account, 100n]])))),
  }
  const priceService = new PriceService({
    logger,
    mempoolApiUrl: 'https://example.invalid',
    settings: () => ({ source: undefined, fallbacks: false }),
  })
  const price = vi
    .spyOn(priceService, 'getCurrentBtcPrice')
    .mockImplementation(
      asyncFn(async () => Ok({ value: new Decimal(50_000), asOf: now, source: 'block' as const, lastKnown: false })),
    )
  const service = new ControlCenterService({
    db,
    logger,
    onchainProvider,
    exchangeService: new ExchangeService({ db, logger }),
    manualService: new ManualService({ db, logger }),
    etfService: new EtfService({ db, logger }),
    priceService,
  })
  // Replace only external history fetching; storage, coverage, scheduling and responses remain real.
  const history = vi
    .fn(service['getTransactionEntriesByAccountSinceBlock'])
    .mockResolvedValue(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
  service['getTransactionEntriesByAccountSinceBlock'] = history
  const sync = async (from = 0, to = tip.height): Promise<void> => {
    await service['recordAccountHistorySync'](accountId, { fromBlockHeight: from, toBlockHeight: to }, tip)
  }
  const run = async (balance: bigint = 100n, balanceTip?: Block): Promise<bigint | null> =>
    service['ensureAccountHistorySnapshots'](accountId, account, balance, new Date(0), true, undefined, balanceTip)
  const rows = async (): Promise<Array<{ timestamp: string; balance_sats: string }>> =>
    db
      .select({ timestamp: balanceSnapshots.timestamp, balance_sats: balanceSnapshots.balanceSats })
      .from(balanceSnapshots)
      .orderBy(asc(balanceSnapshots.timestamp))
  const coverage = async (): Promise<Array<{ from_block_height: number; to_block_height: number }>> =>
    db
      .select({
        from_block_height: accountHistorySyncs.fromBlockHeight,
        to_block_height: accountHistorySyncs.toBlockHeight,
      })
      .from(accountHistorySyncs)
      .orderBy(asc(accountHistorySyncs.fromBlockHeight))
  const close = (): void => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  }
  return { directory, db, provider, service, history, price, sync, run, rows, coverage, close }
}

let harness: Awaited<ReturnType<typeof createHarness>>

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    harness.close()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  harness = await createHarness()

  await run()
}

describe('portfolio history completion', () => {
  it('starts All at the earliest current or archived wallet activity and respects account selection', async () => {
    await withTestSetup(async () => {
      const { db, service } = harness
      await harness.sync()
      await service.recordAccountSnapshot(accountId, '0', '2009-01-03T00:00:00.000Z')
      await service.recordAccountSnapshot(accountId, '100', '2020-01-02T12:00:00.000Z')

      const archivedId = 'archived-wallet'
      await db.insert(accounts).values({
        id: archivedId,
        descriptor: Wallets.singlesigLegacyAccount.toString(),
        displayName: 'Archived wallet',
      })
      await service.recordAccountSnapshot(archivedId, '0', '2009-01-03T00:00:00.000Z')
      await service.recordAccountSnapshot(archivedId, '50', '2018-06-05T12:00:00.000Z')
      await db.update(accounts).set({ deletedAt: '2019-01-01T12:00:00.000Z' }).where(eq(accounts.id, archivedId))

      const all = (await service.getData({ timeRange: 'all' })).unwrap()
      expect(all.historicalData[0]?.timestamp).toBe('2018-06-05T00:00:00.000Z')
      expect(all.historicalData[1]?.totalBalance).toBe('50')
      expect(all.historicalData.find(({ timestamp }) => timestamp === '2019-01-01T23:59:59.999Z')?.totalBalance).toBe(
        '0',
      )
      expect(all.historicalData.at(-1)?.totalBalance).toBe('100')
      expect(all.historySyncingAccountIds).toEqual([])

      const selected = (await service.getData({ timeRange: 'all', accountIds: [accountId] })).unwrap()
      expect(selected.historicalData[0]?.timestamp).toBe('2020-01-02T00:00:00.000Z')

      await db.update(accounts).set({ deletedAt: '2021-01-01T12:00:00.000Z' }).where(eq(accounts.id, accountId))
      const archivedOnly = (await service.getData({ timeRange: 'all' })).unwrap()
      expect(archivedOnly.historicalData[0]?.timestamp).toBe('2018-06-05T00:00:00.000Z')
      expect(archivedOnly.historicalData.at(-1)?.totalBalance).toBe('0')
    })
  })

  it('returns the new snapshots when a backfill finishes while another data source is loading', async () => {
    await withTestSetup(async () => {
      const { service, history, price } = harness
      const pendingHistory = deferred<Result<TransactionEntry[], Error>>()
      const pendingPrice = deferred<ReturnType<typeof Ok<{ value: Decimal; asOf: Date }>>>()
      history.mockReturnValueOnce(pendingHistory.promise)
      price.mockReturnValueOnce(new AsyncResult(pendingPrice.promise))
      const resultPromise = service.getData({ customDateRange: customRange })
      await vi.waitFor(async () => {
        expect(history).toHaveBeenCalledTimes(1)
      })
      pendingHistory.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
      await vi.waitFor(async () => {
        await expect(harness.coverage()).resolves.toHaveLength(1)
      })
      pendingPrice.resolve(Ok({ value: new Decimal(50_000), asOf: now, source: 'block' as const, lastKnown: false }))
      const data = (await resultPromise).unwrap()
      expect(data.historySyncingAccountIds).toEqual([])
      expect(data.historySyncedAccountIds).toEqual([accountId])
      expect(data.historicalData.map(({ totalBalance }) => totalBalance)).toEqual(['0', '0', '100', '100'])
    })
  })

  it('reports loading until the requested full history has completed', async () => {
    await withTestSetup(async () => {
      const pending = deferred<Result<TransactionEntry[], Error>>()
      harness.history.mockReturnValueOnce(pending.promise)
      const data = (await harness.service.getData({ customDateRange: customRange })).unwrap()
      expect(data.historySyncingAccountIds).toEqual([accountId])
      expect(data.historySyncedAccountIds).toEqual([])
      expect(data.historyRefreshingAccountIds).toEqual([])
      expect(data.historyFailedAccountIds).toEqual([])
      pending.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
      await vi.waitFor(async () => {
        await expect(harness.coverage()).resolves.toHaveLength(1)
      })
    })
  })

  it("returns each active wallet's latest stored balance, leaving out wallets that never synced", async () => {
    await withTestSetup(async () => {
      const { db, service } = harness
      await service.recordAccountSnapshot(accountId, '90', '2020-01-01T00:00:00.000Z')
      await service.recordAccountSnapshot(accountId, '150', '2020-01-03T09:00:00.000Z')
      const unsyncedId = 'unsynced-wallet'
      const archivedId = 'archived-wallet'
      await db.insert(accounts).values([
        { id: unsyncedId, descriptor: Wallets.singlesigLegacyAccount.toString(), displayName: 'Unsynced wallet' },
        { id: archivedId, descriptor: Wallets.singlesigNestedSegwitAccount.toString(), displayName: 'Archived wallet' },
      ])
      await service.recordAccountSnapshot(archivedId, '50', '2020-01-02T00:00:00.000Z')
      await db.update(accounts).set({ deletedAt: '2020-01-04T00:00:00.000Z' }).where(eq(accounts.id, archivedId))

      await expect(service.getStoredWalletBalances([accountId, unsyncedId, archivedId])).resolves.toEqual([
        { accountId, balanceSats: '150', timestamp: '2020-01-03T09:00:00.000Z' },
      ])
      await expect(service.getStoredWalletBalances([])).resolves.toEqual([])
    })
  })

  it("counts each wallet's latest stored balance while live balances are unavailable", async () => {
    await withTestSetup(async () => {
      await harness.service.recordAccountSnapshot(accountId, '90', '2020-01-01T00:00:00.000Z')
      await harness.service.recordAccountSnapshot(accountId, '150', '2020-01-03T09:00:00.000Z')
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Err(new Error('Balance unavailable')))
      const offline = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(offline.currentTotalBalance).toBe('150')
    })
  })

  it('keeps a certified history prefix available while a new block is fetched', async () => {
    await withTestSetup(async () => {
      await harness.sync()
      await harness.service.recordAccountSnapshot(accountId, '100', '2020-01-02T12:00:00.000Z')
      harness.provider.getBlocksTip.mockResolvedValue(Ok(nextTip))
      const pending = deferred<Result<TransactionEntry[], Error>>()
      harness.history.mockReturnValueOnce(pending.promise)
      const data = (await harness.service.getData({ timeRange: 'all' })).unwrap()
      expect(data.historySyncingAccountIds).toEqual([accountId])
      expect(data.historyRefreshingAccountIds).toEqual([accountId])
      expect(data.historySyncedAccountIds).toEqual([])
      expect(data.historyFailedAccountIds).toEqual([])
      expect(data.historicalData.length).toBeGreaterThan(1)
      pending.resolve(Ok([]))
      await vi.waitFor(async () => {
        await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: nextTip.height }])
      })
    })
  })

  it.each(['missing start', 'gap before the tip', 'outdated certification'])(
    'does not call incomplete full history a background refresh: %s',
    async (scenario) => {
      await withTestSetup(async () => {
        if (scenario === 'missing start') {
          await harness.sync(100)
        } else if (scenario === 'gap before the tip') {
          await harness.sync(0, 100)
          await harness.sync(200)
        } else {
          await harness.sync()
          await harness.db.update(accountHistorySyncs).set({ syncVersion: 4 })
        }
        const status = await harness.service['getAccountHistoryStatus'](
          [{ id: accountId, descriptor: account.toString(), network: 'mainnet' }],
          new Date(0),
          true,
        )
        expect(status.historySyncingAccountIds).toEqual([accountId])
        expect(status.historyRefreshingAccountIds).toEqual([])
      })
    },
  )

  it.each([true, false])(
    'reports an unavailable tip and preserves only certified history (cached: %s)',
    async (cached) => {
      await withTestSetup(async () => {
        if (cached) {
          await harness.sync()
        }
        harness.provider.getBlocksTip.mockResolvedValue(Err(new Error('Connection unavailable')))
        const data = (await harness.service.getData({ customDateRange: customRange })).unwrap()
        expect(data.historySyncingAccountIds).toEqual([accountId])
        expect(data.historySyncedAccountIds).toEqual([])
        expect(data.historyFailedAccountIds).toEqual([accountId])
        expect(data.historyRefreshingAccountIds).toEqual(cached ? [accountId] : [])
        await vi.waitFor(async () => {
          expect(harness.service['accountHistoryBackfillsInFlight'].size).toBe(0)
        })
      })
    },
  )

  it('does not fetch history or balances again when coverage is complete', async () => {
    await withTestSetup(async () => {
      await harness.sync()
      await expect(harness.run()).resolves.toBe(100n)
      expect(harness.history).not.toHaveBeenCalled()
      expect(harness.provider.getConfirmedAccountBalances).not.toHaveBeenCalled()
      expect(harness.provider.getBlocksTip).toHaveBeenCalledTimes(1)
    })
  })

  it('still verifies the balance for archival with complete coverage', async () => {
    await withTestSetup(async () => {
      await harness.sync()
      await expect(
        harness.service['ensureAccountHistorySnapshots'](accountId, account, undefined, new Date(0), true),
      ).resolves.toBe(100n)
      expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(1)
      expect(harness.history).not.toHaveBeenCalled()
    })
  })

  it('rechecks history certified by the old partial-response implementation', async () => {
    await withTestSetup(async () => {
      await harness.sync()
      await harness.db.update(accountHistorySyncs).set({ syncVersion: 4 })
      await expect(harness.run()).resolves.toBe(100n)
      expect(harness.history).toHaveBeenCalledWith(account, 0)
      await expect(
        harness.db.select({ sync_version: accountHistorySyncs.syncVersion }).from(accountHistorySyncs),
      ).resolves.toEqual([{ sync_version: 5 }])
    })
  })
})

describe('history scan boundaries', () => {
  it('reconciles snapshots that predate the estimated genesis timestamp', async () => {
    await withTestSetup(async () => {
      await harness.service.recordAccountSnapshot(accountId, '50', '2009-01-04T12:00:00.000Z')
      harness.history.mockResolvedValue(Ok([entry(100n, '2009-01-05T12:00:00.000Z', 100)]))
      await expect(harness.run()).resolves.toBe(100n)
      expect(
        (await harness.rows()).find(({ timestamp }) => timestamp === '2009-01-04T12:00:00.000Z')?.balance_sats,
      ).toBe('0')
    })
  })

  it('retains progress through multiple new blocks without rescanning old transactions', async () => {
    await withTestSetup(async () => {
      const thirdTip = {
        ...nextTip,
        height: nextTip.height + 1,
        hash: 'third-tip',
        timestamp: new Date('2026-09-05T11:20:00Z'),
      }
      harness.provider.getBlocksTip
        .mockResolvedValueOnce(Ok(tip))
        .mockResolvedValueOnce(Ok(nextTip))
        .mockResolvedValue(Ok(thirdTip))
      harness.provider.getBlock.mockResolvedValueOnce(Ok(tip)).mockResolvedValueOnce(Ok(nextTip))
      harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 130n]])))
      harness.history
        .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
        .mockResolvedValueOnce(Ok([entry(20n, nextTip.timestamp.toISOString(), nextTip.height)]))
        .mockResolvedValueOnce(Ok([entry(10n, thirdTip.timestamp.toISOString(), thirdTip.height)]))
      await expect(harness.run()).resolves.toBe(130n)
      expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([0, tip.height, nextTip.height])
      expect(
        (await harness.rows()).find(({ timestamp }) => timestamp === '2020-01-02T12:00:00.000Z')?.balance_sats,
      ).toBe('100')
      expect((await harness.rows()).at(-1)?.balance_sats).toBe('130')
    })
  })

  it('does not certify an unverified or incomplete tail after the chain advances', async () => {
    await withTestSetup(async () => {
      harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
      harness.history
        .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
        .mockResolvedValueOnce(Err(new Error('Tail unavailable')))
      await expect(harness.run()).resolves.toBeNull()
      await expect(harness.coverage()).resolves.toEqual([])
      await expect(harness.rows()).resolves.toEqual([])
    })
  })

  it('keeps the long scan and fetches only the new tail when the chain advances', async () => {
    await withTestSetup(async () => {
      const tail = entry(20n, nextTip.timestamp.toISOString(), nextTip.height)
      harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
      harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 120n]])))
      // The initial scan may already contain the new block; it must not be counted twice.
      harness.history
        .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z'), tail]))
        .mockResolvedValueOnce(Ok([tail]))
      await expect(harness.run()).resolves.toBe(120n)
      expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([0, tip.height])
      expect(harness.provider.getBlock).toHaveBeenCalledWith(tip.height)
      expect(
        (await harness.rows()).find(({ timestamp }) => timestamp === '2020-01-02T12:00:00.000Z')?.balance_sats,
      ).toBe('100')
      expect((await harness.rows()).at(-1)?.balance_sats).toBe('120')
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: nextTip.height }])
    })
  })

  it('preserves archived history if a new block arrives after the cached-range check', async () => {
    await withTestSetup(async () => {
      await harness.sync()
      await harness.service.recordAccountSnapshot(accountId, '100', '2020-01-02T12:00:00.000Z')
      harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
      harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 120n]])))
      harness.history.mockResolvedValue(Ok([entry(20n, nextTip.timestamp.toISOString(), nextTip.height)]))
      expect((await harness.service.archiveAccount(accountId)).isOk()).toBe(true)
      expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([tip.height])
      expect((await harness.rows())[0]?.balance_sats).toBe('100')
      expect((await harness.rows()).at(-1)?.balance_sats).toBe('120')
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: nextTip.height }])
    })
  })

  it.each(['same-height reorganization', 'deeper reorganization', 'height rollback'])(
    'does not certify history after a %s',
    async (scenario) => {
      await withTestSetup(async () => {
        const changedTip =
          scenario === 'same-height reorganization'
            ? { ...tip, hash: 'reorganized' }
            : scenario === 'height rollback'
              ? { ...tip, height: tip.height - 1 }
              : nextTip
        harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(changedTip))
        harness.provider.getBlock.mockResolvedValue(Ok({ ...tip, hash: 'reorganized' }))
        await expect(harness.run()).resolves.toBeNull()
        await expect(harness.coverage()).resolves.toEqual([])
        await expect(harness.rows()).resolves.toEqual([])
      })
    },
  )

  it('does not save snapshots or completion after a partial history failure', async () => {
    await withTestSetup(async () => {
      harness.history.mockResolvedValue(Err(new Error('Electrum unavailable')))
      await expect(harness.run()).resolves.toBeNull()
      await expect(harness.coverage()).resolves.toEqual([])
      await expect(harness.rows()).resolves.toEqual([])
    })
  })

  it('does not let an invalidated background scan overwrite account history', async () => {
    await withTestSetup(async () => {
      const pending = deferred<Result<TransactionEntry[], Error>>()
      harness.history.mockReturnValueOnce(pending.promise)
      const result = harness.run()
      await vi.waitFor(async () => {
        expect(harness.history).toHaveBeenCalledTimes(1)
      })
      harness.service['invalidateAccountHistoryBackfill'](accountId)
      pending.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
      await expect(result).resolves.toBeNull()
      await expect(harness.coverage()).resolves.toEqual([])
      await expect(harness.rows()).resolves.toEqual([])
    })
  })
})

describe('history balance reuse', () => {
  it('avoids a second balance/discovery sweep during a stable-tip page request', async () => {
    await withTestSetup(async () => {
      await harness.service.getData({ timeRange: 'all' })
      await vi.waitFor(async () => {
        expect(harness.service['accountHistoryBackfillsInFlight'].size).toBe(0)
      })
      expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(1)
      expect(harness.history).toHaveBeenCalledTimes(1)
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: tip.height }])
    })
  })

  it.each([0n, 100n])('reuses an anchored balance of %s only after verifying the tip', async (balance) => {
    await withTestSetup(async () => {
      await expect(harness.run(balance, tip)).resolves.toBe(balance)
      expect(harness.provider.getConfirmedAccountBalances).not.toHaveBeenCalled()
      expect(harness.provider.getBlocksTip).toHaveBeenCalledTimes(2)
      expect((await harness.rows()).at(-1)?.balance_sats).toBe(balance.toString())
    })
  })

  it.each([undefined, nextTip, { ...tip, hash: 'different-chain' }])(
    'fetches a fresh balance without a matching anchor (%j)',
    async (balanceTip) => {
      await withTestSetup(async () => {
        await expect(harness.run(999n, balanceTip)).resolves.toBe(100n)
        expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(1)
      })
    },
  )

  it('does not treat an unavailable anchor or a cached balance as reusable', async () => {
    await withTestSetup(async () => {
      harness.provider.getBlocksTip.mockResolvedValueOnce(Err(new Error('Tip unavailable')))
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Err(new Error('Balance unavailable')))
      await harness.service.recordAccountSnapshot(accountId, '999', '2020-01-01T00:00:00.000Z')
      await harness.service.getData({ timeRange: 'all' })
      await vi.waitFor(async () => {
        expect(harness.service['accountHistoryBackfillsInFlight'].size).toBe(0)
      })
      expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(2)
      expect((await harness.rows()).at(-1)?.balance_sats).toBe('100')
    })
  })

  it('discards the reused balance and fetches a new balance and tail when the tip advances', async () => {
    await withTestSetup(async () => {
      harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
      harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 120n]])))
      harness.history
        .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
        .mockResolvedValueOnce(Ok([entry(20n, nextTip.timestamp.toISOString(), nextTip.height)]))
      await expect(harness.run(100n, tip)).resolves.toBe(120n)
      expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(1)
      expect(harness.provider.getBlock).toHaveBeenCalledWith(tip.height)
      expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([0, tip.height])
      expect(
        (await harness.rows()).find(({ timestamp }) => timestamp === '2020-01-02T12:00:00.000Z')?.balance_sats,
      ).toBe('100')
    })
  })

  it.each(['reorganization', 'tip failure'])('does not save an anchored balance after a %s', async (failure) => {
    await withTestSetup(async () => {
      harness.provider.getBlocksTip
        .mockResolvedValueOnce(Ok(tip))
        .mockResolvedValue(
          failure === 'reorganization' ? Ok({ ...tip, hash: 'reorganized' }) : Err(new Error('Tip unavailable')),
        )
      await expect(harness.run(100n, tip)).resolves.toBeNull()
      await expect(harness.rows()).resolves.toEqual([])
      await expect(harness.coverage()).resolves.toEqual([])
    })
  })
})

describe('compacted history coverage', () => {
  it('combines overlaps and adjacent ranges on both sides without closing real gaps', async () => {
    await withTestSetup(async () => {
      await harness.sync(0, 99)
      await harness.sync(200, 299)
      await harness.sync(400, 499)
      await harness.sync(100, 199)
      await harness.sync(50, 250)
      await expect(harness.coverage()).resolves.toEqual([
        { from_block_height: 0, to_block_height: 299 },
        { from_block_height: 400, to_block_height: 499 },
      ])
      await expect(
        harness.service['getMissingAccountHistorySyncRanges'](accountId, { fromBlockHeight: 0, toBlockHeight: 499 }),
      ).resolves.toEqual([{ fromBlockHeight: 300, toBlockHeight: 399 }])
      await harness.sync(300, 399)
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: 499 }])
    })
  })

  it('compacts previously accumulated adjacent records when the next tail is recorded', async () => {
    await withTestSetup(async () => {
      for (let height = 0; height < 100; height++) {
        await harness.db.insert(accountHistorySyncs).values({
          accountId,
          fromBlockHeight: height,
          toBlockHeight: height,
          rangeStart: now.toISOString(),
          rangeEnd: now.toISOString(),
          syncVersion: 5,
        })
      }
      await harness.sync(100, 100)
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: 100 }])
      for (let height = 101; height < 200; height++) {
        await harness.sync(height, height)
      }
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: 199 }])
    })
  })

  it('keeps old certification versions and other accounts separate', async () => {
    await withTestSetup(async () => {
      await harness.sync(0, 99)
      await harness.db.update(accountHistorySyncs).set({ syncVersion: 4 })
      await harness.db
        .insert(accounts)
        .values({ id: 'other', descriptor: Wallets.singlesigLegacyAccount.toString(), displayName: 'Other wallet' })
      await harness.service['recordAccountHistorySync']('other', { fromBlockHeight: 0, toBlockHeight: 99 }, tip)
      await harness.sync(100, 199)
      await expect(
        harness.db
          .select({
            account_id: accountHistorySyncs.accountId,
            from_block_height: accountHistorySyncs.fromBlockHeight,
            to_block_height: accountHistorySyncs.toBlockHeight,
            sync_version: accountHistorySyncs.syncVersion,
          })
          .from(accountHistorySyncs)
          .orderBy(asc(accountHistorySyncs.accountId), asc(accountHistorySyncs.fromBlockHeight)),
      ).resolves.toEqual([
        { account_id: 'other', from_block_height: 0, to_block_height: 99, sync_version: 5 },
        { account_id: accountId, from_block_height: 0, to_block_height: 99, sync_version: 4 },
        { account_id: accountId, from_block_height: 100, to_block_height: 199, sync_version: 5 },
      ])
      await expect(
        harness.service['getMissingAccountHistorySyncRanges'](accountId, { fromBlockHeight: 0, toBlockHeight: 199 }),
      ).resolves.toEqual([{ fromBlockHeight: 0, toBlockHeight: 99 }])
    })
  })

  it('rolls back the deletion if the replacement record cannot be written', async () => {
    await withTestSetup(async () => {
      await harness.sync(0, 99)
      await harness.db.run(sql`CREATE TEMP TRIGGER fail_sync BEFORE INSERT ON account_history_syncs
      BEGIN SELECT RAISE(ABORT, 'Synthetic write failure'); END`)
      await expect(harness.sync(100, 199)).rejects.toThrow('Failed query: insert into "account_history_syncs"')
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: 99 }])
    })
  })
})

describe('atomic history persistence', () => {
  it.each(['archive', 'delete', 'invalidate'] as const)(
    'rejects a completed scan if %s wins immediately before persistence',
    async (action) => {
      await withTestSetup(async () => {
        const { db, service, provider } = harness
        await service.recordAccountSnapshot(accountId, '999', '2020-01-01T00:00:00.000Z')
        const before = await harness.rows()
        const canContinue = service['canContinueAccountHistoryBackfill'].bind(service)
        let changed = false
        service['canContinueAccountHistoryBackfill'] = vi.fn(canContinue).mockImplementation(async (...args) => {
          const allowed = await canContinue(...args)
          if (!changed && provider.getBlocksTip.mock.calls.length === 2) {
            changed = true
            if (action === 'archive') {
              await db.update(accounts).set({ deletedAt: now.toISOString() }).where(eq(accounts.id, accountId))
            } else if (action === 'delete') {
              await db.delete(accounts).where(eq(accounts.id, accountId))
            } else {
              service['invalidateAccountHistoryBackfill'](accountId)
            }
          }
          return allowed
        })

        await expect(harness.run()).resolves.toBeNull()
        expect(changed).toBe(true)
        await expect(harness.rows()).resolves.toEqual(action === 'delete' ? [] : before)
        await expect(harness.coverage()).resolves.toEqual([])
      })
    },
  )

  it.each(['snapshot', 'reconciliation', 'coverage'] as const)(
    'rolls back all backfill changes if the %s write fails',
    async (failure) => {
      await withTestSetup(async () => {
        const { db, service } = harness
        await service.recordAccountSnapshot(accountId, '999', '2020-01-01T00:00:00.000Z')
        await harness.sync()
        await db.update(accountHistorySyncs).set({ syncVersion: 4 })
        const beforeSnapshots = await db.select().from(balanceSnapshots)
        const beforeSyncs = await db.select().from(accountHistorySyncs)
        if (failure === 'snapshot') {
          await db.run(sql`CREATE TEMP TRIGGER fail_backfill BEFORE INSERT ON balance_snapshots
            WHEN NEW.timestamp = '2020-01-02T12:00:00.000Z'
            BEGIN SELECT RAISE(ABORT, 'Synthetic snapshot failure'); END`)
        } else if (failure === 'reconciliation') {
          await db.run(sql`CREATE TEMP TRIGGER fail_backfill BEFORE UPDATE ON balance_snapshots
            WHEN OLD.timestamp = '2020-01-01T00:00:00.000Z'
            BEGIN SELECT RAISE(ABORT, 'Synthetic reconciliation failure'); END`)
        } else {
          await db.run(sql`CREATE TEMP TRIGGER fail_backfill BEFORE INSERT ON account_history_syncs
            BEGIN SELECT RAISE(ABORT, 'Synthetic coverage failure'); END`)
        }

        await expect(harness.run()).rejects.toThrow('Failed query: insert into')
        await expect(db.select().from(balanceSnapshots)).resolves.toEqual(beforeSnapshots)
        await expect(db.select().from(accountHistorySyncs)).resolves.toEqual(beforeSyncs)
        await db.run(sql`DROP TRIGGER fail_backfill`)
        await expect(harness.run()).resolves.toBe(100n)
        await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: tip.height }])
      })
    },
  )

  it('exposes the entire backfill together to a separate connection and queued readers', async () => {
    await withTestSetup(async () => {
      const { service } = harness
      await service.recordAccountSnapshot(accountId, '999', '2020-01-01T00:00:00.000Z')
      const before = await harness.rows()
      const observer = drizzle({
        client: createClient({ url: pathToFileURL(join(harness.directory, 'sentinel.db')).href, concurrency: 1 }),
      })
      const reached = deferred<undefined>()
      const proceed = deferred<undefined>()
      const upsert = service['upsertAccountSnapshot'].bind(service)
      service['upsertAccountSnapshot'] = vi.fn(upsert).mockImplementationOnce(async (...args) => {
        await upsert(...args)
        reached.resolve(undefined)
        await proceed.promise
      })
      const run = harness.run()
      try {
        await reached.promise
        const queuedRead = harness.rows()
        await expect(
          observer
            .select({ timestamp: balanceSnapshots.timestamp, balance_sats: balanceSnapshots.balanceSats })
            .from(balanceSnapshots)
            .orderBy(asc(balanceSnapshots.timestamp)),
        ).resolves.toEqual(before)
        await expect(observer.select().from(accountHistorySyncs)).resolves.toEqual([])
        proceed.resolve(undefined)
        await expect(run).resolves.toBe(100n)
        const complete = await harness.rows()
        expect(complete).toHaveLength(4)
        expect(complete.find((snapshot) => snapshot.timestamp === '2020-01-01T00:00:00.000Z')?.balance_sats).toBe('0')
        await expect(queuedRead).resolves.toEqual(complete)
        await expect(observer.select().from(balanceSnapshots)).resolves.toHaveLength(4)
        await expect(observer.select().from(accountHistorySyncs)).resolves.toHaveLength(1)
      } finally {
        proceed.resolve(undefined)
        try {
          await run
        } finally {
          observer.$client.close()
        }
      }
    })
  })

  it('rolls back earlier coverage ranges when a later range fails in the same backfill', async () => {
    await withTestSetup(async () => {
      const { db, service } = harness
      await service.recordAccountSnapshot(accountId, '999', '2020-01-01T00:00:00.000Z')
      await harness.sync(100, 199)
      const beforeSnapshots = await db.select().from(balanceSnapshots)
      const beforeSyncs = await db.select().from(accountHistorySyncs)
      await db.run(sql`CREATE TEMP TRIGGER fail_later_range BEFORE INSERT ON account_history_syncs
        WHEN NEW.to_block_height > 199
        BEGIN SELECT RAISE(ABORT, 'Synthetic later-range failure'); END`)

      await expect(harness.run()).rejects.toThrow('Failed query: insert into "account_history_syncs"')
      await expect(db.select().from(accountHistorySyncs)).resolves.toEqual(beforeSyncs)
      await expect(db.select().from(balanceSnapshots)).resolves.toEqual(beforeSnapshots)
      await db.run(sql`DROP TRIGGER fail_later_range`)
      await expect(harness.run()).resolves.toBe(100n)
      await expect(harness.coverage()).resolves.toEqual([{ from_block_height: 0, to_block_height: tip.height }])
    })
  })

  it.each([
    ['snapshot', 'archive'],
    ['snapshot', 'delete'],
    ['coverage', 'archive'],
    ['coverage', 'delete'],
  ] as const)(
    'keeps the standalone %s check and write together when %s is queued after the check',
    async (kind, action) => {
      await withTestSetup(async () => {
        const { db, service } = harness
        const isActive = service['isAccountActive'].bind(service)
        let change: Promise<void> | undefined
        let rowsAtArchive: Awaited<ReturnType<typeof harness.rows>> = []
        let coverageAtArchive: Awaited<ReturnType<typeof harness.coverage>> = []
        service['isAccountActive'] = vi.fn(isActive).mockImplementationOnce(async (...args) => {
          const active = await isActive(...args)
          change = db.transaction(async (tx) => {
            if (action === 'archive') {
              await tx.update(accounts).set({ deletedAt: now.toISOString() }).where(eq(accounts.id, accountId))
              rowsAtArchive = await tx
                .select({ timestamp: balanceSnapshots.timestamp, balance_sats: balanceSnapshots.balanceSats })
                .from(balanceSnapshots)
                .orderBy(asc(balanceSnapshots.timestamp))
              coverageAtArchive = await tx
                .select({
                  from_block_height: accountHistorySyncs.fromBlockHeight,
                  to_block_height: accountHistorySyncs.toBlockHeight,
                })
                .from(accountHistorySyncs)
                .orderBy(asc(accountHistorySyncs.fromBlockHeight))
            } else {
              await tx.delete(accounts).where(eq(accounts.id, accountId))
            }
          })
          return active
        })

        const write =
          kind === 'snapshot' ? service.recordAccountSnapshot(accountId, '100', now.toISOString()) : harness.sync()
        const result = await Promise.allSettled([write])
        assert(change)
        await change
        expect(result[0]).toMatchObject({ status: 'fulfilled' })
        if (action === 'archive') {
          expect(kind === 'snapshot' ? rowsAtArchive : coverageAtArchive).toHaveLength(1)
          await expect(harness.rows()).resolves.toEqual(rowsAtArchive)
          await expect(harness.coverage()).resolves.toEqual(coverageAtArchive)
        } else {
          await expect(harness.rows()).resolves.toEqual([])
          await expect(harness.coverage()).resolves.toEqual([])
        }
      })
    },
  )

  it.each(['archive', 'delete'] as const)(
    'skips standalone writes when %s already made the account inactive',
    async (action) => {
      await withTestSetup(async () => {
        const { db, service } = harness
        if (action === 'archive') {
          await db.update(accounts).set({ deletedAt: now.toISOString() }).where(eq(accounts.id, accountId))
        } else {
          await db.delete(accounts).where(eq(accounts.id, accountId))
        }
        await service.recordAccountSnapshot(accountId, '100', now.toISOString())
        await harness.sync()
        await expect(harness.rows()).resolves.toEqual([])
        await expect(harness.coverage()).resolves.toEqual([])
      })
    },
  )
})

describe('history retry coordination', () => {
  it('reports persistent failures without stopping automatic retries, then clears the error on success', async () => {
    await withTestSetup(async () => {
      const { service, history } = harness
      history.mockResolvedValue(Err(new Error('Synthetic address failure')))
      for (let attempt = 1; attempt <= 12; attempt++) {
        await service['queueAccountHistoryBackfill'](accountId, account, 100n, new Date(0), true)
        await vi.waitFor(async () => {
          expect(service['accountHistoryBackfillsInFlight'].has(accountId)).toBe(false)
        })
        const data = (await service.getData({ customDateRange: customRange })).unwrap()
        expect(data.historyFailedAccountIds).toEqual([accountId])
        expect(data.historySyncingAccountIds).toEqual([accountId])
        expect(data.historyRefreshingAccountIds).toEqual([])
        expect(history).toHaveBeenCalledTimes(attempt)
        await expect(harness.coverage()).resolves.toEqual([])
        const cooldown = service['accountHistoryBackfillCooldownUntil'].get(accountId)
        assert.exists(cooldown, 'Expected a retry cooldown after a failed scan')
        vi.setSystemTime(cooldown + 1)
      }
      history.mockResolvedValue(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
      await service['queueAccountHistoryBackfill'](accountId, account, 100n, new Date(0), true)
      await vi.waitFor(async () => {
        expect(service['accountHistoryBackfillsInFlight'].has(accountId)).toBe(false)
      })
      const recovered = (await service.getData({ customDateRange: customRange })).unwrap()
      expect(recovered.historyFailedAccountIds).toEqual([])
      expect(recovered.historySyncingAccountIds).toEqual([])
      expect(recovered.historySyncedAccountIds).toEqual([accountId])
      expect(history).toHaveBeenCalledTimes(13)
    })
  })

  it('does not clear a failed wider scan cooldown when a narrower range is complete', async () => {
    await withTestSetup(async () => {
      const { service, history } = harness
      await harness.sync(tip.height - 60_000)
      history.mockResolvedValueOnce(Err(new Error('Electrum temporarily unavailable')))
      const request = async (): Promise<void> => {
        await service['queueAccountHistoryBackfill'](accountId, account, 100n, new Date(0), true)
      }
      await request()
      await vi.waitFor(async () => {
        expect(service['accountHistoryBackfillCooldownUntil'].has(accountId)).toBe(true)
      })
      const cooldown = service['accountHistoryBackfillCooldownUntil'].get(accountId)
      assert.exists(cooldown, 'Expected a retry cooldown after a failed scan')
      const status = await service['getAccountHistoryStatus'](
        [{ id: accountId, descriptor: account.toString(), network: 'mainnet' }],
        new Date('2025-09-05'),
        false,
      )
      expect(status.historySyncedAccountIds).toEqual([accountId])
      expect(status.historyFailedAccountIds).toEqual([])
      expect(service['accountHistoryBackfillCooldownUntil'].get(accountId)).toBe(cooldown)
      expect(service['accountHistoryBackfillFailureCounts'].get(accountId)).toBe(1)
      await request()
      expect(history).toHaveBeenCalledTimes(1)
      vi.setSystemTime(cooldown + 1)
      await request()
      await vi.waitFor(async () => {
        expect(history).toHaveBeenCalledTimes(2)
      })
      await vi.waitFor(async () => {
        expect(service['accountHistoryBackfillsInFlight'].has(accountId)).toBe(false)
      })
      expect(service['accountHistoryBackfillFailureCounts'].has(accountId)).toBe(false)
    })
  })
})

describe('current balance outages', () => {
  it('reports a never-loaded balance as unknown and recovers without inventing zero', async () => {
    await withTestSetup(async () => {
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Err(new Error('Electrum unavailable')))
      const offline = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(offline.currentTotalBalance).toBeNull()
      expect(offline.knownTotalBalance).toBe('0')
      expect(offline.balanceStatus).toMatchObject({
        complete: false,
        missingAccountIds: [accountId],
        staleAccountIds: [],
      })
      expect(offline.historicalData).toEqual([])
      const recovered = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(recovered.currentTotalBalance).toBe('100')
      expect(recovered.balanceStatus.complete).toBe(true)
      expect(recovered.balanceStatus.missingAccountIds).toEqual([])
    })
  })

  it('retains a confirmed zero snapshot with its original timestamp during an outage', async () => {
    await withTestSetup(async () => {
      const timestamp = '2020-01-03T09:00:00.000Z'
      await harness.service.recordAccountSnapshot(accountId, '0', timestamp)
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Err(new Error('Electrum unavailable')))
      const offline = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(offline.currentTotalBalance).toBe('0')
      expect(offline.balanceStatus).toEqual({
        complete: true,
        missingAccountIds: [],
        staleAccountIds: [accountId],
        asOf: timestamp,
      })
    })
  })

  it('keeps a partial subtotal separate from a complete portfolio balance', async () => {
    await withTestSetup(async () => {
      await harness.service.recordAccountSnapshot(accountId, '150', '2020-01-03T09:00:00.000Z')
      await harness.db
        .insert(accounts)
        .values({ id: 'new-wallet', descriptor: Wallets.singlesigLegacyAccount.toString(), displayName: 'New wallet' })
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Err(new Error('Electrum unavailable')))
      const offline = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(offline.currentTotalBalance).toBeNull()
      expect(offline.knownTotalBalance).toBe('150')
      expect(offline.balanceStatus).toMatchObject({
        complete: false,
        missingAccountIds: ['new-wallet'],
        staleAccountIds: [accountId],
      })
      expect(offline.historicalData.at(-1)?.totalBalance).toBe('150')
    })
  })

  it('does not treat an omitted provider result as a confirmed zero', async () => {
    await withTestSetup(async () => {
      harness.provider.getConfirmedAccountBalances.mockResolvedValueOnce(Ok(new IndexMap<Account, bigint>()))
      const data = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(data.currentTotalBalance).toBeNull()
      expect(data.balanceStatus.missingAccountIds).toEqual([accountId])
    })
  })

  it('keeps BTC available when the fiat price is unavailable or last known', async () => {
    await withTestSetup(async () => {
      harness.price.mockResolvedValueOnce(Err(new Error('Price unavailable')))
      const missingPrice = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(missingPrice.currentTotalBalance).toBe('100')
      expect(missingPrice.currentBtcPrice).toBeNull()
      expect(missingPrice.priceStatus).toBeNull()
      harness.price.mockResolvedValueOnce(
        Ok({ value: new Decimal(50_000), asOf: now, source: 'block', lastKnown: true }),
      )
      const cachedPrice = (await harness.service.getData({ timeRange: '90d' })).unwrap()
      expect(cachedPrice.currentBtcPrice).toBe('50000')
      expect(cachedPrice.priceStatus).toEqual({ asOf: now.toISOString(), lastKnown: true })
    })
  })
})
