import { type AddressInfo, type Server, createServer } from 'node:net'
import { Err, Ok, tryBlock } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import type { AppContext } from './context'
import { type SentinelServer, main } from './main'

interface FakeContext {
  context: AppContext
  closes: () => number
  stops: () => number
}

let running: SentinelServer[]
let sockets: Server[]
let queued: AppContext[]

// main() takes contexts in order, so each fake answers exactly one start.
const createContext = () =>
  tryBlock(async function* () {
    const next = queued.shift()
    return next ? Ok(next) : Err(new Error('No test context queued'))
  })

function queueContext(port: number): FakeContext {
  let closes = 0
  let stops = 0
  const fake = {
    env: { HOST: '127.0.0.1', PORT: port, APP_DIR: '/nonexistent-sentinel-test-assets' },
    controlCenterService: { recordAllSnapshots: async (): Promise<void> => undefined },
    stopElectrum: (): void => {
      stops += 1
    },
    database: {
      $client: {
        close: (): void => {
          closes += 1
        },
      },
    },
  }
  // SAFETY: main() reads only these members before serving /health and shutting down.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The test serves no routes that need the rest of the context.
  const context = fake as AppContext
  queued.push(context)
  return { context, closes: () => closes, stops: () => stops }
}

function isTcpAddress(address: AddressInfo | string | null): address is AddressInfo {
  return address !== null && typeof address !== 'string'
}

async function reservePort(): Promise<number> {
  const socket = createServer()
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  if (!isTcpAddress(address)) {
    throw new Error('Expected a TCP listener')
  }
  return address.port
}

async function closeSocket(socket: Server): Promise<void> {
  if (socket.listening) {
    await new Promise<void>((resolve) => {
      socket.close(() => {
        resolve()
      })
    })
  }
}

const HealthSchema = z.object({ status: z.string() })

async function health(port: number): Promise<z.infer<typeof HealthSchema>> {
  const response = await fetch(`http://127.0.0.1:${port}/health`)
  const body: unknown = await response.json()
  return parseUnknown(HealthSchema, body).expect('health response')
}

async function start(options: Parameters<typeof main>[0] = {}): Promise<SentinelServer> {
  const server = await main(options, createContext)
  running.push(server)
  return server
}

function setup(): void {
  running = []
  sockets = []
  queued = []
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'fatal')
  onTestFinished(async () => {
    for (const server of running.splice(0)) {
      await server.shutdown()
    }
    for (const socket of sockets.splice(0)) {
      await closeSocket(socket)
    }
    vi.unstubAllEnvs()
  })
}

describe('Sentinel listening port', () => {
  it('binds an operating-system port when asked for port zero and reports it', async () => {
    setup()
    queueContext(3400)
    const server = await start({ listenPort: 0 })
    expect(server.port).toBeGreaterThan(0)
    expect(server.port).not.toBe(3400)
    await expect(health(server.port)).resolves.toEqual({ status: 'ok' })
  })

  it('uses the requested port instead of the configured one', async () => {
    setup()
    const requested = await reservePort()
    const reserved = sockets[0]
    if (reserved) {
      await closeSocket(reserved)
    }
    queueContext(3400)
    const server = await start({ listenPort: requested })
    expect(server.port).toBe(requested)
  })

  it('runs alongside a server on the configured port and shuts down independently', async () => {
    setup()
    const configured = await reservePort()
    const reserved = sockets[0]
    if (reserved) {
      await closeSocket(reserved)
    }
    const desktopContext = queueContext(configured)
    const desktop = await start({ listenPort: 0 })
    queueContext(configured)
    const development = await start()

    expect(development.port).toBe(configured)
    expect(desktop.port).not.toBe(configured)
    await development.shutdown()
    await expect(health(desktop.port)).resolves.toEqual({ status: 'ok' })
    expect(desktopContext.closes()).toBe(0)
  })

  it('cleans up its own resources after a failed bind', async () => {
    setup()
    const port = await reservePort()
    const failed = queueContext(port)
    await expect(main({}, createContext)).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(failed.closes()).toBe(1)
    expect(failed.stops()).toBe(1)
    expect(sockets[0]?.listening).toBe(true)
  })

  it('fails on an occupied loopback address instead of binding only another address', async () => {
    setup()
    // With "localhost", Fastify would bind [::1] and ignore this occupied IPv4 address.
    const occupied = await reservePort()
    const failed = queueContext(3400)
    // Desktop falls back to a new port only for a listen error that names the requested port.
    await expect(main({ listenPort: occupied }, createContext)).rejects.toMatchObject({
      code: 'EADDRINUSE',
      syscall: 'listen',
      port: occupied,
    })
    expect(failed.closes()).toBe(1)
  })

  it('answers only on its configured loopback address', async () => {
    setup()
    queueContext(3400)
    const server = await start({ listenPort: 0 })
    await expect(health(server.port)).resolves.toEqual({ status: 'ok' })
    await expect(fetch(`http://[::1]:${server.port}/health`)).rejects.toThrow('fetch failed')
  })
})
