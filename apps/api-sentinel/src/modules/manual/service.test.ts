import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { manualAccounts, manualBalanceSnapshots, settings } from '../../db/schema'
import { ManualService } from './service'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-concurrency-'))
  const logger = pino({ level: 'silent' })
  const database = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { db: database, service: new ManualService({ db: database, logger }) }
}

it('allows concurrent account creation without dropping accounts or snapshots', async () => {
  const { db, service } = await setup()
  const results = await Promise.all(
    ['A', 'B', 'C'].map(async (displayName) =>
      service.createAccount({ displayName, balanceSats: '0', balanceAsOf: '2026-01-01' }),
    ),
  )
  expect(results.every((result) => result.isOk())).toBe(true)
  await expect(service.listAccounts()).resolves.toHaveLength(3)
  await expect(db.select().from(manualBalanceSnapshots)).resolves.toHaveLength(3)
})

it('serializes balance reads and writes with concurrent queries and native batches', async () => {
  const { db, service } = await setup()
  const account = (
    await service.createAccount({ displayName: 'Wallet', balanceSats: '0', balanceAsOf: '2026-01-01' })
  ).expect('Expected successful result')
  const results = await Promise.all([
    service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '10',
      transactedAt: '2026-01-02',
      addToBalance: true,
    }),
    service.listAccounts(),
    db.batch([db.insert(settings).values({ key: 'test', value: 'value' })]),
    service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '20',
      transactedAt: '2026-01-03',
      addToBalance: true,
    }),
  ])
  expect(results[0].isOk()).toBe(true)
  expect(results[3].isOk()).toBe(true)
  expect((await service.getAccount(account.id))?.balanceSats).toBe('30')
  await expect(service.listTransactions(account.id)).resolves.toHaveLength(2)
})

it('does not let concurrent transactions exceed the stored balance', async () => {
  const { service } = await setup()
  const account = (
    await service.createAccount({ displayName: 'Wallet', balanceSats: '10', balanceAsOf: '2026-01-01' })
  ).expect('Expected successful result')
  const results = await Promise.all(
    [1, 2].map(async () =>
      service.addTransaction({
        accountId: account.id,
        type: 'buy',
        amountSats: '10',
        transactedAt: '2026-01-02',
      }),
    ),
  )
  expect(results.map((result) => result.isOk())).toEqual([true, false])
  await expect(service.listTransactions(account.id)).resolves.toHaveLength(1)
})

it('releases queued work after a transaction rolls back and hides its partial writes', async () => {
  const { db, service } = await setup()
  const results = await Promise.allSettled([
    db.transaction(async (tx) => {
      await tx.insert(manualAccounts).values({ id: 'rolled-back', displayName: 'Rollback' })
      throw new Error('Synthetic rollback')
    }),
    db.select({ id: manualAccounts.id }).from(manualAccounts).execute(),
    service.createAccount({ displayName: 'Survives', balanceSats: '1', balanceAsOf: '2026-01-01' }),
  ])
  expect(results[0]).toMatchObject({ status: 'rejected', reason: new Error('Synthetic rollback') })
  expect(results[1]).toEqual({ status: 'fulfilled', value: [] })
  expect((await service.listAccounts()).map((account) => account.displayName)).toEqual(['Survives'])
})

it('returns the renamed row and reports not found when a concurrent deletion wins', async () => {
  const { service } = await setup()
  const account = (
    await service.createAccount({ displayName: 'Wallet', balanceSats: '10', balanceAsOf: '2026-01-01' })
  ).expect('Expected successful result')
  const renamed = await service.renameAccount({ accountId: account.id, displayName: 'Renamed' })
  expect(renamed.expect('Expected successful result')).toEqual({ ...account, displayName: 'Renamed' })
  const [removed, missing] = await Promise.all([
    service.removeAccount(account.id),
    service.renameAccount({ accountId: account.id, displayName: 'Too late' }),
  ])
  expect(removed.isOk()).toBe(true)
  expect(missing.expectErr('Expected failed result').message).toBe('Manual account not found')
})
