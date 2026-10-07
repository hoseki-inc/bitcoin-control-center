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
  expect(imported.expect('Expected successful result')).toEqual({ imported: 1, skipped: 0 })
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
  expect(missing.expectErr('Expected failed result').message).toBe('Exchange account not found')
  expect(empty.expectErr('Expected failed result').message).toBe('Exchange account not found')
  await expect(service.listStatementTransactions('exchange')).resolves.toEqual([])
})

it('deduplicates concurrent imports and rolls back earlier rows if a later insert fails', async () => {
  const { db, service } = await setup()
  const input = { accountId: 'exchange', transactions: [transaction] }
  const [first, second] = await Promise.all([
    service.importStatementTransactions(input),
    service.importStatementTransactions(input),
  ])
  expect(first.expect('Expected successful result')).toEqual({ imported: 1, skipped: 0 })
  expect(second.expect('Expected successful result')).toEqual({ imported: 0, skipped: 1 })
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
