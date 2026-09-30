import { mkdtempSync, rmSync } from 'node:fs'
import { type Socket, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { type AppContext, createAppContext } from './context'
import * as environment from './env'
import type { Env } from './env'
import type { ConnectionProfileStore } from './modules/connection_profiles/store'
import { appRouter } from './modules/trpc/router'

let env: Env

const logger = pino({ level: 'silent' })
const contexts = new Set<AppContext>()
interface ElectrumFixture {
  config: { host: string; port: number; protocol: 'tcp' }
  methods: string[]
  sockets: Set<Socket>
  holdHeaders: () => void
  releaseVersion: () => void
  close: () => Promise<void>
}
const fixtures: ElectrumFixture[] = []
function initialFixture(): ElectrumFixture {
  const fixture = fixtures[0]
  if (!fixture) {
    throw new Error('Missing initial Electrum fixture')
  }
  return fixture
}
let directory: string

async function startElectrum(height: number, holdVersion = false, rejectVersion = false): Promise<ElectrumFixture> {
  const sockets = new Set<Socket>()
  const methods: string[] = []
  const versions: Array<() => void> = []
  let holdHeaders = false
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
    socket.on('error', () => undefined)
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) !== -1) {
        // SAFETY: JSON socket input is untrusted until the request schema validates it.
        const request = parseUnknown(
          z.object({ id: z.number(), method: z.string() }),
          JSON.parse(buffer.slice(0, newline)) as unknown,
        ).expect('valid test request')
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
        if (request.method === 'server.version' && holdVersion) {
          versions.push(reply)
        } else if (request.method !== 'blockchain.headers.subscribe' || !holdHeaders) {
          reply()
        }
      }
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const config = {
    host: '127.0.0.1',
    port: parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener').port,
    protocol: 'tcp' as const,
  }
  const fixture: ElectrumFixture = {
    config,
    methods,
    sockets,
    holdHeaders: (): void => {
      holdHeaders = true
    },
    releaseVersion: (): void => {
      for (const reply of versions.splice(0)) {
        reply()
      }
    },
    close: async (): Promise<void> => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
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

async function restart(ctx: AppContext, waitForElectrum = true): Promise<AppContext> {
  ctx.stopElectrum()
  ctx.database.close()
  contexts.delete(ctx)
  return context(waitForElectrum, true)
}

function profileStore(ctx: AppContext): ConnectionProfileStore {
  if (!ctx.connectionProfiles) {
    throw new Error('Saved connections are not enabled')
  }
  return ctx.connectionProfiles
}

function itemAt<T>(items: T[], index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(`Missing item ${index}`)
  }
  return item
}

function settings(ctx: AppContext): Array<{ key: string; value: string }> {
  return ctx.database.db
    .prepare<[], { key: string; value: string }>(
      "SELECT key, value FROM settings WHERE key LIKE 'electrum_%' OR key = 'tor_enabled' ORDER BY key",
    )
    .all()
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  onTestFinished(async () => {
    vi.restoreAllMocks()
    for (const ctx of contexts) {
      ctx.stopElectrum()
      ctx.database.close()
    }
    contexts.clear()
    for (const fixture of fixtures.splice(0)) {
      await fixture.close()
    }
    rmSync(directory, { recursive: true, force: true })
  })
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
  vi.spyOn(environment, 'loadEnv').mockImplementation(() => env)
  await run()
}

