import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '@hoseki/packages/bitcoin/account'
import type { Block, TransactionEntry } from '@hoseki/packages/bitcoin/onchain'
import { Txid } from '@hoseki/packages/bitcoin/txid'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap } from '@hoseki/packages/collection'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { asc, eq } from 'drizzle-orm'
import pino from 'pino'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createAppContext } from '../../context'
import { accountHistorySyncs, accounts, balanceSnapshots } from '../../db/schema'
import * as env from '../../env'
import { appRouter } from '../../modules/trpc/router'

const tip: Block = { height: 900_000, hash: 'tip', timestamp: new Date('2026-09-05T11:00:00.000Z') }
const deposit: TransactionEntry = {
  txid: Txid.fromString('1'.repeat(64)).unwrap(),
  address: Wallets.segwitAddress,
  value: 120n,
  timestamp: new Date('2020-01-02T12:00:00.000Z'),
  confirmed: true,
  blockHeight: 600_000,
}

/** A real app and database. Only Electrum's replies are stubbed: a fixed tip, one deposit and a 120 sat balance. */
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-archive-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(env, 'loadEnv').mockReturnValue({ ...env.loadEnv(), DATA_DIR: directory })
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const app = (await createAppContext(pino({ level: 'silent' }))).unwrap()
  onTestFinished(() => {
    app.database.$client.close()
    app.electrumClient.disconnect()
  })

  const electrum = {
    tip: vi.spyOn(app.onchainProvider, 'getBlocksTip').mockImplementation(asyncFn(async () => Ok(tip))),
    balances: vi
      .spyOn(app.onchainProvider, 'getConfirmedAccountBalances')
      .mockImplementation(
        asyncFn(async (requested: Iterable<Account>) =>
          Ok(new IndexMap<Account, bigint>([...requested].map((account) => [account, 120n]))),
        ),
      ),
  }
  app.controlCenterService['getTransactionEntriesByAccountSinceBlock'] = vi.fn().mockResolvedValue(Ok([deposit]))

  const caller = appRouter.createCaller({ app }).portalProve.accounts
  const create = async (account: Account, displayName: string): Promise<string> =>
    (
      await caller.create.singlesig({
        network: 'bitcoin_mainnet',
        account: account.toString(),
        displayName,
        trackOnly: true,
        keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
      })
    ).claim.id

  const db = app.database
  const deletedAt = async (id: string): Promise<string | null> =>
    (await db.select({ deletedAt: accounts.deletedAt }).from(accounts).where(eq(accounts.id, id)))[0]?.deletedAt ?? null
  const snapshots = async (id: string): Promise<Array<{ timestamp: string; balanceSats: string }>> =>
    db
      .select({ timestamp: balanceSnapshots.timestamp, balanceSats: balanceSnapshots.balanceSats })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, id))
      .orderBy(asc(balanceSnapshots.timestamp))
  const syncs = async (id: string): Promise<Array<{ fromBlockHeight: number; toBlockHeight: number }>> =>
    db
      .select({
        fromBlockHeight: accountHistorySyncs.fromBlockHeight,
        toBlockHeight: accountHistorySyncs.toBlockHeight,
      })
      .from(accountHistorySyncs)
      .where(eq(accountHistorySyncs.accountId, id))
      .orderBy(asc(accountHistorySyncs.fromBlockHeight))
  const seedSync = async (id: string, fromBlockHeight: number, toBlockHeight: number): Promise<void> => {
    await db.insert(accountHistorySyncs).values({
      accountId: id,
      fromBlockHeight,
      toBlockHeight,
      rangeStart: '2020-01-01T00:00:00.000Z',
      rangeEnd: '2020-02-01T00:00:00.000Z',
    })
  }
  const generation = (id: string): number => app.controlCenterService['getAccountHistoryBackfillGeneration'](id)
  const spies = {
    invalidateBackfill: vi.spyOn(app.controlCenterService, 'invalidateAccountHistoryBackfill'),
    clearBackfill: vi.spyOn(app.controlCenterService, 'clearAccountHistoryBackfillState'),
    invalidateBalance: vi.spyOn(app.walletBalanceService, 'invalidate'),
  }

  return { app, caller, create, deletedAt, snapshots, syncs, seedSync, generation, electrum, spies }
}

