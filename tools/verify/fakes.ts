import { appendFileSync, mkdirSync } from 'node:fs'
import {
  type Server as HttpServer,
  type IncomingMessage,
  type ServerResponse,
  createServer as createHttpServer,
} from 'node:http'
import { type Socket, type Server as TcpServer, createServer as createTcpServer } from 'node:net'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { readArgs } from './args'
import {
  type ChainIndex,
  type PriceHistory,
  type PricePoint,
  blockHeader,
  blockTime,
  currentPrice,
  indexChain,
  priceHistory,
  scriptAddress,
  tipHeight,
} from './chain'
import { faultedAnswer } from './rules'
import {
  type FaultTarget,
  type Faults,
  FaultsSchema,
  NO_FAULTS,
  boundPort,
  fail,
  readJsonFile,
  runPaths,
  wait,
  writeJson,
} from './run'

// Local stand-ins for the Electrum server and the mempool API, serving the synthetic chain and prices in chain.ts.
// Started by launch.ts. Every request is logged; UNHANDLED and ERROR lines are requests the fakes could not serve,
// which the doctor's `fake coverage` check reports. `helpers/verify fault` makes them fail on purpose: FAULT lines are
// requests they failed that way.

const { values: fakeArgs } = readArgs({ run: { type: 'string' }, 'release-tag': { type: 'string' } })
const runId = fakeArgs.run ?? fail('Usage: fakes.ts --run <id> [--release-tag <tag>]')
const releaseTag = fakeArgs['release-tag'] ?? 'v0.0.0_0'
const paths = runPaths(runId)
mkdirSync(paths.logsDir, { recursive: true })

function log(line: string): void {
  appendFileSync(paths.requestLog, `${new Date().toISOString()} ${line}\n`)
}

let faults = NO_FAULTS

interface ChainView {
  tip: number
  index: ChainIndex
}

/** Rebuilt for each request: the tip follows the clock, and the chain is small. */
function chain(): ChainView {
  const tip = tipHeight()
  return { tip, index: indexChain(tip) }
}

const RpcRequestSchema = z.object({
  id: z.union([z.number(), z.string(), z.null()]).optional(),
  method: z.string(),
  params: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])).default([]),
})
type RpcRequest = z.infer<typeof RpcRequestSchema>
const RpcMessageSchema = z.union([RpcRequestSchema, z.array(RpcRequestSchema)])

type RpcAnswer =
  | { result: string | null | object; error?: never }
  | { result?: never; error: { code: number; message: string } }

const UNHANDLED = -32601

function electrum({ method, params }: RpcRequest): RpcAnswer {
  const { tip, index } = chain()
  const first = String(params[0] ?? '')
  switch (method) {
    case 'server.version':
      return { result: ['Verify fake Electrum', '1.4'] }
    case 'server.ping':
      return { result: null }
    case 'blockchain.headers.subscribe':
      return { result: { height: tip, hex: blockHeader(tip) } }
    case 'blockchain.block.header': {
      const height = Number(params[0])
      return Number.isInteger(height) && height >= 0 && height <= tip
        ? { result: blockHeader(height) }
        : { error: { code: 1, message: `No block at height ${first}` } }
    }
    case 'blockchain.scripthash.get_history':
      return { result: index.history.get(first) ?? [] }
    case 'blockchain.scripthash.listunspent':
      return { result: index.unspent.get(first) ?? [] }
    case 'blockchain.scripthash.get_balance': {
      const confirmed = (index.unspent.get(first) ?? []).reduce((sum, utxo) => sum + utxo.value, 0)
      return { result: { confirmed, unconfirmed: 0 } }
    }
    case 'blockchain.transaction.get': {
      if (params[1] === true) {
        return { error: { code: 2, message: 'Verbose transactions are not supported' } }
      }
      const entry = index.byTxid.get(first)
      return entry ? { result: entry.hex } : { error: { code: 2, message: 'No such transaction' } }
    }
    default:
      return { error: { code: UNHANDLED, message: `Unhandled method ${method}` } }
  }
}

const FAULT_ERROR = { code: -32603, message: 'Verify fault: the server failed this request' }

async function answer(socket: Socket, line: string): Promise<void> {
  let message: unknown
  try {
    message = JSON.parse(line)
  } catch {
    log('electrum UNHANDLED unparseable request')
    return
  }
  const parsed = parseUnknown(RpcMessageSchema, message)
  if (parsed.isErr()) {
    log('electrum UNHANDLED request shape')
    return
  }
  const requests = parsed.unwrap()
  const mode = faults.electrum
  const answers = [requests]
    .flat()
    .map((request) => ({ request, fault: faultedAnswer('electrum', mode, request.method) }))
  await wait(Math.max(0, ...answers.map(({ fault }) => fault.delayMs)))
  const responses = answers.map(({ request, fault }) => {
    const response: RpcAnswer = fault.fail ? { error: FAULT_ERROR } : electrum(request)
    const outcome =
      response.error === undefined
        ? ''
        : fault.fail
          ? ` FAULT ${mode}`
          : response.error.code === UNHANDLED
            ? ' UNHANDLED'
            : ' ERROR'
    log(`electrum ${request.method}${outcome}`)
    return Object.assign({ jsonrpc: '2.0', id: request.id ?? null }, response)
  })
  if (!socket.destroyed) {
    socket.write(`${JSON.stringify(Array.isArray(requests) ? responses : responses[0])}\n`)
  }
}