describe('Electrum connection lifecycle', () => {
  it('makes desktop settings and local holdings available while the initial connection is still pending', async () => {
    await withTestSetup(async () => {
      const pending = await startElectrum(100, true)
      env.ELECTRUM_PORT = pending.config.port
      const ctx = await context(false)
      const caller = appRouter.createCaller({ app: ctx })
      await expect(caller.settings.electrumStatus()).resolves.toMatchObject({ connected: false })
      await expect(caller.settings.get({ key: 'user_name' })).resolves.toBeNull()
      await expect(
        caller.portalProve.manual.create({
          displayName: 'Offline holding',
          balanceSats: '123',
          balanceAsOf: '2026-09-06T00:00:00.000Z',
        }),
      ).resolves.toMatchObject({ balance: '123' })
      await vi.waitFor(() => {
        expect(pending.methods).toContain('server.version')
      })
      pending.releaseVersion()
      await vi.waitFor(() => {
        expect(ctx.electrumClient.isConnected()).toBe(true)
      })
    })
  })

  it('keeps desktop settings available after a failed initial handshake', async () => {
    await withTestSetup(async () => {
      const unavailable = await startElectrum(100, false, true)
      env.ELECTRUM_PORT = unavailable.config.port
      const ctx = await context(false)
      await vi.waitFor(() => {
        expect(unavailable.methods).toContain('server.version')
      })
      await expect(appRouter.createCaller({ app: ctx }).settings.get({ key: 'user_name' })).resolves.toBeNull()
      expect(ctx.electrumClient.isConnected()).toBe(false)
      await vi.waitFor(() => {
        expect(unavailable.sockets.size).toBe(0)
      })
    })
  })

  it('preserves the default StartOS startup requirement', async () => {
    await withTestSetup(async () => {
      const unavailable = await startElectrum(100, false, true)
      env.ELECTRUM_PORT = unavailable.config.port
      expect((await createAppContext(logger)).isErr()).toBe(true)
    })
  })

  it('switches the existing portfolio and statement providers and restores the saved server on restart', async () => {
    await withTestSetup(async () => {
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
      ctx.stopElectrum()
      ctx.database.close()
      contexts.delete(ctx)
      const restarted = await context()
      expect(restarted.electrumConfig.port).toBe(next.config.port)
      expect((await restarted.onchainProvider.getBlocksTip()).unwrap().height).toBe(200)
    })
  })

  it('keeps the working connection and saved settings when the replacement fails', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      await ctx.reconnectElectrum(initialFixture().config)
      const before = settings(ctx)
      const failed = await startElectrum(200, false, true)
      expect((await ctx.reconnectElectrum(failed.config)).isErr()).toBe(true)
      expect(settings(ctx)).toEqual(before)
      expect(ctx.electrumClient.isConnected()).toBe(true)
      expect((await ctx.controlCenterService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
      await vi.waitFor(() => {
        expect(failed.sockets.size).toBe(0)
      })
    })
  })

  it('rolls back every setting and keeps the previous client if persistence fails mid-transaction', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      await ctx.reconnectElectrum(initialFixture().config)
      const before = settings(ctx)
      ctx.database.db.exec(
        "CREATE TRIGGER reject_connection_save BEFORE INSERT ON settings WHEN NEW.key = 'electrum_port' BEGIN SELECT RAISE(FAIL, 'test write failure'); END",
      )
      const next = await startElectrum(200)
      expect((await ctx.reconnectElectrum(next.config)).unwrapErr().message).toContain('Could not save')
      expect(settings(ctx)).toEqual(before)
      expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
      await vi.waitFor(() => {
        expect(next.sockets.size).toBe(0)
      })
    })
  })

  it('rejects a concurrent change instead of allowing a slower save to overwrite it later', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      const next = await startElectrum(200, true)
      const pending = ctx.reconnectElectrum(next.config)
      await vi.waitFor(() => {
        expect(next.methods).toContain('server.version')
      })
      expect((await ctx.reconnectElectrum(initialFixture().config)).unwrapErr().message).toContain(
        'already in progress',
      )
      next.releaseVersion()
      expect((await pending).isOk()).toBe(true)
      expect(ctx.electrumConfig.port).toBe(next.config.port)
    })
  })

  it('cancels a pending change on shutdown without saving it', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      const before = settings(ctx)
      const next = await startElectrum(200, true)
      const pending = ctx.reconnectElectrum(next.config)
      await vi.waitFor(() => {
        expect(next.methods).toContain('server.version')
      })
      ctx.stopElectrum()
      expect((await pending).isErr()).toBe(true)
      expect(settings(ctx)).toEqual(before)
      await vi.waitFor(() => {
        expect(next.sockets.size).toBe(0)
      })
    })
  })

  it('settles requests using the previous connection when switching instead of leaving them hanging', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      initialFixture().holdHeaders()
      const previousRequest = ctx.controlCenterService['onchainProvider'].getBlocksTip()
      await vi.waitFor(() => {
        expect(initialFixture().methods).toContain('blockchain.headers.subscribe')
      })
      const next = await startElectrum(200)
      expect((await ctx.reconnectElectrum(next.config)).isOk()).toBe(true)
      expect((await previousRequest).isErr()).toBe(true)
      expect((await ctx.controlCenterService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(200)
    })
  })

  it.each(['electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled'])(
    'rejects partial writes to %s through the generic settings endpoint',
    async (key) => {
      await withTestSetup(async () => {
        const ctx = await context()
        await expect(
          appRouter.createCaller({ app: ctx }).settings.update({ key, value: 'invalid' }),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' })
        expect(settings(ctx)).toEqual([])
      })
    },
  )
})

