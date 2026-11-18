import { expect, it } from 'vitest'
import { challenges } from '../../db/schema'
import { StatementMapper } from './mapper'
import { setupDistinctWalletNames } from './service.fixtures'

it('records when each wallet last proved ownership, and keeps it with the saved statement', async () => {
  const { service, db, input } = await setupDistinctWalletNames()
  const [savingsId] = input.claimIds
  await db.insert(challenges).values([
    { id: 'older', accountId: savingsId, isSatisfied: 1, completedAt: '2026-08-01T12:00:00.000Z' },
    { id: 'latest', accountId: savingsId, isSatisfied: 1, completedAt: '2026-09-03T12:00:00.000Z' },
    // A challenge still waiting for signatures proves nothing.
    { id: 'unsigned', accountId: savingsId, isSatisfied: 0, completedAt: null },
  ])

  const data = (await service.generateStatementData(input)).unwrap()
  const id = (await service.create(input)).unwrap()
  ;(await service.complete(id, data.transactionMap, data.dailyRates)).unwrap()
  const saved = await service.loadCompleted(id)
  if (saved === null) {
    return expect.unreachable('The completed statement must load')
  }

  const statement = new StatementMapper()
    .toPdfStatement(
      {
        ...input,
        ...saved,
        id,
        createdAt: new Date(),
        status: 'completed',
        counter: 1,
        user: { email: null, name: null, address: null },
      },
      'custom',
    )
    .expect('Saved statement data must map to a PDF statement')
  if (statement.format !== 'custom') {
    return expect.unreachable('The statement must use the custom format')
  }
  expect(statement.summary.entries.map((entry) => [entry.displayName, entry.ownershipProvenAt])).toEqual([
    ['Savings', new Date('2026-09-03T12:00:00.000Z')],
    // No completed challenge, so no date rather than a guess.
    ['Spending', undefined],
  ])
})
