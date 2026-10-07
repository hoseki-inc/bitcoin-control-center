import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { describe, expect, it, onTestFinished } from 'vitest'
import { registerStaticAssets } from './static_assets'

const temporaryDirectories: string[] = []

async function createPublicDirectory(): Promise<string> {
  const publicDir = await mkdtemp(join(tmpdir(), 'sentinel-static-test-'))
  temporaryDirectories.push(publicDir)
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><html><body>Control Center</body></html>')
  return publicDir
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
    )
  })

  await run()
}

describe('registerStaticAssets', () => {
  it('serves the SPA shell when a browser route is loaded directly', async () => {
    await withTestSetup(async () => {
      const server = Fastify()
      const publicDir = await createPublicDirectory()
      await registerStaticAssets(server, publicDir)

      const response = await server.inject({ method: 'GET', url: '/portfolio' })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/html')
      expect(response.body).toContain('Control Center')
      await server.close()
    })
  })

  it.each([
    ['br, gzip', 'br', 'brotli copy'],
    ['gzip', 'gzip', 'gzip copy'],
    ['identity', undefined, 'console.log("app")'],
  ])('serves a precompressed asset to a browser accepting %s', async (acceptEncoding, encoding, body) => {
    await withTestSetup(async () => {
      const server = Fastify()
      const publicDir = await createPublicDirectory()
      await writeFile(join(publicDir, 'app.js'), 'console.log("app")')
      await writeFile(join(publicDir, 'app.js.br'), 'brotli copy')
      await writeFile(join(publicDir, 'app.js.gz'), 'gzip copy')
      await registerStaticAssets(server, publicDir)

      const response = await server.inject({
        method: 'GET',
        url: '/app.js',
        headers: { 'accept-encoding': acceptEncoding },
      })

      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('javascript')
      expect(response.headers['content-encoding']).toBe(encoding)
      expect(response.body).toBe(body)
      await server.close()
    })
  })

  it('preserves JSON 404 responses for unknown API routes', async () => {
    await withTestSetup(async () => {
      const server = Fastify()
      const publicDir = await createPublicDirectory()
      await registerStaticAssets(server, publicDir)

      const response = await server.inject({ method: 'GET', url: '/trpc/missing' })

      expect(response.statusCode).toBe(404)
      expect(response.json()).toEqual({ error: 'Not found' })
      await server.close()
    })
  })
})
