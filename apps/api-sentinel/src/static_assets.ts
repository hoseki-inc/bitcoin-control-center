import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import type { FastifyInstance } from 'fastify'

export async function registerStaticAssets(server: FastifyInstance, publicDir: string): Promise<void> {
  const indexHtml = await readFile(join(publicDir, 'index.html'))

  await server.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
    decorateReply: false,
    // Serve the .br or .gz copy a StartOS build writes next to each asset, when the browser accepts it.
    preCompressed: true,
  })

  // Serve the cached SPA shell for browser routes so direct navigation and
  // restored tabs work without relying on @fastify/static's sendFile decorator.
  server.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/trpc')) {
      return reply.status(404).send({ error: 'Not found' })
    }
    return reply.type('text/html; charset=utf-8').send(indexHtml)
  })
}
