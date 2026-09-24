import { existsSync } from 'node:fs'
import { join } from 'node:path'
import cors from '@fastify/cors'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import pino from 'pino'
import { createAppContext } from './context'
import type { TRPCContext } from './modules/trpc/init'
import { type AppRouter, appRouter } from './modules/trpc/router'
import { requestLoggerFactory } from './request_logging'
import { isAllowedDevelopmentOrigin, registerRequestSecurity } from './request_security'
import { registerStaticAssets } from './static_assets'

export interface SentinelServer {
  shutdown: () => Promise<void>
}

export async function main(): Promise<SentinelServer> {
  const isProduction = process.env['NODE_ENV'] === 'production'
  const logger = pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    transport: !isProduction ? { target: 'pino-pretty' } : undefined,
  })

  // Initialize application context (database, Electrum connection, etc.)
  const ctxResult = await createAppContext(logger)
  if (ctxResult.isErr()) {
    logger.error({ error: ctxResult.unwrapErr().message }, 'Failed to initialize application context')
    throw new Error(ctxResult.unwrapErr().message)
  }
  const appCtx = ctxResult.unwrap()

  const host = appCtx.env.HOST
  const port = appCtx.env.PORT

  const server = Fastify({
    loggerInstance: logger.child({ module: 'fastify' }) as FastifyBaseLogger,
    childLoggerFactory: requestLoggerFactory,
    forceCloseConnections: 'idle',
  })

  registerRequestSecurity(server, appCtx.env.SENTINEL_ALLOWED_HOSTS, isProduction)

  // CORS is only needed for the Vite dev server. Production serves the UI from
  // the same origin, so reflecting arbitrary browser origins is unnecessary.
  await server.register(cors, {
    origin: isProduction
      ? false
      : (origin, callback) => {
          callback(null, isAllowedDevelopmentOrigin(origin))
        },
    credentials: !isProduction,
  })

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
  await server.listen({ host, port })
  logger.info({ host, port }, 'api-sentinel is running')

  // Record initial balance snapshots, then every 15 minutes
  void appCtx.controlCenterService.recordAllSnapshots()
  snapshotTimer = setInterval(() => void appCtx.controlCenterService.recordAllSnapshots(), 15 * 60 * 1000)

  // Graceful shutdown
  let shuttingDown = false
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info('Starting graceful shutdown')

    if (snapshotTimer) clearInterval(snapshotTimer)

    try {
      await server.close()
    } catch (err) {
      logger.error({ err }, 'Error closing Fastify')
    }

    appCtx.electrum.stop()
    appCtx.database.close()

    logger.info('Shutdown complete')
  }

  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())

  return { shutdown }
}
