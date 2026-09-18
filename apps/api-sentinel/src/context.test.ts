import { mkdtempSync, rmSync } from 'node:fs'
import { type AddressInfo, type Socket, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppContext, createAppContext } from './context'
import type { Env } from './env'
import { appRouter } from './modules/trpc/router'

let env: Env
vi.mock('./env', () => ({ loadEnv: () => env }))

const logger = pino({ level: 'silent' })
const contexts = new Set<AppContext>()
const fixtures: Array<Awaited<ReturnType<typeof startElectrum>>> = []
let directory: string

async function startElectrum(height: number, holdVersion = false, rejectVersion = false) {
  const sockets = new Set<Socket>()
  const methods: string[] = []
  const versions: Array<() => void> = []
  let holdHeaders = false
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => undefined)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const request = JSON.parse(buffer.slice(0, newline)) as { id: number; method: string }
        buffer = buffer.slice(newline + 1)
        methods.push(request.method)
        const reply = (): void => {
          const response =
            request.method === 'server.version'
              ? rejectVersion
                ? { error: { code: -1, message: 'Test server unavailable' } }
                : { result: ['Review Electrum', '1.4'] }
              : { result: { height, hex: '00'.repeat(80) } }
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, ...response })}\n`)
        }
        if (request.method === 'server.version' && holdVersion) versions.push(reply)
        else if (request.method !== 'blockchain.headers.subscribe' || !holdHeaders) reply()
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const config = { host: '127.0.0.1', port: (server.address() as AddressInfo).port, protocol: 'tcp' as const }
  const fixture = {
    config,
    methods,
    sockets,
    holdHeaders: (): void => {
      holdHeaders = true
    },
    releaseVersion: (): void => {
      for (const reply of versions.splice(0)) reply()
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
  fixtures.push(fixture)
  return fixture
}

async function context(waitForElectrum = true, connectionProfiles = false): Promise<AppContext> {
  const ctx = (await createAppContext(logger, { waitForElectrum, connectionProfiles })).unwrap()
  contexts.add(ctx)
  return ctx
}

function settings(ctx: AppContext): unknown {
  return ctx.database.db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'electrum_%' OR key = 'tor_enabled' ORDER BY key")
    .all()
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'sentinel-connection-test-'))
  const initial = await startElectrum(100)
  env = {
    HOST: '127.0.0.1',
    PORT: 3400,
    ELECTRUM_HOST: initial.config.host,
    ELECTRUM_PORT: initial.config.port,
    ELECTRUM_PROTOCOL: 'tcp',
    BITCOIN_NETWORK: 'mainnet',
    DATA_DIR: directory,
    APP_DIR: directory,
    LOG_LEVEL: 'fatal',
    MEMPOOL_API_URL: 'https://example.invalid',
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts) {
    ctx.disconnectElectrum()
    ctx.database.close()
  }
  contexts.clear()
  for (const fixture of fixtures.splice(0)) await fixture.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('Electrum connection lifecycle', () => {
  it('makes desktop settings and local holdings available while the initial connection is still pending', async () => {
    const pending = await startElectrum(100, true)
    env.ELECTRUM_PORT = pending.config.port
    const ctx = await context(false)
    const caller = appRouter.createCaller({ app: ctx })
    await expect(caller.settings.electrumStatus()).resolves.toMatchObject({ connected: false })
    expect(await caller.settings.get({ key: 'user_name' })).toBeNull()
    expect(
      await caller.portalProve.manual.create({
        displayName: 'Offline holding',
        balanceSats: '123',
        balanceAsOf: '2026-09-06T00:00:00.000Z',
      }),
    ).toMatchObject({ balance: '123' })
    await vi.waitFor(() => expect(pending.methods).toContain('server.version'))
    pending.releaseVersion()
    await vi.waitFor(() => expect(ctx.electrumClient.isConnected()).toBe(true))
  })

  it('keeps desktop settings available after a failed initial handshake', async () => {
    const unavailable = await startElectrum(100, false, true)
    env.ELECTRUM_PORT = unavailable.config.port
    const ctx = await context(false)
    await vi.waitFor(() => expect(unavailable.methods).toContain('server.version'))
    expect(await appRouter.createCaller({ app: ctx }).settings.get({ key: 'user_name' })).toBeNull()
    expect(ctx.electrumClient.isConnected()).toBe(false)
    await vi.waitFor(() => expect(unavailable.sockets.size).toBe(0))
  })

  it('preserves the default StartOS startup requirement', async () => {
    const unavailable = await startElectrum(100, false, true)
    env.ELECTRUM_PORT = unavailable.config.port
    expect((await createAppContext(logger)).isErr()).toBe(true)
  })

  it('switches the existing portfolio and statement providers and restores the saved server on restart', async () => {
    const ctx = await context()
    const portfolio = ctx.controlCenterService['onchainProvider']
    const statements = ctx.statementService['onchainProvider']
    const next = await startElectrum(200)
    await appRouter.createCaller({ app: ctx }).settings.reconnectElectrum(next.config)
    expect((await portfolio.getBlocksTip()).unwrap().height).toBe(200)
    expect((await statements.getBlocksTip()).unwrap().height).toBe(200)
    expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(200)
    expect(settings(ctx)).toEqual([
      { key: 'electrum_host', value: next.config.host },
      { key: 'electrum_port', value: String(next.config.port) },
      { key: 'electrum_protocol', value: 'tcp' },
      { key: 'tor_enabled', value: 'false' },
    ])
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    const restarted = await context()
    expect(restarted.electrumConfig.port).toBe(next.config.port)
    expect((await restarted.onchainProvider.getBlocksTip()).unwrap().height).toBe(200)
  })

  it('keeps the working connection and saved settings when the replacement fails', async () => {
    const ctx = await context()
    await ctx.reconnectElectrum(fixtures[0]!.config)
    const before = settings(ctx)
    const failed = await startElectrum(200, false, true)
    expect((await ctx.reconnectElectrum(failed.config)).isErr()).toBe(true)
    expect(settings(ctx)).toEqual(before)
    expect(ctx.electrumClient.isConnected()).toBe(true)
    expect((await ctx.controlCenterService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
    await vi.waitFor(() => expect(failed.sockets.size).toBe(0))
  })

  it('rolls back every setting and keeps the previous client if persistence fails mid-transaction', async () => {
    const ctx = await context()
    await ctx.reconnectElectrum(fixtures[0]!.config)
    const before = settings(ctx)
    ctx.database.db.exec(
      "CREATE TRIGGER reject_connection_save BEFORE INSERT ON settings WHEN NEW.key = 'electrum_port' BEGIN SELECT RAISE(FAIL, 'test write failure'); END",
    )
    const next = await startElectrum(200)
    expect((await ctx.reconnectElectrum(next.config)).unwrapErr().message).toContain('Could not save')
    expect(settings(ctx)).toEqual(before)
    expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
    await vi.waitFor(() => expect(next.sockets.size).toBe(0))
  })

  it('rejects a concurrent change instead of allowing a slower save to overwrite it later', async () => {
    const ctx = await context()
    const next = await startElectrum(200, true)
    const pending = ctx.reconnectElectrum(next.config)
    await vi.waitFor(() => expect(next.methods).toContain('server.version'))
    expect((await ctx.reconnectElectrum(fixtures[0]!.config)).unwrapErr().message).toContain('already in progress')
    next.releaseVersion()
    expect((await pending).isOk()).toBe(true)
    expect(ctx.electrumConfig.port).toBe(next.config.port)
  })

  it('cancels a pending change on shutdown without saving it', async () => {
    const ctx = await context()
    const before = settings(ctx)
    const next = await startElectrum(200, true)
    const pending = ctx.reconnectElectrum(next.config)
    await vi.waitFor(() => expect(next.methods).toContain('server.version'))
    ctx.disconnectElectrum()
    expect((await pending).isErr()).toBe(true)
    expect(settings(ctx)).toEqual(before)
    await vi.waitFor(() => expect(next.sockets.size).toBe(0))
  })

  it('settles requests using the previous connection when switching instead of leaving them hanging', async () => {
    const ctx = await context()
    fixtures[0]!.holdHeaders()
    const previousRequest = ctx.controlCenterService['onchainProvider'].getBlocksTip()
    await vi.waitFor(() => expect(fixtures[0]!.methods).toContain('blockchain.headers.subscribe'))
    const next = await startElectrum(200)
    expect((await ctx.reconnectElectrum(next.config)).isOk()).toBe(true)
    expect((await previousRequest).isErr()).toBe(true)
    expect((await ctx.controlCenterService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(200)
  })

  it.each(['electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled'])(
    'rejects partial writes to %s through the generic settings endpoint',
    async (key) => {
      const ctx = await context()
      await expect(
        appRouter.createCaller({ app: ctx }).settings.update({ key, value: 'invalid' }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(settings(ctx)).toEqual([])
    },
  )
})

describe('Tor connection policy', () => {
  it('does not fall back to direct connections when Tor is requested but unavailable', async () => {
    const ctx = await context()
    const next = await startElectrum(200)
    const caller = appRouter.createCaller({ app: ctx })
    await expect(caller.settings.reconnectElectrum({ ...next.config, torEnabled: true })).rejects.toThrow(
      'Tor is not available',
    )
    await expect(caller.settings.testElectrum({ ...next.config, torEnabled: true })).rejects.toThrow(
      'Tor is not available',
    )
    expect(next.methods).toEqual([])
    expect(ctx.electrumConfig.port).toBe(fixtures[0]!.config.port)
    expect(settings(ctx)).toEqual([])
  })

  it('rejects onion addresses unless Tor is enabled', async () => {
    const ctx = await context()
    await expect(
      appRouter
        .createCaller({ app: ctx })
        .settings.testElectrum({ host: 'example.onion', port: 50001, protocol: 'tcp' }),
    ).rejects.toThrow('Onion addresses require Tor')
  })

  it('keeps a saved Tor configuration offline when the proxy is missing on restart', async () => {
    const previous = await context()
    previous.database.db.prepare("INSERT INTO settings (key, value) VALUES ('tor_enabled', 'true')").run()
    previous.disconnectElectrum()
    previous.database.close()
    contexts.delete(previous)
    const initialCalls = fixtures[0]!.methods.length
    const ctx = await context(false)
    expect((await ctx.electrumClient.connect()).isErr()).toBe(true)
    expect((await ctx.onchainProvider.getBlocksTip()).isErr()).toBe(true)
    expect(fixtures[0]!.methods).toHaveLength(initialCalls)
  })

  it('waits for managed Tor before opening SOCKS, and uses the distribution port', async () => {
    const connections: Socket[] = []
    const proxy = createServer((socket) => {
      connections.push(socket)
      socket.on('error', () => undefined)
      socket.once('data', () => socket.end(Buffer.from([5, 255])))
    })
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve))
    try {
      env.SOCKS_PROXY_HOST = '127.0.0.1'
      env.SOCKS_PROXY_PORT = (proxy.address() as AddressInfo).port
      let ready!: (status: { state: string }) => void
      const bootstrap = new Promise<{ state: string }>((resolve) => {
        ready = resolve
      })
      const tor = { start: vi.fn(() => bootstrap), getStatus: () => ({ state: 'starting' as const }) }
      const ctx = (await createAppContext(logger, { tor })).unwrap()
      contexts.add(ctx)
      const pending = appRouter
        .createCaller({ app: ctx })
        .settings.testElectrum({ ...fixtures[0]!.config, torEnabled: true })
      const outcome = expect(pending).rejects.toThrow()
      await vi.waitFor(() => expect(tor.start).toHaveBeenCalled())
      expect(connections).toHaveLength(0)
      expect(ctx.getTorStatus().state).toBe('starting')
      ready({ state: 'ready' })
      await outcome
      expect(connections).toHaveLength(1)
    } finally {
      for (const socket of connections) socket.destroy()
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })

  it('preserves the active server and settings when managed Tor fails', async () => {
    env.SOCKS_PROXY_HOST = '127.0.0.1'
    env.SOCKS_PROXY_PORT = 19451
    const ctx = (
      await createAppContext(logger, {
        tor: {
          start: async () => ({ state: 'failed', message: 'Tor bootstrap failed' }),
          getStatus: () => ({ state: 'failed', message: 'Tor bootstrap failed' }),
        },
      })
    ).unwrap()
    contexts.add(ctx)
    const next = await startElectrum(200)
    await expect(
      appRouter.createCaller({ app: ctx }).settings.reconnectElectrum({ ...next.config, torEnabled: true }),
    ).rejects.toThrow('Tor bootstrap failed')
    expect(next.methods).toEqual([])
    expect(settings(ctx)).toEqual([])
    expect(ctx.electrumClient.isConnected()).toBe(true)
  })
})

describe('desktop saved connections', () => {
  it('restores the active profile even if launcher defaults change before any connection switch', async () => {
    const ctx = await context(true, true)
    const initial = ctx.electrumConfig.port
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    env.ELECTRUM_PORT = (await startElectrum(200)).config.port
    const restarted = await context(true, true)
    expect(restarted.electrumConfig.port).toBe(initial)
    expect((await restarted.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
  })
  it('keeps profile APIs disabled and the profile table empty in node deployments', async () => {
    const ctx = await context()
    await expect(appRouter.createCaller({ app: ctx }).settings.connectionProfiles.list()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
    await expect(
      appRouter.createCaller({ app: ctx }).settings.connectionProfiles.delete({
        id: '00000000-0000-4000-8000-000000000001',
        revision: 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(ctx.database.db.prepare('SELECT * FROM desktop_connection_profiles').all()).toEqual([])
  })

  it('migrates the existing Tor connection once without changing its endpoint or connecting directly', async () => {
    const previous = await context()
    const save = previous.database.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
    save.run('electrum_host', 'my-node.onion')
    save.run('electrum_port', '50001')
    save.run('electrum_protocol', 'tcp')
    save.run('tor_enabled', 'true')
    previous.disconnectElectrum()
    previous.database.close()
    contexts.delete(previous)
    const ctx = await context(false, true)
    const snapshot = await appRouter.createCaller({ app: ctx }).settings.connectionProfiles.list()
    expect(snapshot.profiles).toEqual([
      expect.objectContaining({
        nickname: 'Current connection',
        host: 'my-node.onion',
        port: 50001,
        protocol: 'tcp',
        torEnabled: true,
      }),
    ])
    expect(snapshot.activeId).toBe(snapshot.profiles[0]!.id)
    expect((await ctx.electrumClient.connect()).isErr()).toBe(true)
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    const restarted = await context(false, true)
    expect(restarted.connectionProfiles!.list()).toEqual(snapshot.profiles)
  })

  it('saves and renames inactive profiles without making network requests or changing the active connection', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const before = await api.list()
    const next = await startElectrum(200)
    const saved = await api.create({ ...next.config, nickname: '  Home LAN  ' })
    expect(saved.nickname).toBe('Home LAN')
    const renamed = await api.rename({ ...saved, nickname: 'My node' })
    expect(renamed.id).toBe(saved.id)
    expect((await api.list()).activeId).toBe(before.activeId)
    expect(next.methods).toEqual([])
    await expect(api.rename({ ...saved, nickname: 'Stale edit' })).rejects.toThrow('another window')
    expect((await api.list()).profiles[1]!.nickname).toBe('My node')
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    const restarted = await context(true, true)
    expect(restarted.connectionProfiles!.list()[1]).toEqual(renamed)
  })

  it('enforces the five-profile limit across concurrent requests', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, i) =>
        api.create({
          host: 'unused.example',
          port: 50002,
          protocol: 'ssl',
          nickname: `Connection ${i}`,
        }),
      ),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4)
    expect((await api.list()).profiles).toHaveLength(5)
    await expect(
      api.create({ host: 'unused.example', port: 50002, protocol: 'ssl', nickname: 'Sixth' }),
    ).rejects.toThrow('up to 5')
  })

  it('validates names, endpoints, and routes while allowing offline Tor profiles to be saved', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    await expect(api.create({ ...fixtures[0]!.config, nickname: '   ' })).rejects.toThrow('nickname')
    await expect(api.create({ ...fixtures[0]!.config, nickname: 'x'.repeat(81) })).rejects.toThrow('80')
    await expect(
      api.create({ host: 'ssl://node.example:50002', port: 50002, protocol: 'ssl', nickname: 'Invalid' }),
    ).rejects.toThrow('host')
    await expect(
      api.create({ host: 'node.onion', port: 50001, protocol: 'tcp', nickname: 'Invalid route' }),
    ).rejects.toThrow('require Tor')
    const saved = await api.create({
      host: ' NODE.ONION. ',
      port: 50001,
      protocol: 'tcp',
      torEnabled: true,
      nickname: 'Away',
    })
    expect(saved.host).toBe('node.onion')
    await expect(api.connect(saved)).rejects.toThrow('Tor is not available')
    expect((await api.list()).activeId).not.toBe(saved.id)
  })

  it('deletes an inactive profile locally, frees a slot, and preserves the deletion after restart', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const active = (await api.list()).activeId
    const next = await startElectrum(200)
    const removed = await api.create({ ...next.config, nickname: 'Remove me' })
    for (let i = 0; i < 3; i++) await api.create({ ...next.config, nickname: `Keep ${i}` })
    expect((await api.list()).profiles).toHaveLength(5)
    const beforeSettings = settings(ctx)
    await api.delete(removed)
    expect((await api.list()).profiles).toHaveLength(4)
    await api.create({ ...next.config, nickname: 'Replacement slot' })
    expect((await api.list()).profiles).toHaveLength(5)
    expect((await api.list()).activeId).toBe(active)
    expect(settings(ctx)).toEqual(beforeSettings)
    expect(next.methods).toEqual([])
    expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    const restarted = await context(true, true)
    expect(restarted.connectionProfiles!.list()).toHaveLength(5)
    expect(restarted.connectionProfiles!.list().some((profile) => profile.id === removed.id)).toBe(false)
    expect(restarted.connectionProfiles!.getActiveId()).toBe(active)
  })

  it('protects the active or last profile even offline and permits deletion after switching', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const initial = (await api.list()).profiles[0]!
    await expect(api.delete(initial)).rejects.toThrow('Connect to another profile')
    ctx.electrumClient.disconnect()
    await expect(api.delete(initial)).rejects.toThrow('Connect to another profile')
    const next = await api.create({ ...(await startElectrum(200)).config, nickname: 'New active' })
    const connected = await api.connect(next)
    await expect(api.delete(connected)).rejects.toThrow('Connect to another profile')
    await api.delete(initial)
    expect((await api.list()).profiles).toEqual([connected])
    expect((await api.list()).activeId).toBe(next.id)
    expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(200)
  })

  it('rejects stale deletion and repeated deletion without affecting other profiles', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const saved = await api.create({ ...fixtures[0]!.config, nickname: 'Before' })
    const renamed = await api.rename({ ...saved, nickname: 'After' })
    await expect(api.delete(saved)).rejects.toThrow('another window')
    expect((await api.list()).profiles).toContainEqual(renamed)
    const outcomes = await Promise.allSettled([api.delete(renamed), api.delete(renamed)])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect((await api.list()).profiles).toHaveLength(1)
  })

  it('preserves the saved profiles and active runtime when deletion cannot be persisted', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const saved = await api.create({ ...fixtures[0]!.config, nickname: 'Keep after failure' })
    const before = await api.list()
    ctx.database.db.exec(
      "CREATE TRIGGER reject_profile_delete BEFORE DELETE ON desktop_connection_profiles BEGIN SELECT RAISE(FAIL, 'test deletion failure'); END",
    )
    await expect(api.delete(saved)).rejects.toThrow('Could not save connection settings')
    expect(await api.list()).toEqual(before)
    expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
  })

  it('does not activate or recreate a profile deleted during its pending handshake', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const active = (await api.list()).activeId
    const next = await startElectrum(200, true)
    const saved = await api.create({ ...next.config, nickname: 'Connecting' })
    const pending = api.connect(saved)
    const outcome = expect(pending).rejects.toThrow('no longer exists')
    await vi.waitFor(() => expect(next.methods).toContain('server.version'))
    await api.delete(saved)
    next.releaseVersion()
    await outcome
    expect((await api.list()).activeId).toBe(active)
    expect((await api.list()).profiles).toHaveLength(1)
    expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
    await vi.waitFor(() => expect(next.sockets.size).toBe(0))
  })

  it('tests an inactive profile without activating it, then switches every provider and restores it on restart', async () => {
    const ctx = await context(true, true)
    const caller = appRouter.createCaller({ app: ctx })
    const api = caller.settings.connectionProfiles
    const before = (await api.list()).activeId
    const next = await startElectrum(200)
    const saved = await api.create({ ...next.config, nickname: 'Home' })
    await caller.settings.testElectrum(saved)
    expect((await api.list()).activeId).toBe(before)
    expect(next.methods).toEqual(['server.version'])
    const connected = await api.connect(saved)
    expect(connected.revision).toBe(saved.revision + 1)
    expect((await api.list()).activeId).toBe(saved.id)
    expect((await ctx.controlCenterService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(200)
    expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(200)
    ctx.disconnectElectrum()
    ctx.database.close()
    contexts.delete(ctx)
    const restarted = await context(true, true)
    expect(restarted.connectionProfiles!.getActiveId()).toBe(saved.id)
    expect(restarted.electrumConfig.port).toBe(next.config.port)
  })

  it('preserves all profile and runtime state after failed connection or failed persistence', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const next = await startElectrum(200)
    const bad = await startElectrum(300, false, true)
    const saved = await api.create({ ...next.config, nickname: 'Next' })
    const before = await api.list()
    await expect(api.connect({ ...saved, connection: { ...bad.config, torEnabled: false } })).rejects.toThrow()
    expect(await api.list()).toEqual(before)
    ctx.database.db.exec(
      "CREATE TRIGGER reject_profile_save BEFORE INSERT ON settings WHEN NEW.key = 'electrum_port' BEGIN SELECT RAISE(FAIL, 'test write failure'); END",
    )
    await expect(api.connect(saved)).rejects.toThrow('Could not save')
    expect(await api.list()).toEqual(before)
    expect(settings(ctx)).toEqual([])
    expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
    await vi.waitFor(() => expect(next.sockets.size).toBe(0))
  })

  it('rejects concurrent switches and a profile edited during its pending handshake', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const next = await startElectrum(200, true)
    const saved = await api.create({ ...next.config, nickname: 'Next' })
    const pending = api.connect(saved)
    const outcome = expect(pending).rejects.toThrow('another window')
    await vi.waitFor(() => expect(next.methods).toContain('server.version'))
    await expect(api.connect(saved)).rejects.toThrow('already in progress')
    await api.rename({ ...saved, nickname: 'Changed while connecting' })
    next.releaseVersion()
    await outcome
    expect((await api.list()).activeId).not.toBe(saved.id)
    expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
  })

  it('cancels a pending profile activation on shutdown without changing its saved values', async () => {
    const ctx = await context(true, true)
    const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
    const next = await startElectrum(200, true)
    const saved = await api.create({ ...next.config, nickname: 'Next' })
    const before = ctx.connectionProfiles!.list()
    const active = ctx.connectionProfiles!.getActiveId()
    const pending = api.connect(saved)
    const outcome = expect(pending).rejects.toThrow('shutting down')
    await vi.waitFor(() => expect(next.methods).toContain('server.version'))
    ctx.disconnectElectrum()
    await outcome
    expect(ctx.connectionProfiles!.list()).toEqual(before)
    expect(ctx.connectionProfiles!.getActiveId()).toBe(active)
  })
})
