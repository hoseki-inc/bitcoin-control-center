import { hosid } from '@hoseki/packages/schemas'
import { describe, expect, it, onTestFinished } from 'vitest'
import { owner, setupAppCaller } from '../modules/trpc/ownership.fixtures'
import { accounts, challenges, exchangeAccounts, keystores, signedMessages, statements } from './schema'
import { normalizeDbTimestamp, parseDbTimestamp } from './timestamp'

// SQLite's datetime('now') text for 2026-11-17T01:40:43Z, which is 8:40 PM the day before in New York.
const sqliteNow = '2026-11-17 01:40:43'
const utc = '2026-11-17T01:40:43.000Z'

function useTimezone(timezone: string): void {
  const originalTimezone = process.env.TZ
  process.env.TZ = timezone
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
    useTimezone('America/New_York')
    expect(parseDbTimestamp(sqliteNow).toISOString()).toBe(utc)
    expect(parseDbTimestamp('2026-11-17 01:40:43.250').toISOString()).toBe('2026-11-17T01:40:43.250Z')
    expect(normalizeDbTimestamp(utc)).toBe(utc)
    expect(normalizeDbTimestamp('2026-11-17')).toBe('2026-11-17')
  })

  it.each(['Asia/Tokyo', 'Asia/Kolkata', 'Australia/Lord_Howe'])(
    'reads SQLite datetime text as UTC in %s',
    (timezone) => {
      useTimezone(timezone)
      // 15:00Z is midnight the next day in Tokyo, so a local read would also move the date.
      expect(parseDbTimestamp('2026-11-16 15:00:00').toISOString()).toBe('2026-11-16T15:00:00.000Z')
    },
  )

  it('reads SQLite datetime text as UTC on both sides of a DST change', () => {
    useTimezone('America/New_York')
    // New York falls back at 06:00Z on 2026-11-01, so a local read would be off by 4 hours before it and 5 after.
    expect(parseDbTimestamp('2026-11-01 05:59:59').toISOString()).toBe('2026-11-01T05:59:59.000Z')
    expect(parseDbTimestamp('2026-11-01 06:00:01').toISOString()).toBe('2026-11-01T06:00:01.000Z')
  })

  it('returns statement, claim, keystore, signed message and exchange creation times in UTC', async () => {
    useTimezone('America/New_York')
    const { caller, db } = await setupAppCaller()
    const challengeId = hosid('re_chal')
    const keystoreId = hosid('re_ks')
    const signedMessageId = hosid('re_mesg')
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
    await db.insert(keystores).values({
      id: keystoreId,
      accountId: 'acct_created_time',
      label: 'Key',
      xpub: owner.xpub.toString(),
      createdAt: sqliteNow,
    })
    await db.insert(challenges).values({ id: challengeId, accountId: 'acct_created_time', createdAt: sqliteNow })
    await db.insert(signedMessages).values({
      id: signedMessageId,
      challengeId,
      keystoreId,
      address: owner.account.receiveAddress(0).toString(),
      messageText: 'Created time',
      createdAt: sqliteNow,
    })
    await db.insert(exchangeAccounts).values({
      id: 'ex_created_time',
      provider: 'strike',
      displayName: 'Strike',
      encryptedCredentials: '{}',
      createdAt: sqliteNow,
    })

    const statement = await caller.portalProve.statements.retrieve('st_created_time')
    const claim = await caller.portalProve.registry.claims.get.byId({ id: 'acct_created_time' })
    const message = await caller.portalProve.registry.challengeMessages.get({ signedMessageId })
    const [exchange] = await caller.portalProve.exchange.list()

    expect(statement.createdAt.toISOString()).toBe(utc)
    expect(statement.updatedAt.toISOString()).toBe(utc)
    expect(claim.createdAt.toISOString()).toBe(utc)
    expect(claim.keystores[0]?.createdAt.toISOString()).toBe(utc)
    expect(message.signedMessage.createdAt.toISOString()).toBe(utc)
    expect(message.signedMessage.updatedAt.toISOString()).toBe(utc)
    expect(exchange?.createdAt).toBe('2026-11-17T01:40:43Z')
  })
})
