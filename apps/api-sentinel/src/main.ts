import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import pino from 'pino'
import { type AppContextOptions, createAppContext } from './context'
import { walletDetailLogOptions } from './log_redaction'
import type { TRPCContext } from './modules/trpc/init'
import { type AppRouter, appRouter } from './modules/trpc/router'
import { requestLoggerFactory } from './request_logging'
import { registerCorsPolicy, registerRequestSecurity } from './request_security'
import { registerStaticAssets } from './static_assets'

export interface SentinelServer {
  port: number
  shutdown: () => Promise<void>
}

export interface SentinelServerOptions extends AppContextOptions {
  /** Override the configured port; zero lets the OS allocate and bind a free port. */
  listenPort?: number
}

export async function main(
  options: SentinelServerOptions = {},
  // Tests supply a context; the application always uses createAppContext.
  createContext: typeof createAppContext = createAppContext,
): Promise<SentinelServer> {
  const isProduction = process.env['NODE_ENV'] === 'production'
  const level = process.env['LOG_LEVEL'] ?? 'info'
  const logger = pino({
    level,
    ...walletDetailLogOptions(level),
    transport: !isProduction ? { target: 'pino-pretty' } : undefined,
  })

  // Initialize application context (database, Electrum connection, etc.)
  const ctxResult = await createContext(logger, options)
  if (ctxResult.isErr()) {
    logger.error({ error: ctxResult.unwrapErr().message }, 'Failed to initialize application context')
    throw new Error(ctxResult.unwrapErr().message)
  }
  const appCtx = ctxResult.unwrap()

  const host = appCtx.env.HOST
  const port = options.listenPort ?? appCtx.env.PORT

  const fastifyLogger: FastifyBaseLogger = logger.child({ module: 'fastify' })
  const server = Fastify({
    loggerInstance: fastifyLogger,
    childLoggerFactory: requestLoggerFactory,
    forceCloseConnections: 'idle',
  })

  registerRequestSecurity(server, appCtx.env.SENTINEL_ALLOWED_HOSTS, isProduction, appCtx.env.SENTINEL_ALLOW_IP_HOSTS)

  await registerCorsPolicy(server, isProduction)

  // Health check
  server.get('/health', async () => ({ status: 'ok' }))

  // tRPC
  await server.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: {
      router: appRouter,
      createContext: async (): Promise<TRPCContext> => ({ app: appCtx }),
    } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
  })

  // Serve Control Center static assets (when bundled in production / Docker)
  const publicDir = join(appCtx.env.APP_DIR, 'public')
  if (existsSync(publicDir)) {
    await registerStaticAssets(server, publicDir)
    logger.info({ publicDir }, 'Serving static web UI')
  }

  // Start listening
  let snapshotTimer: ReturnType<typeof setInterval> | undefined
  let boundPort: number
  try {
    await server.listen({ host, port })
    // Report the port actually bound, which differs from the request when it is zero.
    boundPort = server.addresses()[0]?.port ?? port
  } catch (error) {
    appCtx.stopElectrum()
    appCtx.database.$client.close()
    await server.close()
    throw error
  }
  // Sentinel's own address helps diagnose an unreachable UI, so it isn't logged as a hidden `host`.
  logger.info({ listenHost: host, port: boundPort }, 'api-sentinel is running')

  // Record initial balance snapshots, then every 15 minutes
  void appCtx.controlCenterService.recordAllSnapshots()
  snapshotTimer = setInterval(() => void appCtx.controlCenterService.recordAllSnapshots(), 15 * 60 * 1000)
  appCtx.releaseCheckService.start()

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    process.off('SIGTERM', onSignal)
    process.off('SIGINT', onSignal)
    logger.info('Starting graceful shutdown')

    clearInterval(snapshotTimer)
    appCtx.releaseCheckService.stop()

    try {
      await server.close()
    } catch (err) {
      logger.error({ err }, 'Error closing Fastify')
    }

    appCtx.stopElectrum()
    appCtx.database.$client.close()

    logger.info('Shutdown complete')
  }

  const onSignal = (): void => void shutdown()
  process.once('SIGTERM', onSignal)
  process.once('SIGINT', onSignal)

  return { port: boundPort, shutdown }
}
