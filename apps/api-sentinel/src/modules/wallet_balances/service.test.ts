import type { Account } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import type { Block } from '@hoseki/packages/bitcoin/onchain'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap, type IndexSet } from '@hoseki/packages/collection'
import { AsyncResult, Err, Ok, type Result } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { asc, eq, sql } from 'drizzle-orm'
import { type MockInstance, expect, it, vi } from 'vitest'
import { accounts, balanceSnapshots } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { WalletBalanceService, retryDelayMs } from './service'

const first = Wallets.singlesigNativeSegwitAccount
const second = Wallets.singlesigTaprootAccount
const tip: Block = { height: 800_000, hash: 'a'.repeat(64), timestamp: new Date('2024-02-10T11:55:00.000Z') }

type Scan = Result<IndexMap<Account, bigint>, Error>

async function setup(): Promise<{
  service: WalletBalanceService
  db: Awaited<ReturnType<typeof setupServiceDatabase>>['db']
  scans: ReturnType<typeof vi.fn<(requested: IndexSet<Account>) => AsyncResult<IndexMap<Account, bigint>, Error>>>
  tipReads: MockInstance<() => AsyncResult<Block, Error>>
  answer: (account: Account, result: Scan) => void
  snapshots: () => Promise<Array<{ accountId: string; balanceSats: string }>>
}> {
  const { db, logger } = await setupServiceDatabase()
  await db.insert(accounts).values([
    { id: 'first', descriptor: first.toString(), displayName: 'First wallet' },
    { id: 'second', descriptor: second.toString(), displayName: 'Second wallet' },
  ])
  const onchainProvider = new ElectrumProvider(Network.Mainnet, {
    logger,
    electrum: new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' }),
  })
  const tipReads = vi.spyOn(onchainProvider, 'getBlocksTip').mockReturnValue(new AsyncResult(Promise.resolve(Ok(tip))))
  // Each scan waits until the test answers it, so tests control when scans finish.
  const pending = new Map<string, Array<(result: Scan) => void>>()
  const scans = vi.fn((requested: IndexSet<Account>): AsyncResult<IndexMap<Account, bigint>, Error> => {
    const [account] = [...requested]
    const key = account?.toString() ?? ''
    return new AsyncResult(
      new Promise<Scan>((resolve) => {
        pending.set(key, [...(pending.get(key) ?? []), resolve])
      }),
    )
  })
  vi.spyOn(onchainProvider, 'getConfirmedAccountBalances').mockImplementation(scans)
  const service = new WalletBalanceService({ db, logger, onchainProvider })
  return {
    service,
    db,
    scans,
    tipReads,
    answer: (account, result) => {
      const waiting = pending.get(account.toString()) ?? []
      pending.set(account.toString(), [])
      for (const resolve of waiting) {
        resolve(result)
      }
    },
    snapshots: async () =>
      db
        .select({ accountId: balanceSnapshots.accountId, balanceSats: balanceSnapshots.balanceSats })
        .from(balanceSnapshots)
        .orderBy(asc(balanceSnapshots.accountId)),
  }
}

const BALANCE_MAX_AGE_MS = 60_000

const balanceOf = (account: Account, sats: bigint): Scan => Ok(new IndexMap<Account, bigint>([[account, sats]]))

async function scanStarted(scans: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(scans).toHaveBeenCalledTimes(count)
  })
}

async function settled(service: WalletBalanceService, id: string): Promise<void> {
  await vi.waitFor(async () => {
    expect((await service.readBalances([id]))[0]?.syncing).toBe(false)
  })
}

it('shares one scan between callers asking at the same time, and records it once', async () => {
  const { service, scans, answer, snapshots } = await setup()
  const requests = [service.getLiveBalances(['first']), service.getLiveBalances(['first']), service.refreshAll()]
  await scanStarted(scans, 2)
  expect((await service.readBalances(['first']))[0]?.syncing).toBe(true)
  answer(first, balanceOf(first, 1_000n))
  answer(second, balanceOf(second, 2_000n))

  const [one, two] = await Promise.all(requests)
  expect(one?.get('first')?.unwrap().balanceSats).toBe(1_000n)
  expect(two?.get('first')?.unwrap().balanceSats).toBe(1_000n)
  expect(scans).toHaveBeenCalledTimes(2)
  expect((await service.readBalances(['first']))[0]).toMatchObject({ syncing: false, failed: false })
  await expect(snapshots()).resolves.toEqual([
    { accountId: 'first', balanceSats: '1000' },
    { accountId: 'second', balanceSats: '2000' },
  ])
})

