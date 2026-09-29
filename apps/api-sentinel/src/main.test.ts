import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { type AddressInfo, type Server, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { readPreferredPort, startOnPreferredPort, writePreferredPort } from '../../../desktop/src/preferred-port'
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
let portFile: string

// main() takes contexts in order, so each fake answers exactly one start.
const createContext = asyncFn(async () => {
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
      close: (): void => {
        closes += 1
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

async function startDesktop(
  start = async (listenPort: number) => main({ waitForElectrum: false, listenPort }, createContext),
): Promise<SentinelServer> {
  const server = await startOnPreferredPort(portFile, start)
  running.push(server)
  return server
}

function setup(): void {
  running = []
  sockets = []
  queued = []
  portFile = join(mkdtempSync(join(tmpdir(), 'desktop-listen-test-')), 'port')
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
    rmSync(join(portFile, '..'), { recursive: true, force: true })
  })
}

describe('desktop and development server coexistence', () => {
  it('falls back from an occupied saved port, remembers it, and shuts down independently', async () => {
    setup()
    const occupiedPort = await reservePort()
    writePreferredPort(portFile, occupiedPort)
    const failed = queueContext(occupiedPort)
    const started = queueContext(occupiedPort)
    const desktop = await startDesktop()

    expect(desktop.port).toBeGreaterThan(0)
    expect(desktop.port).not.toBe(occupiedPort)
    expect(readPreferredPort(portFile)).toBe(desktop.port)
    expect(failed.closes()).toBe(1)
    expect(started.closes()).toBe(0)
    await expect(health(desktop.port)).resolves.toEqual({ status: 'ok' })
    await desktop.shutdown()
    expect(sockets[0]?.listening).toBe(true)
    expect(started.closes()).toBe(1)
  })

  it.each([undefined, '3400', '4269'])('lets development start after desktop with saved port %s', async (savedPort) => {
    setup()
    if (savedPort !== undefined) {
      writeFileSync(portFile, savedPort)
    }
    const configuredPort = await reservePort()
    const desktopContext = queueContext(configuredPort)
    const start = vi.fn(async (listenPort: number) => main({ waitForElectrum: false, listenPort }, createContext))
    const desktop = await startDesktop(start)
    expect(start).toHaveBeenCalledExactlyOnceWith(0)
    const reserved = sockets[0]
    if (reserved) {
      await closeSocket(reserved)
    }
    queueContext(configuredPort)
    const development = await main({}, createContext)
    running.push(development)

    expect(development.port).toBe(configuredPort)
    expect(development.port).not.toBe(desktop.port)
    await development.shutdown()
    await expect(health(desktop.port)).resolves.toEqual({ status: 'ok' })
    expect(desktopContext.closes()).toBe(0)
  })

  it('reuses a saved non-development port when it becomes available again', async () => {
    setup()
    queueContext(3400)
    const initial = await startDesktop()
    await initial.shutdown()
    queueContext(3400)
    const restarted = await startDesktop()
    expect(restarted.port).toBe(initial.port)
    await expect(health(restarted.port)).resolves.toEqual({ status: 'ok' })
  })

  it('cleans up its own resources after a configured-port bind failure', async () => {
    setup()
    const port = await reservePort()
    const failed = queueContext(port)
    await expect(main({}, createContext)).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(failed.closes()).toBe(1)
    expect(failed.stops()).toBe(1)
    expect(sockets[0]?.listening).toBe(true)
  })
})
