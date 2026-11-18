import { randomUUID } from 'node:crypto'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { eq, sql } from 'drizzle-orm'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import { desktopConnectionProfiles, settings } from '../../db/schema'

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

const ACTIVE_KEY = 'desktop_active_connection'
export const MAX_CONNECTION_PROFILES = 5

/** Saved desktop connections. Creating, renaming, or deleting a profile never opens a connection. */
export class ConnectionProfileStore {
  private readonly db: SentinelDb

  public constructor(db: SentinelDb) {
    this.db = db
  }

  public async getActiveId(db: SentinelDb | SentinelTx = this.db): Promise<string | undefined> {
    const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, ACTIVE_KEY))
    return row?.value
  }

  public async list(db: SentinelDb | SentinelTx = this.db): Promise<ConnectionProfile[]> {
    const rows = await db
      .select()
      .from(desktopConnectionProfiles)
      .orderBy(sql`${desktopConnectionProfiles}.rowid`)
    return rows.map((row) => ({
      id: row.id,
      nickname: row.nickname,
      host: row.host,
      port: row.port,
      protocol: row.protocol,
      torEnabled: row.torEnabled === 1,
      revision: row.revision,
    }))
  }

  public async get(
    reference: ProfileReference,
    db: SentinelDb | SentinelTx = this.db,
  ): Promise<Result<ConnectionProfile, Error>> {
    const profile = (await this.list(db)).find((item) => item.id === reference.id)
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
   * existing one is never adopted here; with no room left, nothing becomes active. Returns the
   * active profile, if there is one.
   */
  public async initialize(initial: ConnectionDetails): Promise<Result<ConnectionProfile | undefined, Error>> {
    return this.write(async (tx) => {
      if ((await this.getActiveId(tx)) === undefined && (await this.list(tx)).length < MAX_CONNECTION_PROFILES) {
        const profile = await this.insert(tx, { ...initial, nickname: 'Current connection' })
        await this.saveSetting(tx, ACTIVE_KEY, profile.id)
      }
      // Read here too, so an unreadable table is reported as an error rather than thrown.
      const activeId = await this.getActiveId(tx)
      return Ok((await this.list(tx)).find((profile) => profile.id === activeId))
    })
  }

  public async create(input: ConnectionDetails & { nickname: string }): Promise<Result<ConnectionProfile, Error>> {
    return this.write(async (tx) => {
      if ((await this.list(tx)).length >= MAX_CONNECTION_PROFILES) {
        return Err(new Error(`You can save up to ${MAX_CONNECTION_PROFILES} connections`))
      }
      return Ok(await this.insert(tx, input))
    })
  }

  public async rename(reference: ProfileReference, nickname: string): Promise<Result<ConnectionProfile, Error>> {
    return this.write(async (tx) => {
      const current = await this.get(reference, tx)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      await tx
        .update(desktopConnectionProfiles)
        .set({ nickname, revision: reference.revision + 1 })
        .where(eq(desktopConnectionProfiles.id, reference.id))
      return Ok({ ...current.unwrap(), nickname, revision: reference.revision + 1 })
    })
  }

  public async delete(reference: ProfileReference): Promise<Result<void, Error>> {
    return this.write(async (tx) => {
      const current = await this.get(reference, tx)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      if ((await this.getActiveId(tx)) === reference.id) {
        return Err(new Error('Connect to another saved connection before deleting the active one'))
      }
      await tx.delete(desktopConnectionProfiles).where(eq(desktopConnectionProfiles.id, reference.id))
      return Ok(undefined)
    })
  }

  /** Called after a successful handshake, before any runtime consumer is replaced. */
  public async activate(
    reference: ProfileReference,
    connection: ConnectionDetails,
    isStopped: () => boolean = () => false,
  ): Promise<Result<void, Error>> {
    return this.write(async (tx) => {
      const current = await this.get(reference, tx)
      if (current.isErr()) {
        return Err(current.unwrapErr())
      }
      await tx
        .update(desktopConnectionProfiles)
        .set({ ...connection, torEnabled: Number(connection.torEnabled), revision: reference.revision + 1 })
        .where(eq(desktopConnectionProfiles.id, reference.id))
      await this.saveSetting(tx, ACTIVE_KEY, reference.id)
      // Keep the single-connection settings current, which launchers and older versions read.
      await this.saveSetting(tx, 'electrum_host', connection.host)
      await this.saveSetting(tx, 'electrum_port', String(connection.port))
      await this.saveSetting(tx, 'electrum_protocol', connection.protocol)
      await this.saveSetting(tx, 'tor_enabled', String(connection.torEnabled))
      if (isStopped()) {
        throw new Error('The application is shutting down')
      }
      return Ok(undefined)
    })
  }

  private async insert(tx: SentinelTx, input: ConnectionDetails & { nickname: string }): Promise<ConnectionProfile> {
    const profile = { ...input, id: randomUUID(), revision: 1 }
    await tx.insert(desktopConnectionProfiles).values({ ...profile, torEnabled: Number(profile.torEnabled) })
    return profile
  }

  private async saveSetting(tx: SentinelTx, key: string, value: string): Promise<void> {
    await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } })
  }

  private async write<T>(operation: (tx: SentinelTx) => Promise<Result<T, Error>>): Promise<Result<T, Error>> {
    try {
      return await this.db.transaction(operation)
    } catch {
      return Err(new Error('Could not save connection settings; the previous connection has been kept'))
    }
  }
}
