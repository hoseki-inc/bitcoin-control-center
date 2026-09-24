import type { ElectrumClient, ElectrumClientConfig } from '@hoseki/packages/clients/electrum'
import { AsyncResult, Err, Ok } from '@hoseki/packages/result'
import Database from 'better-sqlite3'
import { pino } from 'pino'
import { assert, describe, expect, it, onTestFinished, vi } from 'vitest'
import { ElectrumConnection, type ElectrumServer, loadElectrumServer, saveElectrumServer } from './connection'

/** Stands in for a server: `reachable` decides whether the next connect succeeds. */
class FakeClient {
  public connected = false
  public disconnected = false

  public readonly config: ElectrumClientConfig
  private readonly reachable: () => boolean

  public constructor(config: ElectrumClientConfig, reachable: () => boolean) {
    this.config = config
    this.reachable = reachable
  }

  public connect(): AsyncResult<{ server: string }, Error> {
    const ok = this.reachable()
    this.connected = ok
    return new AsyncResult(
      Promise.resolve(ok ? Ok({ server: 'fake' }) : Err(new Error(`connect ECONNREFUSED ${this.config.host}`))),
    )
  }

  public isConnected(): boolean {
    return this.connected
  }

  public disconnect(): void {
    this.connected = false
    this.disconnected = true
  }
}

const HOME: ElectrumServer = { host: 'umbrel.local', port: 50001, protocol: 'tcp', tor: false }
const PUBLIC: ElectrumServer = { host: 'electrum.blockstream.info', port: 50002, protocol: 'ssl', tor: false }
const TOR_PROXY = { host: '127.0.0.1', port: 9050 }

function setup(options: { reachable?: Set<string>; socksProxy?: typeof TOR_PROXY; server?: ElectrumServer } = {}): {
  connection: ElectrumConnection
  clients: FakeClient[]
  reachable: Set<string>
  onClientChange: ReturnType<typeof vi.fn<(client: ElectrumClient) => void>>
} {
  const reachable = options.reachable ?? new Set<string>()
  const clients: FakeClient[] = []
  const onClientChange = vi.fn<(client: ElectrumClient) => void>()
  const connection = new ElectrumConnection({
    logger: pino({ level: 'silent' }),
    server: options.server ?? HOME,
    ...(options.socksProxy ? { socksProxy: options.socksProxy } : {}),
    onClientChange,
    retryDelaysMs: [1_000, 5_000],
    healthCheckMs: 30_000,
    createClient: (config) => {
      const client = new FakeClient(config, () => reachable.has(config.host))
      clients.push(client)
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The client class is nominal; the fake has every method the connection calls.
      return client as unknown as ElectrumClient
    },
  })
  return { connection, clients, reachable, onClientChange }
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown, so it runs once even after a failure or timeout.
  onTestFinished(async () => {
    vi.useRealTimers()
  })

  vi.useFakeTimers()

  await run()
}

