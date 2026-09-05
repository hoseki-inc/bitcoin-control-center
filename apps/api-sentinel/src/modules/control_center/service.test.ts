import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Block, TransactionEntry } from '@hoseki/packages/bitcoin/onchain'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { IndexMap } from '@hoseki/packages/collection'
import { Wallets } from '@hoseki/packages/testing'
import { Err, Ok, type Result } from '@patina/core'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initDatabase } from '../../db'
import type { EtfService } from '../etf/service'
import type { ExchangeService } from '../exchange/service'
import type { ManualService } from '../manual/service'
import type { PriceService } from '../price/service'
import { ControlCenterService } from './service'

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

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function createHarness() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-history-test-'))
  const logger = pino({ level: 'silent' })
  const database = initDatabase(directory, logger)
  const db = database.db
  db.prepare('INSERT INTO accounts (id, descriptor, display_name) VALUES (?, ?, ?)').run(
    accountId,
    account.toString(),
    'Test wallet',
  )
  const provider = {
    getBlocksTip: vi.fn(async () => Ok(tip)),
    getBlock: vi.fn(async () => Ok(tip)),
    getConfirmedAccountBalances: vi.fn(async () => Ok(new IndexMap<Account, bigint>([[account, 100n]]))),
  }
  const price = vi.fn(async () => Ok({ value: 50_000 }))
  const service = new ControlCenterService({
    db,
    logger,
    onchainProvider: provider as unknown as ElectrumProvider,
    exchangeService: { listAccounts: () => [] } as unknown as ExchangeService,
    manualService: { listAccounts: () => [], getTransactionEntries: () => [] } as unknown as ManualService,
    etfService: { listAccounts: () => [], getAccumulationEntries: () => [] } as unknown as EtfService,
    priceService: { getCurrentBtcPrice: price } as unknown as PriceService,
  })
  // Replace only the external history fetch. Snapshot storage, range coverage,
  // retry scheduling and response construction all use the real service.
  const history = vi
    .spyOn(
      service as unknown as {
        getTransactionEntriesByAccountSinceBlock(
          account: Account,
          height: number,
        ): Promise<Result<TransactionEntry[], Error>>
      },
      'getTransactionEntriesByAccountSinceBlock',
    )
    .mockResolvedValue(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
  const sync = (from = 0, to = tip.height): void =>
    service['recordAccountHistorySync'](accountId, { fromBlockHeight: from, toBlockHeight: to }, tip)
  const run = (balance: bigint | undefined = 100n): Promise<bigint | null> =>
    service['ensureAccountHistorySnapshots'](accountId, account, balance, new Date(0), true)
  const rows = (): Array<{ timestamp: string; balance_sats: string }> =>
    db.prepare('SELECT timestamp, balance_sats FROM balance_snapshots ORDER BY timestamp').all() as Array<{
      timestamp: string
      balance_sats: string
    }>
  const coverage = (): Array<{ from_block_height: number; to_block_height: number }> =>
    db
      .prepare('SELECT from_block_height, to_block_height FROM account_history_syncs ORDER BY from_block_height')
      .all() as Array<{
      from_block_height: number
      to_block_height: number
    }>
  const close = (): void => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  }
  return { db, provider, service, history, price, sync, run, rows, coverage, close }
}

let harness: ReturnType<typeof createHarness>

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)
  harness = createHarness()
})

