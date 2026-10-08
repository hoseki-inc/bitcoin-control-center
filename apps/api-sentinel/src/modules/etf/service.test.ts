import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { assert, expect, it, onTestFinished } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { etfBalanceSnapshots, etfHoldings } from '../../db/schema'
import { EtfService } from './service'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-etf-'))
  const logger = pino({ level: 'silent' })
  const db = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const service = new EtfService({ db, logger })
  const account = (
    await service.createAccount({ displayName: 'ETF', holdings: [{ ticker: 'IBIT', shares: '1' }] })
  ).expect('Expected successful result')
  return { db, service, account }
}

it('only removes a holding once under concurrent requests', async () => {
  const { db, service, account } = await setup()
  const [holding] = await service.listHoldings(account.id)
  assert(holding)
  const [first, second] = await Promise.all([service.removeHolding(holding.id), service.removeHolding(holding.id)])
  expect(first.expect('Expected successful result')).toBe(account.id)
  expect(second.expectErr('Expected failed result').message).toBe('ETF holding not found')
  await expect(db.select().from(etfHoldings)).resolves.toHaveLength(0)
  await expect(service.computeAccountBalance(account.id)).resolves.toBe(0n)
})

it('handles concurrent holding addition and account deletion without a foreign-key failure', async () => {
  const { db, service, account } = await setup()
  const add = async () => service.addHolding({ accountId: account.id, ticker: 'IBIT', shares: '2' })
  const remove = async () => service.removeAccount(account.id)
  const [added, removed] = await Promise.all([add(), remove()])
  expect(removed.isOk()).toBe(true)
  expect(added.isOk()).toBe(true)
  await expect(db.select().from(etfHoldings)).resolves.toHaveLength(0)
  await expect(db.select().from(etfBalanceSnapshots)).resolves.toHaveLength(0)
})

it('returns not found when the account was deleted before adding a holding', async () => {
  const { service, account } = await setup()
  await service.removeAccount(account.id)
  const added = await service.addHolding({ accountId: account.id, ticker: 'IBIT', shares: '2' })
  expect(added.expectErr('Expected failed result').message).toBe('ETF account not found')
})

it('rolls back holding deletion when its balance snapshot cannot be written', async () => {
  const { db, service, account } = await setup()
  const [holding] = await service.listHoldings(account.id)
  assert(holding)
  const before = await db.select().from(etfBalanceSnapshots)
  await db.run(sql`CREATE TEMP TRIGGER fail_snapshot BEFORE INSERT ON etf_balance_snapshots
    BEGIN SELECT RAISE(ABORT, 'Synthetic snapshot failure'); END`)
  await expect(service.removeHolding(holding.id)).rejects.toHaveProperty(
    'cause.message',
    expect.stringContaining('Synthetic snapshot failure'),
  )
  await expect(service.listHoldings(account.id)).resolves.toMatchObject([{ id: holding.id, shares: holding.shares }])
  await expect(db.select().from(etfBalanceSnapshots)).resolves.toEqual(before)
})