it('reuses a recent balance, and scans again once it is older than allowed', async () => {
  const { service, scans, answer } = await setup()
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, balanceOf(first, 1_000n))
  await fetching

  await expect(service.getLiveBalances(['first'])).resolves.toHaveProperty('size', 1)
  await service.readBalances(['first'])
  expect(scans).toHaveBeenCalledTimes(1)

  vi.setSystemTime(Date.now() + BALANCE_MAX_AGE_MS + 1)
  const again = service.getLiveBalances(['first'])
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_500n))
  expect((await again).get('first')?.unwrap().balanceSats).toBe(1_500n)
})

it('keeps scanning other wallets when one fails, and logs only the kind of failure', async () => {
  const { service, scans, answer, snapshots } = await setup()
  const warn = vi.spyOn(service['logger'], 'warn')
  const fetching = service.getLiveBalances(['first', 'second'])
  await scanStarted(scans, 2)
  answer(first, Err(new Error('Connection closed: synthetic-sensitive-detail')))
  answer(second, balanceOf(second, 2_000n))

  const results = await fetching
  expect(results.get('first')?.isErr()).toBe(true)
  expect(results.get('second')?.unwrap().balanceSats).toBe(2_000n)
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ accountId: 'first', failure: 'unreachable' }),
    'Wallet balance scan failed',
  )
  await expect(snapshots()).resolves.toEqual([{ accountId: 'second', balanceSats: '2000' }])
  expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-sensitive-detail')
})

it('waits before a read scans a failed wallet again, but not when asked directly', async () => {
  const { service, scans, answer } = await setup()
  const warn = vi.spyOn(service['logger'], 'warn')
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, Err(Object.assign(new Error('Request timed out'), { name: 'ElectrumTimeoutError' })))
  await fetching
  expect(warn).toHaveBeenCalledWith(
    expect.objectContaining({ failure: 'timeout', retryMs: 10_000 }),
    'Wallet balance scan failed',
  )

  expect((await service.readBalances(['first']))[0]).toMatchObject({ syncing: false, failed: true })
  expect(scans).toHaveBeenCalledTimes(1)

  const direct = service.getLiveBalances(['first'])
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_000n))
  expect((await direct).get('first')?.isOk()).toBe(true)
  expect((await service.readBalances(['first']))[0]).toMatchObject({ balanceSats: 1_000n, failed: false })
})

it('waits 10, 20, 40, then 60 s after failures in a row', () => {
  expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([10_000, 20_000, 40_000, 60_000, 60_000, 60_000])
})

it('leaves out a wallet archived during its scan and records nothing for it', async () => {
  const { service, db, scans, answer, snapshots } = await setup()
  const fetching = service.getLiveBalances(['first', 'second'])
  await scanStarted(scans, 2)
  await db.update(accounts).set({ deletedAt: new Date().toISOString() }).where(eq(accounts.id, 'first'))
  service.invalidate('first')
  answer(first, balanceOf(first, 1_000n))
  answer(second, balanceOf(second, 2_000n))

  const results = await fetching
  expect([...results.keys()]).toEqual(['second'])
  await expect(snapshots()).resolves.toEqual([{ accountId: 'second', balanceSats: '2000' }])
  await expect(service.getLiveBalances(['first'])).resolves.toHaveProperty('size', 0)
})

it('forgets balances when the server changes', async () => {
  const { service, scans, answer } = await setup()
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, balanceOf(first, 1_000n))
  await fetching

  service.invalidateAll()
  const again = service.getLiveBalances(['first'])
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_000n))
  await again
})

