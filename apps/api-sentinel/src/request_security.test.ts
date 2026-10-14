import Fastify, { type FastifyInstance, type InjectOptions } from 'fastify'
import { describe, expect, it, onTestFinished } from 'vitest'
import { registerRequestSecurity } from './request_security'

const servers: FastifyInstance[] = []
const publicIp = '203.0.113.42'
const allowedHosts = `${publicIp},10.0.0.20,fd00::20,node.local,example.onion,control.example.com`

function createServer(configuredHosts: string | undefined = allowedHosts, isProduction = true): FastifyInstance {
  const server = Fastify()
  registerRequestSecurity(server, configuredHosts, isProduction)
  server.get('/', async () => 'Control Center')
  server.get('/health', async () => ({ status: 'ok' }))
  server.get('/trpc/data', async () => ({ ok: true }))
  server.post('/trpc/settings', async () => ({ ok: true }))
  servers.push(server)
  return server
}

// Control Center's tRPC client sends every change as JSON.
function jsonWrite(headers: Record<string, string>): InjectOptions {
  return {
    method: 'POST',
    url: '/trpc/settings',
    headers: { 'content-type': 'application/json', ...headers },
    payload: '{}',
  }
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await Promise.all(servers.splice(0).map(async (server) => server.close()))
  })

  await run()
}

