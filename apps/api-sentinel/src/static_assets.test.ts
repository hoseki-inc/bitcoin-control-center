import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerStaticAssets } from './static_assets'

const temporaryDirectories: string[] = []

async function createPublicDirectory(): Promise<string> {
  const publicDir = await mkdtemp(join(tmpdir(), 'sentinel-static-test-'))
  temporaryDirectories.push(publicDir)
  await writeFile(join(publicDir, 'index.html'), '<!doctype html><html><body>Control Center</body></html>')
  return publicDir
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('registerStaticAssets', () => {
  it('serves the SPA shell when a browser route is loaded directly', async () => {
    const server = Fastify()
    const publicDir = await createPublicDirectory()
    await registerStaticAssets(server, publicDir)

    const response = await server.inject({ method: 'GET', url: '/portfolio' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('Control Center')
    await server.close()
  })

  it('preserves JSON 404 responses for unknown API routes', async () => {
    const server = Fastify()
    const publicDir = await createPublicDirectory()
    await registerStaticAssets(server, publicDir)

    const response = await server.inject({ method: 'GET', url: '/trpc/missing' })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({ error: 'Not found' })
    await server.close()
  })
})
