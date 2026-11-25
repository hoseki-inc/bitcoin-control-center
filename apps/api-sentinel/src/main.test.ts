import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { type AddressInfo, type Server, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Err, Ok, type Result, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import type { Logger } from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import type { AppContext } from './context'
import { type SentinelServer, main } from './main'

interface FakeContext {
  context: AppContext
  closes: () => number
  stops: () => number
  releaseCheckStarts: () => number
  releaseCheckStops: () => number
}

interface QueuedContext {
  context: AppContext
  onLogger?: (logger: Logger) => void
}

let running: SentinelServer[]
let sockets: Server[]
let queued: QueuedContext[]

// main() takes contexts in order, so each fake answers exactly one start.
const createContext = asyncFn(async (logger: Logger) => {
  const next = queued.shift()
  if (!next) {
    return Err(new Error('No test context queued'))
  }
  next.onLogger?.(logger)
  return Ok(next.context)
})

function queueContext(
  port: number,
  options?: {
    recordAllSnapshots?: () => Promise<Result<void, Error>>
    onLogger?: (logger: Logger) => void
  },
): FakeContext {
  let closes = 0
  let stops = 0
  let releaseCheckStarts = 0
  let releaseCheckStops = 0
  const recordAllSnapshots =
    options?.recordAllSnapshots ?? asyncFn(async (): Promise<Result<void, Error>> => Ok(undefined))
  const fake = {
    env: { HOST: '127.0.0.1', PORT: port, APP_DIR: '/nonexistent-sentinel-test-assets' },
    controlCenterService: { recordAllSnapshots },
    releaseCheckService: {
      start: (): void => {
        releaseCheckStarts += 1
      },
      stop: (): void => {
        releaseCheckStops += 1
      },
    },
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
  queued.push({ context, onLogger: options?.onLogger })
  return {
    context,
    closes: () => closes,
    stops: () => stops,
    releaseCheckStarts: () => releaseCheckStarts,
    releaseCheckStops: () => releaseCheckStops,
  }
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
    const developmentContext = queueContext(configured)
    const development = await start()

    expect(development.port).toBe(configured)
    expect(desktop.port).not.toBe(configured)
    await development.shutdown()
    await expect(health(desktop.port)).resolves.toEqual({ status: 'ok' })
    expect(desktopContext.closes()).toBe(0)
    expect(developmentContext.releaseCheckStarts()).toBe(1)
    expect(desktopContext.releaseCheckStarts()).toBe(1)
    expect(developmentContext.releaseCheckStops()).toBe(1)
    expect(desktopContext.releaseCheckStops()).toBe(0)
  })

  it('cleans up its own resources after a failed bind', async () => {
    setup()
    const port = await reservePort()
    const failed = queueContext(port)
    await expect(main({}, createContext)).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(failed.closes()).toBe(1)
    expect(failed.stops()).toBe(1)
    expect(failed.releaseCheckStarts()).toBe(0)
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

describe('Sentinel routes', () => {
  // Routes outside tRPC skip the PIN check and the route lint, so each one must be a deliberate choice.
  it('answers only on health, tRPC, the CORS preflight and the static UI', async () => {
    setup()
    const appDir = mkdtempSync(join(tmpdir(), 'sentinel-routes-'))
    onTestFinished(() => {
      rmSync(appDir, { recursive: true, force: true })
    })
    mkdirSync(join(appDir, 'public'))
    writeFileSync(join(appDir, 'public', 'index.html'), '<html></html>')
    const fake = queueContext(0)
    Object.assign(fake.context.env, { APP_DIR: appDir })

    const server = await start({ listenPort: 0 })

    const trpc = server.routes.filter((route) => route.endsWith(' /trpc/:path'))
    const others = server.routes.filter((route) => !trpc.includes(route))
    expect(trpc).toContain('POST /trpc/:path')
    expect([...others].sort()).toEqual(['GET /*', 'GET /health', 'HEAD /*', 'HEAD /health', 'OPTIONS *'])
  })

  it('runs shutdown once under concurrent calls and skips signal listeners when host-owned', async () => {
    setup()
    const beforeSigterm = process.listenerCount('SIGTERM')
    const beforeSigint = process.listenerCount('SIGINT')
    const fake = queueContext(0)

    let markEntered: () => void = () => undefined
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve
    })
    let releaseRequest: () => void = () => undefined
    const release = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    Object.assign(fake.context, {
      auth: {
        status: async (): Promise<{ platform: null }> => {
          markEntered()
          await release
          return { platform: null }
        },
      },
    })

    const server = await start({ listenPort: 0, registerSignalHandlers: false })
    expect(process.listenerCount('SIGTERM')).toBe(beforeSigterm)
    expect(process.listenerCount('SIGINT')).toBe(beforeSigint)

    const inFlight = fetch(`http://127.0.0.1:${server.port}/trpc/auth.status`, {
      headers: { connection: 'close' },
    }).then(async (response) => {
      await response.text()
    })
    try {
      await entered

      let firstSettled = false
      let secondSettled = false
      const first = server.shutdown().then(() => {
        firstSettled = true
      })
      const second = server.shutdown().then(() => {
        secondSettled = true
      })

      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      expect(firstSettled).toBe(false)
      expect(secondSettled).toBe(false)
      expect(fake.closes()).toBe(0)
      expect(fake.stops()).toBe(0)

      releaseRequest()
      await Promise.all([first, second, inFlight])
      expect(firstSettled).toBe(true)
      expect(secondSettled).toBe(true)
      expect(fake.closes()).toBe(1)
      expect(fake.stops()).toBe(1)
      expect(fake.releaseCheckStops()).toBe(1)
    } finally {
      releaseRequest()
    }
  })
})

describe('Sentinel snapshot schedule', () => {
  it('skips overlapping 15-minute ticks, logs fixed warnings on Err or rejection without leaking secrets, resumes after settlement, and stops on shutdown', async () => {
    setup()
    vi.stubEnv('LOG_LEVEL', 'warn')

    let unhandledCount = 0
    const onUnhandled = (): void => {
      unhandledCount += 1
    }
    process.on('unhandledRejection', onUnhandled)
    onTestFinished(() => {
      process.off('unhandledRejection', onUnhandled)
    })

    const originalSetInterval = globalThis.setInterval
    const createdTimers: Array<ReturnType<typeof setInterval>> = []
    let snapshotTick: (() => void) | undefined
    let snapshotTimerHandle: ReturnType<typeof setInterval> | undefined
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation((callback, delay) => {
      const handle = originalSetInterval(() => undefined, 60 * 60 * 1000)
      createdTimers.push(handle)
      if (delay === 15 * 60 * 1000) {
        snapshotTimerHandle = handle
        snapshotTick = () => {
          callback()
        }
      }
      return handle
    })
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    onTestFinished(() => {
      setIntervalSpy.mockRestore()
      clearIntervalSpy.mockRestore()
      for (const timer of createdTimers) {
        clearInterval(timer)
      }
    })

    let resolveFirstPass: (result: Result<void, Error>) => void = () => undefined
    const firstPass = new Promise<Result<void, Error>>((resolve) => {
      resolveFirstPass = resolve
    })
    onTestFinished(() => {
      resolveFirstPass(Ok(undefined))
    })

    let callCount = 0
    const recordAllSnapshots = async (): Promise<Result<void, Error>> => {
      callCount += 1
      if (callCount === 1) {
        return firstPass
      }
      if (callCount === 2) {
        throw new Error('secret-rejected-err-canary')
      }
      return Ok(undefined)
    }

    const warnCalls: string[] = []
    queueContext(0, {
      recordAllSnapshots,
      onLogger: (logger) => {
        vi.spyOn(logger, 'warn').mockImplementation((...args) => {
          warnCalls.push(JSON.stringify(args))
        })
      },
    })

    const server = await start({ listenPort: 0, registerSignalHandlers: false })
    expect(callCount).toBe(1)
    expect(snapshotTick).toBeDefined()

    // While startup pass is still in flight, 15-minute ticks must skip.
    snapshotTick?.()
    snapshotTick?.()
    expect(callCount).toBe(1)

    // Returned Err logs a fixed warning without leaking raw error text.
    resolveFirstPass(Err(new Error('secret-returned-err-canary')))
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(warnCalls).toHaveLength(1)
    expect(warnCalls[0]).toContain('Balance snapshot pass failed')
    expect(warnCalls[0]).not.toContain('secret-returned-err-canary')

    // Next tick after settlement runs pass 2, which rejects unexpectedly.
    snapshotTick?.()
    expect(callCount).toBe(2)
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(unhandledCount).toBe(0)
    expect(warnCalls).toHaveLength(2)
    expect(warnCalls[1]).toContain('Balance snapshot pass failed')
    expect(warnCalls[1]).not.toContain('secret-rejected-err-canary')

    // Next tick resumes cleanly after rejection.
    snapshotTick?.()
    expect(callCount).toBe(3)
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(warnCalls).toHaveLength(2)

    // Shutdown clears the interval and prevents any queued/late tick from running.
    await server.shutdown()
    expect(clearIntervalSpy).toHaveBeenCalledWith(snapshotTimerHandle)
    snapshotTick?.()
    expect(callCount).toBe(3)
  })
})