it('reuses a balance for a history check only if its scan started at the same chain tip', async () => {
  const { service, scans, answer } = await setup()
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, balanceOf(first, 1_000n))
  await fetching

  await expect(service.getLiveBalances(['first'], { anchoredTo: tip })).resolves.toHaveProperty('size', 1)
  expect(scans).toHaveBeenCalledTimes(1)

  const newerTip = { ...tip, height: tip.height + 1, hash: 'b'.repeat(64) }
  const anchored = service.getLiveBalances(['first'], { anchoredTo: newerTip })
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_000n))
  await anchored
})

it('reads the newest known balance at once, starting a scan for wallets that are out of date', async () => {
  const { service, db, scans, answer } = await setup()
  await db
    .insert(balanceSnapshots)
    .values({ accountId: 'first', balanceSats: '900', timestamp: '2024-02-09T00:00:00.000Z' })

  await expect(service.readBalances(['first', 'second'])).resolves.toEqual([
    {
      accountId: 'first',
      balanceSats: 900n,
      asOf: new Date('2024-02-09T00:00:00.000Z'),
      tip: null,
      syncing: true,
      failed: false,
    },
    { accountId: 'second', balanceSats: null, asOf: null, tip: null, syncing: true, failed: false },
  ])
  await scanStarted(scans, 2)
  // Reading again while the scans run joins them rather than starting more.
  await service.readBalances(['first', 'second'])
  expect(scans).toHaveBeenCalledTimes(2)

  answer(first, balanceOf(first, 1_000n))
  answer(second, Err(new Error('Connection closed')))
  await settled(service, 'second')
  await expect(service.readBalances(['first', 'second'])).resolves.toEqual([
    { accountId: 'first', balanceSats: 1_000n, asOf: new Date(), tip, syncing: false, failed: false },
    { accountId: 'second', balanceSats: null, asOf: null, tip: null, syncing: false, failed: true },
  ])
  // A failed wallet waits before it is scanned again.
  expect(scans).toHaveBeenCalledTimes(2)
})

it('leaves archived wallets out of a read', async () => {
  const { service, db } = await setup()
  await db.update(accounts).set({ deletedAt: new Date().toISOString() }).where(eq(accounts.id, 'second'))
  const read = await service.readBalances(['first', 'second'])
  expect(read.map(({ accountId }) => accountId)).toEqual(['first'])
})

it('gives the chain tip Electrum answers with, a recent one while it is slow, and none once that is old', async () => {
  const { service, tipReads } = await setup()
  await expect(service.currentTip(1_000)).resolves.toEqual({ tip, failed: false })

  tipReads.mockReturnValueOnce(new AsyncResult(Promise.resolve(Err(new Error('Connection closed')))))
  await expect(service.currentTip(1_000)).resolves.toEqual({ tip: null, failed: true })

  // Electrum stops answering: the tip read a moment ago stands in, and the read is shared.
  tipReads.mockReturnValue(new AsyncResult(new Promise(() => undefined)))
  await expect(service.currentTip(20)).resolves.toEqual({ tip, failed: false })
  await expect(service.currentTip(20)).resolves.toEqual({ tip, failed: false })
  expect(tipReads).toHaveBeenCalledTimes(3)

  vi.setSystemTime(Date.now() + 10 * 60_000 + 1)
  await expect(service.currentTip(20)).resolves.toEqual({ tip: null, failed: false })
})

it('reports a wallet whose descriptor cannot be read as failing, so pages count it as empty', async () => {
  const { service, db } = await setup()
  await db.insert(accounts).values({ id: 'broken', descriptor: 'not a descriptor', displayName: 'Broken wallet' })
  const [read] = await service.readBalances(['broken'])
  expect(read).toMatchObject({ accountId: 'broken', balanceSats: null, syncing: false, failed: true })
})

it('keeps a fetched balance when recording it fails, and records it on the next refresh', async () => {
  const { service, db, scans, answer, snapshots } = await setup()
  await db.run(sql`CREATE TEMP TRIGGER fail_snapshot BEFORE INSERT ON balance_snapshots
    BEGIN SELECT RAISE(ABORT, 'Synthetic snapshot failure'); END`)
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, balanceOf(first, 1_000n))
  expect((await fetching).get('first')?.unwrap()).toMatchObject({ balanceSats: 1_000n, recorded: false })
  await expect(snapshots()).resolves.toEqual([])

  await db.run(sql`DROP TRIGGER fail_snapshot`)
  const refreshing = service.refreshAll()
  await scanStarted(scans, 3)
  answer(first, balanceOf(first, 1_000n))
  answer(second, balanceOf(second, 2_000n))
  expect((await refreshing).get('first')?.unwrap().recorded).toBe(true)
  await expect(snapshots()).resolves.toEqual([
    { accountId: 'first', balanceSats: '1000' },
    { accountId: 'second', balanceSats: '2000' },
  ])
})

