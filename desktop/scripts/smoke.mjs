// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Reads one field of a parsed JSON value, failing the smoke test if it's missing.
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  assert.ok(value instanceof Object && Object.hasOwn(value, key), `Missing ${key}`)
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

/**
 * Reads a tRPC query's result, with or without the superjson wrapper.
 * @param {string} url
 * @returns {Promise<unknown>}
 */
async function trpcQuery(url) {
  const response = await fetch(url)
  assert.equal(response.status, 200, url)
  /** @type {unknown} */
  const body = await response.json()
  const data = field(field(body, 'result'), 'data')
  return data instanceof Object && Object.hasOwn(data, 'json') ? field(data, 'json') : data
}

const resourcesArgument = process.argv[2]
assert.ok(resourcesArgument !== undefined, 'Usage: smoke.mjs <packaged resources directory>')
const resources = resolve(resourcesArgument)
const data = mkdtempSync(join(tmpdir(), 'bcc-packaged-smoke-'))
/** @type {Set<import('node:net').Socket>} */
const sockets = new Set()
// A fixture Electrum server that answers every request with a server version.
const electrum = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => {
    sockets.delete(socket)
  })
  socket.on('error', () => undefined)
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      /** @type {unknown} */
      const request = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      socket.write(
        `${JSON.stringify({ id: field(request, 'id'), jsonrpc: '2.0', result: ['Fixture Electrum', '1.4'] })}\n`,
      )
      newline = buffer.indexOf('\n')
    }
  })
})
/** @type {{ port: number, shutdown: () => Promise<void> } | undefined} */
let server
const deadline = setTimeout(() => {
  console.error('Packaged smoke test timed out')
  process.exit(1)
}, 30_000)

async function smoke() {
  await new Promise((done, fail) => {
    electrum.once('error', fail)
    electrum.listen(0, '127.0.0.1', () => {
      done(undefined)
    })
  })
  // The backend is asked to listen on the port Electrum already holds, so it must pick another.
  const occupiedPort = Number(field(electrum.address(), 'port'))
  const appDir = join(resources, 'app.asar/app/server')
  Object.assign(process.env, {
    DATA_DIR: data,
    APP_DIR: appDir,
    HOST: '127.0.0.1',
    PORT: String(occupiedPort),
    NODE_ENV: 'production',
    LOG_LEVEL: 'fatal',
    ELECTRUM_HOST: '127.0.0.1',
    ELECTRUM_PORT: String(occupiedPort),
    ELECTRUM_PROTOCOL: 'tcp',
    BITCOIN_NETWORK: 'mainnet',
    MEMPOOL_API_URL: 'http://127.0.0.1:1',
  })
  /** @type {{ main: (options: { listenPort: number, connectionProfiles: boolean }) => Promise<{ port: number, shutdown: () => Promise<void> }> }} */
  // oxlint-disable-next-line typescript/no-unsafe-assignment -- The packaged backend's main() is typed by the annotation above.
  const backend = await import(pathToFileURL(join(appDir, 'main.js')).href)
  server = await backend.main({ listenPort: 0, connectionProfiles: true })
  assert.notEqual(server.port, occupiedPort)
  const origin = `http://127.0.0.1:${server.port}`
  assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { status: 'ok' })
  const page = await fetch(origin)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<html/i)
  const status = await trpcQuery(`${origin}/trpc/settings.electrumStatus`)
  assert.equal(field(status, 'connected'), true)
  assert.equal(field(status, 'port'), occupiedPort)
  const saved = await trpcQuery(`${origin}/trpc/settings.connectionProfiles.list`)
  const profiles = field(saved, 'profiles')
  assert.ok(Array.isArray(profiles))
  assert.equal(profiles.length, 1)
  /** @type {unknown} */
  const profile = profiles[0]
  assert.equal(field(profile, 'nickname'), 'Current connection')
  assert.equal(field(profile, 'port'), occupiedPort)
  assert.equal(field(saved, 'activeId'), field(profile, 'id'))
  execFileSync(join(resources, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor'), ['--version'], {
    stdio: 'pipe',
    timeout: 10_000,
  })
  console.log(
    'Packaged backend, native SQLite, saved connections, frontend assets, dynamic port, fixture Electrum, and bundled Tor passed.',
  )
}

try {
  await smoke()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await server?.shutdown()
  for (const socket of sockets) {
    socket.destroy()
  }
  await new Promise((done) => {
    electrum.close(() => {
      done(undefined)
    })
  })
  rmSync(data, { recursive: true, force: true })
  clearTimeout(deadline)
  // Exit even if a failed start left handles open, rather than waiting for the CI time limit.
  process.exit(process.exitCode ?? 0)
}
