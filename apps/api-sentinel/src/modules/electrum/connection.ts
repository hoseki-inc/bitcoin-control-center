import { ElectrumClient, type ElectrumClientConfig } from '@hoseki/packages/clients/electrum'
import { Err, Ok, type Result } from '@patina/core'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'

export type ElectrumProtocol = 'tcp' | 'ssl'

/** The Electrum server Sentinel reads chain data from. */
export interface ElectrumServer {
  host: string
  port: number
  protocol: ElectrumProtocol
  /** Route the connection through the Tor SOCKS proxy. */
  tor: boolean
}

export interface ElectrumStatus extends ElectrumServer {
  connected: boolean
  /** Whether this build runs its own Tor proxy (the desktop app does). */
  torAvailable: boolean
  /** Why the latest attempt to reach the server failed, while it is unreachable. */
  error: string | null
}

export interface SocksProxy {
  host: string
  port: number
}

/**
 * Where Tor listens by default. A saved Tor preference is always honoured through a
 * proxy, never by connecting directly, even in a build that does not bundle Tor.
 */
const DEFAULT_TOR_PROXY: SocksProxy = { host: '127.0.0.1', port: 9050 }

/** Waits between attempts while the server is unreachable; the last one repeats. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000, 60_000]

/** How often a live connection is checked, so a dropped one is noticed without a request. */
const HEALTH_CHECK_MS = 30_000

export interface ElectrumConnectionDeps {
  logger: Logger
  server: ElectrumServer
  /** The bundled Tor proxy, when this build has one. */
  socksProxy?: SocksProxy
  /** Called after a server change so long-lived consumers move to the new client. */
  onClientChange?: (client: ElectrumClient) => void
  createClient?: (config: ElectrumClientConfig) => ElectrumClient
  retryDelaysMs?: readonly number[]
  healthCheckMs?: number
}

/**
 * Owns the connection to the Electrum server.
 *
 * Sentinel starts whether or not the server can be reached: an offline laptop, a server
 * that is down or a Tor proxy that is still bootstrapping all leave the app usable, and
 * the connection keeps retrying in the background. A new server replaces the current one
 * only once it has answered.
 */
export class ElectrumConnection {
  private current: ElectrumClient
  private server: ElectrumServer
  private lastError: string | null = null
  private failures = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = true
  private switchSeq = 0

  public constructor(private readonly deps: ElectrumConnectionDeps) {
    this.server = deps.server
    this.current = this.createClient(deps.server)
  }

  public get client(): ElectrumClient {
    return this.current
  }

  public status(): ElectrumStatus {
    const connected = this.current.isConnected()
    return {
      ...this.server,
      connected,
      torAvailable: this.deps.socksProxy !== undefined,
      error: connected ? null : this.lastError,
    }
  }

  /** Connects in the background and keeps the connection up. Never fails. */
  public start(): void {
    if (!this.stopped) return
    this.stopped = false
    void this.check()
  }

  public stop(): void {
    this.stopped = true
    this.clearTimer()
    this.current.disconnect()
  }

  /** Why this server cannot be used here, before any connection is attempted. */
  public problemWith(server: ElectrumServer): string | null {
    if (server.tor && this.deps.socksProxy === undefined) {
      return 'Tor is only available in the desktop app.'
    }
    if (!server.tor && server.host.endsWith('.onion')) {
      return 'Onion addresses can only be reached through Tor.'
    }
    return null
  }

  /**
   * Connects to `server` and, once it answers, makes it the server for everything.
   * On failure the current server stays in place.
   */
  public async switchTo(server: ElectrumServer): Promise<Result<void, Error>> {
    const problem = this.problemWith(server)
    if (problem !== null) return Err(new Error(problem))

    const seq = ++this.switchSeq
    const client = this.createClient(server)
    const result = await client.connect()
    if (result.isErr()) {
      client.disconnect()
      return Err(result.unwrapErr())
    }
    if (seq !== this.switchSeq) {
      client.disconnect()
      return Err(new Error('A newer server change replaced this one.'))
    }

    const previous = this.current
    this.current = client
    this.server = server
    this.lastError = null
    this.failures = 0
    this.deps.onClientChange?.(client)
    previous.disconnect()
    this.deps.logger.info(
      { host: server.host, port: server.port, protocol: server.protocol, tor: server.tor },
      'Switched Electrum server',
    )
    if (!this.stopped) this.schedule(this.deps.healthCheckMs ?? HEALTH_CHECK_MS)
    return Ok(undefined)
  }

  private createClient(server: ElectrumServer): ElectrumClient {
    const config: ElectrumClientConfig = {
      host: server.host,
      port: server.port,
      protocol: server.protocol,
      requestTimeout: 10_000,
      ...(server.tor ? { proxy: this.deps.socksProxy ?? DEFAULT_TOR_PROXY } : {}),
    }
    return (this.deps.createClient ?? ((c: ElectrumClientConfig) => new ElectrumClient(c)))(config)
  }

  private async check(): Promise<void> {
    this.timer = null
    if (this.stopped) return

    const client = this.current
    if (client.isConnected()) {
      this.schedule(this.deps.healthCheckMs ?? HEALTH_CHECK_MS)
      return
    }

    const result = await client.connect()
    // A server change while this attempt was in flight schedules its own check.
    if (this.stopped || client !== this.current) return

    const { host, port, protocol, tor } = this.server
    if (result.isOk()) {
      this.deps.logger.info({ host, port, protocol, tor }, 'Connected to Electrum server')
      this.lastError = null
      this.failures = 0
      this.schedule(this.deps.healthCheckMs ?? HEALTH_CHECK_MS)
      return
    }

    this.lastError = result.unwrapErr().message
    const delays = this.deps.retryDelaysMs ?? RETRY_DELAYS_MS
    const delay = delays[Math.min(this.failures, delays.length - 1)] ?? HEALTH_CHECK_MS
    if (this.failures === 0) {
      this.deps.logger.warn(
        { host, port, protocol, tor, error: this.lastError },
        'Electrum server unreachable; retrying in the background',
      )
    }
    this.failures += 1
    this.schedule(delay)
  }

  private schedule(ms: number): void {
    this.clearTimer()
    this.timer = setTimeout(() => void this.check(), ms)
    this.timer.unref()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }
}

const SETTING_KEYS = {
  host: 'electrum_host',
  port: 'electrum_port',
  protocol: 'electrum_protocol',
  tor: 'tor_enabled',
} as const

/** The saved server, falling back to the platform's default for anything not saved. */
export function loadElectrumServer(
  db: Database.Database,
  defaults: { host: string; port: number; protocol: ElectrumProtocol },
): ElectrumServer {
  const read = (key: string): string | undefined =>
    (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value

  const port = Number(read(SETTING_KEYS.port))
  const protocol = read(SETTING_KEYS.protocol)
  return {
    host: read(SETTING_KEYS.host) ?? defaults.host,
    port: Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : defaults.port,
    protocol: protocol === 'tcp' || protocol === 'ssl' ? protocol : defaults.protocol,
    tor: read(SETTING_KEYS.tor) === 'true',
  }
}

/** Saves the whole server at once, so a restart never mixes old and new values. */
export function saveElectrumServer(db: Database.Database, server: ElectrumServer): void {
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  db.transaction(() => {
    upsert.run(SETTING_KEYS.host, server.host)
    upsert.run(SETTING_KEYS.port, String(server.port))
    upsert.run(SETTING_KEYS.protocol, server.protocol)
    upsert.run(SETTING_KEYS.tor, String(server.tor))
  })()
}
