export async function startServer(serverMain: string): Promise<{ shutdown: () => Promise<void> }> {
  const module: unknown = await import(serverMain)
  if (!module || typeof module !== 'object' || !('main' in module) || typeof module.main !== 'function') {
    throw new TypeError('The bundled Sentinel server must export a main function')
  }
  const main = module.main
  const server: unknown = await main()
  if (!server || typeof server !== 'object' || !('shutdown' in server) || typeof server.shutdown !== 'function') {
    throw new TypeError('The Sentinel server must provide a shutdown function')
  }
  const shutdown = server.shutdown
  return {
    shutdown: async (): Promise<void> => {
      await shutdown.call(server)
    },
  }
}
