import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { type AddressInfo, type Server, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Ok } from '@patina/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readPreferredPort, startOnPreferredPort, writePreferredPort } from '../../../desktop/src/preferred-port'
import { type AppContext, createAppContext } from './context'
import { type SentinelServer, main } from './main'

vi.mock('./context', () => ({ createAppContext: vi.fn() }))

const running: SentinelServer[] = []
const sockets: Server[] = []
let portFile: string

function configureContext(port: number): AppContext {
  const context = {
    env: { HOST: '127.0.0.1', PORT: port, APP_DIR: '/nonexistent-sentinel-test-assets' },
    controlCenterService: { recordAllSnapshots: vi.fn().mockResolvedValue(undefined) },
    stopElectrum: vi.fn(),
    database: { close: vi.fn() },
  } as unknown as AppContext
  vi.mocked(createAppContext).mockResolvedValueOnce(Ok(context))
  return context
}

async function reservePort(): Promise<number> {
  const socket = createServer()
  sockets.push(socket)
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.listen(0, '127.0.0.1', resolve)
  })
  return (socket.address() as AddressInfo).port
}

beforeEach(() => {
  portFile = join(mkdtempSync(join(tmpdir(), 'desktop-listen-test-')), 'port')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'fatal')
})

afterEach(async () => {
  for (const server of running.splice(0)) {
    await server.shutdown()
  }
  for (const socket of sockets.splice(0)) {
    if (socket.listening) {
      await new Promise<void>((resolve) => socket.close(() => resolve()))
    }
  }
  vi.unstubAllEnvs()
  vi.resetAllMocks()
  rmSync(join(portFile, '..'), { recursive: true, force: true })
})

describe('desktop and development server coexistence', () => {
  it('falls back from an occupied saved port, remembers it, and shuts down independently', async () => {
    const occupiedPort = await reservePort()
    writePreferredPort(portFile, occupiedPort)
    const failedContext = configureContext(occupiedPort)
    const context = configureContext(occupiedPort)
    const desktop = await startOnPreferredPort(portFile, (listenPort) => main({ waitForElectrum: false, listenPort }))
    running.push(desktop)

    expect(desktop.port).toBeGreaterThan(0)
    expect(desktop.port).not.toBe(occupiedPort)
    expect(readPreferredPort(portFile)).toBe(desktop.port)
    expect(failedContext.database.close).toHaveBeenCalledOnce()
    expect(context.database.close).not.toHaveBeenCalled()
    expect(await (await fetch(`http://127.0.0.1:${desktop.port}/health`)).json()).toEqual({ status: 'ok' })
    await desktop.shutdown()
    expect(sockets[0]?.listening).toBe(true)
    expect(context.database.close).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '3400', '4269'])('lets development start after desktop with saved port %s', async (savedPort) => {
    if (savedPort) {
      writeFileSync(portFile, savedPort)
    }
    const configuredPort = await reservePort()
    const desktopContext = configureContext(configuredPort)
    const start = vi.fn((listenPort: number) => main({ waitForElectrum: false, listenPort }))
    const desktop = await startOnPreferredPort(portFile, start)
    expect(start).toHaveBeenCalledExactlyOnceWith(0)
    running.push(desktop)
    await new Promise<void>((resolve) => sockets[0]!.close(() => resolve()))
    configureContext(configuredPort)
    const development = await main()
    running.push(development)

    expect(development.port).toBe(configuredPort)
    expect(development.port).not.toBe(desktop.port)
    await development.shutdown()
    expect(await (await fetch(`http://127.0.0.1:${desktop.port}/health`)).json()).toEqual({ status: 'ok' })
    expect(desktopContext.database.close).not.toHaveBeenCalled()
  })

  it('reuses a saved non-development port when it becomes available again', async () => {
    configureContext(3400)
    const initial = await startOnPreferredPort(portFile, (listenPort) => main({ waitForElectrum: false, listenPort }))
    running.push(initial)
    await initial.shutdown()
    configureContext(3400)
    const restarted = await startOnPreferredPort(portFile, (listenPort) => main({ waitForElectrum: false, listenPort }))
    running.push(restarted)
    expect(restarted.port).toBe(initial.port)
    expect(await (await fetch(`http://127.0.0.1:${restarted.port}/health`)).json()).toEqual({ status: 'ok' })
  })

  it('cleans up its own resources after a configured-port bind failure', async () => {
    const port = await reservePort()
    const context = configureContext(port)
    await expect(main()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(context.database.close).toHaveBeenCalledTimes(1)
    expect(context.stopElectrum).toHaveBeenCalledTimes(1)
    expect(sockets[0]?.listening).toBe(true)
  })
})
