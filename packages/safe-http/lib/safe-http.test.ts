import http from 'node:http'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { parseUnknown } from '../../result/index.ts'
import { SafeBodyErrorKind, SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import { safeHttp } from './safe-http.ts'

const url = 'https://example.com'

async function startSilentServer(options: { sendHeaders: boolean }): Promise<string> {
  const server = http.createServer((_req, res) => {
    if (options.sendHeaders) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.write('{"partial":')
    }
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve()
    })
  })
  onTestFinished(async () => {
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

describe('SafeHttp', () => {
  const originalFetch = global.fetch
  async function withTestSetup(run: () => Promise<void>): Promise<void> {
    // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
    onTestFinished(async () => {
      global.fetch = originalFetch
    })

    await run()
  }

  it('returns safe response', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response())
      const response = await safeHttp.get(url)
      expect(response.unwrap()).toBeInstanceOf(SafeResponse)
    })
  })

  it('aborts a silent request after the default timeout unless the caller passes a signal', async () => {
    await withTestSetup(async () => {
      const silentUrl = await startSilentServer({ sendHeaders: false })
      const requested = shortenDefaultTimeout()

      const timedOut = await safeHttp.get(silentUrl)
      expect(requested).toEqual([30_000])
      expect(timedOut.expectErr('default timeout').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)

      const controller = new AbortController()
      const reason = new Error('caller aborted')
      setTimeout(() => {
        controller.abort(reason)
      }, 200)
      const callerAborted = await safeHttp.get(silentUrl, { signal: controller.signal })
      const error = callerAborted.expectErr('caller abort')
      expect(error.kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
      expect(error.kind.cause).toBe(reason)
    })
  })

  it('fails the body read when a reply stalls after its headers', async () => {
    await withTestSetup(async () => {
      const silentUrl = await startSilentServer({ sendHeaders: true })
      shortenDefaultTimeout()
      const response = (await safeHttp.get(silentUrl)).expect('headers arrive')
      const body = await response.text()
      expect(body.expectErr('stalled body').kind).toEqual(SafeBodyErrorKind.Unreadable)
    })
  })

  it('returns error when network is unreachable', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const response = await safeHttp.get(url)
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
    })
  })

  it('returns error when response is not ok', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false })
      const response = await safeHttp.get(url)
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.ErrorResponse)
    })
  })
})
