import type { TorManager } from './tor'

interface ServerOptions {
  /** Saved Electrum connections, which only the desktop app offers. */
  connectionProfiles?: boolean
  waitForElectrum?: boolean
  /** Lets Settings choose Electrum for statement lookups, which only the desktop app offers. */
  statementSourceSetting?: boolean
  tor?: Pick<TorManager, 'start' | 'getStatus' | 'getSocksProxy'>
  /** Port to bind; zero lets the operating system choose a free port. */
  listenPort?: number
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- A dynamically loaded server method can return any runtime value, which is checked by its caller.
function isCallable(value: unknown): value is (options?: ServerOptions) => unknown {
  return typeof value === 'function'
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Runtime-loaded server exports are checked structurally before use.
function isServerModule(value: unknown): value is { main: (options?: ServerOptions) => unknown } {
  return value !== null && typeof value === 'object' && 'main' in value && isCallable(value.main)
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Runtime-loaded server shutdown values are checked structurally before use.
function hasShutdown(value: unknown): value is { shutdown: () => unknown } {
  return value !== null && typeof value === 'object' && 'shutdown' in value && isCallable(value.shutdown)
}

// oxlint-disable-next-line anti-slop/no-unknown-returns -- Runtime-loaded server values are checked structurally before use.
function hasPort(value: unknown): value is { port: number } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'port' in value &&
    Number.isInteger(value.port) &&
    Number(value.port) > 0
  )
}

export async function startServer(
  serverMain: string,
  options?: ServerOptions,
): Promise<{ port: number; shutdown: () => Promise<void> }> {
  const module: unknown = await import(serverMain)
  if (!isServerModule(module)) {
    throw new TypeError('The bundled Sentinel server must export a main function')
  }
  const main = module.main
  const server: unknown = await main(options)
  if (!hasShutdown(server)) {
    throw new TypeError('The Sentinel server must provide a shutdown function')
  }
  if (!hasPort(server)) {
    // The server is already listening; stop it rather than leave it running unused.
    await Promise.resolve(server.shutdown.call(server)).catch(() => undefined)
    throw new TypeError('The Sentinel server must report the port it bound')
  }
  const shutdown = server.shutdown
  return {
    port: server.port,
    shutdown: async (): Promise<void> => {
      await shutdown.call(server)
    },
  }
}
