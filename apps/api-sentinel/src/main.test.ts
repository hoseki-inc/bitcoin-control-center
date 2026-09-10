import { type AddressInfo, type Server, createServer } from 'node:net'
import { Ok } from '@patina/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AppContext, createAppContext } from './context'
import { type SentinelServer, main } from './main'

vi.mock('./context', () => ({ createAppContext: vi.fn() }))

const running: SentinelServer[] = []
const sockets: Server[] = []

function configureContext(port: number): AppContext {
  const context = {
    env: { HOST: '127.0.0.1', PORT: port, APP_DIR: '/nonexistent-sentinel-test-assets' },
    controlCenterService: { recordAllSnapshots: vi.fn().mockResolvedValue(undefined) },
    disconnectElectrum: vi.fn(),
    database: { close: vi.fn() },
  } as unknown as AppContext
  vi.mocked(createAppContext).mockResolvedValue(Ok(context))
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
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'fatal')
})

afterEach(async () => {
  for (const server of running.splice(0)) await server.shutdown()
  for (const socket of sockets.splice(0)) {
    if (socket.listening) await new Promise<void>((resolve) => socket.close(() => resolve()))
  }
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('desktop and development server coexistence', () => {
  it('binds a usable independent port when the configured development port is occupied', async () => {
    const occupiedPort = await reservePort()
    const context = configureContext(occupiedPort)
    const desktop = await main({ waitForElectrum: false, listenPort: 0 })
    running.push(desktop)

    expect(desktop.port).toBeGreaterThan(0)
    expect(desktop.port).not.toBe(occupiedPort)
    expect(await (await fetch(`http://127.0.0.1:${desktop.port}/health`)).json()).toEqual({ status: 'ok' })
    await desktop.shutdown()
    expect(sockets[0]?.listening).toBe(true)
    expect(context.database.close).toHaveBeenCalledTimes(1)
  })

  it('lets the configured server start after desktop and keeps desktop alive when it stops', async () => {
    const configuredPort = await reservePort()
    const desktopContext = configureContext(configuredPort)
    const desktop = await main({ waitForElectrum: false, listenPort: 0 })
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

  it('cleans up its own resources after a configured-port bind failure', async () => {
    const port = await reservePort()
    const context = configureContext(port)
    await expect(main()).rejects.toMatchObject({ code: 'EADDRINUSE' })
    expect(context.database.close).toHaveBeenCalledTimes(1)
    expect(context.disconnectElectrum).toHaveBeenCalledTimes(1)
    expect(sockets[0]?.listening).toBe(true)
  })
})
