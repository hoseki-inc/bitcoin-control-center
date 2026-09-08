import { mkdtempSync, rmSync } from 'node:fs'
import { type AddressInfo, type Socket, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { Wallets } from '@hoseki/packages/testing'
import { createTRPCProxyClient, httpLink } from '@trpc/client'
import pino from 'pino'
import superjson from 'superjson'
import { expect, it, vi } from 'vitest'
import { initDatabase } from './db'
import type { Env } from './env'
import { main } from './main'
import type { AppRouter } from './modules/trpc/router'

const config = vi.hoisted(() => ({ env: {} as Env }))
vi.mock('./env', () => ({ loadEnv: () => config.env }))

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

it('starts with Electrum offline and recovers wallet balances and portfolio history without restarting Sentinel', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-startup-recovery-'))
  const sockets = new Set<Socket>()
  const requests: string[] = []
  const header = Buffer.alloc(80)
  header.writeUInt32LE(Math.floor(Date.now() / 1000) - 86400, 68)
  const wallet = Wallets.singlesigNativeSegwitAccount
  const address = wallet.address(0, 0)
  const scripthash = addressToScripthash(address).unwrap()
  const tx = new bitcoin.Transaction()
  tx.addInput(Buffer.alloc(32), 0xffffffff)
  tx.addOutput(bitcoin.address.toOutputScript(address.toString(), bitcoin.networks.bitcoin), 123456)
  const electrum = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let end: number
      while ((end = buffer.indexOf('\n')) >= 0) {
        const message = JSON.parse(buffer.slice(0, end)) as { id: number; method: string; params: unknown[] }
        buffer = buffer.slice(end + 1)
        requests.push(message.method)
        let result: unknown
        switch (message.method) {
          case 'server.version':
            result = ['Recovery test', '1.4']
            break
          case 'blockchain.headers.subscribe':
            result = { height: 900000, hex: header.toString('hex') }
            break
          case 'blockchain.block.header':
            result = header.toString('hex')
            break
          case 'blockchain.scripthash.get_history':
            result = message.params[0] === scripthash ? [{ tx_hash: tx.getId(), height: 899999 }] : []
            break
          case 'blockchain.scripthash.get_balance':
            result = { confirmed: message.params[0] === scripthash ? 123456 : 0, unconfirmed: 0 }
            break
          case 'blockchain.transaction.get':
            result = tx.toHex()
            break
          default:
            socket.write(
              `${JSON.stringify({ id: message.id, error: { code: -32601, message: 'Unsupported test method' } })}\n`,
            )
            continue
        }
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n`)
      }
    })
  })
  let server: Awaited<ReturnType<typeof main>> | undefined
  const previousSignals = { SIGINT: process.listeners('SIGINT'), SIGTERM: process.listeners('SIGTERM') }
  const nativeFetch = globalThis.fetch
  // Only the unrelated public market-price request is stubbed. HTTP, SQLite,
  // wallet discovery, Electrum reconnection and history backfill are real.
  vi.stubGlobal('fetch', ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(input).startsWith('https://api.coingecko.com/'))
      return Promise.resolve(Response.json({ bitcoin: { usd: 50000 } }))
    return nativeFetch(input, init)
  }) as typeof fetch)
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'silent')
  try {
    const electrumPort = await unusedPort()
    const apiPort = await unusedPort()
    config.env = {
      HOST: '127.0.0.1',
      PORT: apiPort,
      ELECTRUM_HOST: '127.0.0.1',
      ELECTRUM_PORT: electrumPort,
      ELECTRUM_PROTOCOL: 'tcp',
      BITCOIN_NETWORK: 'mainnet',
      DATA_DIR: directory,
      APP_DIR: directory,
      MEMPOOL_API_URL: 'http://127.0.0.1',
      LOG_LEVEL: 'silent',
    }
    const database = initDatabase(directory, pino({ level: 'silent' }))
    database.db
      .prepare('INSERT INTO accounts (id, descriptor, display_name) VALUES (?, ?, ?)')
      .run('wallet', wallet.toString(), 'Recovery wallet')
    database.close()
    server = await main()
    const client = createTRPCProxyClient<AppRouter>({
      transformer: superjson,
      links: [httpLink({ url: `http://127.0.0.1:${apiPort}/trpc` })],
    })
    expect((await fetch(`http://127.0.0.1:${apiPort}/health`)).status).toBe(200)
    expect(await client.portalProve.registry.claims.list.query({ excludePending: false })).toHaveLength(1)
    await expect(client.portalProve.onchain.claimBalances.query({ claimIds: ['wallet'] })).rejects.toThrow()
    const offline = await client.portalProve.controlCenter.getData.query({ timeRange: 'all' })
    expect(offline.historyFailedAccountIds).toContain('wallet')

    await new Promise<void>((resolve, reject) =>
      electrum.once('error', reject).listen(electrumPort, '127.0.0.1', resolve),
    )
    const balances = await client.portalProve.onchain.claimBalances.query({ claimIds: ['wallet'] })
    expect(balances.get('wallet')?.toString()).toBe('123456')
    await vi.waitFor(
      async () => {
        const history = await client.portalProve.controlCenter.getData.query({ timeRange: 'all' })
        expect(history.currentTotalBalance).toBe('123456')
        expect(history.historyFailedAccountIds).toEqual([])
        expect(history.historySyncingAccountIds).toEqual([])
        expect(history.historySyncedAccountIds).toContain('wallet')
        expect(history.historicalData.some((point) => point.totalBalance === '123456')).toBe(true)
      },
      { timeout: 10000, interval: 100 },
    )
    expect(requests).toContain('blockchain.transaction.get')
    expect(requests.filter((method) => method === 'server.version')).toHaveLength(1)
  } finally {
    await server?.shutdown()
    for (const socket of sockets) socket.destroy()
    if (electrum.listening) await new Promise<void>((resolve) => electrum.close(() => resolve()))
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      for (const listener of process.listeners(signal))
        if (!previousSignals[signal].includes(listener)) process.removeListener(signal, listener)
    }
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  }
}, 20000)
