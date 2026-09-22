import assert from 'node:assert/strict'
import { test } from 'node:test'
import { startServer } from '../src/server.ts'

/** @param {string} source */
function moduleUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

void test('starts the bundled server and preserves the shutdown receiver', async () => {
  const server = await startServer(
    moduleUrl(`
    export async function main() {
      return { token: 'server', async shutdown() {
        if (this.token !== 'server') throw new Error('Lost the server receiver')
      } }
    }
  `),
  )
  await server.shutdown()
})

void test('awaits asynchronous shutdown and propagates its failure', async () => {
  const server = await startServer(
    moduleUrl(`
    export async function main() { return { async shutdown() {
      await new Promise(resolve => setTimeout(resolve, 0))
      throw new Error('Shutdown failed')
    } } }
  `),
  )
  await assert.rejects(server.shutdown(), /Shutdown failed/)
})

void test('propagates startup failure', async () => {
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
  void test(`rejects a missing or invalid entry point: ${source}`, async () => {
    await assert.rejects(startServer(moduleUrl(source)), /must export a main function/)
  })
}
for (const value of ['null', '{}', '{ shutdown: 1 }']) {
  void test(`rejects an invalid server handle: ${value}`, async () => {
    await assert.rejects(
      startServer(moduleUrl(`export async function main() { return ${value} }`)),
      /must provide a shutdown function/,
    )
  })
}
