import * as net from 'node:net'
import { SocksClient } from 'socks'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { Err, parseUnknown } from '../../../result'
import { ElectrumClient } from './client'
import { ElectrumServerError, ElectrumTransport, shouldVerifyElectrumTlsCertificate } from './protocol'

interface MockServer {
  port: number
  requests: string[]
  /** Close every client socket, as a server does after an idle timeout. */
  dropClients: () => void
  close: () => Promise<void>
}

async function startMockServer(): Promise<MockServer> {
  const requests: string[] = []
  const sockets = new Set<net.Socket>()

  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => {
      sockets.delete(socket)
    })
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', (chunk: string) => {
      buffer += chunk
      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (line.length === 0) {
          continue
        }
        requests.push(line)
        // SAFETY: Socket input is arbitrary text; the JSON-RPC request schema below validates its shape.
        const req = parseUnknown(
          z.object({ id: z.number(), method: z.string(), params: z.array(z.unknown()) }),
          JSON.parse(line) as unknown,
        ).expect('valid JSON-RPC test request')
        const result =
          req.method === 'server.version'
            ? ['MockElectrum 1.0', '1.4']
            : req.method === 'blockchain.scripthash.get_history'
              ? [{ tx_hash: 'a'.repeat(64), height: 800000 }]
              : // Some servers answer ping with something other than the protocol's null.
                req.method === 'server.ping'
                ? 'pong'
                : null
        socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: req.id, result })}\n`)
      }
    })
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = parseUnknown(z.object({ port: z.number() }), server.address()).expect('Expected a TCP listener')
  const port = address.port

  return {
    port,
    requests,
    dropClients: () => {
      for (const socket of sockets) {
        socket.destroy()
      }
    },
    close: async () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      }),
  }
}

describe('ElectrumClient concurrent reconnect', () => {
  let mock: MockServer

  async function withTestSetup(run: () => Promise<void>): Promise<void> {
    const pendingMock = startMockServer()
    const lifecycle = { finished: false }
    // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
    onTestFinished(async () => {
      lifecycle.finished = true

      const serverForTest = await pendingMock
      await serverForTest.close()
    })
    const serverForTest = await pendingMock
    if (lifecycle.finished) {
      return
    }
    mock = serverForTest

    await run()
  }

  it('shares a single connect across concurrent callers from cold start', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp' })

      const scripthash = 'a'.repeat(64)
      const results = await Promise.all(Array.from({ length: 10 }, () => client.getHistory(scripthash)))

      for (const r of results) {
        expect(r.isOk()).toBe(true)
      }

      const versionCalls = mock.requests.filter((r) => r.includes('server.version')).length
      expect(versionCalls).toBe(1)

      client.disconnect()
    })
  })

  it('reconnects cleanly after an explicit disconnect under concurrency', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp' })
      const scripthash = 'a'.repeat(64)

      const first = await client.getHistory(scripthash)
      expect(first.isOk()).toBe(true)

      client.disconnect()

      const results = await Promise.all(Array.from({ length: 10 }, () => client.getHistory(scripthash)))
      const errors = results.filter((r) => r.isErr()).map((r) => r.expectErr('Expected failed result').message)
      expect(errors).toEqual([])

      const versionCalls = mock.requests.filter((r) => r.includes('server.version')).length
      expect(versionCalls).toBe(2)

      client.disconnect()
    })
  })

  it('stays reachable when the server closes an idle socket, and reconnects on the next request', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp' })
      expect(client.isReachable()).toBe(false)
      expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)

      mock.dropClients()
      await vi.waitFor(() => {
        expect(client.isConnected()).toBe(false)
      })
      expect(client.isReachable()).toBe(true)

      expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)
      expect(client.isConnected()).toBe(true)
      client.disconnect()
      expect(client.isReachable()).toBe(false)
    })
  })

  it('pings at most once per interval, reconnecting an idle socket, and notices when the server is gone', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp', connectTimeout: 1000 })
      const pings = (): number => mock.requests.filter((r) => r.includes('server.ping')).length
      client.checkReachable(60_000)
      client.checkReachable(60_000)
      await vi.waitFor(() => {
        expect(client.isReachable()).toBe(true)
      })
      client.checkReachable(60_000)
      expect(pings()).toBe(1)

      mock.dropClients()
      await mock.close()
      await vi.waitFor(() => {
        client.checkReachable(0)
        expect(client.isReachable()).toBe(false)
      })
    })
  })

  it('reports a connection attempt while it is in progress', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp' })
      const attempt = client.connect()
      expect(client.isConnecting()).toBe(true)
      expect((await attempt).isOk()).toBe(true)
      expect(client.isConnecting()).toBe(false)
      client.disconnect()
    })
  })

  it('reports only the first attempt as connecting, and times checks from when they finish', async () => {
    await withTestSetup(async () => {
      let attempts = 0
      let finishAttempt: () => void = () => undefined
      const client = new ElectrumClient({
        host: '127.0.0.1',
        port: mock.port,
        protocol: 'tcp',
        // Stands in for a Tor start that takes a while and then fails.
        beforeConnect: async () => {
          attempts += 1
          await new Promise<void>((resolve) => {
            finishAttempt = resolve
          })
          return Err(new Error('Tor is unavailable'))
        },
      })
      const first = client.connect()
      expect(client.isConnecting()).toBe(true)
      finishAttempt()
      expect((await first).isErr()).toBe(true)

      // A background retry during the outage is not a first connection.
      client.checkReachable(0)
      await vi.waitFor(() => {
        expect(attempts).toBe(2)
      })
      expect(client.isConnecting()).toBe(false)
      // The attempt took a while: move the clock on, so timing from its start would allow another.
      const started = performance.now()
      const clock = vi.spyOn(performance, 'now').mockReturnValue(started + 50)
      onTestFinished(() => {
        clock.mockRestore()
      })
      finishAttempt()
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
      // The slow check ended just now, so another one waits for the full interval.
      client.checkReachable(40)
      expect(attempts).toBe(2)
      expect(client.isReachable()).toBe(false)
      client.disconnect()
    })
  })

  it('reports the server unreachable once reconnecting fails', async () => {
    await withTestSetup(async () => {
      const client = new ElectrumClient({ host: '127.0.0.1', port: mock.port, protocol: 'tcp', connectTimeout: 1000 })
      expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)

      mock.dropClients()
      await mock.close()
      await vi.waitFor(() => {
        expect(client.isConnected()).toBe(false)
      })
      expect(client.isReachable()).toBe(true)
      expect((await client.getHistory('a'.repeat(64))).isErr()).toBe(true)
      expect(client.isReachable()).toBe(false)
    })
  })
})

describe('Electrum TLS verification policy', () => {
  it('verifies public SSL Electrum hosts by default', () => {
    expect(shouldVerifyElectrumTlsCertificate('electrum.blockstream.info')).toBe(true)
    expect(shouldVerifyElectrumTlsCertificate('electrum.mempool.space')).toBe(true)
  })

  it('allows self-signed TLS for local/private hosts by default', () => {
    expect(shouldVerifyElectrumTlsCertificate('localhost')).toBe(false)
    expect(shouldVerifyElectrumTlsCertificate('127.0.0.1')).toBe(false)
    expect(shouldVerifyElectrumTlsCertificate('192.168.1.10')).toBe(false)
    expect(shouldVerifyElectrumTlsCertificate('electrs.embassy')).toBe(false)
  })

  it('honors explicit TLS verification overrides', () => {
    expect(shouldVerifyElectrumTlsCertificate('electrum.blockstream.info', false)).toBe(false)
    expect(shouldVerifyElectrumTlsCertificate('localhost', true)).toBe(true)
  })
})

it('cancels an unfinished SOCKS connection and closes a socket delivered after cancellation', async () => {
  let completeProxy!: (value: Awaited<ReturnType<typeof SocksClient.createConnection>>) => void
  const proxy = new Promise<Awaited<ReturnType<typeof SocksClient.createConnection>>>((resolve) => {
    completeProxy = resolve
  })
  const connect = vi.spyOn(SocksClient, 'createConnection').mockReturnValue(proxy)
  const transport = new ElectrumTransport({
    host: 'electrum.example',
    port: 50001,
    protocol: 'tcp',
    proxy: { host: '127.0.0.1', port: 9050 },
  })
  const lateSocket = new net.Socket()
  try {
    const pending = transport.connect()
    transport.disconnect()
    expect((await pending).expectErr('Expected failed result').message).toBe('Connection closed')
    completeProxy({ socket: lateSocket })
    await vi.waitFor(() => {
      expect(lateSocket.destroyed).toBe(true)
    })
    expect(transport.isConnected()).toBe(false)
  } finally {
    transport.disconnect()
    lateSocket.destroy()
    connect.mockRestore()
  }
})

describe('managed connection prerequisite', () => {
  it('cancels a connection waiting for readiness without opening a socket afterwards', async () => {
    const { Ok } = await import('@hoseki/packages/result')
    let ready!: (result: ReturnType<typeof Ok<undefined>>) => void
    const prerequisite = new Promise<ReturnType<typeof Ok<undefined>>>((resolve) => {
      ready = resolve
    })
    const socket = vi.spyOn(SocksClient, 'createConnection')
    const client = new ElectrumClient({
      host: 'example.invalid',
      port: 50001,
      protocol: 'tcp',
      beforeConnect: async () => prerequisite,
      proxy: { host: '127.0.0.1', port: 19450 },
    })
    const pending = client.connect()
    client.disconnect()
    ready(Ok(undefined))
    expect((await pending).expectErr('Expected failed result').message).toBe('Connection closed')
    expect(socket).not.toHaveBeenCalled()
    socket.mockRestore()
  })

  it('gives the SOCKS handshake the full connection limit and the proxy resolved when connecting', async () => {
    const connect = vi.spyOn(SocksClient, 'createConnection').mockReturnValue(new Promise(() => undefined))
    let port = 49321
    const transport = new ElectrumTransport({
      host: 'example.onion',
      port: 50001,
      protocol: 'tcp',
      connectTimeout: 60_000,
      proxy: { host: '127.0.0.1', port: 1 },
      resolveProxy: () => ({ host: '127.0.0.1', port }),
    })
    try {
      port = 49322
      const pending = transport.connect()
      expect(connect).toHaveBeenCalledOnce()
      const options = connect.mock.calls[0]?.[0]
      expect(options?.timeout).toBe(60_000)
      expect(options?.proxy.port).toBe(49322)
      transport.disconnect()
      expect((await pending).expectErr('Expected failed result').message).toBe('Connection closed')
    } finally {
      transport.disconnect()
      connect.mockRestore()
    }
  })

  it('never falls back to a direct connection when the resolved proxy is not ready', async () => {
    const server = await startMockServer()
    const proxy = vi.spyOn(SocksClient, 'createConnection')
    const client = new ElectrumClient({
      host: '127.0.0.1',
      port: server.port,
      protocol: 'tcp',
      resolveProxy: () => null,
    })
    try {
      expect((await client.connect()).expectErr('Expected failed result').message).toBe('The Tor proxy is not ready')
      expect(proxy).not.toHaveBeenCalled()
      expect(server.requests).toEqual([])
    } finally {
      client.disconnect()
      proxy.mockRestore()
      await server.close()
    }
  })

  it('does not open a direct or SOCKS socket when readiness fails', async () => {
    const proxy = vi.spyOn(SocksClient, 'createConnection')
    const client = new ElectrumClient({
      host: 'example.onion',
      port: 50001,
      protocol: 'tcp',
      proxy: { host: '127.0.0.1', port: 19450 },
      beforeConnect: async () => Err(new Error('Tor is unavailable')),
    })
    expect((await client.connect()).expectErr('Expected failed result').message).toBe('Tor is unavailable')
    expect(proxy).not.toHaveBeenCalled()
    client.disconnect()
    proxy.mockRestore()
  })
})

describe('connections that go silent, are busy, or answer with errors', () => {
  /** How the test server treats a request: answer it (optionally after a delay), ignore it, or return an error. */
  type Mode = { answer: number } | 'silent' | 'error'
  interface TestServer {
    port: number
    sockets: net.Socket[]
    /** Methods each connection received, by connection. */
    received: string[][]
    /** Methods each connection answered, by connection. */
    answered: string[][]
  }

  async function serverWith(
    mode: (method: string, connection: number) => Mode,
    closeAfterError = false,
  ): Promise<TestServer> {
    const sockets: net.Socket[] = []
    const received: string[][] = []
    const answered: string[][] = []
    const server = net.createServer((socket) => {
      sockets.push(socket)
      const connection = sockets.length - 1
      received.push([])
      answered.push([])
      socket.on('error', () => undefined)
      socket.setEncoding('utf8')
      socket.on('data', (chunk: string) => {
        for (const line of chunk.split('\n').filter(Boolean)) {
          // SAFETY: Socket input is arbitrary text; the request schema validates its shape.
          const req = parseUnknown(
            z.object({ id: z.number(), method: z.string() }),
            JSON.parse(line) as unknown,
          ).expect('valid JSON-RPC test request')
          received[connection]?.push(req.method)
          const how = mode(req.method, connection)
          if (how === 'silent') {
            continue
          }
          const body =
            how === 'error'
              ? { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: 'refused' } }
              : {
                  jsonrpc: '2.0',
                  id: req.id,
                  result: req.method === 'server.version' ? ['MockElectrum 1.0', '1.4'] : [],
                }
          const reply = (): void => {
            if (!socket.destroyed) {
              answered[connection]?.push(req.method)
              socket.write(`${JSON.stringify(body)}\n`)
            }
          }
          if (how === 'error') {
            reply()
            if (closeAfterError) {
              socket.end()
            }
          } else if (how.answer === 0) {
            reply()
          } else {
            setTimeout(reply, how.answer)
          }
        }
      })
    })
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve)
    })
    onTestFinished(async () => {
      for (const socket of sockets) {
        socket.destroy()
      }
      await new Promise<void>((resolve) => {
        server.close(() => {
          resolve()
        })
      })
    })
    const port = parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener').port
    return { port, sockets, received, answered }
  }
  const now: Mode = { answer: 0 }
  // The first connection goes silent after the handshake, like a laptop that slept; new ones work.
  const firstGoesSilent = (method: string, connection: number): Mode =>
    method === 'server.version' || connection > 0 ? now : 'silent'

  it('keeps a busy connection and its other requests when one request times out', async () => {
    // A server answering requests concurrently: one lookup never comes back, others arrive late but in time.
    const server = await serverWith((method) =>
      method === 'blockchain.scripthash.get_balance'
        ? 'silent'
        : method === 'blockchain.scripthash.listunspent'
          ? { answer: 300 }
          : now,
    )
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 400 })
    expect((await client.connect()).isOk()).toBe(true)
    const stuck = client.getBalance('a'.repeat(64))
    expect((await client.getHistory('b'.repeat(64))).isOk()).toBe(true)
    await new Promise((resolve) => {
      setTimeout(resolve, 200)
    })
    // Sent before the stuck lookup times out, answered after it.
    const late = client.listUnspent('c'.repeat(64))
    expect((await stuck).isErr()).toBe(true)
    expect((await late).isOk()).toBe(true)
    expect(server.sockets).toHaveLength(1)
    client.disconnect()
  })

  it('retries a status check on a fresh connection when the open one has gone silent', async () => {
    const server = await serverWith(firstGoesSilent)
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 200 })
    expect((await client.connect()).isOk()).toBe(true)
    client.checkReachable(0)
    await vi.waitFor(() => {
      expect(server.answered[1]).toContain('server.ping')
    })
    await vi.waitFor(() => {
      expect(client.isReachable()).toBe(true)
    })
    // The answer on the fresh connection decided the status: a retry that ignored it would leave it false.
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(client.isReachable()).toBe(true)
    expect(server.sockets).toHaveLength(2)
    client.disconnect()
  })

  it('reports a server that stops answering as unreachable', async () => {
    const server = await serverWith((method) => (method === 'server.version' ? now : 'silent'))
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 200 })
    expect((await client.connect()).isOk()).toBe(true)
    client.checkReachable(0)
    await vi.waitFor(() => {
      expect(client.isReachable()).toBe(false)
    })
    expect(server.sockets.length).toBeGreaterThan(1)
    client.disconnect()
  })

  it('does not count the reconnect handshake as an answer when the ping goes unanswered', async () => {
    const server = await serverWith((method) => (method === 'server.version' ? now : 'silent'))
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 200 })
    expect((await client.connect()).isOk()).toBe(true)
    // The server closes the idle connection, so the check reconnects and the handshake is answered.
    server.sockets[0]?.destroy()
    await vi.waitFor(() => {
      expect(client.isConnected()).toBe(false)
    })
    client.checkReachable(0)
    await vi.waitFor(() => {
      expect(server.received[1]).toContain('server.ping')
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 400)
    })
    expect(client.isReachable()).toBe(false)
    client.disconnect()
  })

  it('treats a retried ping that times out while other answers arrive as a busy, reachable server', async () => {
    // The first connection goes silent; on the fresh one, pings go unanswered but wallet requests work.
    const server = await serverWith((method, connection) =>
      method === 'server.version' || (connection > 0 && method !== 'server.ping') ? now : 'silent',
    )
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 300 })
    expect((await client.connect()).isOk()).toBe(true)
    client.checkReachable(0)
    await vi.waitFor(() => {
      expect(server.received[1]).toContain('server.ping')
    })
    expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)
    await new Promise((resolve) => {
      setTimeout(resolve, 400)
    })
    expect(client.isReachable()).toBe(true)
    expect(server.sockets).toHaveLength(2)
    client.disconnect()
  })

  it('does not reopen a connection when the client is disconnected during a check', async () => {
    const server = await serverWith(firstGoesSilent)
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 200 })
    expect((await client.connect()).isOk()).toBe(true)
    client.checkReachable(0)
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    client.disconnect()
    await new Promise((resolve) => {
      setTimeout(resolve, 600)
    })
    expect(server.sockets).toHaveLength(1)
    expect(client.isReachable()).toBe(false)
  })

  it('replaces a silent connection after a data request times out', async () => {
    const server = await serverWith(firstGoesSilent)
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp', requestTimeout: 150 })
    expect((await client.connect()).isOk()).toBe(true)
    expect((await client.getHistory('a'.repeat(64))).isErr()).toBe(true)
    expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)
    expect(server.sockets).toHaveLength(2)
    client.disconnect()
  })

  it('treats an error answer to the ping as a reachable server and keeps the connection', async () => {
    const server = await serverWith((method) => (method === 'server.ping' ? 'error' : now))
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp' })
    expect((await client.connect()).isOk()).toBe(true)
    client.disconnect()
    expect(client.isReachable()).toBe(false)
    client.checkReachable(0)
    await vi.waitFor(() => {
      expect(server.answered.flat()).toContain('server.ping')
    })
    await vi.waitFor(() => {
      expect(client.isReachable()).toBe(true)
    })
    expect((await client.getHistory('a'.repeat(64))).isOk()).toBe(true)
    expect(server.sockets).toHaveLength(2)
    client.disconnect()
  })

  for (const [label, keepOpen] of [
    ['closes the connection', false],
    ['keeps the connection open', true],
  ] as const) {
    it(`reports a server that refuses the handshake and ${label} as unreachable`, async () => {
      const server = await serverWith((method) => (method === 'server.version' ? 'error' : now), !keepOpen)
      const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp' })
      const first = await client.connect()
      expect(first.isErr()).toBe(true)
      expect(first.expectErr('Expected failed result')).not.toBeInstanceOf(ElectrumServerError)
      expect(first.expectErr('Expected failed result').message).toBe(
        'Electrum handshake failed: Electrum error [-32601]: refused',
      )
      client.checkReachable(0)
      await vi.waitFor(() => {
        expect(server.received.flat().filter((method) => method === 'server.version').length).toBeGreaterThan(1)
      })
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
      })
      expect(client.isReachable()).toBe(false)
      // A refused handshake never leaves a half-open connection for later requests to use.
      expect(client.isConnected()).toBe(false)
      client.disconnect()
    })
  }

  it('keeps checking after the system clock moves backwards', async () => {
    const server = await serverWith(() => now)
    const client = new ElectrumClient({ host: '127.0.0.1', port: server.port, protocol: 'tcp' })
    expect((await client.connect()).isOk()).toBe(true)
    client.checkReachable(30_000)
    await vi.waitFor(() => {
      expect(server.answered.flat().filter((method) => method === 'server.ping')).toHaveLength(1)
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    // The clock jumps back an hour while 31 seconds really pass.
    vi.useFakeTimers({ toFake: ['Date'] })
    onTestFinished(() => {
      vi.useRealTimers()
    })
    vi.setSystemTime(Date.now() - 60 * 60 * 1000)
    const clock = vi.spyOn(performance, 'now').mockReturnValue(performance.now() + 31_000)
    onTestFinished(() => {
      clock.mockRestore()
    })
    client.checkReachable(30_000)
    await vi.waitFor(() => {
      expect(server.received.flat().filter((method) => method === 'server.ping')).toHaveLength(2)
    })
    client.disconnect()
  })
})
