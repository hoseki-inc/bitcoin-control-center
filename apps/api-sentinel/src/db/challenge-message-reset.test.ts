import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from './drizzle'

const resetMigration = '%_reset_unfinished_challenge_messages'
const logger = pino({ level: 'silent' })

async function snapshot(db: SentinelDb) {
  return {
    accounts: await db.all(sql`SELECT * FROM accounts ORDER BY id`),
    keystores: await db.all(sql`SELECT * FROM keystores ORDER BY id`),
    challenges: await db.all(sql`SELECT * FROM challenges ORDER BY id`),
    messages: await db.all(sql`SELECT * FROM signed_messages ORDER BY id`),
    migrations: await db.all(sql`SELECT id, name FROM _migrations ORDER BY id`),
  }
}

async function reopen(directory: string): Promise<void> {
  const db = await openDrizzleDatabase(directory, logger)
  db.$client.close()
}

async function setupUpgrade(): Promise<{ directory: string; db: SentinelDb }> {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-challenge-reset-'))
  const db = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  // This data-only migration does not change the schema. Removing just its journal
  // entry produces the preceding version without replaying any historical migrations.
  await db.run(sql`DELETE FROM _migrations WHERE name LIKE ${resetMigration}`)
  for (const [id, satisfied, completedAt, status, archived] of [
    ['pending', 0, null, 'pending', null],
    ['archived', 0, null, 'pending', '2026-01-01'],
    ['completed', 1, '2026-01-01', 'verified', null],
    ['flag-only', 1, null, 'verified', null],
    ['date-only', 0, '2026-01-01', 'verified', null],
  ] as const) {
    await db.run(sql`INSERT INTO accounts (id, descriptor, display_name, status, deleted_at)
      VALUES (${id}, 'synthetic-descriptor', ${id}, ${status}, ${archived})`)
    await db.run(sql`INSERT INTO keystores (id, account_id, label, xpub, wallet, model)
      VALUES (${id}, ${id}, 'Saved wallet', 'synthetic-xpub', 'ledger', 'nanoX')`)
    await db.run(sql`INSERT INTO challenges (id, account_id, is_satisfied, completed_at)
      VALUES (${id}, ${id}, ${satisfied}, ${completedAt})`)
    for (const signed of [false, true]) {
      await db.run(sql`INSERT INTO signed_messages
        (id, challenge_id, keystore_id, address, message_text, signature, signed_at)
        VALUES (${`${id}-${String(signed)}`}, ${id}, ${id}, 'synthetic-address', 'Synthetic proof',
          ${signed ? 'synthetic-signature' : null}, ${signed ? '2026-01-01' : null})`)
    }
  }
  return { directory, db }
}

describe('unfinished challenge message reset migration', () => {
  it('clears only unfinished messages, preserves completion markers and wallet data, and runs once', async () => {
    const { directory, db } = await setupUpgrade()
    const before = await snapshot(db)
    const preservedMessages = await db.all(
      sql`SELECT * FROM signed_messages WHERE challenge_id NOT IN ('pending', 'archived') ORDER BY id`,
    )

    await reopen(directory)

    const after = await snapshot(db)
    expect(after.accounts).toEqual(before.accounts)
    expect(after.keystores).toEqual(before.keystores)
    expect(after.challenges).toEqual(before.challenges)
    expect(after.messages).toEqual(preservedMessages)
    expect(after.migrations.slice(0, -1)).toEqual(before.migrations)
    expect(after.migrations).toHaveLength(before.migrations.length + 1)
    await expect(db.all(sql`SELECT name FROM _migrations WHERE name LIKE ${resetMigration}`)).resolves.toHaveLength(1)
    await expect(db.all(sql`PRAGMA foreign_key_check`)).resolves.toEqual([])

    // New progress after the upgrade must survive every subsequent startup.
    await db.run(sql`INSERT INTO signed_messages
      (id, challenge_id, keystore_id, address, message_text, signature, signed_at)
      VALUES ('fresh', 'pending', 'pending', 'new-address', 'New proof', 'new-signature', '2026-02-01')`)
    const resumed = await snapshot(db)
    await reopen(directory)
    await reopen(directory)
    await expect(snapshot(db)).resolves.toEqual(resumed)
  })

  it('rolls back the delete if recording the migration fails, then safely retries', async () => {
    const { directory, db } = await setupUpgrade()
    await db.run(sql`CREATE TRIGGER reject_reset_journal BEFORE INSERT ON _migrations
      WHEN NEW.name LIKE '%_reset_unfinished_challenge_messages'
      BEGIN SELECT RAISE(ABORT, 'synthetic journal failure'); END`)
    const before = await snapshot(db)

    await expect(reopen(directory)).rejects.toThrow('synthetic journal failure')
    await expect(snapshot(db)).resolves.toEqual(before)

    await db.run(sql`DROP TRIGGER reject_reset_journal`)
    await reopen(directory)
    await expect(
      db.all(sql`SELECT * FROM signed_messages WHERE challenge_id IN ('pending', 'archived')`),
    ).resolves.toEqual([])
    await expect(db.all(sql`SELECT name FROM _migrations WHERE name LIKE ${resetMigration}`)).resolves.toHaveLength(1)
  })
})
