import http from 'node:http'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import pino, { type Logger } from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { StrikeResponseError, StrikeTransportError, getStrikeBtcBalance, validateStrikeApiKey } from './strike'

async function startSilentServer(options: { sendHeaders: boolean }): Promise<string> {
  const fallbacks = new Set<ReturnType<typeof setTimeout>>()
  const server = http.createServer((_req, res) => {
    if (options.sendHeaders) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.flushHeaders()
      res.write('[')
    }
    const body = options.sendHeaders
      ? '{"currency":"BTC","total":"1","available":"1"}]'
      : '[{"currency":"BTC","total":"1","available":"1"}]'
    const fallback = setTimeout(() => {
      if (!options.sendHeaders) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
      }
      res.end(body)
    }, 1500)
    fallbacks.add(fallback)
    res.once('close', () => {
      clearTimeout(fallback)
      fallbacks.delete(fallback)
    })
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  onTestFinished(async () => {
    for (const fallback of fallbacks) {
      clearTimeout(fallback)
    }
    fallbacks.clear()
    server.closeAllConnections()
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
  })
  const { port } = parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener')
  return `http://127.0.0.1:${port}`
}

function shortenDefaultTimeout(): number[] {
  const requested: number[] = []
  const realTimeout = AbortSignal.timeout.bind(AbortSignal)
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    requested.push(ms)
    return realTimeout(50)
  })
  onTestFinished(() => {
    spy.mockRestore()
  })
  return requested
}

describe('Strike client timeout', () => {
  it.each([
    {
      behavior: 'sends nothing',
      sendHeaders: false,
      expectedError: StrikeTransportError,
      call: (logger: Logger) => validateStrikeApiKey('test-key', logger),
    },
    {
      behavior: 'sends headers then goes quiet',
      sendHeaders: true,
      expectedError: StrikeResponseError,
      call: (logger: Logger) => getStrikeBtcBalance('test-key', logger),
    },
  ])('times out when Strike $behavior', async ({ sendHeaders, expectedError, call }) => {
    const silentUrl = await startSilentServer({ sendHeaders })
    const realFetch = globalThis.fetch
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (input === 'https://api.strike.me/v1/balances') {
        return realFetch(`${silentUrl}/v1/balances`, init)
      }
      return realFetch(input, init)
    })
    onTestFinished(() => {
      fetchSpy.mockRestore()
    })
    const requested = shortenDefaultTimeout()
    const logger = pino({ level: 'silent' })

    const result = await call(logger)

    expect(result.expectErr('timed out request')).toBeInstanceOf(expectedError)
    expect(requested).toEqual([30_000])
  })
})