afterEach(() => {
  harness.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('portfolio history completion', () => {
  it('starts All at the earliest current or archived wallet activity and respects account selection', async () => {
    const { db, service } = harness
    harness.sync()
    service.recordAccountSnapshot(accountId, '0', '2009-01-03T00:00:00.000Z')
    service.recordAccountSnapshot(accountId, '100', '2020-01-02T12:00:00.000Z')

    const archivedId = 'archived-wallet'
    db.prepare('INSERT INTO accounts (id, descriptor, display_name) VALUES (?, ?, ?)').run(
      archivedId,
      Wallets.singlesigLegacyAccount.toString(),
      'Archived wallet',
    )
    service.recordAccountSnapshot(archivedId, '0', '2009-01-03T00:00:00.000Z')
    service.recordAccountSnapshot(archivedId, '50', '2018-06-05T12:00:00.000Z')
    db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run('2019-01-01T12:00:00.000Z', archivedId)

    const all = (await service.getData({ timeRange: 'all' })).unwrap()
    expect(all.historicalData[0]?.timestamp).toBe('2018-06-05T00:00:00.000Z')
    expect(all.historicalData[1]?.totalBalance).toBe('50')
    expect(all.historicalData.find(({ timestamp }) => timestamp === '2019-01-01T23:59:59.999Z')?.totalBalance).toBe('0')
    expect(all.historicalData.at(-1)?.totalBalance).toBe('100')
    expect(all.historySyncingAccountIds).toEqual([])

    const selected = (await service.getData({ timeRange: 'all', accountIds: [accountId] })).unwrap()
    expect(selected.historicalData[0]?.timestamp).toBe('2020-01-02T00:00:00.000Z')

    db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run('2021-01-01T12:00:00.000Z', accountId)
    const archivedOnly = (await service.getData({ timeRange: 'all' })).unwrap()
    expect(archivedOnly.historicalData[0]?.timestamp).toBe('2018-06-05T00:00:00.000Z')
    expect(archivedOnly.historicalData.at(-1)?.totalBalance).toBe('0')
  })

  it('returns the new snapshots when a backfill finishes while another data source is loading', async () => {
    const { service, history, price } = harness
    const pendingHistory = deferred<Result<TransactionEntry[], Error>>()
    const pendingPrice = deferred<ReturnType<typeof Ok<{ value: number }>>>()
    history.mockReturnValueOnce(pendingHistory.promise)
    price.mockReturnValueOnce(pendingPrice.promise)
    const resultPromise = service.getData({ customDateRange: customRange })
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(1))
    pendingHistory.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
    await vi.waitFor(() => expect(harness.coverage()).toHaveLength(1))
    pendingPrice.resolve(Ok({ value: 50_000 }))
    const data = (await resultPromise).unwrap()
    expect(data.historySyncingAccountIds).toEqual([])
    expect(data.historySyncedAccountIds).toEqual([accountId])
    expect(data.historicalData.map(({ totalBalance }) => totalBalance)).toEqual(['0', '0', '100', '100'])
  })

  it('reports loading until the requested full history has completed', async () => {
    const pending = deferred<Result<TransactionEntry[], Error>>()
    harness.history.mockReturnValueOnce(pending.promise)
    const data = (await harness.service.getData({ customDateRange: customRange })).unwrap()
    expect(data.historySyncingAccountIds).toEqual([accountId])
    expect(data.historySyncedAccountIds).toEqual([])
    pending.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
    await vi.waitFor(() => expect(harness.coverage()).toHaveLength(1))
  })

  it('does not fetch history or balances again when coverage is complete', async () => {
    harness.sync()
    expect(await harness.run()).toBe(100n)
    expect(harness.history).not.toHaveBeenCalled()
    expect(harness.provider.getConfirmedAccountBalances).not.toHaveBeenCalled()
    expect(harness.provider.getBlocksTip).toHaveBeenCalledTimes(1)
  })

  it('still verifies the balance for archival with complete coverage', async () => {
    harness.sync()
    expect(
      await harness.service['ensureAccountHistorySnapshots'](accountId, account, undefined, new Date(0), true),
    ).toBe(100n)
    expect(harness.provider.getConfirmedAccountBalances).toHaveBeenCalledTimes(1)
    expect(harness.history).not.toHaveBeenCalled()
  })

  it('rechecks history certified by the old partial-response implementation', async () => {
    harness.sync()
    harness.db.prepare('UPDATE account_history_syncs SET sync_version = 4').run()
    expect(await harness.run()).toBe(100n)
    expect(harness.history).toHaveBeenCalledWith(account, 0)
    expect(harness.db.prepare('SELECT sync_version FROM account_history_syncs').get()).toEqual({ sync_version: 5 })
  })
})

describe('history scan boundaries', () => {
  it('reconciles snapshots that predate the estimated genesis timestamp', async () => {
    harness.service.recordAccountSnapshot(accountId, '50', '2009-01-04T12:00:00.000Z')
    harness.history.mockResolvedValue(Ok([entry(100n, '2009-01-05T12:00:00.000Z', 100)]))
    expect(await harness.run()).toBe(100n)
    expect(harness.rows().find(({ timestamp }) => timestamp === '2009-01-04T12:00:00.000Z')?.balance_sats).toBe('0')
  })

  it('retains progress through multiple new blocks without rescanning old transactions', async () => {
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
    expect(await harness.run()).toBe(130n)
    expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([0, tip.height, nextTip.height])
    expect(harness.rows().find(({ timestamp }) => timestamp === '2020-01-02T12:00:00.000Z')?.balance_sats).toBe('100')
    expect(harness.rows().at(-1)?.balance_sats).toBe('130')
  })

  it('does not certify an unverified or incomplete tail after the chain advances', async () => {
    harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
    harness.history
      .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
      .mockResolvedValueOnce(Err(new Error('Tail unavailable')))
    expect(await harness.run()).toBeNull()
    expect(harness.coverage()).toEqual([])
    expect(harness.rows()).toEqual([])
  })

  it('keeps the long scan and fetches only the new tail when the chain advances', async () => {
    const tail = entry(20n, nextTip.timestamp.toISOString(), nextTip.height)
    harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
    harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 120n]])))
    // The initial scan may already contain the new block; it must not be counted twice.
    harness.history
      .mockResolvedValueOnce(Ok([entry(100n, '2020-01-02T12:00:00.000Z'), tail]))
      .mockResolvedValueOnce(Ok([tail]))
    expect(await harness.run()).toBe(120n)
    expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([0, tip.height])
    expect(harness.provider.getBlock).toHaveBeenCalledWith(tip.height)
    expect(harness.rows().find(({ timestamp }) => timestamp === '2020-01-02T12:00:00.000Z')?.balance_sats).toBe('100')
    expect(harness.rows().at(-1)?.balance_sats).toBe('120')
    expect(harness.coverage()).toEqual([{ from_block_height: 0, to_block_height: nextTip.height }])
  })

  it('preserves archived history if a new block arrives after the cached-range check', async () => {
    harness.sync()
    harness.service.recordAccountSnapshot(accountId, '100', '2020-01-02T12:00:00.000Z')
    harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(nextTip))
    harness.provider.getConfirmedAccountBalances.mockResolvedValue(Ok(new IndexMap([[account, 120n]])))
    harness.history.mockResolvedValue(Ok([entry(20n, nextTip.timestamp.toISOString(), nextTip.height)]))
    expect((await harness.service.archiveAccount(accountId)).isOk()).toBe(true)
    expect(harness.history.mock.calls.map(([, height]) => height)).toEqual([tip.height])
    expect(harness.rows()[0]?.balance_sats).toBe('100')
    expect(harness.rows().at(-1)?.balance_sats).toBe('120')
    expect(harness.coverage()).toEqual([
      { from_block_height: 0, to_block_height: tip.height },
      { from_block_height: nextTip.height, to_block_height: nextTip.height },
    ])
  })

  it.each(['same-height reorganization', 'deeper reorganization', 'height rollback'])(
    'does not certify history after a %s',
    async (scenario) => {
      const changedTip =
        scenario === 'same-height reorganization'
          ? { ...tip, hash: 'reorganized' }
          : scenario === 'height rollback'
            ? { ...tip, height: tip.height - 1 }
            : nextTip
      harness.provider.getBlocksTip.mockResolvedValueOnce(Ok(tip)).mockResolvedValue(Ok(changedTip))
      harness.provider.getBlock.mockResolvedValue(Ok({ ...tip, hash: 'reorganized' }))
      expect(await harness.run()).toBeNull()
      expect(harness.coverage()).toEqual([])
      expect(harness.rows()).toEqual([])
    },
  )

  it('does not save snapshots or completion after a partial history failure', async () => {
    harness.history.mockResolvedValue(Err(new Error('Electrum unavailable')))
    expect(await harness.run()).toBeNull()
    expect(harness.coverage()).toEqual([])
    expect(harness.rows()).toEqual([])
  })

  it('does not let an invalidated background scan overwrite account history', async () => {
    const pending = deferred<Result<TransactionEntry[], Error>>()
    harness.history.mockReturnValueOnce(pending.promise)
    const result = harness.run()
    await vi.waitFor(() => expect(harness.history).toHaveBeenCalledTimes(1))
    harness.service['invalidateAccountHistoryBackfill'](accountId)
    pending.resolve(Ok([entry(100n, '2020-01-02T12:00:00.000Z')]))
    expect(await result).toBeNull()
    expect(harness.coverage()).toEqual([])
    expect(harness.rows()).toEqual([])
  })
})

