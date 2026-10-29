import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
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
  ).unwrap()
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
  ).unwrap()
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
  ).unwrap()
  const renamed = await service.renameAccount({ accountId: account.id, displayName: 'Renamed' })
  expect(renamed.unwrap()).toEqual({ ...account, displayName: 'Renamed' })
  const [removed, missing] = await Promise.all([
    service.removeAccount(account.id),
    service.renameAccount({ accountId: account.id, displayName: 'Too late' }),
  ])
  expect(removed.isOk()).toBe(true)
  expect(missing.unwrapErr().message).toBe('Manual account not found')
})

describe('portfolio history entries', () => {
  const history = async (service: ManualService, accountIds?: string[]): Promise<Array<[string, string]>> =>
    (await service.getHistoryEntries(accountIds)).map(({ timestamp, value }) => [
      timestamp.toISOString(),
      value.toString(),
    ])

  it('starts the balance on the date it was entered', async () => {
    const { service } = await setup()
    await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-02T12:00:00.000Z' })
    await expect(history(service)).resolves.toEqual([['2026-09-02T12:00:00.000Z', '5000']])
  })

  it('moves the balance on the dates it was updated or added to', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-02T12:00:00.000Z' })
    ).unwrap()
    await service.updateBalance({ accountId: account.id, balanceSats: '8000', balanceAsOf: '2026-09-04T12:00:00.000Z' })
    await service.addTransaction({
      accountId: account.id,
      type: 'sell',
      amountSats: '1000',
      transactedAt: '2026-09-05T12:00:00.000Z',
      addToBalance: true,
    })
    await expect(history(service)).resolves.toEqual([
      ['2026-09-02T12:00:00.000Z', '5000'],
      ['2026-09-04T12:00:00.000Z', '3000'],
      ['2026-09-05T12:00:00.000Z', '-1000'],
    ])
  })

  it('shows transactions logged before the entered date as part of that balance', async () => {
    const { db, service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-02T12:00:00.000Z' })
    ).unwrap()
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '2000',
      transactedAt: '2026-08-01T12:00:00.000Z',
    })
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-03T12:00:00.000Z',
    })
    await expect(db.select().from(manualBalanceSnapshots)).resolves.toHaveLength(1)
    await expect(history(service)).resolves.toEqual([
      ['2026-08-01T12:00:00.000Z', '2000'],
      ['2026-09-02T12:00:00.000Z', '3000'],
    ])
  })

  it('lets a balance entered for an earlier date replace the ones saved after it', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    for (const day of ['02', '03', '04', '05', '06', '07', '08']) {
      await service.recordSnapshot(account.id, `2026-09-${day}T15:00:00.000Z`)
    }
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-05T12:00:00.000Z',
      addToBalance: true,
    })
    await service.updateBalance({ accountId: account.id, balanceSats: '9000', balanceAsOf: '2026-09-07T12:00:00.000Z' })
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '5000'],
      ['2026-09-05T12:00:00.000Z', '1000'],
      ['2026-09-07T12:00:00.000Z', '3000'],
    ])
  })

  it('adds a back-dated amount to the balances saved after it instead of replacing them', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    await service.updateBalance({ accountId: account.id, balanceSats: '9000', balanceAsOf: '2026-09-08T12:00:00.000Z' })
    const buy = await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-05T12:00:00.000Z',
      addToBalance: true,
    })
    expect((await service.getAccount(account.id))?.balanceSats).toBe('10000')
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '5000'],
      ['2026-09-05T12:00:00.000Z', '1000'],
      ['2026-09-08T12:00:00.000Z', '4000'],
    ])

    // Deleting it takes the amount back out of the same dates.
    expect((await service.deleteTransaction(buy.unwrap().id)).isOk()).toBe(true)
    expect((await service.getAccount(account.id))?.balanceSats).toBe('9000')
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '5000'],
      ['2026-09-08T12:00:00.000Z', '4000'],
    ])
  })

  it('adds a back-dated amount once to a balance saved at the same time', async () => {
    const { db, service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-01T12:00:00.000Z',
      addToBalance: true,
    })
    await expect(
      db
        .select({ timestamp: manualBalanceSnapshots.timestamp, balanceSats: manualBalanceSnapshots.balanceSats })
        .from(manualBalanceSnapshots),
    ).resolves.toEqual([{ timestamp: '2026-09-01T12:00:00.000Z', balanceSats: '6000' }])
  })

  it('does not save a balance when deleting a transaction from before the first one', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-10T12:00:00.000Z' })
    ).unwrap()
    const first = await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-01T12:00:00.000Z',
    })
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '2000',
      transactedAt: '2026-09-05T12:00:00.000Z',
    })
    await service.deleteTransaction(first.unwrap().id)
    await expect(history(service)).resolves.toEqual([
      ['2026-09-05T12:00:00.000Z', '2000'],
      ['2026-09-10T12:00:00.000Z', '2000'],
    ])
  })

  it('takes a deleted amount out from its date after a correction dated before it', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    const buy = await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-09-05T12:00:00.000Z',
      addToBalance: true,
    })
    await service.updateBalance({ accountId: account.id, balanceSats: '7000', balanceAsOf: '2026-09-03T12:00:00.000Z' })
    await service.deleteTransaction(buy.unwrap().id)
    expect((await service.getAccount(account.id))?.balanceSats).toBe('6000')
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '5000'],
      ['2026-09-03T12:00:00.000Z', '2000'],
      ['2026-09-05T12:00:00.000Z', '-1000'],
    ])
  })

  it('keeps earlier logged transactions when a buy before the first balance is added and deleted', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-02T12:00:00.000Z' })
    ).unwrap()
    await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '2000',
      transactedAt: '2026-08-10T12:00:00.000Z',
    })
    const buy = await service.addTransaction({
      accountId: account.id,
      type: 'buy',
      amountSats: '1000',
      transactedAt: '2026-08-01T12:00:00.000Z',
      addToBalance: true,
    })
    await expect(history(service)).resolves.toEqual([
      ['2026-08-01T12:00:00.000Z', '1000'],
      ['2026-08-10T12:00:00.000Z', '2000'],
      ['2026-09-02T12:00:00.000Z', '3000'],
    ])
    await service.deleteTransaction(buy.unwrap().id)
    await expect(history(service)).resolves.toEqual([
      ['2026-08-10T12:00:00.000Z', '2000'],
      ['2026-09-02T12:00:00.000Z', '3000'],
    ])
  })

  it('keeps a balance saved while background collection was running', async () => {
    const { service } = await setup()
    const account = (
      await service.createAccount({ displayName: 'Cold', balanceSats: '5000', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    // Collection starts just before midnight; the user saves 8000 just after it.
    await service.updateBalance({ accountId: account.id, balanceSats: '8000', balanceAsOf: '2026-09-05T00:00:05.000Z' })
    await service.recordSnapshot(account.id, '2026-09-04T23:59:50.000Z')
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '5000'],
      ['2026-09-05T00:00:05.000Z', '3000'],
    ])

    // Later collections save the current balance, not a stale one.
    await service.recordSnapshot(account.id, '2026-09-05T00:15:00.000Z')
    await expect(history(service)).resolves.toHaveLength(2)
  })

  it('keeps each account separate and respects the selection', async () => {
    const { service } = await setup()
    const first = (
      await service.createAccount({ displayName: 'A', balanceSats: '100', balanceAsOf: '2026-09-01T12:00:00.000Z' })
    ).unwrap()
    const second = (
      await service.createAccount({ displayName: 'B', balanceSats: '50', balanceAsOf: '2026-09-02T12:00:00.000Z' })
    ).unwrap()
    await service.recordSnapshot(first.id, '2026-09-03T00:00:00.000Z')
    await expect(history(service)).resolves.toEqual([
      ['2026-09-01T12:00:00.000Z', '100'],
      ['2026-09-02T12:00:00.000Z', '50'],
    ])
    await expect(history(service, [second.id])).resolves.toEqual([['2026-09-02T12:00:00.000Z', '50']])
    await expect(history(service, [])).resolves.toEqual([])
  })
})
