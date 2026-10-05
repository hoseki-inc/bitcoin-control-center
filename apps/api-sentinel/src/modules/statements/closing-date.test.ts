import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { setupAppCaller } from '../trpc/ownership.fixtures'
import { type GenerateStatementInput, validateStatementInput } from './service'

const now = new Date('2026-10-05T18:00:00.000Z')

function statementEnding(closingDate: string, timezone = 'UTC'): GenerateStatementInput {
  return {
    claimIds: [],
    openingDate: new Date('2026-09-01T00:00:00.000Z'),
    closingDate: new Date(closingDate),
    timezone,
  }
}

describe('statement closing date limit', () => {
  it.each([
    { scenario: 'the end of the day before yesterday', closingDate: '2026-10-03T23:59:59.999Z' },
    {
      scenario: "the end of the day before yesterday in the statement's timezone",
      closingDate: '2026-10-04T06:59:59.999Z',
      timezone: 'America/Los_Angeles',
    },
  ])('accepts a statement ending at $scenario', ({ closingDate, timezone }) => {
    expect(validateStatementInput(statementEnding(closingDate, timezone), now).isOk()).toBe(true)
  })

  it.each([
    { scenario: 'yesterday', closingDate: '2026-10-04T00:00:00.000Z' },
    { scenario: 'today', closingDate: '2026-10-05T12:00:00.000Z' },
    { scenario: 'a future day', closingDate: '2026-10-08T00:00:00.000Z' },
    {
      scenario: "yesterday in the statement's timezone",
      closingDate: '2026-10-04T07:00:00.000Z',
      timezone: 'America/Los_Angeles',
    },
  ])('rejects a statement ending $scenario', ({ closingDate, timezone }) => {
    const error = validateStatementInput(statementEnding(closingDate, timezone), now).expectErr('Must be rejected')
    expect(error.message).toContain('at least 2 days ago')
  })

  it('rejects an unrecognized timezone', () => {
    expect(validateStatementInput(statementEnding('2026-10-01T00:00:00.000Z', 'Mars/Olympus'), now).isErr()).toBe(true)
  })

  it('rejects a statement ending yesterday without saving it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { caller, db } = setupAppCaller()

    const attempt = caller.portalProve.statement.initiateGeneration(statementEnding('2026-10-04T12:00:00.000Z'))

    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt).rejects.toThrow('at least 2 days ago')
    expect(db.prepare('SELECT COUNT(*) AS count FROM statements').get()).toEqual({ count: 0 })
  })

  it('saves and starts a statement ending the day before yesterday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { caller, db } = setupAppCaller()

    const statement = await caller.portalProve.statement.initiateGeneration(statementEnding('2026-10-03T23:59:59.999Z'))

    expect(statement.status).toBe('pending')
    // Generation runs past the date check and stops only because the request selects no accounts.
    await vi.waitFor(() => {
      expect(db.prepare('SELECT status FROM statements WHERE id = ?').get(statement.id)).toEqual({ status: 'failed' })
    })
  })

  it('rejects a preview ending yesterday as a bad request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
    onTestFinished(() => {
      vi.useRealTimers()
    })
    const { caller } = setupAppCaller()

    const attempt = caller.portalProve.statement.generatePreview(statementEnding('2026-10-04T12:00:00.000Z'))

    await expect(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(attempt).rejects.toThrow('at least 2 days ago')
  })
})
