import assert from 'node:assert/strict'
import { test } from 'vitest'
import { startServer } from '../src/server.ts'

/** @param {string} source */
function moduleUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

test('starts the bundled server and preserves the shutdown receiver', async () => {
  const server = await startServer(
    moduleUrl(`
    export async function main() {
      return { token: 'server', port: 51234, async shutdown() {
        if (this.token !== 'server') throw new Error('Lost the server receiver')
      } }
    }
  `),
  )
  await server.shutdown()
})

test('awaits asynchronous shutdown and propagates its failure', async () => {
  const server = await startServer(
    moduleUrl(`
    export async function main() { return { port: 51234, async shutdown() {
      await new Promise(resolve => setTimeout(resolve, 0))
      throw new Error('Shutdown failed')
    } } }
  `),
  )
  await assert.rejects(server.shutdown(), /Shutdown failed/)
})

test('propagates startup failure', async () => {
  await assert.rejects(
    startServer(
      moduleUrl(`
    export async function main() { throw new Error('Startup failed') }
  `),
    ),
    /Startup failed/,
  )
})

for (const source of ['export const value = 1', 'export const main = 1']) {
  test(`rejects a missing or invalid entry point: ${source}`, async () => {
    await assert.rejects(startServer(moduleUrl(source)), /must export a main function/)
  })
}
for (const value of ['null', '{}', '{ shutdown: 1 }']) {
  test(`rejects an invalid server handle: ${value}`, async () => {
    await assert.rejects(
      startServer(moduleUrl(`export async function main() { return ${value} }`)),
      /must provide a shutdown function/,
    )
  })
}

test('forwards desktop offline and managed Tor options to the bundled server', async () => {
  let starts = 0
  const server = await startServer(
    moduleUrl(`
    export async function main(options) {
      if (options.waitForElectrum !== false) throw new Error('Offline startup flag missing')
      if (options.tor.getStatus().state !== 'ready') throw new Error('Tor manager missing')
      await options.tor.start()
      return { port: options.listenPort, async shutdown() {} }
    }
  `),
    {
      waitForElectrum: false,
      listenPort: 51235,
      tor: {
        start: async () => {
          starts += 1
          return { state: 'ready' }
        },
        getStatus: () => ({ state: 'ready' }),
      },
    },
  )
  assert.equal(starts, 1)
  assert.equal(server.port, 51235)
  await server.shutdown()
})

for (const port of ['', 'port: 0,', 'port: "3400",']) {
  test(`stops and rejects a server that does not report the port it bound: {${port}}`, async () => {
    globalThis.serverStopped = false
    await assert.rejects(
      startServer(
        moduleUrl(
          `export async function main() { return { ${port} async shutdown() { globalThis.serverStopped = true } } }`,
        ),
      ),
      /must report the port it bound/,
    )
    // A server that is already listening must not be left running.
    assert.equal(globalThis.serverStopped, true)
    delete globalThis.serverStopped
  })
}