describe('archive', () => {
  it('saves full history, archives the account and records its balance at the archive time', async () => {
    const { caller, create, deletedAt, snapshots, syncs, generation, spies } = await setup()
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    const before = generation(id)

    await caller.archive({ id })

    const archivedAt = await deletedAt(id)
    assert(archivedAt !== null)
    // The full history scan covered every block and saved the deposit.
    await expect(syncs(id)).resolves.toEqual([{ fromBlockHeight: 0, toBlockHeight: tip.height }])
    const rows = await snapshots(id)
    expect(rows).toContainEqual({ timestamp: deposit.timestamp.toISOString(), balanceSats: '120' })
    // The snapshot written in the same transaction as deletedAt.
    expect(rows).toContainEqual({ timestamp: archivedAt, balanceSats: '120' })
    expect(generation(id)).toBe(before + 1)
    expect(spies.invalidateBackfill).toHaveBeenCalledWith(id)
    expect(spies.invalidateBalance).toHaveBeenCalledWith(id)
    // The account leaves the active list and shows under Archived.
    expect((await caller.list()).map((claim) => claim.id)).not.toContain(id)
    await expect(caller.listArchived()).resolves.toEqual([expect.objectContaining({ id, isArchived: true })])
  })

  it('refuses a missing account, and an account that is already archived', async () => {
    const { caller, create } = await setup()
    await expect(caller.archive({ id: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    await caller.archive({ id })
    await expect(caller.archive({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Claim not found or already archived',
    })
  })

  it('leaves the account active when its history cannot be saved', async () => {
    const { caller, create, deletedAt, electrum, spies } = await setup()
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    electrum.tip.mockImplementation(asyncFn(async () => Err(new Error('Electrum is unreachable'))))

    await expect(caller.archive({ id })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Failed to preserve full account history',
    })
    await expect(deletedAt(id)).resolves.toBeNull()
    await expect(caller.listArchived()).resolves.toEqual([])
    expect(spies.invalidateBackfill).not.toHaveBeenCalled()
    expect(spies.invalidateBalance).not.toHaveBeenCalledWith(id)
  })

  it('rolls back the archive when its balance snapshot cannot be written', async () => {
    const { app, caller, create, deletedAt, syncs, spies } = await setup()
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    // Fails only writes made after deletedAt is set, inside the archive transaction.
    for (const event of ['INSERT', 'UPDATE']) {
      await app.database.$client.execute(
        `CREATE TRIGGER fail_archived_snapshot_${event} BEFORE ${event} ON balance_snapshots
         WHEN (SELECT deleted_at FROM accounts WHERE id = NEW.account_id) IS NOT NULL
         BEGIN SELECT RAISE(ABORT, 'snapshot write failed'); END`,
      )
    }

    const attempt = caller.archive({ id })
    await expect(attempt).rejects.toMatchObject({ code: 'INTERNAL_SERVER_ERROR' })
    await expect(attempt).rejects.toThrow('insert into "balance_snapshots"')
    // The history scan ran and committed before the archive transaction failed.
    await expect(syncs(id)).resolves.toEqual([{ fromBlockHeight: 0, toBlockHeight: tip.height }])
    await expect(deletedAt(id)).resolves.toBeNull()
    await expect(caller.listArchived()).resolves.toEqual([])
    expect((await caller.list()).map((claim) => claim.id)).toContain(id)
    expect(spies.invalidateBackfill).not.toHaveBeenCalled()
  })
})

describe('restore', () => {
  it('brings an archived account back, forgets only its history scans and keeps its snapshots', async () => {
    const { caller, create, deletedAt, snapshots, syncs, seedSync, spies } = await setup()
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    const other = await create(Wallets.singlesigLegacyAccount, 'Other')
    await caller.archive({ id })
    await seedSync(id, 10, 20)
    await seedSync(other, 0, 100)
    const archivedSnapshots = await snapshots(id)
    await expect(syncs(id)).resolves.toHaveLength(2)
    // Archive made the same calls; count only restore's.
    spies.clearBackfill.mockClear()
    spies.invalidateBalance.mockClear()

    await caller.restore({ id })

    await expect(deletedAt(id)).resolves.toBeNull()
    await expect(syncs(id)).resolves.toEqual([])
    await expect(syncs(other)).resolves.toEqual([{ fromBlockHeight: 0, toBlockHeight: 100 }])
    await expect(snapshots(id)).resolves.toEqual(archivedSnapshots)
    expect(spies.clearBackfill).toHaveBeenCalledWith(id)
    expect(spies.invalidateBalance).toHaveBeenCalledWith(id)
    expect((await caller.list()).map((claim) => claim.id)).toContain(id)
    await expect(caller.listArchived()).resolves.toEqual([])
  })

  it('refuses a missing account, an active account and a second restore', async () => {
    const { caller, create, deletedAt } = await setup()
    await expect(caller.restore({ id: 'missing' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const id = await create(Wallets.singlesigNativeSegwitAccount, 'Savings')
    await expect(caller.restore({ id })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Claim not found or not archived',
    })
    await caller.archive({ id })
    await caller.restore({ id })
    await expect(caller.restore({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(deletedAt(id)).resolves.toBeNull()
  })
})