describe('Tor connection policy', () => {
  it('does not fall back to direct connections when Tor is requested but unavailable', async () => {
    await withTestSetup(async () => {
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
      expect(ctx.electrumConfig.port).toBe(initialFixture().config.port)
      expect(settings(ctx)).toEqual([])
    })
  })

  it('rejects onion addresses unless Tor is enabled', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      await expect(
        appRouter
          .createCaller({ app: ctx })
          .settings.testElectrum({ host: 'example.onion', port: 50001, protocol: 'tcp' }),
      ).rejects.toThrow('Onion addresses require Tor')
    })
  })

  it('keeps a saved Tor configuration offline when the proxy is missing on restart', async () => {
    await withTestSetup(async () => {
      const previous = await context()
      previous.database.db.prepare("INSERT INTO settings (key, value) VALUES ('tor_enabled', 'true')").run()
      previous.stopElectrum()
      previous.database.close()
      contexts.delete(previous)
      const initialCalls = initialFixture().methods.length
      const ctx = await context(false)
      expect((await ctx.electrumClient.connect()).isErr()).toBe(true)
      expect((await ctx.onchainProvider.getBlocksTip()).isErr()).toBe(true)
      expect(initialFixture().methods).toHaveLength(initialCalls)
    })
  })

  it('waits for managed Tor before opening SOCKS, and uses the port Tor chose', async () => {
    await withTestSetup(async () => {
      const connections: Socket[] = []
      const proxy = createServer((socket) => {
        connections.push(socket)
        socket.on('error', () => undefined)
        socket.once('data', () => {
          socket.end(Buffer.from([5, 255]))
        })
      })
      await new Promise<void>((resolve) => {
        proxy.listen(0, '127.0.0.1', resolve)
      })
      try {
        // A static proxy setting must not override the port managed Tor chose.
        env.SOCKS_PROXY_HOST = '127.0.0.1'
        env.SOCKS_PROXY_PORT = 1
        const chosenPort = parseUnknown(z.object({ port: z.number() }), proxy.address()).expect('TCP listener').port
        let torReady = false
        let ready!: (status: { state: string }) => void
        const bootstrap = new Promise<{ state: string }>((resolve) => {
          ready = resolve
        })
        const tor = {
          start: vi.fn(async () => bootstrap),
          getStatus: () => ({ state: 'starting' as const }),
          getSocksProxy: () => (torReady ? { host: '127.0.0.1', port: chosenPort } : null),
        }
        const ctx = (await createAppContext(logger, { tor })).unwrap()
        contexts.add(ctx)
        const pending = appRouter
          .createCaller({ app: ctx })
          .settings.testElectrum({ ...initialFixture().config, torEnabled: true })
        const outcome = pending.then(
          () => false,
          () => true,
        )
        await vi.waitFor(() => {
          expect(tor.start).toHaveBeenCalled()
        })
        expect(connections).toHaveLength(0)
        expect(ctx.getTorStatus().state).toBe('starting')
        torReady = true
        ready({ state: 'ready' })
        await expect(outcome).resolves.toBe(true)
        expect(connections).toHaveLength(1)
      } finally {
        for (const socket of connections) {
          socket.destroy()
        }
        await new Promise<void>((resolve) => {
          proxy.close(() => {
            resolve()
          })
        })
      }
    })
  })

  it('gives Tor-routed connections longer connection and request limits than direct ones', async () => {
    await withTestSetup(async () => {
      env.SOCKS_PROXY_HOST = '127.0.0.1'
      env.SOCKS_PROXY_PORT = 19452
      const ctx = await context()
      const config = { host: 'electrum.example', port: 50002, protocol: 'ssl' as const }
      expect(ctx.prepareElectrumConfig(config, false).unwrap().connectTimeout).toBeUndefined()
      expect(ctx.prepareElectrumConfig(config, true).unwrap().connectTimeout).toBe(60_000)
      expect(ctx.prepareElectrumConfig(config, false).unwrap().requestTimeout).toBeUndefined()
      expect(ctx.prepareElectrumConfig({ ...config, requestTimeout: 10_000 }, true).unwrap().requestTimeout).toBe(
        30_000,
      )
      expect(ctx.prepareElectrumConfig({ ...config, connectTimeout: 90_000 }, true).unwrap().connectTimeout).toBe(
        90_000,
      )
      const managed = (
        await createAppContext(logger, {
          tor: {
            start: async () => ({ state: 'ready' }),
            getStatus: () => ({ state: 'ready' }),
            getSocksProxy: () => null,
          },
        })
      ).unwrap()
      contexts.add(managed)
      const prepared = managed.prepareElectrumConfig(config, true).unwrap()
      expect(prepared.connectTimeout).toBe(60_000)
      expect(prepared.requestTimeout).toBe(30_000)
      expect(prepared.proxy).toBeUndefined()
      expect(prepared.resolveProxy?.()).toBeNull()
    })
  })

  it('starts managed Tor on request without waiting for bootstrap', async () => {
    await withTestSetup(async () => {
      const bootstrap = new Promise<{ state: string }>(() => undefined)
      const tor = {
        start: vi.fn(async () => bootstrap),
        getStatus: () => ({ state: 'starting' as const, progress: 25 }),
        getSocksProxy: () => null,
      }
      const ctx = (await createAppContext(logger, { tor })).unwrap()
      contexts.add(ctx)
      await expect(appRouter.createCaller({ app: ctx }).settings.startTor()).resolves.toEqual({
        state: 'starting',
        progress: 25,
      })
      expect(tor.start).toHaveBeenCalledOnce()
      expect(ctx.startTor()).toEqual({ state: 'starting', progress: 25 })
    })
  })

  it('reports Tor as unavailable when the distribution does not manage it', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      expect(ctx.startTor()).toEqual({ state: 'unavailable' })
    })
  })

  it('preserves the active server and settings when managed Tor fails', async () => {
    await withTestSetup(async () => {
      const ctx = (
        await createAppContext(logger, {
          tor: {
            start: async () => ({ state: 'failed', message: 'Tor bootstrap failed' }),
            getStatus: () => ({ state: 'failed', message: 'Tor bootstrap failed' }),
            getSocksProxy: () => null,
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
})

describe('price source settings', () => {
  it('saves the price source and fallbacks together and reports the price found under them', async () => {
    await withTestSetup(async () => {
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      const seconds = Math.floor(Date.now() / 1000) - 60
      const answers = new Map([
        ['example.invalid', () => Response.json({ time: seconds, USD: 83000 })],
        ['api.coinbase.com', () => Response.json({ data: { amount: '83105.04', currency: 'USD' } })],
      ])
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => answers.get(new URL(url).host)?.() ?? new Response(null, { status: 503 })),
      )
      const caller = appRouter.createCaller({ app: await context() })
      await expect(caller.settings.priceSource()).resolves.toMatchObject({ selected: 'mempool', fallbacks: true })
      const first = await caller.settings.priceStatus()
      expect(first).toMatchObject({
        selected: 'mempool',
        fallbacks: true,
        price: { source: 'mempool', lastKnown: false },
      })
      expect(Math.abs(Date.parse(first.price?.asOf ?? '') - seconds * 1000)).toBeLessThan(1000)

      await expect(caller.settings.setPriceSettings({ source: 'coinbase', fallbacks: false })).resolves.toMatchObject({
        selected: 'coinbase',
        fallbacks: false,
      })
      await expect(caller.settings.priceSource()).resolves.toMatchObject({ selected: 'coinbase', fallbacks: false })
      await expect(caller.settings.priceStatus()).resolves.toMatchObject({
        selected: 'coinbase',
        fallbacks: false,
        price: { source: 'coinbase', lastKnown: false },
      })

      answers.delete('api.coinbase.com')
      const withoutCoinbase = appRouter.createCaller({ app: await context() })
      await expect(withoutCoinbase.settings.priceStatus()).resolves.toEqual({
        selected: 'coinbase',
        fallbacks: false,
        price: null,
      })
    })
  })

  it('lists the price sources without waiting for a price', async () => {
    await withTestSetup(async () => {
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Promise<Response>(() => undefined)),
      )
      const caller = appRouter.createCaller({ app: await context() })
      await expect(caller.settings.priceSource()).resolves.toMatchObject({ selected: 'mempool' })
    })
  })

  it('rejects a price source that is not available here', async () => {
    await withTestSetup(async () => {
      env = { ...env, MEMPOOL_API_URL: 'https://mempool.space' }
      const caller = appRouter.createCaller({ app: await context() })
      await expect(caller.settings.setPriceSettings({ source: 'mempool' })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      await expect(caller.settings.priceSource()).resolves.toMatchObject({ selected: 'block' })
    })
  })

  it.each(['price_source', 'price_fallbacks_enabled'])(
    'does not read or write %s through the generic settings endpoints',
    async (key) => {
      await withTestSetup(async () => {
        const caller = appRouter.createCaller({ app: await context() })
        await expect(caller.settings.update({ key, value: 'false' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
        await expect(caller.settings.get({ key })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      })
    },
  )
})

it('checks the primary again for status and skips malformed timestamps without failing the endpoint', async () => {
  await withTestSetup(async () => {
    onTestFinished(() => {
      vi.unstubAllGlobals()
    })
    let time = Math.floor(Date.now() / 1000)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        new URL(url).host === 'example.invalid'
          ? Response.json({ USD: 83000, time })
          : Response.json({ amount: '84000', base: 'BTC', currency: 'USD' }),
      ),
    )
    const caller = appRouter.createCaller({ app: await context() })
    expect((await caller.settings.priceStatus()).price?.source).toBe('mempool')
    time = 9e12
    const status = await caller.settings.priceStatus()
    expect(status.price).toMatchObject({ source: 'block', lastKnown: false })
    expect(Number.isFinite(Date.parse(status.price?.asOf ?? ''))).toBe(true)
  })
})

describe('desktop saved connections', () => {
  it('keeps saved connections unavailable outside the desktop app', async () => {
    await withTestSetup(async () => {
      const ctx = await context()
      const caller = appRouter.createCaller({ app: ctx })
      await expect(caller.settings.connectionProfiles.list()).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(
        caller.settings.connectionProfiles.delete({ id: '00000000-0000-4000-8000-000000000001', revision: 1 }),
      ).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect(ctx.database.db.prepare('SELECT * FROM desktop_connection_profiles').all()).toEqual([])
    })
  })

  it('connects only through saved connections in the desktop app', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const next = await startElectrum(200)
      await expect(appRouter.createCaller({ app: ctx }).settings.reconnectElectrum(next.config)).rejects.toThrow(
        'Choose a saved connection',
      )
      expect(next.methods).toEqual([])
      expect(settings(ctx)).toEqual([])
    })
  })

  it('saves the existing Tor connection as the first profile without connecting directly', async () => {
    await withTestSetup(async () => {
      const previous = await context()
      const save = previous.database.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)')
      save.run('electrum_host', 'my-node.onion')
      save.run('electrum_port', '50001')
      save.run('electrum_protocol', 'tcp')
      save.run('tor_enabled', 'true')
      const ctx = await restart(previous, false)
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
      expect(snapshot.activeId).toBe(itemAt(snapshot.profiles, 0).id)
      expect((await ctx.electrumClient.connect()).isErr()).toBe(true)
      const restarted = await restart(ctx, false)
      expect(profileStore(restarted).list()).toEqual(snapshot.profiles)
    })
  })

  it('restores the active profile on restart even if the launcher defaults change', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const initial = ctx.electrumConfig.port
      env.ELECTRUM_PORT = (await startElectrum(200)).config.port
      const restarted = await restart(ctx)
      expect(restarted.electrumConfig.port).toBe(initial)
      expect((await restarted.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
    })
  })

  it('saves and renames profiles without connecting or changing the active connection', async () => {
    await withTestSetup(async () => {
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
      expect(itemAt((await api.list()).profiles, 1).nickname).toBe('My node')
      const restarted = await restart(ctx)
      expect(itemAt(profileStore(restarted).list(), 1)).toEqual(renamed)
    })
  })

  it('limits saved connections to five, even across simultaneous requests', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const connection = { host: 'unused.example', port: 50002, protocol: 'ssl' as const }
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, async (_, index) => api.create({ ...connection, nickname: `Connection ${index}` })),
      )
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(4)
      expect((await api.list()).profiles).toHaveLength(5)
      await expect(api.create({ ...connection, nickname: 'Sixth' })).rejects.toThrow('up to 5')
    })
  })

  it('validates nicknames and servers, and requires Tor for onion addresses', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const { config } = initialFixture()
      await expect(api.create({ ...config, nickname: '   ' })).rejects.toThrow('nickname')
      await expect(api.create({ ...config, nickname: 'x'.repeat(81) })).rejects.toThrow('80')
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
      // Saving a Tor connection works offline; connecting without Tor available never falls back to direct.
      await expect(api.connect(saved)).rejects.toThrow('Tor is not available')
      expect((await api.list()).activeId).not.toBe(saved.id)
    })
  })

  it('connects a saved Tor profile only through managed Tor, and a direct profile without it', async () => {
    await withTestSetup(async () => {
      const connections: Socket[] = []
      // A SOCKS proxy that refuses every request stands in for Tor.
      const proxy = createServer((socket) => {
        connections.push(socket)
        socket.on('error', () => undefined)
        socket.once('data', () => {
          socket.end(Buffer.from([5, 255]))
        })
      })
      await new Promise<void>((resolve) => {
        proxy.listen(0, '127.0.0.1', resolve)
      })
      onTestFinished(async () => {
        for (const socket of connections) {
          socket.destroy()
        }
        await new Promise<void>((resolve) => {
          proxy.close(() => {
            resolve()
          })
        })
      })
      const port = parseUnknown(z.object({ port: z.number() }), proxy.address()).expect('TCP listener').port
      const tor = {
        start: vi.fn(async () => ({ state: 'ready' })),
        getStatus: () => ({ state: 'ready' as const }),
        getSocksProxy: () => ({ host: '127.0.0.1', port }),
      }
      const ctx = (await createAppContext(logger, { tor, connectionProfiles: true })).unwrap()
      contexts.add(ctx)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const active = (await api.list()).activeId
      const next = await startElectrum(200)
      const viaTor = await api.create({ ...next.config, torEnabled: true, nickname: 'Via Tor' })
      await expect(api.connect(viaTor)).rejects.toThrow('Socks5')
      expect(tor.start).toHaveBeenCalledOnce()
      expect(connections).toHaveLength(1)
      expect(next.methods).toEqual([])
      expect((await api.list()).activeId).toBe(active)

      const direct = await api.create({ ...next.config, nickname: 'Direct' })
      await api.connect(direct)
      expect(tor.start).toHaveBeenCalledOnce()
      expect(next.methods).toContain('server.version')
      expect((await api.list()).activeId).toBe(direct.id)
    })
  })

  it('deletes an inactive profile and keeps the deletion after restart', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const active = (await api.list()).activeId
      const next = await startElectrum(200)
      const removed = await api.create({ ...next.config, nickname: 'Remove me' })
      for (let index = 0; index < 3; index++) {
        await api.create({ ...next.config, nickname: `Keep ${index}` })
      }
      expect((await api.list()).profiles).toHaveLength(5)
      const beforeSettings = settings(ctx)
      await api.delete(removed)
      expect((await api.list()).profiles).toHaveLength(4)
      await api.create({ ...next.config, nickname: 'Replacement slot' })
      expect((await api.list()).profiles).toHaveLength(5)
      expect((await api.list()).activeId).toBe(active)
      expect(settings(ctx)).toEqual(beforeSettings)
      expect(next.methods).toEqual([])
      const restarted = await restart(ctx)
      expect(profileStore(restarted).list()).toHaveLength(5)
      expect(
        profileStore(restarted)
          .list()
          .some((profile) => profile.id === removed.id),
      ).toBe(false)
      expect(profileStore(restarted).getActiveId()).toBe(active)
    })
  })

  it('refuses to delete the active connection, even offline, and allows it after switching', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const initial = itemAt((await api.list()).profiles, 0)
      await expect(api.delete(initial)).rejects.toThrow('Connect to another saved connection')
      ctx.electrumClient.disconnect()
      await expect(api.delete(initial)).rejects.toThrow('Connect to another saved connection')
      const next = await api.create({ ...(await startElectrum(200)).config, nickname: 'New active' })
      const connected = await api.connect(next)
      await expect(api.delete(connected)).rejects.toThrow('Connect to another saved connection')
      await api.delete(initial)
      expect((await api.list()).profiles).toEqual([connected])
      expect((await api.list()).activeId).toBe(next.id)
      expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(200)
    })
  })

  it('rejects stale and repeated deletion without affecting other profiles', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const saved = await api.create({ ...initialFixture().config, nickname: 'Before' })
      const renamed = await api.rename({ ...saved, nickname: 'After' })
      await expect(api.delete(saved)).rejects.toThrow('another window')
      expect((await api.list()).profiles).toContainEqual(renamed)
      const outcomes = await Promise.allSettled([api.delete(renamed), api.delete(renamed)])
      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
      expect((await api.list()).profiles).toHaveLength(1)
    })
  })

  it('keeps every profile when a deletion cannot be saved', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const saved = await api.create({ ...initialFixture().config, nickname: 'Keep after failure' })
      const before = await api.list()
      ctx.database.db.exec(
        "CREATE TRIGGER reject_profile_delete BEFORE DELETE ON desktop_connection_profiles BEGIN SELECT RAISE(FAIL, 'test deletion failure'); END",
      )
      await expect(api.delete(saved)).rejects.toThrow('Could not save connection settings')
      await expect(api.list()).resolves.toEqual(before)
      expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
    })
  })

  it('tests a profile without activating it, then switches every provider and restores it on restart', async () => {
    await withTestSetup(async () => {
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
      const restarted = await restart(ctx)
      expect(profileStore(restarted).getActiveId()).toBe(saved.id)
      expect(restarted.electrumConfig.port).toBe(next.config.port)
    })
  })

  it('keeps every profile and the active connection after a failed connection or save', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const next = await startElectrum(200)
      const bad = await startElectrum(300, false, true)
      const saved = await api.create({ ...next.config, nickname: 'Next' })
      const before = await api.list()
      await expect(api.connect({ ...saved, connection: { ...bad.config, torEnabled: false } })).rejects.toThrow(
        'Test server unavailable',
      )
      await expect(api.list()).resolves.toEqual(before)
      ctx.database.db.exec(
        "CREATE TRIGGER reject_profile_save BEFORE INSERT ON settings WHEN NEW.key = 'electrum_port' BEGIN SELECT RAISE(FAIL, 'test write failure'); END",
      )
      await expect(api.connect(saved)).rejects.toThrow('Could not save')
      await expect(api.list()).resolves.toEqual(before)
      expect(settings(ctx)).toEqual([])
      expect((await ctx.statementService['onchainProvider'].getBlocksTip()).unwrap().height).toBe(100)
      await vi.waitFor(() => {
        expect(next.sockets.size).toBe(0)
      })
    })
  })

  it('does not activate or recreate a profile deleted during its handshake', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const active = (await api.list()).activeId
      const next = await startElectrum(200, true)
      const saved = await api.create({ ...next.config, nickname: 'Connecting' })
      const pending = api.connect(saved)
      await vi.waitFor(() => {
        expect(next.methods).toContain('server.version')
      })
      await api.delete(saved)
      next.releaseVersion()
      await expect(pending).rejects.toThrow('no longer exists')
      expect((await api.list()).activeId).toBe(active)
      expect((await api.list()).profiles).toHaveLength(1)
      expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
      await vi.waitFor(() => {
        expect(next.sockets.size).toBe(0)
      })
    })
  })

  it('rejects a concurrent switch and a profile edited during its handshake', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const next = await startElectrum(200, true)
      const saved = await api.create({ ...next.config, nickname: 'Next' })
      const pending = api.connect(saved)
      await vi.waitFor(() => {
        expect(next.methods).toContain('server.version')
      })
      await expect(api.connect(saved)).rejects.toThrow('already in progress')
      await api.rename({ ...saved, nickname: 'Changed while connecting' })
      next.releaseVersion()
      await expect(pending).rejects.toThrow('another window')
      expect((await api.list()).activeId).not.toBe(saved.id)
      expect((await ctx.onchainProvider.getBlocksTip()).unwrap().height).toBe(100)
    })
  })

  it('cancels a pending switch on shutdown without changing saved profiles', async () => {
    await withTestSetup(async () => {
      const ctx = await context(true, true)
      const api = appRouter.createCaller({ app: ctx }).settings.connectionProfiles
      const next = await startElectrum(200, true)
      const saved = await api.create({ ...next.config, nickname: 'Next' })
      const before = profileStore(ctx).list()
      const active = profileStore(ctx).getActiveId()
      const pending = api.connect(saved)
      await vi.waitFor(() => {
        expect(next.methods).toContain('server.version')
      })
      ctx.stopElectrum()
      await expect(pending).rejects.toThrow('shutting down')
      expect(profileStore(ctx).list()).toEqual(before)
      expect(profileStore(ctx).getActiveId()).toBe(active)
    })
  })
})

describe('saved connection startup', () => {
  it('starts with the last saved server when saved connections cannot be loaded', async () => {
    await withTestSetup(async () => {
      const previous = await context(false)
      // An out-of-range port cannot be saved as the first connection.
      previous.database.db
        .prepare(
          "INSERT INTO settings (key, value) VALUES ('electrum_port', '70000') ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run()
      const ctx = await restart(previous, false)
      expect(ctx.electrumConfig.port).toBe(70_000)
      expect(profileStore(ctx).list()).toEqual([])
      expect(profileStore(ctx).getActiveId()).toBeUndefined()
    })
  })
})
