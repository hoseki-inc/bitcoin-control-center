import * as net from 'node:net'
import { SocksClient } from 'socks'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { Err, parseUnknown } from '../../../result'
import { ElectrumClient } from './client'
import { ElectrumTransport, shouldVerifyElectrumTlsCertificate } from './protocol'

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
      const errors = results.filter((r) => r.isErr()).map((r) => r.unwrapErr().message)
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
      await new Promise((resolve) => {
        setTimeout(resolve, 50)
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
    expect((await pending).unwrapErr().message).toBe('Connection closed')
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
    expect((await pending).unwrapErr().message).toBe('Connection closed')
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
      expect((await pending).unwrapErr().message).toBe('Connection closed')
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
      expect((await client.connect()).unwrapErr().message).toBe('The Tor proxy is not ready')
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
    expect((await client.connect()).unwrapErr().message).toBe('Tor is unavailable')
    expect(proxy).not.toHaveBeenCalled()
    client.disconnect()
    proxy.mockRestore()
  })
})