describe('Sentinel interface access', () => {
  it('reproduces public-IP 403s with the legacy StartOS defaults', async () => {
    await withTestSetup(async () => {
      const server = createServer('hoseki-sentinel.local,hoseki-sentinel.embassy,*.local,*.onion,*.embassy')
      const response = await server.inject({ url: '/trpc/data', headers: { host: `${publicIp}:50399` } })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ code: 'forbidden_host' })
      expect((await server.inject({ url: '/', headers: { host: `${publicIp}:50399` } })).statusCode).toBe(200)
    })
  })

  it.each([
    `https://${publicIp}:50399`,
    'https://10.0.0.20:50399',
    'https://[fd00::20]:50399',
    'https://node.local:50399',
    'http://example.onion',
    'https://control.example.com',
  ])('accepts API reads and writes through an enabled interface: %s', async (origin) => {
    await withTestSetup(async () => {
      const server = createServer()
      const headers = { host: new URL(origin).host, origin, 'sec-fetch-site': 'same-origin' }
      const read = await server.inject({ url: '/trpc/data', headers })
      const write = await server.inject({ ...jsonWrite(headers), remoteAddress: '10.0.3.1' })
      expect(read.statusCode).toBe(200)
      expect(write.statusCode).toBe(200)
    })
  })

  it('uses the forwarded public hostname when StartOS proxies through an internal host', async () => {
    await withTestSetup(async () => {
      const server = createServer()
      const response = await server.inject({
        url: '/trpc/data',
        headers: {
          host: 'internal-proxy:3400',
          'x-forwarded-host': `${publicIp}:50399`,
          origin: `https://${publicIp}:50399`,
        },
      })
      expect(response.statusCode).toBe(200)
    })
  })

  it.each(['203.0.113.43', 'other.local', 'other.onion', 'control.example.com.evil.example'])(
    'rejects an address that is not enabled: %s',
    async (host) => {
      await withTestSetup(async () => {
        const response = await createServer().inject({ url: '/trpc/data', headers: { host } })
        expect(response.statusCode).toBe(403)
        expect(response.json()).toMatchObject({ code: 'forbidden_host' })
      })
    },
  )

  it.each([
    { origin: 'https://evil.example' },
    { origin: 'null' },
    { origin: `https://${publicIp}:50399`, 'sec-fetch-site': 'cross-site' },
    {},
  ])('rejects unauthorized browser writes: case %#', async (headers) => {
    await withTestSetup(async () => {
      const response = await createServer().inject({
        method: 'POST',
        url: '/trpc/settings',
        headers: { host: `${publicIp}:50399`, ...headers },
        remoteAddress: '10.0.3.1',
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ code: 'forbidden_origin' })
    })
  })

  it('rejects a disallowed forwarded host even when Host is allowed', async () => {
    await withTestSetup(async () => {
      const response = await createServer().inject({
        url: '/trpc/data',
        headers: { host: 'localhost', 'x-forwarded-host': 'evil.example' },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ code: 'forbidden_host' })
    })
  })

  it('protects tRPC routes reached through an encoded path', async () => {
    await withTestSetup(async () => {
      const server = createServer('')
      // Like the tRPC plugin: one route per procedure under a /trpc prefix.
      await server.register(
        async (trpc) => {
          trpc.post('/:procedure', async () => ({ ok: true }))
        },
        { prefix: '/trpc' },
      )
      const read = await server.inject({
        url: '/%74rpc/data',
        headers: { host: 'evil.example', 'sec-fetch-site': 'cross-site' },
      })
      // A cross-site form post: text/plain needs no preflight, so the page never asks first.
      const write = await server.inject({
        method: 'POST',
        url: '/%74rpc/settings.update',
        headers: { host: '127.0.0.1:3400', origin: 'https://evil.example', 'content-type': 'text/plain' },
        payload: '{}',
      })
      expect(read.statusCode).toBe(403)
      expect(write.statusCode).toBe(403)
      expect(write.json()).toMatchObject({ code: 'forbidden_origin' })
    })
  })

  it.each([undefined, ''])(
    'ignores a forwarded host a page sends itself when no proxy is configured: %j',
    async (configuredHosts) => {
      await withTestSetup(async () => {
        // createServer() would swap undefined for the StartOS hosts.
        const server = Fastify()
        servers.push(server)
        registerRequestSecurity(server, configuredHosts, true)
        server.get('/trpc/data', async () => ({ ok: true }))
        // After DNS rebinding, a page reads from its own origin, so the browser sends no Origin.
        const response = await server.inject({
          url: '/trpc/data',
          headers: { host: 'rebind.attacker.example:3400', 'x-forwarded-host': 'localhost:3400' },
        })
        expect(response.statusCode).toBe(403)
        expect(response.json()).toMatchObject({ code: 'forbidden_host' })
      })
    },
  )

  it('keeps missing interface addresses loopback-only and leaves health checks available', async () => {
    await withTestSetup(async () => {
      const server = createServer('')
      for (const host of [publicIp, 'node.local', 'example.onion']) {
        expect((await server.inject({ url: '/trpc/data', headers: { host } })).statusCode).toBe(403)
      }
      for (const host of ['localhost:3400', '127.0.0.1:3400', '[::1]:3400']) {
        expect((await server.inject(jsonWrite({ host }))).statusCode).toBe(200)
      }
      expect((await server.inject({ url: '/health', headers: { host: 'internal-proxy' } })).statusCode).toBe(200)
    })
  })

  it('accepts JSON writes from the desktop window and through the StartOS proxy', async () => {
    await withTestSetup(async () => {
      const desktop = await createServer('').inject(
        jsonWrite({ host: '127.0.0.1:51234', origin: 'http://127.0.0.1:51234', 'sec-fetch-site': 'same-origin' }),
      )
      const startOs = await createServer().inject({
        ...jsonWrite({
          host: 'internal-proxy:3400',
          'x-forwarded-host': 'node.local:50399',
          origin: 'https://node.local:50399',
          'content-type': 'Application/JSON; charset=utf-8',
        }),
        remoteAddress: '10.0.3.1',
      })
      expect(desktop.statusCode).toBe(200)
      expect(startOs.statusCode).toBe(200)
    })
  })

  // Another app's page on the same machine, or another service on the same StartOS hostname, passes the
  // hostname-only Origin check, so only the content type tells its writes apart.
  it.each([
    { configuredHosts: '', host: '127.0.0.1:3400', origin: 'http://127.0.0.1:8080', remoteAddress: '127.0.0.1' },
    {
      configuredHosts: allowedHosts,
      host: 'internal-proxy:3400',
      'x-forwarded-host': 'node.local:50399',
      origin: 'https://node.local:8443',
      remoteAddress: '10.0.3.1',
    },
  ])('rejects writes that are not JSON, even from an allowed hostname: $origin', async (request) => {
    await withTestSetup(async () => {
      const { configuredHosts, remoteAddress, ...headers } = request
      const server = createServer(configuredHosts)
      for (const contentType of [
        'text/plain',
        'text/plain; application/json',
        'application/x-www-form-urlencoded',
        'multipart/form-data; boundary=x',
      ]) {
        const response = await server.inject({
          ...jsonWrite({ ...headers, 'sec-fetch-site': 'same-site', 'content-type': contentType }),
          remoteAddress,
        })
        expect(response.statusCode).toBe(415)
        expect(response.json()).toMatchObject({ code: 'unsupported_content_type' })
      }
      const withoutContentType = await server.inject({
        method: 'POST',
        url: '/trpc/settings',
        headers: { ...headers, 'sec-fetch-site': 'same-site' },
        remoteAddress,
      })
      expect(withoutContentType.statusCode).toBe(415)
      expect(withoutContentType.json()).toMatchObject({ code: 'unsupported_content_type' })
    })
  })

  it('preserves local development origins', async () => {
    await withTestSetup(async () => {
      const server = createServer('', false)
      const headers = { host: 'localhost:3400', origin: 'http://localhost:5173' }
      expect((await server.inject(jsonWrite(headers))).statusCode).toBe(200)
      const rejected = await server.inject({
        url: '/trpc/data',
        headers: { ...headers, origin: 'https://evil.example' },
      })
      expect(rejected.statusCode).toBe(403)
    })
  })
})
