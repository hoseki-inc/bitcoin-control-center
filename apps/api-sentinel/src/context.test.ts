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

async function context(waitForElectrum = true): Promise<AppContext> {
  const ctx = (await createAppContext(logger, { waitForElectrum })).unwrap()
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
