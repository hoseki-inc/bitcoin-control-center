import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { initDatabase } from './db'

const resetMigration = '017_reset_unfinished_challenge_messages'
const logger = pino({ level: 'silent' })

function snapshot(db: Database.Database) {
  return {
    accounts: db.prepare('SELECT * FROM accounts ORDER BY id').all(),
    keystores: db.prepare('SELECT * FROM keystores ORDER BY id').all(),
    challenges: db.prepare('SELECT * FROM challenges ORDER BY id').all(),
    messages: db.prepare('SELECT * FROM signed_messages ORDER BY id').all(),
    migrations: db.prepare('SELECT * FROM _migrations ORDER BY id').all(),
  }
}

function setupUpgrade() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-challenge-migration-'))
  const database = initDatabase(directory, logger)
  const { db } = database
  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })
  // This data-only migration does not change the schema. Removing just its journal
  // entry produces the preceding version without replaying any historical migrations.
  db.prepare('DELETE FROM _migrations WHERE name = ?').run(resetMigration)
  for (const [id, satisfied, completedAt, status, archived] of [
    ['pending', 0, null, 'pending', null],
    ['archived', 0, null, 'pending', '2026-01-01'],
    ['completed', 1, '2026-01-01', 'verified', null],
    ['flag-only', 1, null, 'verified', null],
    ['date-only', 0, '2026-01-01', 'verified', null],
  ] as const) {
    db.prepare('INSERT INTO accounts (id, descriptor, display_name, status, deleted_at) VALUES (?, ?, ?, ?, ?)').run(
      id,
      'synthetic-descriptor',
      id,
      status,
      archived,
    )
    db.prepare('INSERT INTO keystores (id, account_id, label, xpub, wallet, model) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      id,
      'Saved wallet',
      'synthetic-xpub',
      'ledger',
      'nanoX',
    )
    db.prepare('INSERT INTO challenges (id, account_id, is_satisfied, completed_at) VALUES (?, ?, ?, ?)').run(
      id,
      id,
      satisfied,
      completedAt,
    )
    for (const signed of [false, true]) {
      db.prepare(`INSERT INTO signed_messages
        (id, challenge_id, keystore_id, address, message_text, signature, signed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        `${id}-${signed}`,
        id,
        id,
        'synthetic-address',
        'Synthetic proof',
        signed ? 'synthetic-signature' : null,
        signed ? '2026-01-01' : null,
      )
    }
  }
  return { directory, db }
}

describe('unfinished challenge reset migration', () => {
  it('clears only unfinished messages, preserves completion markers and wallet data, and runs once', () => {
    const { directory, db } = setupUpgrade()
    const before = snapshot(db)
    const preservedMessages = db
      .prepare("SELECT * FROM signed_messages WHERE challenge_id NOT IN ('pending', 'archived') ORDER BY id")
      .all()

    initDatabase(directory, logger).close()

    const after = snapshot(db)
    expect(after.accounts).toEqual(before.accounts)
    expect(after.keystores).toEqual(before.keystores)
    expect(after.challenges).toEqual(before.challenges)
    expect(after.messages).toEqual(preservedMessages)
    expect(after.migrations).toEqual([...before.migrations, expect.objectContaining({ name: resetMigration })])
    expect(db.pragma('foreign_key_check')).toEqual([])

    // New progress after the upgrade must survive every subsequent startup.
    db.prepare(`INSERT INTO signed_messages
      (id, challenge_id, keystore_id, address, message_text, signature, signed_at)
      VALUES ('fresh', 'pending', 'pending', 'new-address', 'New proof', 'new-signature', '2026-02-01')`).run()
    const resumed = snapshot(db)
    initDatabase(directory, logger).close()
    initDatabase(directory, logger).close()
    expect(snapshot(db)).toEqual(resumed)
  })

  it('rolls back the delete if recording the migration fails, then safely retries', () => {
    const { directory, db } = setupUpgrade()
    db.exec(`CREATE TRIGGER reject_reset_journal BEFORE INSERT ON _migrations
      WHEN NEW.name = '${resetMigration}'
      BEGIN SELECT RAISE(ABORT, 'synthetic journal failure'); END`)
    const before = snapshot(db)

    expect(() => initDatabase(directory, logger)).toThrow('synthetic journal failure')
    expect(snapshot(db)).toEqual(before)

    db.exec('DROP TRIGGER reject_reset_journal')
    initDatabase(directory, logger).close()
    expect(db.prepare("SELECT * FROM signed_messages WHERE challenge_id IN ('pending', 'archived')").all()).toEqual([])
    expect(db.prepare('SELECT name FROM _migrations WHERE name = ?').get(resetMigration)).toEqual({
      name: resetMigration,
    })
  })
})