describe('history retry coordination', () => {
  it('does not clear a failed wider scan cooldown when a narrower range is complete', async () => {
    const { service, history } = harness
    harness.sync(tip.height - 60_000)
    history.mockResolvedValueOnce(Err(new Error('Electrum temporarily unavailable')))
    const request = (): void => service['queueAccountHistoryBackfill'](accountId, account, 100n, new Date(0), true)
    request()
    await vi.waitFor(() => expect(service['accountHistoryBackfillCooldownUntil'].has(accountId)).toBe(true))
    const cooldown = service['accountHistoryBackfillCooldownUntil'].get(accountId)!
    const status = await service['getAccountHistoryStatus'](
      [{ id: accountId, descriptor: account.toString(), network: 'mainnet' }],
      new Date('2025-09-05'),
      false,
    )
    expect(status.historySyncedAccountIds).toEqual([accountId])
    expect(service['accountHistoryBackfillCooldownUntil'].get(accountId)).toBe(cooldown)
    expect(service['accountHistoryBackfillFailureCounts'].get(accountId)).toBe(1)
    request()
    expect(history).toHaveBeenCalledTimes(1)
    vi.setSystemTime(cooldown + 1)
    request()
    await vi.waitFor(() => expect(history).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(service['accountHistoryBackfillsInFlight'].has(accountId)).toBe(false))
    expect(service['accountHistoryBackfillFailureCounts'].has(accountId)).toBe(false)
  })
})
