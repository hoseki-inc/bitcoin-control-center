import { describe, expect, it, onTestFinished } from 'vitest'
import { setupAppCaller } from '../modules/trpc/ownership.fixtures'
import { accounts, exchangeAccounts, statements } from './schema'
import { normalizeDbTimestamp, parseDbTimestamp } from './timestamp'

// SQLite's datetime('now') text for 2026-11-17T01:40:43Z, which is 8:40 PM the day before in New York.
const sqliteNow = '2026-11-17 01:40:43'
const utc = '2026-11-17T01:40:43.000Z'

function useNewYorkTime(): void {
  const originalTimezone = process.env.TZ
  process.env.TZ = 'America/New_York'
  onTestFinished(() => {
    if (originalTimezone === undefined) {
      delete process.env.TZ
    } else {
      process.env.TZ = originalTimezone
    }
  })
}

describe('database timestamps outside UTC', () => {
  it('reads SQLite datetime text as UTC and leaves ISO strings alone', () => {
    useNewYorkTime()
    expect(parseDbTimestamp(sqliteNow).toISOString()).toBe(utc)
    expect(parseDbTimestamp('2026-11-17 01:40:43.250').toISOString()).toBe('2026-11-17T01:40:43.250Z')
    expect(normalizeDbTimestamp(utc)).toBe(utc)
    expect(normalizeDbTimestamp('2026-11-17')).toBe('2026-11-17')
  })

  it('returns statement, claim and exchange creation times in UTC', async () => {
    useNewYorkTime()
    const { caller, db } = await setupAppCaller()
    await db.insert(statements).values({
      id: 'st_created_time',
      status: 'failed',
      openingDate: '2026-09-01',
      closingDate: '2026-09-30',
      accountIds: '[]',
      createdAt: sqliteNow,
      updatedAt: sqliteNow,
    })
    await db.insert(accounts).values({
      id: 'acct_created_time',
      descriptor: 'wpkh(created-time)',
      displayName: 'Wallet',
      createdAt: sqliteNow,
    })
    await db.insert(exchangeAccounts).values({
      id: 'ex_created_time',
      provider: 'strike',
      displayName: 'Strike',
      encryptedCredentials: '{}',
      createdAt: sqliteNow,
    })

    const statement = await caller.portalProve.statement.retrieve('st_created_time')
    const claim = await caller.portalProve.registry.claims.get.byId({ id: 'acct_created_time' })
    const [exchange] = await caller.portalProve.exchange.list()

    expect(statement.createdAt.toISOString()).toBe(utc)
    expect(statement.updatedAt.toISOString()).toBe(utc)
    expect(claim.createdAt.toISOString()).toBe(utc)
    expect(exchange?.createdAt).toBe('2026-11-17T01:40:43Z')
  })
})