it('records a balance the periodic refresh shares with a history backfill, which records none itself', async () => {
  const { service, scans, answer, snapshots } = await setup()
  const backfill = service.getLiveBalances(['first'], { anchoredTo: tip, record: false })
  await scanStarted(scans, 1)
  const periodic = service.refreshAll()
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_000n))
  answer(second, balanceOf(second, 2_000n))

  expect((await backfill).get('first')?.unwrap().balanceSats).toBe(1_000n)
  expect((await periodic).get('first')?.unwrap().recorded).toBe(true)
  await expect(snapshots()).resolves.toEqual([
    { accountId: 'first', balanceSats: '1000' },
    { accountId: 'second', balanceSats: '2000' },
  ])
})

it('retries a failing wallet after 10, 20, 40, then every 60 s, and starts over once it succeeds', async () => {
  const { service, scans, answer } = await setup()
  const unreachable = Err(new Error('Connection closed'))
  let started = 0
  const scanAnswered = async (result: Scan): Promise<void> => {
    started += 1
    await scanStarted(scans, started)
    answer(first, result)
    await settled(service, 'first')
  }
  await service.readBalances(['first'])
  await scanAnswered(unreachable)
  for (const delayMs of [10_000, 20_000, 40_000, 60_000, 60_000]) {
    vi.setSystemTime(Date.now() + delayMs - 1)
    await service.readBalances(['first'])
    expect(scans).toHaveBeenCalledTimes(started)
    vi.setSystemTime(Date.now() + 1)
    await service.readBalances(['first'])
    await scanAnswered(unreachable)
  }

  vi.setSystemTime(Date.now() + 60_000)
  await service.readBalances(['first'])
  await scanAnswered(balanceOf(first, 1_000n))
  // The balance goes out of date and the next scan fails: the wait starts over at 10 s.
  vi.setSystemTime(Date.now() + BALANCE_MAX_AGE_MS + 1)
  await service.readBalances(['first'])
  await scanAnswered(unreachable)
  vi.setSystemTime(Date.now() + 10_000)
  await service.readBalances(['first'])
  expect(scans).toHaveBeenCalledTimes(started + 1)
})

it('forgets a chain tip the old server answers with after the server changes', async () => {
  const { service, tipReads } = await setup()
  let answerOldServer: (result: Result<Block, Error>) => void = () => undefined
  tipReads.mockReturnValueOnce(
    new AsyncResult(
      new Promise((resolve) => {
        answerOldServer = resolve
      }),
    ),
  )
  await expect(service.currentTip(10)).resolves.toEqual({ tip: null, failed: false })

  service.invalidateAll()
  answerOldServer(Ok(tip))
  // The new server doesn't answer yet: nothing from the old one stands in for its tip.
  tipReads.mockReturnValue(new AsyncResult(new Promise(() => undefined)))
  await expect(service.currentTip(10)).resolves.toEqual({ tip: null, failed: false })
  expect(tipReads).toHaveBeenCalledTimes(2)
})

it('still reads as syncing when the server changes during a read, so pages keep polling', async () => {
  const { service, db } = await setup()
  await db
    .insert(balanceSnapshots)
    .values({ accountId: 'first', balanceSats: '900', timestamp: '2024-02-09T00:00:00.000Z' })
  const select = db.select.bind(db)
  let selects = 0
  // The read's second query is the wallet's snapshot: the server changes while it runs.
  vi.spyOn(db, 'select').mockImplementation((...args: Parameters<typeof db.select>) => {
    selects += 1
    if (selects === 2) {
      service.invalidateAll()
    }
    return select(...args)
  })
  const [read] = await service.readBalances(['first'])
  expect(read).toMatchObject({ accountId: 'first', balanceSats: 900n, syncing: true })
})
