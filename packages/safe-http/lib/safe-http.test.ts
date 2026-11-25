import http from 'node:http'
import v8 from 'node:v8'
import vm from 'node:vm'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { parseUnknown } from '../../result/index.ts'
import { SafeBodyErrorKind, SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import { safeHttp } from './safe-http.ts'

const url = 'https://example.com'

interface SilentServer {
  url: string
  nextRequest: () => Promise<void>
}

async function startSilentServer(options: { sendHeaders: boolean }): Promise<SilentServer> {
  let pendingArrivals = 0
  const waiters: Array<() => void> = []

  const server = http.createServer((_req, res) => {
    const waiter = waiters.shift()
    if (waiter !== undefined) {
      waiter()
    } else {
      pendingArrivals += 1
    }
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
    const closed = new Promise<void>((resolve) => {
      server.close(() => {
        resolve()
      })
    })
    server.closeAllConnections()
    await closed
  })
  const { port } = parseUnknown(z.object({ port: z.number() }), server.address()).expect('TCP listener')
  return {
    url: `http://127.0.0.1:${port}`,
    nextRequest: async () => {
      if (pendingArrivals > 0) {
        pendingArrivals -= 1
        return
      }
      await new Promise<void>((resolve) => {
        waiters.push(resolve)
      })
    },
  }
}

interface StubbedTimeout {
  requested: number[]
  fire: () => void
}

function stubDefaultTimeout(): StubbedTimeout {
  const requested: number[] = []
  const controllers: AbortController[] = []
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
    requested.push(ms)
    const controller = new AbortController()
    controllers.push(controller)
    return controller.signal
  })
  onTestFinished(() => {
    spy.mockRestore()
  })
  return {
    requested,
    fire: () => {
      for (const controller of controllers) {
        if (!controller.signal.aborted) {
          controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))
        }
      }
    },
  }
}

function getGc(): () => void {
  v8.setFlagsFromString('--expose-gc')
  return parseUnknown(z.function({ input: [], output: z.void() }), vm.runInNewContext('gc')).expect(
    'gc exposed by --expose-gc',
  )
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
      const server = await startSilentServer({ sendHeaders: false })
      const timeout = stubDefaultTimeout()

      const pendingTimeout = safeHttp.get(server.url)
      await server.nextRequest()
      timeout.fire()
      const timedOut = await pendingTimeout
      expect(timeout.requested).toEqual([30_000])
      expect(timedOut.expectErr('default timeout').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)

      const controller = new AbortController()
      const reason = new Error('caller aborted')
      const pendingCaller = safeHttp.get(server.url, { signal: controller.signal })
      await server.nextRequest()
      expect(timeout.requested).toEqual([30_000])
      controller.abort(reason)
      const callerAborted = await pendingCaller
      const error = callerAborted.expectErr('caller abort')
      expect(error.kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
      expect(error.kind.cause).toBe(reason)
    })
  })

  it('still aborts an in-flight request after garbage collection', async () => {
    await withTestSetup(async () => {
      const server = await startSilentServer({ sendHeaders: false })
      const gc = getGc()
      const controller = new AbortController()
      const reason = new Error('caller aborted after gc')

      const pending = safeHttp.get(server.url, { signal: controller.signal })
      await server.nextRequest()
      gc()
      await new Promise<void>((resolve) => {
        setImmediate(resolve)
      })
      gc()
      controller.abort(reason)

      let guardTimer: ReturnType<typeof setTimeout> | undefined
      const settled = await Promise.race([
        pending,
        new Promise<'hung'>((resolve) => {
          guardTimer = setTimeout(() => {
            resolve('hung')
          }, 500)
        }),
      ])
      clearTimeout(guardTimer)
      if (settled === 'hung') {
        expect.fail('request hung after GC broke abort propagation')
      }
      const error = settled.expectErr('caller abort after gc')
      expect(error.kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
      expect(error.kind.cause).toBe(reason)
    })
  })

  it('fails the body read when a reply stalls after its headers', async () => {
    await withTestSetup(async () => {
      const server = await startSilentServer({ sendHeaders: true })
      const timeout = stubDefaultTimeout()
      const response = (await safeHttp.get(server.url)).expect('headers arrive')
      const bodyPromise = response.text()
      timeout.fire()
      const body = await bodyPromise
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

  it('returns Err without throwing synchronously on illegal header characters', async () => {
    await withTestSetup(async () => {
      const fetchMock = vi.fn()
      global.fetch = fetchMock
      const response = await safeHttp.get(url, { headers: { Authorization: 'Bearer bad\r\nheader' } })
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  it('returns Err without throwing synchronously on a malformed URL', async () => {
    await withTestSetup(async () => {
      const fetchMock = vi.fn()
      global.fetch = fetchMock
      const response = await safeHttp.get('http://[::1')
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
