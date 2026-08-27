import { existsSync } from 'node:fs'
import { join } from 'node:path'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import Fastify, { type FastifyBaseLogger } from 'fastify'
import pino from 'pino'
import { createAppContext } from './context'
import { registerStatementRoutes } from './modules/statements/routes'
import type { TRPCContext } from './modules/trpc/init'
import { type AppRouter, appRouter } from './modules/trpc/router'

export interface SentinelServer {
  shutdown: () => Promise<void>
}

const DEFAULT_ALLOWED_HOST_PATTERNS = ['localhost', '127.0.0.1', '::1']

function normalizeHostname(hostname: string): string {
  return hostname.trim().toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '')
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function isLoopbackAddress(address: string): boolean {
  const normalized = normalizeHostname(address).replace(/^::ffff:/, '')
  return isLoopbackHost(normalized)
}

function getHostname(host: string | undefined): string | null {
  if (!host) return null

  try {
    return normalizeHostname(new URL(`http://${host}`).hostname)
  } catch {
    return null
  }
}

function getHeaderValue(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim()
}

function normalizeAllowedHostPattern(pattern: string): string | null {
  const trimmed = pattern.trim()
  if (trimmed.length === 0) return null

  if (trimmed.startsWith('*.')) {
    const suffix = normalizeHostname(trimmed.slice(2))
    return suffix.length > 0 ? `*.${suffix}` : null
  }

  const hostname = getHostname(trimmed)
  return hostname ?? normalizeHostname(trimmed)
}

function getAllowedHostPatterns(configuredHosts: string | undefined): string[] {
  const configuredPatterns = (configuredHosts ?? '')
    .split(',')
    .map(normalizeAllowedHostPattern)
    .filter((pattern): pattern is string => pattern !== null)

  return [...DEFAULT_ALLOWED_HOST_PATTERNS, ...configuredPatterns]
}

function isAllowedHost(host: string | undefined, allowedPatterns: string[]): boolean {
  const hostname = getHostname(host)
  if (!hostname) return false

  return allowedPatterns.some((pattern) => {
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2)
      return hostname === suffix || hostname.endsWith(`.${suffix}`)
    }

    return hostname === pattern
  })
}

function isAllowedDevelopmentOrigin(origin: string | undefined): boolean {
  if (!origin) return true

  try {
    const url = new URL(origin)
    return isLoopbackHost(url.hostname)
  } catch {
    return false
  }
}

function isAllowedRequestOrigin(
  origin: string | undefined,
  allowedHostPatterns: string[],
  isProduction: boolean,
): boolean {
  if (!origin) return true
  if (!isProduction) return isAllowedDevelopmentOrigin(origin)

  try {
    const originUrl = new URL(origin)
    return allowedHostPatterns.some((pattern) => {
      const hostname = normalizeHostname(originUrl.hostname)
      if (pattern.startsWith('*.')) {
        const suffix = pattern.slice(2)
        return hostname === suffix || hostname.endsWith(`.${suffix}`)
      }

      return hostname === pattern
    })
  } catch {
    return false
  }
}

function isUnsafeMethod(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
}

function isProtectedRoute(url: string): boolean {
  return url.startsWith('/trpc') || url.startsWith('/statements/')
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
  const allowedHostPatterns = getAllowedHostPatterns(appCtx.env.SENTINEL_ALLOWED_HOSTS)

  const server = Fastify({
    loggerInstance: logger.child({ module: 'fastify' }) as FastifyBaseLogger,
    forceCloseConnections: 'idle',
  })

  server.addHook('onRequest', async (request, reply) => {
    if (!isProtectedRoute(request.url)) return

    const secFetchSite = getHeaderValue(request.headers['sec-fetch-site'])
    if (secFetchSite === 'cross-site') {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Cross-site requests are not allowed' })
    }

    const forwardedHost = getHeaderValue(request.headers['x-forwarded-host'])
    const requestHost = forwardedHost ?? getHeaderValue(request.headers.host)
    if (!isAllowedHost(requestHost, allowedHostPatterns)) {
      return reply.status(403).send({ code: 'forbidden_host', message: 'Host is not allowed' })
    }

    if (!isAllowedRequestOrigin(request.headers.origin, allowedHostPatterns, isProduction)) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is not allowed' })
    }

    if (!request.headers.origin && isUnsafeMethod(request.method) && !isLoopbackAddress(request.ip)) {
      return reply.status(403).send({ code: 'forbidden_origin', message: 'Origin is required' })
    }
  })

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

  // Statement PDF download endpoint (non-tRPC, streams PDF file)
  await registerStatementRoutes(server, appCtx)

  // Serve Control Center static assets (when bundled in production / Docker)
  const publicDir = join(appCtx.env.APP_DIR, 'public')
  if (existsSync(publicDir)) {
    await server.register(fastifyStatic, {
      root: publicDir,
      prefix: '/',
      decorateReply: false,
    })

    // SPA fallback: non-API routes serve index.html
    server.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/trpc') || request.url.startsWith('/statements/')) {
        return reply.status(404).send({ error: 'Not found' })
      }
      return reply.sendFile('index.html')
    })
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

    appCtx.electrumClient.disconnect()
    appCtx.database.close()

    logger.info('Shutdown complete')
  }

  process.once('SIGTERM', () => void shutdown())
  process.once('SIGINT', () => void shutdown())

  return { shutdown }
}
