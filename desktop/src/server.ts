import type { TorManager } from './tor'

interface ServerOptions {
  waitForElectrum?: boolean
  tor?: Pick<TorManager, 'start' | 'getStatus'>
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

export async function startServer(
  serverMain: string,
  options?: ServerOptions,
): Promise<{ shutdown: () => Promise<void> }> {
  const module: unknown = await import(serverMain)
  if (!isServerModule(module)) {
    throw new TypeError('The bundled Sentinel server must export a main function')
  }
  const main = module.main
  const server: unknown = await main(options)
  if (!hasShutdown(server)) {
    throw new TypeError('The Sentinel server must provide a shutdown function')
  }
  const shutdown = server.shutdown
  return {
    shutdown: async (): Promise<void> => {
      await shutdown.call(server)
    },
  }
}