describe('ElectrumConnection', () => {
  it('starts without a reachable server and connects once it comes up', async () => {
    await withTestSetup(async () => {
      const { connection, reachable } = setup()
      connection.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(connection.status()).toMatchObject({ connected: false, host: 'umbrel.local' })
      expect(connection.status().error).toContain('ECONNREFUSED')

      reachable.add('umbrel.local')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(connection.status()).toMatchObject({ connected: true, error: null })
      connection.stop()
    })
  })

  it('backs off between attempts while the server stays down', async () => {
    await withTestSetup(async () => {
      const { connection, clients } = setup()
      const client = clients[0]
      assert(client !== undefined)
      const connect = vi.spyOn(client, 'connect')
      connection.start()
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1_000)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(connect).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(connect).toHaveBeenCalledTimes(3)
      connection.stop()
    })
  })

  it('switches every consumer to a new server only after it answers', async () => {
    await withTestSetup(async () => {
      const { connection, clients, onClientChange } = setup({ reachable: new Set(['umbrel.local', PUBLIC.host]) })
      connection.start()
      await vi.advanceTimersByTimeAsync(0)

      const result = await connection.switchTo(PUBLIC)
      expect(result.isOk()).toBe(true)
      expect(connection.status()).toMatchObject({ host: PUBLIC.host, port: 50002, protocol: 'ssl', connected: true })
      expect(onClientChange).toHaveBeenCalledWith(clients[1])
      expect(connection.client).toBe(clients[1])
      expect(clients[0]?.disconnected).toBe(true)
      connection.stop()
    })
  })

  it('keeps the current server when the new one cannot be reached', async () => {
    await withTestSetup(async () => {
      const { connection, clients, onClientChange } = setup({ reachable: new Set(['umbrel.local']) })
      connection.start()
      await vi.advanceTimersByTimeAsync(0)

      const result = await connection.switchTo(PUBLIC)
      expect(result.unwrapErr().message).toContain('ECONNREFUSED')
      expect(connection.status()).toMatchObject({ host: 'umbrel.local', connected: true })
      expect(connection.client).toBe(clients[0])
      expect(onClientChange).not.toHaveBeenCalled()
      expect(clients[1]?.disconnected).toBe(true)
      connection.stop()
    })
  })

  it('routes Tor connections through the proxy and never directly', async () => {
    await withTestSetup(async () => {
      const { connection, clients } = setup({ reachable: new Set(['abc.onion']), socksProxy: TOR_PROXY })
      const onion: ElectrumServer = { host: 'abc.onion', port: 50001, protocol: 'tcp', tor: true }
      expect((await connection.switchTo(onion)).isOk()).toBe(true)
      expect(clients[1]?.config.proxy).toEqual(TOR_PROXY)
      expect(connection.status()).toMatchObject({ tor: true, torAvailable: true })

      // A saved Tor preference in a build without a Tor proxy still goes through a proxy.
      const bundled = setup({ server: { ...onion } })
      expect(bundled.clients[0]?.config.proxy).toEqual(TOR_PROXY)
      expect(bundled.connection.status().torAvailable).toBe(false)
    })
  })

  it('refuses Tor without a proxy and onion addresses without Tor', async () => {
    await withTestSetup(async () => {
      const { connection, clients } = setup({ reachable: new Set(['abc.onion']) })
      const viaTor = await connection.switchTo({ ...HOME, tor: true })
      expect(viaTor.unwrapErr().message).toBe('Tor is only available in the desktop app.')
      const onion = await connection.switchTo({ host: 'abc.onion', port: 50001, protocol: 'tcp', tor: false })
      expect(onion.unwrapErr().message).toBe('Onion addresses can only be reached through Tor.')
      expect(clients).toHaveLength(1)
    })
  })

  it('lets the latest of two overlapping changes win', async () => {
    await withTestSetup(async () => {
      const { connection } = setup({ reachable: new Set([PUBLIC.host, 'electrum.mempool.space']) })
      const mempool: ElectrumServer = { ...PUBLIC, host: 'electrum.mempool.space' }
      const [first, second] = await Promise.all([connection.switchTo(PUBLIC), connection.switchTo(mempool)])
      expect(first.isErr()).toBe(true)
      expect(second.isOk()).toBe(true)
      expect(connection.status().host).toBe('electrum.mempool.space')
    })
  })
})

describe('saved Electrum server', () => {
  const defaults = { host: 'electrum.blockstream.info', port: 50002, protocol: 'ssl' as const }

  function database(): Database.Database {
    const db = new Database(':memory:')
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    return db
  }

  it('falls back to the platform default when nothing is saved', async () => {
    await withTestSetup(async () => {
      expect(loadElectrumServer(database(), defaults)).toEqual({ ...defaults, tor: false })
    })
  })

  it('saves and loads every field together', async () => {
    await withTestSetup(async () => {
      const db = database()
      const server: ElectrumServer = { host: 'abc.onion', port: 50001, protocol: 'tcp', tor: true }
      saveElectrumServer(db, server)
      expect(loadElectrumServer(db, defaults)).toEqual(server)
    })
  })

  it('ignores a corrupt port or protocol', async () => {
    await withTestSetup(async () => {
      const db = database()
      db.prepare("INSERT INTO settings VALUES ('electrum_port', 'abc'), ('electrum_protocol', 'udp')").run()
      expect(loadElectrumServer(db, defaults)).toMatchObject({ port: 50002, protocol: 'ssl' })
    })
  })
})