const sockets = new Set<Socket>()
const electrumServer = createTcpServer((socket) => {
  sockets.add(socket)
  socket.on('close', () => {
    sockets.delete(socket)
  })
  socket.on('error', () => undefined)
  let buffer = ''
  socket.on('data', (chunk) => {
    buffer += chunk.toString()
    for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
      void answer(socket, buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
    }
  })
})

/** The subset of mempool's /api/tx/{txid} that Sentinel reads. */
interface MempoolTx {
  txid: string
  vin: Array<{
    txid: string
    vout: number
    is_coinbase: boolean
    prevout: { scriptpubkey_address: string | undefined; value: number } | null
  }>
  vout: Array<{ scriptpubkey_address: string | undefined; value: number }>
  status: { confirmed: boolean; block_height: number; block_time: number }
}

function mempoolTransaction(txid: string): MempoolTx | null {
  const { index } = chain()
  const entry = index.byTxid.get(txid)
  if (entry === undefined) {
    return null
  }
  return {
    txid,
    vin: entry.tx.ins.map((input) => {
      const parentId = Buffer.from(input.hash).reverse().toString('hex')
      if (input.index === 0xffffffff && /^0+$/.test(parentId)) {
        return { txid: parentId, vout: input.index, is_coinbase: true, prevout: null }
      }
      const spent = index.byTxid.get(parentId)?.tx.outs[input.index]
      return {
        txid: parentId,
        vout: input.index,
        is_coinbase: false,
        prevout: spent ? { scriptpubkey_address: scriptAddress(Buffer.from(spent.script)), value: spent.value } : null,
      }
    }),
    vout: entry.tx.outs.map((output) => ({
      scriptpubkey_address: scriptAddress(Buffer.from(output.script)),
      value: output.value,
    })),
    status: { confirmed: true, block_height: entry.height, block_time: blockTime(entry.height) },
  }
}

async function mempool(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://fake.invalid')
  const mode = faults.mempool
  const fault = faultedAnswer('mempool', mode, url.pathname)
  await wait(fault.delayMs)
  if (fault.fail) {
    log(`mempool ${request.method ?? 'GET'} ${url.pathname} 500 FAULT ${mode}`)
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'Verify fault: the server failed this request' }))
    return
  }
  const send = (
    status: number,
    body: MempoolTx | PricePoint | PriceHistory | { tag: string } | { error: string },
  ): void => {
    log(`mempool ${request.method ?? 'GET'} ${url.pathname} ${status}${status >= 400 ? ' ERROR' : ''}`)
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(body))
  }
  const transaction = /^\/api\/tx\/([0-9a-f]{64})$/.exec(url.pathname)
  if (url.pathname === '/api/v1/prices') {
    send(200, currentPrice())
  } else if (url.pathname === '/api/v1/historical-price') {
    send(200, priceHistory())
  } else if (url.pathname === '/latest.json') {
    send(200, { tag: releaseTag })
  } else if (transaction?.[1] !== undefined) {
    const body = mempoolTransaction(transaction[1])
    send(body === null ? 404 : 200, body ?? { error: 'Transaction not found' })
  } else {
    log(`mempool ${request.method ?? 'GET'} ${url.pathname} UNHANDLED`)
    response.writeHead(404).end()
  }
}

const mempoolServer = createHttpServer((request, response) => {
  void mempool(request, response)
})

await new Promise<void>((done) => {
  electrumServer.listen(0, '127.0.0.1', done)
})
await new Promise<void>((done) => {
  mempoolServer.listen(0, '127.0.0.1', done)
})
const ports = {
  electrumPort: boundPort(electrumServer.address()),
  mempoolPort: boundPort(mempoolServer.address()),
}
writeJson(paths.fakesFile, ports)
log('fakes ready')

const servers: Record<FaultTarget, { server: TcpServer | HttpServer; port: number }> = {
  electrum: { server: electrumServer, port: ports.electrumPort },
  mempool: { server: mempoolServer, port: ports.mempoolPort },
}

/** `down` stops listening and drops open connections, so clients see the connection refused; any other mode listens. */
async function setListening(target: FaultTarget, listening: boolean): Promise<void> {
  const { server, port } = servers[target]
  if (server.listening === listening) {
    return
  }
  if (listening) {
    await new Promise<void>((done) => {
      server.listen(port, '127.0.0.1', done)
    })
    return
  }
  const closed = new Promise<void>((done) => {
    server.close(() => {
      done()
    })
  })
  if (target === 'electrum') {
    for (const socket of sockets) {
      socket.destroy()
    }
  } else {
    mempoolServer.closeAllConnections()
  }
  await closed
}

// The fault command writes faults.json; the fakes poll it, act on each new change, then confirm it in
// faults-applied.json, which the command waits for.
let applying = false

async function applyFaults(next: Faults): Promise<void> {
  try {
    await Promise.all([
      setListening('electrum', next.electrum !== 'down'),
      setListening('mempool', next.mempool !== 'down'),
    ])
    faults = next
    writeJson(paths.appliedFaultsFile, next)
    log(`fault ${next.seq}: electrum ${next.electrum}, mempool ${next.mempool}`)
  } catch (error) {
    log(`fault ${next.seq} ERROR ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    applying = false
  }
}

setInterval(() => {
  const requested = readJsonFile(FaultsSchema, paths.faultsFile)
  if (applying || requested.status !== 'ok' || requested.value.seq === faults.seq) {
    return
  }
  applying = true
  void applyFaults(requested.value)
}, 200)

function stop(): void {
  for (const socket of sockets) {
    socket.destroy()
  }
  electrumServer.close()
  mempoolServer.close()
  process.exit(0)
}
process.once('SIGTERM', stop)
process.once('SIGINT', stop)
