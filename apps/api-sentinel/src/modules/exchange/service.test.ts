import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { exchangeAccounts } from '../../db/schema'
import { ExchangeService } from './service'

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-exchange-'))
  const logger = pino({ level: 'silent' })
  const db = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  await db.insert(exchangeAccounts).values({
    id: 'exchange',
    provider: 'strike',
    displayName: 'Test account',
    encryptedCredentials: '{}',
  })
  return { db, service: new ExchangeService({ db, logger }) }
}

const transaction = {
  externalId: 'first',
  transactedAt: '2026-01-01',
  type: 'buy',
  amountBtc: '1',
  statementMonth: '2026-01',
}

it('completes an import atomically before a concurrent account deletion', async () => {
  const { service } = await setup()
  const [imported, removed] = await Promise.all([
    service.importStatementTransactions({ accountId: 'exchange', transactions: [transaction] }),
    service.removeAccount('exchange'),
  ])
  expect(imported.unwrap()).toEqual({ imported: 1, skipped: 0 })
  expect(removed.isOk()).toBe(true)
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual([])
})

it('returns not found if deletion is queued before the import, including empty imports', async () => {
  const { db, service } = await setup()
  // execute() queues the delete eagerly; query builders otherwise start when awaited.
  const removal = db.delete(exchangeAccounts).where(eq(exchangeAccounts.id, 'exchange')).execute()
  const [missing, empty] = await Promise.all([
    service.importStatementTransactions({ accountId: 'exchange', transactions: [transaction] }),
    service.importStatementTransactions({ accountId: 'exchange', transactions: [] }),
  ])
  await removal
  expect(missing.unwrapErr().message).toBe('Exchange account not found')
  expect(empty.unwrapErr().message).toBe('Exchange account not found')
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual([])
})

it('deduplicates concurrent imports and rolls back earlier rows if a later insert fails', async () => {
  const { db, service } = await setup()
  const input = { accountId: 'exchange', transactions: [transaction] }
  const [first, second] = await Promise.all([
    service.importStatementTransactions(input),
    service.importStatementTransactions(input),
  ])
  expect(first.unwrap()).toEqual({ imported: 1, skipped: 0 })
  expect(second.unwrap()).toEqual({ imported: 0, skipped: 1 })
  const before = await service.listStatementTransactions('exchange')
  await db.run(sql`CREATE TEMP TRIGGER fail_import BEFORE INSERT ON exchange_statement_txs
    WHEN NEW.external_id = 'fail'
    BEGIN SELECT RAISE(ABORT, 'Synthetic import failure'); END`)
  await expect(
    service.importStatementTransactions({
      accountId: 'exchange',
      transactions: [
        { ...transaction, externalId: 'second' },
        { ...transaction, externalId: 'fail' },
      ],
    }),
  ).rejects.toHaveProperty('cause.message', expect.stringContaining('Synthetic import failure'))
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual(before)
})

const receive = { ...transaction, externalId: 'tx-9', amountBtc: '0.00010000', statementMonth: '2026-09' }
const reversal = { ...receive, amountBtc: '-0.00010000', statementMonth: '2026-10' }

it.each([
  ['the reversal after the original', receive, reversal],
  ['the original after the reversal', reversal, receive],
])('refuses %s and writes nothing from that file', async (_, first, second) => {
  const { service } = await setup()
  const other = { ...transaction, externalId: 'tx-10' }
  await service.importStatementTransactions({ accountId: 'exchange', transactions: [first] })
  const before = await service.listStatementTransactions('exchange')

  const refused = await service.importStatementTransactions({ accountId: 'exchange', transactions: [other, second] })
  expect(refused.unwrapErr()?.message).toContain('reverses a transaction from an earlier month')
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual(before)
})

it('still skips the same row from the other export format as a duplicate', async () => {
  const { service } = await setup()
  const row = { ...transaction, amountBtc: '0.00010000' }
  await service.importStatementTransactions({ accountId: 'exchange', transactions: [row] })
  const again = await service.importStatementTransactions({
    accountId: 'exchange',
    transactions: [
      { ...row, amountBtc: '0.0001', exchangeRate: '80000.00' },
      { ...row, externalId: 'new' },
    ],
  })
  expect(again.unwrap()).toEqual({ imported: 1, skipped: 1 })
})

it('accepts an empty import for an existing account', async () => {
  const { service } = await setup()
  const result = await service.importStatementTransactions({ accountId: 'exchange', transactions: [] })
  expect(result.unwrap()).toEqual({ imported: 0, skipped: 0 })
})
