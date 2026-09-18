import { randomUUID } from 'node:crypto'
import { Err, Ok } from '@patina/core'
import type { Result } from '@patina/core'
import type Database from 'better-sqlite3'

export interface ConnectionDetails {
  host: string
  port: number
  protocol: 'tcp' | 'ssl'
  torEnabled: boolean
}

export interface ConnectionProfile extends ConnectionDetails {
  id: string
  nickname: string
  revision: number
}

export interface ProfileReference {
  id: string
  revision: number
}

const ACTIVE_KEY = 'desktop_active_connection'
export const MAX_CONNECTION_PROFILES = 5

/** Local desktop preferences. Creating, renaming, or deleting a profile never opens a connection. */
export class ConnectionProfileStore {
  constructor(private readonly db: Database.Database) {}

  getActiveId(): string | undefined {
    return (
      this.db.prepare('SELECT value FROM settings WHERE key = ?').get(ACTIVE_KEY) as { value: string } | undefined
    )?.value
  }

  list(): ConnectionProfile[] {
    const rows = this.db
      .prepare(
        'SELECT id, nickname, host, port, protocol, tor_enabled AS torEnabled, revision FROM desktop_connection_profiles ORDER BY rowid',
      )
      .all() as Array<Omit<ConnectionProfile, 'torEnabled'> & { torEnabled: number }>
    return rows.map((row) => ({ ...row, torEnabled: row.torEnabled === 1 }))
  }

  get(reference: ProfileReference): Result<ConnectionProfile, Error> {
    const profile = this.list().find((item) => item.id === reference.id)
    if (!profile) return Err(new Error('This saved connection no longer exists'))
    if (profile.revision !== reference.revision)
      return Err(new Error('This connection changed in another window. Reload it before trying again.'))
    return Ok(profile)
  }

  initialize(initial: ConnectionDetails): Result<void, Error> {
    return this.write(() => {
      if (this.getActiveId()) return Ok(undefined)
      const existing = this.list()[0]
      const profile = existing ?? this.insert({ ...initial, nickname: 'Current connection' })
      this.saveSetting(ACTIVE_KEY, profile.id)
      return Ok(undefined)
    })
  }

  create(input: ConnectionDetails & { nickname: string }): Result<ConnectionProfile, Error> {
    return this.write(() => {
      if (this.list().length >= MAX_CONNECTION_PROFILES)
        return Err(new Error(`You can save up to ${MAX_CONNECTION_PROFILES} connections`))
      return Ok(this.insert(input))
    })
  }

  rename(reference: ProfileReference, nickname: string): Result<ConnectionProfile, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) return Err(current.unwrapErr())
      this.db
        .prepare('UPDATE desktop_connection_profiles SET nickname = ?, revision = revision + 1 WHERE id = ?')
        .run(nickname, reference.id)
      return Ok({ ...current.unwrap(), nickname, revision: reference.revision + 1 })
    })
  }

  delete(reference: ProfileReference): Result<void, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) return Err(current.unwrapErr())
      if (this.getActiveId() === reference.id)
        return Err(new Error('Connect to another profile before deleting the active connection'))
      this.db.prepare('DELETE FROM desktop_connection_profiles WHERE id = ?').run(reference.id)
      return Ok(undefined)
    })
  }

  /** Called after a successful handshake, before replacing any runtime consumer. */
  activate(reference: ProfileReference, connection: ConnectionDetails): Result<void, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) return Err(current.unwrapErr())
      this.db
        .prepare(
          `UPDATE desktop_connection_profiles
        SET host = ?, port = ?, protocol = ?, tor_enabled = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(connection.host, connection.port, connection.protocol, Number(connection.torEnabled), reference.id)
      this.saveSetting(ACTIVE_KEY, reference.id)
      // Preserve the existing launcher's settings and support upgrades from the single-connection UI.
      this.saveSetting('electrum_host', connection.host)
      this.saveSetting('electrum_port', String(connection.port))
      this.saveSetting('electrum_protocol', connection.protocol)
      this.saveSetting('tor_enabled', String(connection.torEnabled))
      return Ok(undefined)
    })
  }

  private insert(input: ConnectionDetails & { nickname: string }): ConnectionProfile {
    const profile = { ...input, id: randomUUID(), revision: 1 }
    this.db
      .prepare(
        `INSERT INTO desktop_connection_profiles (id, nickname, host, port, protocol, tor_enabled)
      VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(profile.id, profile.nickname, profile.host, profile.port, profile.protocol, Number(profile.torEnabled))
    return profile
  }

  private saveSetting(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value)
  }

  private write<T>(operation: () => Result<T, Error>): Result<T, Error> {
    try {
      return this.db.transaction(operation)()
    } catch {
      return Err(new Error('Could not save connection settings; the previous connection has been kept'))
    }
  }
}
