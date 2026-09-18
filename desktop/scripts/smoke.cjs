// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { pathToFileURL } = require('node:url')

const resources = resolve(process.argv[2])
const data = mkdtempSync(join(tmpdir(), 'bcc-packaged-smoke-'))
const sockets = new Set()
const electrum = createServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => sockets.delete(socket))
  socket.on('error', () => {})
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const request = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      socket.write(`${JSON.stringify({ id: request.id, jsonrpc: '2.0', result: ['Fixture Electrum', '1.4'] })}\n`)
    }
  })
})
let server
const deadline = setTimeout(() => {
  console.error('Packaged smoke test timed out')
  process.exit(1)
}, 30_000)

async function main() {
  await new Promise((resolve, reject) => {
    electrum.once('error', reject)
    electrum.listen(0, '127.0.0.1', resolve)
  })
  const occupiedPort = electrum.address().port
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
  const backend = await import(pathToFileURL(join(appDir, 'main.js')).href)
  server = await backend.main({ listenPort: 0, connectionProfiles: true })
  assert.notEqual(server.port, occupiedPort)
  const origin = `http://127.0.0.1:${server.port}`
  assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { status: 'ok' })
  const page = await fetch(origin)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /<html/i)
  const response = await fetch(`${origin}/trpc/settings.electrumStatus`)
  const wrapped = await response.json()
  const status = wrapped.result.data.json ?? wrapped.result.data
  assert.equal(status.connected, true)
  assert.equal(status.port, occupiedPort)
  const profilesResponse = await fetch(`${origin}/trpc/settings.connectionProfiles.list`)
  assert.equal(profilesResponse.status, 200)
  const profilesWrapped = await profilesResponse.json()
  const profiles = profilesWrapped.result.data.json ?? profilesWrapped.result.data
  assert.equal(profiles.profiles.length, 1)
  assert.equal(profiles.profiles[0].nickname, 'Current connection')
  assert.equal(profiles.profiles[0].port, occupiedPort)
  assert.equal(profiles.activeId, profiles.profiles[0].id)
  assert.equal(profiles.status.connected, true)
  execFileSync(join(resources, 'tor', process.platform === 'win32' ? 'tor.exe' : 'tor'), ['--version'], {
    stdio: 'pipe',
    timeout: 10_000,
  })
  console.log(
    'Packaged backend, native SQLite, saved connections, frontend assets, dynamic port, fixture Electrum, and bundled Tor passed.',
  )
}

main()
  .catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
  .finally(async () => {
    await server?.shutdown()
    for (const socket of sockets) socket.destroy()
    await new Promise((resolve) => electrum.close(() => resolve()))
    rmSync(data, { recursive: true, force: true })
    clearTimeout(deadline)
  })
