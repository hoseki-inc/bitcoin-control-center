import { randomUUID } from 'node:crypto'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
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

/** Identifies the version of a profile a request was made against, so stale edits are refused. */
export interface ProfileReference {
  id: string
  revision: number
}

interface ProfileRow {
  id: string
  nickname: string
  host: string
  port: number
  protocol: string
  torEnabled: number
  revision: number
}

const ACTIVE_KEY = 'desktop_active_connection'
export const MAX_CONNECTION_PROFILES = 5

/** Saved desktop connections. Creating, renaming, or deleting a profile never opens a connection. */
export class ConnectionProfileStore {
  private readonly db: Database.Database

  public constructor(db: Database.Database) {
    this.db = db
  }

  public getActiveId(): string | undefined {
    return this.db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(ACTIVE_KEY)
      ?.value
  }

  public list(): ConnectionProfile[] {
    return this.db
      .prepare<[], ProfileRow>(
        'SELECT id, nickname, host, port, protocol, tor_enabled AS torEnabled, revision FROM desktop_connection_profiles ORDER BY rowid',
      )
      .all()
      .map((row) => ({
        id: row.id,
        nickname: row.nickname,
        host: row.host,
        port: row.port,
        protocol: row.protocol === 'tcp' ? 'tcp' : 'ssl',
        torEnabled: row.torEnabled === 1,
        revision: row.revision,
      }))
  }

  public get(reference: ProfileReference): Result<ConnectionProfile, Error> {
    const profile = this.list().find((item) => item.id === reference.id)
    if (!profile) {
      return Err(new Error('This saved connection no longer exists'))
    }
    if (profile.revision !== reference.revision) {
      return Err(new Error('This connection changed in another window. Reload it before trying again.'))
    }
    return Ok(profile)
  }

  /**
   * Saves the current connection as the active profile when none is active, so upgrades keep
   * their server and Tor setting. A saved profile only becomes active by connecting to it, so an
   * existing one is never adopted here; with no room left, nothing becomes active.
   */
  public initialize(initial: ConnectionDetails): Result<void, Error> {
    return this.write(() => {
      if (this.getActiveId() !== undefined || this.list().length >= MAX_CONNECTION_PROFILES) {
        return Ok(undefined)
      }
      const profile = this.insert({ ...initial, nickname: 'Current connection' })
      this.saveSetting(ACTIVE_KEY, profile.id)
      return Ok(undefined)
    })
  }

  public create(input: ConnectionDetails & { nickname: string }): Result<ConnectionProfile, Error> {
    return this.write(() => {
      if (this.list().length >= MAX_CONNECTION_PROFILES) {
        return Err(new Error(`You can save up to ${MAX_CONNECTION_PROFILES} connections`))
      }
      return Ok(this.insert(input))
    })
  }

  public rename(reference: ProfileReference, nickname: string): Result<ConnectionProfile, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      this.db
        .prepare('UPDATE desktop_connection_profiles SET nickname = ?, revision = revision + 1 WHERE id = ?')
        .run(nickname, reference.id)
      return Ok({ ...current.unwrap(), nickname, revision: reference.revision + 1 })
    })
  }

  public delete(reference: ProfileReference): Result<void, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      if (this.getActiveId() === reference.id) {
        return Err(new Error('Connect to another saved connection before deleting the active one'))
      }
      this.db.prepare('DELETE FROM desktop_connection_profiles WHERE id = ?').run(reference.id)
      return Ok(undefined)
    })
  }

  /** Called after a successful handshake, before any runtime consumer is replaced. */
  public activate(reference: ProfileReference, connection: ConnectionDetails): Result<void, Error> {
    return this.write(() => {
      const current = this.get(reference)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      this.db
        .prepare(
          `UPDATE desktop_connection_profiles
          SET host = ?, port = ?, protocol = ?, tor_enabled = ?, revision = revision + 1 WHERE id = ?`,
        )
        .run(connection.host, connection.port, connection.protocol, Number(connection.torEnabled), reference.id)
      this.saveSetting(ACTIVE_KEY, reference.id)
      // Keep the single-connection settings current, which launchers and older versions read.
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
