import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify'
import pino from 'pino'
import { afterEach, assert, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { requestLoggerFactory } from './request_logging'

const xpub = 'xpubSENTINEL_PRIVATE_WALLET_TEST'
const descriptor = `wpkh([d34db33f/84h/0h/0h]${xpub}/0/*)#testsum`
const input = JSON.stringify({ 0: { json: { descriptor } }, 1: { json: { xpub } } })
const query = `?batch=1&input=${encodeURIComponent(input)}`
const servers: FastifyInstance[] = []

function createServer(): { server: FastifyInstance; logs: string[] } {
  const logs: string[] = []
  const logger = pino({ level: 'trace' }, { write: (line) => logs.push(line) })
  const fastifyLogger: FastifyBaseLogger = logger.child({ module: 'fastify' })
  const server = Fastify({
    loggerInstance: fastifyLogger,
    childLoggerFactory: requestLoggerFactory,
  })
  servers.push(server)
  return { server, logs }
}

const LogEntrySchema = z
  .object({
    level: z.number(),
    msg: z.string(),
    reqId: z.string().optional(),
    err: z.record(z.unknown()).optional(),
  })
  .passthrough()

function readLogs(logs: string[]): Array<z.infer<typeof LogEntrySchema>> {
  return logs.map((line) => parseUnknown(LogEntrySchema, JSON.parse(line)).expect('Expected a structured log entry'))
}

function expectPrivateLogs(logs: string[]): void {
  const output = logs.join('')
  expect(output).not.toContain(xpub)
  expect(output).not.toContain(descriptor)
  expect(output).not.toContain(encodeURIComponent(descriptor))
  expect(output).not.toContain('input=')
  expect(output).not.toContain('batch=')
  expect(output).not.toContain('authorization-secret')
  expect(output).not.toContain('cookie-secret')
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()))
})

describe('Sentinel request logging', () => {
  it.each([
    query,
    `?descriptor=${descriptor.replaceAll('#', '%23')}&xpub=${xpub}`,
    `?input=%ZZ&input=${encodeURIComponent(input)}`,
    `?${xpub}=${encodeURIComponent(descriptor)}`,
  ])('omits all query data without changing the request: case %#', async (search) => {
    const { server, logs } = createServer()
    const path = '/trpc/accounts.inspect,keystores.inspect'
    const url = path + search
    let receivedUrl: string | undefined
    server.get('/trpc/:path', async (request) => {
      receivedUrl = request.url
      return { ok: true }
    })

    const response = await server.inject({
      url,
      headers: { authorization: 'Bearer authorization-secret', cookie: 'session=cookie-secret' },
    })

    expect(response.statusCode).toBe(200)
    expect(receivedUrl).toBe(url)
    expectPrivateLogs(logs)
    const entries = readLogs(logs)
    const incoming = entries.find((entry) => entry.msg === 'incoming request')
    assert.exists(incoming)
    expect(incoming).toMatchObject({
      module: 'fastify',
      reqId: expect.any(String) as unknown,
      req: { method: 'GET', url: path, remoteAddress: '127.0.0.1' },
    })
    expect(entries).toContainEqual(
      expect.objectContaining({
        msg: 'request completed',
        reqId: incoming.reqId,
        res: { statusCode: 200 },
        responseTime: expect.any(Number) as unknown,
      }),
    )
  })

  it.each(['/missing', '/missing/$&', "/missing/$'", '/missing/$$'])(
    'redacts missing-route messages, including replacement characters: case %#',
    async (path) => {
      const { server, logs } = createServer()

      const response = await server.inject({ url: path + query })

      expect(response.statusCode).toBe(404)
      expectPrivateLogs(logs)
      expect(readLogs(logs)).toContainEqual(expect.objectContaining({ msg: `Route GET:${path} not found` }))
    },
  )

  it('redacts URLs in error messages and stacks and omits arbitrary error data', async () => {
    const { server, logs } = createServer()
    const url = '/failure' + query
    server.get('/failure', async (request) => {
      throw Object.assign(new Error(`Could not handle ${request.url}`), {
        code: 'TEST_FAILURE',
        statusCode: 500,
        url: request.url,
        input: { descriptor, xpub },
        headers: request.headers,
      })
    })

    const response = await server.inject({ url })

    expect(response.statusCode).toBe(500)
    expectPrivateLogs(logs)
    const failure = readLogs(logs).find((entry) => entry.level === 50)
    assert.exists(failure)
    expect(failure).toMatchObject({
      msg: 'Could not handle /failure',
      req: { method: 'GET', url: '/failure' },
      res: { statusCode: 500 },
      err: {
        type: 'Error',
        message: 'Could not handle /failure',
        stack: expect.stringContaining('Error: Could not handle /failure') as unknown,
        code: 'TEST_FAILURE',
        statusCode: 500,
      },
    })
    expect(failure.err).not.toHaveProperty('input')
    expect(failure.err).not.toHaveProperty('headers')
    expect(failure.err).not.toHaveProperty('url')
  })

  it('redacts duplicate-reply warnings', async () => {
    const { server, logs } = createServer()
    server.get('/duplicate', async (_request, reply) => {
      reply.send({ ok: true })
      reply.send({ ok: false })
      return reply
    })

    const response = await server.inject({ url: '/duplicate' + query })

    expect(response.statusCode).toBe(200)
    expectPrivateLogs(logs)
    expect(readLogs(logs)).toContainEqual(
      expect.objectContaining({
        level: 40,
        err: expect.objectContaining({ code: 'FST_ERR_REP_ALREADY_SENT' }) as unknown,
      }),
    )
  })

  it('keeps POST bodies and headers out of logs while leaving them available to handlers', async () => {
    const { server, logs } = createServer()
    server.post('/trpc/accounts.create', async (request) => {
      expect(request.body).toEqual({ descriptor, xpub })
      expect(request.headers.authorization).toBe('Bearer authorization-secret')
      request.log.debug({ req: request }, 'Processing request')
      return { ok: true }
    })

    const response = await server.inject({
      method: 'POST',
      url: '/trpc/accounts.create',
      payload: { descriptor, xpub },
      headers: { authorization: 'Bearer authorization-secret', cookie: 'session=cookie-secret' },
    })

    expect(response.statusCode).toBe(200)
    expectPrivateLogs(logs)
    expect(readLogs(logs)).toContainEqual(
      expect.objectContaining({
        msg: 'Processing request',
        req: expect.objectContaining({ method: 'POST', url: '/trpc/accounts.create' }) as unknown,
      }),
    )
  })

  it('keeps query-free health requests useful for diagnostics', async () => {
    const { server, logs } = createServer()
    server.get('/health', async () => ({ status: 'ok' }))

    const response = await server.inject({ url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(readLogs(logs)).toContainEqual(
      expect.objectContaining({ req: expect.objectContaining({ method: 'GET', url: '/health' }) as unknown }),
    )
  })
})
