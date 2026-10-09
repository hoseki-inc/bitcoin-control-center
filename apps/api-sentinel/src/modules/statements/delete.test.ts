import { asc } from 'drizzle-orm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { SentinelDb } from '../../db/drizzle'
import { statements } from '../../db/schema'
import { setupAppCaller } from '../trpc/ownership.fixtures'

const input = {
  claimIds: [],
  openingDate: new Date('2026-09-01T00:00:00.000Z'),
  closingDate: new Date('2026-09-30T23:59:59.999Z'),
  timezone: 'UTC',
}

async function setup(): Promise<Awaited<ReturnType<typeof setupAppCaller>>> {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T18:00:00.000Z'))
  onTestFinished(() => {
    vi.useRealTimers()
  })
  return setupAppCaller()
}

async function insertStatement(db: SentinelDb, id: string, status: 'pending' | 'completed' | 'failed'): Promise<void> {
  await db
    .insert(statements)
    .values({ id, status, openingDate: '2026-09-01', closingDate: '2026-09-30', accountIds: '[]' })
}

describe('statement deletion', () => {
  it('never reuses the number of a deleted statement', async () => {
    const { caller, db } = await setup()
    const api = caller.portalProve.statement
    // With no accounts selected, generation fails, so each statement can be deleted.
    const generate = async (): Promise<{ id: string; counter: number }> => {
      const statement = await api.initiateGeneration(input)
      await vi.waitFor(async () => {
        await expect(api.retrieve(statement.id)).resolves.toMatchObject({ status: 'failed' })
      })
      return statement
    }

    const first = await generate()
    const second = await generate()
    await api.delete(second.id)
    const third = await generate()

    expect([first.counter, second.counter, third.counter]).toEqual([1, 2, 3])
    const remaining = await db.select({ id: statements.id }).from(statements).orderBy(asc(statements.counter))
    expect(remaining).toEqual([{ id: first.id }, { id: third.id }])
  })

  it.each(['completed', 'failed'] as const)('deletes a %s statement', async (status) => {
    const { caller, db } = await setup()
    await insertStatement(db, 'st_stmt_done', status)

    await caller.portalProve.statement.delete('st_stmt_done')

    await expect(db.select().from(statements)).resolves.toEqual([])
  })

  it('keeps a statement that is still generating', async () => {
    const { caller, db } = await setup()
    await insertStatement(db, 'st_stmt_pending', 'pending')

    await expect(caller.portalProve.statement.delete('st_stmt_pending')).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(db.select({ status: statements.status }).from(statements)).resolves.toEqual([{ status: 'pending' }])
  })

  it('reports an unknown statement as not found', async () => {
    const { caller } = await setup()

    await expect(caller.portalProve.statement.delete('st_stmt_missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
