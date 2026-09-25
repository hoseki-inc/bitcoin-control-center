function isCallable(value: unknown): value is () => unknown {
  return typeof value === 'function'
}

function isServerModule(value: unknown): value is { main: () => unknown } {
  return value !== null && typeof value === 'object' && 'main' in value && isCallable(value.main)
}

function hasShutdown(value: unknown): value is { shutdown: () => unknown } {
  return value !== null && typeof value === 'object' && 'shutdown' in value && isCallable(value.shutdown)
}

export async function startServer(serverMain: string): Promise<{ shutdown: () => Promise<void> }> {
  const module: unknown = await import(serverMain)
  if (!isServerModule(module)) {
    throw new TypeError('The bundled Sentinel server must export a main function')
  }
  const main = module.main
  const server: unknown = await main()
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
