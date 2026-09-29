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

async function context(waitForElectrum = true): Promise<AppContext> {
  const ctx = (await createAppContext(logger, { waitForElectrum })).unwrap()
  contexts.add(ctx)
  return ctx
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

  it('gives Tor-routed connections a longer connection limit than direct ones', async () => {
    await withTestSetup(async () => {
      env.SOCKS_PROXY_HOST = '127.0.0.1'
      env.SOCKS_PROXY_PORT = 19452
      const ctx = await context()
      const config = { host: 'electrum.example', port: 50002, protocol: 'ssl' as const }
      expect(ctx.prepareElectrumConfig(config, false).unwrap().connectTimeout).toBeUndefined()
      expect(ctx.prepareElectrumConfig(config, true).unwrap().connectTimeout).toBe(60_000)
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
  it('saves the price source and fallbacks and reports the price found under them', async () => {
    await withTestSetup(async () => {
      onTestFinished(() => {
        vi.unstubAllGlobals()
      })
      const seconds = Math.floor(Date.now() / 1000) - 60
      const asOf = new Date(seconds * 1000)
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
      await expect(caller.settings.priceStatus()).resolves.toEqual({
        selected: 'mempool',
        price: { source: 'mempool', asOf: asOf.toISOString(), lastKnown: false },
      })

      await caller.settings.update({ key: 'price_source', value: 'coinbase' })
      await caller.settings.update({ key: 'price_fallbacks_enabled', value: 'false' })
      await expect(caller.settings.priceSource()).resolves.toMatchObject({ selected: 'coinbase', fallbacks: false })
      await expect(caller.settings.priceStatus()).resolves.toMatchObject({
        selected: 'coinbase',
        price: { source: 'coinbase', lastKnown: false },
      })
      await expect(caller.settings.get({ key: 'price_source' })).resolves.toBe('coinbase')

      answers.delete('api.coinbase.com')
      const withoutCoinbase = appRouter.createCaller({ app: await context() })
      await expect(withoutCoinbase.settings.priceStatus()).resolves.toEqual({ selected: 'coinbase', price: null })
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

  it.each([
    ['price_source', 'kraken'],
    ['price_fallbacks_enabled', 'yes'],
  ])('rejects %s set to %s', async (key, value) => {
    await withTestSetup(async () => {
      const caller = appRouter.createCaller({ app: await context() })
      await expect(caller.settings.update({ key, value })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(caller.settings.get({ key })).resolves.toBeNull()
    })
  })
})
