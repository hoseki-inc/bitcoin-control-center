import type { Account } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import type { Block } from '@hoseki/packages/bitcoin/onchain'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap, type IndexSet } from '@hoseki/packages/collection'
import { AsyncResult, Err, Ok, type Result } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { asc, eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { accounts, balanceSnapshots } from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { WALLET_BALANCE_MAX_AGE_MS, WalletBalanceService } from './service'

const first = Wallets.singlesigNativeSegwitAccount
const second = Wallets.singlesigTaprootAccount
const tip: Block = { height: 800_000, hash: 'a'.repeat(64), timestamp: new Date('2024-02-10T11:55:00.000Z') }

type Scan = Result<IndexMap<Account, bigint>, Error>

async function setup(): Promise<{
  service: WalletBalanceService
  db: Awaited<ReturnType<typeof setupServiceDatabase>>['db']
  scans: ReturnType<typeof vi.fn<(requested: IndexSet<Account>) => AsyncResult<IndexMap<Account, bigint>, Error>>>
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
  vi.spyOn(onchainProvider, 'getBlocksTip').mockReturnValue(new AsyncResult(Promise.resolve(Ok(tip))))
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

const balanceOf = (account: Account, sats: bigint): Scan => Ok(new IndexMap<Account, bigint>([[account, sats]]))

async function scanStarted(scans: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(scans).toHaveBeenCalledTimes(count)
  })
}

it('shares one scan between callers asking at the same time, and records it once', async () => {
  const { service, scans, answer, snapshots } = await setup()
  const requests = [service.getLiveBalances(['first']), service.getLiveBalances(['first']), service.refreshAll()]
  await scanStarted(scans, 2)
  expect(service.getStatus('first').syncing).toBe(true)
  answer(first, balanceOf(first, 1_000n))
  answer(second, balanceOf(second, 2_000n))

  const [one, two] = await Promise.all(requests)
  expect(one?.get('first')?.unwrap().balanceSats).toBe(1_000n)
  expect(two?.get('first')?.unwrap().balanceSats).toBe(1_000n)
  expect(scans).toHaveBeenCalledTimes(2)
  expect(service.getStatus('first')).toMatchObject({ syncing: false, failure: null })
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
  await service.refreshStale(['first'])
  expect(scans).toHaveBeenCalledTimes(1)

  vi.setSystemTime(Date.now() + WALLET_BALANCE_MAX_AGE_MS + 1)
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
  expect(service.getStatus('first').failure).toBe('unreachable')
  await expect(snapshots()).resolves.toEqual([{ accountId: 'second', balanceSats: '2000' }])
  expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-sensitive-detail')
})

it('waits before scanning a failed wallet again in the background, but not when asked directly', async () => {
  const { service, scans, answer } = await setup()
  const fetching = service.getLiveBalances(['first'])
  await scanStarted(scans, 1)
  answer(first, Err(Object.assign(new Error('Request timed out'), { name: 'ElectrumTimeoutError' })))
  await fetching
  expect(service.getStatus('first').failure).toBe('timeout')

  await expect(service.refreshStale(['first'])).resolves.toHaveProperty('size', 0)
  expect(scans).toHaveBeenCalledTimes(1)

  vi.setSystemTime(Date.now() + 10_001)
  const retry = service.refreshStale(['first'])
  await scanStarted(scans, 2)
  answer(first, balanceOf(first, 1_000n))
  expect((await retry).get('first')?.isOk()).toBe(true)
  expect(service.getStatus('first').failure).toBeNull()
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
  expect(service.getStatus('first').live).toBeNull()
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
      balanceSats: '900',
      asOf: '2024-02-09T00:00:00.000Z',
      syncing: true,
      failed: false,
      failure: null,
    },
    { accountId: 'second', balanceSats: null, asOf: null, syncing: true, failed: false, failure: null },
  ])
  await scanStarted(scans, 2)
  // Reading again while the scans run joins them rather than starting more.
  await service.readBalances(['first', 'second'])
  expect(scans).toHaveBeenCalledTimes(2)

  answer(first, balanceOf(first, 1_000n))
  answer(second, Err(new Error('Connection closed')))
  await vi.waitFor(() => {
    expect(service.getStatus('second').syncing).toBe(false)
  })
  await expect(service.readBalances(['first', 'second'])).resolves.toEqual([
    {
      accountId: 'first',
      balanceSats: '1000',
      asOf: service.getStatus('first').live?.fetchedAt.toISOString(),
      syncing: false,
      failed: false,
      failure: null,
    },
    { accountId: 'second', balanceSats: null, asOf: null, syncing: false, failed: true, failure: 'unreachable' },
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
