import * as net from 'node:net'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import { parseUnknown } from '../../../result'
import { ElectrumClient } from './client'
import { shouldVerifyElectrumTlsCertificate } from './protocol'

interface MockServer {
  port: number
  requests: string[]
  close: () => Promise<void>
}

async function startMockServer(): Promise<MockServer> {
  const requests: string[] = []

  const server = net.createServer((socket) => {
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
