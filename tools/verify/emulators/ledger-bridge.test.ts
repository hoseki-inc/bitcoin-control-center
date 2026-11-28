import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { type IncomingMessage, type Server, type ServerResponse, createServer, request } from 'node:http'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { describe, it } from 'vitest'
import { ChildEnv, runCommandResult, startGroup } from '../process'
import {
  BridgeRecordSchema,
  HELPER,
  REPO_ROOT,
  type RunPaths,
  type RunState,
  boundPort,
  bridgeRecordFile,
  isOurProcess,
  portOwnedBy,
  processGroup,
  processStartTime,
  readJsonFile,
  readProcessesFile,
  runPaths,
  stopOwnGroup,
  stopProcess,
  stopRecordedGroups,
  wait,
  writeJson,
} from '../run'
import { bridgeModeNow, launchBridge } from './ledger'
import {
  ApduQueue,
  type Bridge,
  type BridgeControl,
  SHIM_FILE,
  bridgeControl,
  injectShim,
  startBridge,
} from './ledger-bridge'
import type { ScreenElement, SpeculosApi } from './ledger-driver'
import { SHIM_ROUTE } from './webhid-shim'

interface HeldSender {
  send: (apdu: Buffer) => Promise<Buffer>
  sent: string[]
  /** The most APDUs that were ever on the device at once. */
  inFlight: () => number
  answer: (hex: string) => void
}

/** An APDU sender whose answers the test releases one by one. */
function heldSender(): HeldSender {
  const sent: string[] = []
  const pending: Array<(data: Buffer) => void> = []
  let inFlight = 0
  let peak = 0
  return {
    sent,
    inFlight: () => peak,
    send: async (apdu) =>
      new Promise((done) => {
        sent.push(apdu.toString('hex'))
        inFlight += 1
        peak = Math.max(peak, inFlight)
        pending.push((data) => {
          inFlight -= 1
          done(data)
        })
      }),
    answer: (hex) => {
      pending.shift()?.(Buffer.from(hex, 'hex'))
    },
  }
}

const settle = async (): Promise<void> => {
  await wait(5)
}

describe('ApduQueue', { timeout: 15_000 }, () => {
  it('forwards one APDU at a time, in order', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const { sessionId } = queue.openSession()
    const answers = ['01', '02', '03'].map(async (apdu) =>
      queue.submit({ sessionId, channel: 1, apdu: Buffer.from(apdu, 'hex') }),
    )
    await settle()
    assert.deepEqual(device.sent, ['01'])
    assert.equal(queue.queued(), 2)
    for (const hex of ['9001', '9002', '9003']) {
      device.answer(hex)
      await settle()
    }
    const results = await Promise.all(answers)
    assert.deepEqual(
      results.map((result) => (result.status === 200 ? result.data.toString('hex') : result.error)),
      ['9001', '9002', '9003'],
    )
    assert.deepEqual(device.sent, ['01', '02', '03'])
    assert.equal(device.inFlight(), 1)
  })

  it('after SW 0xE000 lets only the same generation, session and channel go next', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const { sessionId } = queue.openSession()
    const first = queue.submit({ sessionId, channel: 7, apdu: Buffer.from('a1', 'hex') })
    await settle()
    // Queued while the first waits: another channel of the same page, then the continuation.
    const other = queue.submit({ sessionId, channel: 8, apdu: Buffer.from('b1', 'hex') })
    const continuation = queue.submit({ sessionId, channel: 7, apdu: Buffer.from('a2', 'hex') })
    device.answer('e000')
    await settle()
    assert.deepEqual(device.sent, ['a1', 'a2'])
    device.answer('9000')
    await settle()
    assert.deepEqual(device.sent, ['a1', 'a2', 'b1'])
    device.answer('9000')
    const done = await Promise.all([first, continuation, other])
    assert.deepEqual(
      done.map((result) => result.status),
      [200, 200, 200],
    )
  })

  it('gives the device to the newest session and refuses the older one with 409, lock and all', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const old = queue.openSession()
    const interrupted = queue.submit({ sessionId: old.sessionId, channel: 1, apdu: Buffer.from('a1', 'hex') })
    await settle()
    device.answer('e000')
    assert.equal((await interrupted).status, 200)
    // A reload: the new page's session takes over, and the old page's continuation no longer counts.
    const fresh = queue.openSession()
    const late = await queue.submit({ sessionId: old.sessionId, channel: 1, apdu: Buffer.from('a2', 'hex') })
    assert.deepEqual(late, { status: 409, error: 'another page now owns the Ledger' })
    const mine = queue.submit({ sessionId: fresh.sessionId, channel: 2, apdu: Buffer.from('c1', 'hex') })
    await settle()
    device.answer('9000')
    assert.equal((await mine).status, 200)
    assert.deepEqual(device.sent, ['a1', 'c1'])

    // Detaching ends every session and starts a new generation.
    const waiting = queue.submit({ sessionId: fresh.sessionId, channel: 2, apdu: Buffer.from('c2', 'hex') })
    const blocker = queue.submit({ sessionId: fresh.sessionId, channel: 2, apdu: Buffer.from('c3', 'hex') })
    await settle()
    queue.detach()
    // The page no longer owns the device, so it hears 409 at once, not the 200 Speculos sends later.
    assert.equal((await waiting).status, 409)
    assert.equal((await blocker).status, 409)
    device.answer('9000')
    assert.equal(queue.openSession().generation, fresh.generation + 1)
  })

  it('answers a page taken over mid-APDU at once, and a late 0xE000 from it never locks out the new owner', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const old = queue.openSession()
    const inFlight = queue.submit({ sessionId: old.sessionId, channel: 1, apdu: Buffer.from('a1', 'hex') })
    await settle()
    const fresh = queue.openSession()
    // Answered before Speculos is: the old page no longer owns the device.
    assert.deepEqual(await inFlight, { status: 409, error: 'another page now owns the Ledger' })
    const mine = queue.submit({ sessionId: fresh.sessionId, channel: 2, apdu: Buffer.from('b1', 'hex') })
    await settle()
    device.answer('e000')
    await settle()
    assert.deepEqual(device.sent, ['a1', 'b1'])
    device.answer('9000')
    assert.equal((await mine).status, 200)
  })

  it('ignores a late 0xE000 from an APDU whose page left, so another channel still goes', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const { sessionId } = queue.openSession()
    const left = new AbortController()
    const gone = queue.submit({ sessionId, channel: 7, apdu: Buffer.from('a1', 'hex') }, left.signal)
    await settle()
    left.abort()
    const other = queue.submit({ sessionId, channel: 8, apdu: Buffer.from('b1', 'hex') })
    device.answer('e000')
    assert.deepEqual(await gone, { status: 499, error: 'the page went away' })
    await settle()
    assert.deepEqual(device.sent, ['a1', 'b1'])
    device.answer('9000')
    assert.equal((await other).status, 200)
  })

  it('drops the interrupt lock when a new page takes over after the 0xE000 answer', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const old = queue.openSession()
    const first = queue.submit({ sessionId: old.sessionId, channel: 1, apdu: Buffer.from('a1', 'hex') })
    await settle()
    device.answer('e000')
    assert.equal((await first).status, 200)
    const fresh = queue.openSession()
    const mine = queue.submit({ sessionId: fresh.sessionId, channel: 2, apdu: Buffer.from('b1', 'hex') })
    await settle()
    assert.deepEqual(device.sent, ['a1', 'b1'])
    device.answer('9000')
    assert.equal((await mine).status, 200)
  })

  it('refuses a stale page at once even while the device is busy', async () => {
    const device = heldSender()
    const queue = new ApduQueue(device.send)
    const old = queue.openSession()
    const fresh = queue.openSession()
    const busy = queue.submit({ sessionId: fresh.sessionId, channel: 1, apdu: Buffer.from('a1', 'hex') })
    await settle()
    // Not queued behind the prompt on the device: refused straight away.
    assert.deepEqual(await queue.submit({ sessionId: old.sessionId, channel: 1, apdu: Buffer.from('c1', 'hex') }), {
      status: 409,
      error: 'another page now owns the Ledger',
    })
    device.answer('9000')
    assert.equal((await busy).status, 200)
  })

  it('answers 499 for an APDU whose page left, queued or on the device, and 502 when Speculos fails', async () => {
    const device = heldSender()
    let failNext = false
    const queue = new ApduQueue(async (apdu) => {
      if (failNext) {
        throw new Error('Speculos gone')
      }
      return device.send(apdu)
    })
    const { sessionId } = queue.openSession()
    const onDevice = new AbortController()
    const queued = new AbortController()
    const busy = queue.submit({ sessionId, channel: 1, apdu: Buffer.from('01', 'hex') }, onDevice.signal)
    const behind = queue.submit({ sessionId, channel: 1, apdu: Buffer.from('02', 'hex') }, queued.signal)
    await settle()
    queued.abort()
    assert.deepEqual(await behind, { status: 499, error: 'the page went away' })
    onDevice.abort()
    assert.equal(queue.current()?.aborted, true)
    device.answer('6985')
    assert.deepEqual(await busy, { status: 499, error: 'the page went away' })
    failNext = true
    assert.deepEqual(await queue.submit({ sessionId, channel: 1, apdu: Buffer.from('03', 'hex') }), {
      status: 502,
      error: 'Speculos gone',
    })
  })
})

async function serve(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler)
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  return { server, url: `http://127.0.0.1:${boundPort(server.address())}` }
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise((done) => {
    server.close(done)
  })
}

const PAGE = '<!doctype html><html><head><title>Control Center</title></head><body><div id="root"></div></body></html>'
const BINARY = randomBytes(70_000)

/** A Sentinel double: an HTML page (plain, gzipped, or without a head), binary assets, and an echo of each request. */
function fakeSentinel(req: IncomingMessage, res: ServerResponse): void {
  const path = req.url ?? '/'
  if (path === '/' || path === '/accounts') {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(PAGE),
      etag: '"p1"',
    })
    res.end(PAGE)
  } else if (path === '/gzip') {
    const body = gzipSync(PAGE)
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip', 'content-length': body.length })
    res.end(body)
  } else if (path === '/no-head') {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<p>bare</p></body>')
  } else if (path === '/asset.bin') {
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': BINARY.length })
    res.end(BINARY)
  } else if (path === '/reset.bin' || path === '/reset.html') {
    // Headers, part of the body, then the connection dies, as when Sentinel crashes mid-answer.
    res.writeHead(200, {
      'content-type': path.endsWith('.html') ? 'text/html' : 'application/octet-stream',
      'content-length': 1000,
    })
    res.write('partial')
    setTimeout(() => {
      res.socket?.destroy()
    }, 20)
  } else if (path === '/gz.js') {
    const body = gzipSync('console.log(1)')
    res.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'gzip', 'content-length': body.length })
    res.end(body)
  } else {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'bcc=abc; HttpOnly; Path=/' })
      res.end(
        JSON.stringify({
          method: req.method,
          url: path,
          host: req.headers.host,
          origin: req.headers.origin ?? null,
          tab: req.headers['x-bcc-tab'] ?? null,
          cookie: req.headers.cookie ?? null,
          body: Buffer.concat(chunks).toString('hex'),
        }),
      )
    })
  }
}

/** Raw HTTP to the bridge, so headers come back exactly as sent and nothing is decoded on the way. */
async function raw(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: Buffer | string } = {},
): Promise<{ status: number; headers: IncomingMessage['headers']; body: Buffer }> {
  return new Promise((done, failed) => {
    const sent = request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }, (answer) => {
      const chunks: Buffer[] = []
      answer.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      answer.on('end', () => {
        done({ status: answer.statusCode ?? 0, headers: answer.headers, body: Buffer.concat(chunks) })
      })
    })
    sent.on('error', failed)
    sent.end(init.body)
  })
}

const IDLE: ScreenElement[] = [{ text: 'Bitcoin', x: 0, y: 0, w: 10, h: 10 }]

/** Just enough Speculos for a bridge whose prompts nobody drives: a screen and a screenshot. */
const quietApi: SpeculosApi = {
  screen: async () => IDLE,
  screenshot: async () => Buffer.from('png'),
  button: async () => {},
  finger: async () => {},
}

async function withBridge(
  fn: (
    bridge: Bridge,
    ctx: { drive: string; control: string; token: string; speculos: string; releaseApdu: () => Promise<void> },
  ) => Promise<void>,
  options: { apduDelayMs?: number } = {},
): Promise<void> {
  const sentinel = await serve(fakeSentinel)
  // Speculos's /apdu: headers at once, then the body after a delay or when the test releases it, as a prompt does.
  const releases: Array<() => void> = []
  const speculos = await serve((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"data": "')
      const finish = (): void => {
        res.end('9000"}')
      }
      if (options.apduDelayMs === undefined) {
        releases.push(finish)
      } else {
        setTimeout(finish, options.apduDelayMs)
      }
    })
  })
  const token = randomBytes(32).toString('hex')
  const bridge = await startBridge({
    target: sentinel.url,
    speculosUrl: speculos.url,
    model: 'flex',
    mode: 'manual',
    token,
    shim: '/* bcc-verify.webhid-shim */',
    api: quietApi,
    pollMs: 20,
    log: () => {},
  })
  try {
    await fn(bridge, {
      drive: `http://127.0.0.1:${bridge.drivePort}`,
      control: `http://127.0.0.1:${bridge.controlPort}`,
      token,
      speculos: speculos.url,
      // Once Speculos has the APDU, lets it finish its answer.
      releaseApdu: async () => {
        for (let i = 0; i < 200 && releases.length === 0; i += 1) {
          await wait(10)
        }
        releases.shift()?.()
      },
    })
  } finally {
    await bridge.close()
    await close(sentinel.server)
    await close(speculos.server)
  }
}

describe('drive proxy', { timeout: 20_000 }, () => {
  it('injects the shim before </head>, else </body>, else at the end', () => {
    const tag = `<script src="${SHIM_FILE}"></script>`
    assert.equal(injectShim('<head></head><body></body>'), `<head>${tag}</head><body></body>`)
    assert.equal(injectShim('<BODY>x</BODY>'), `<BODY>x${tag}</BODY>`)
    assert.equal(injectShim('x'), `x${tag}`)
  })

  it('passes non-HTML through byte for byte, compressed or not, with its own headers', async () => {
    await withBridge(async (_bridge, { drive }) => {
      const asset = await raw(`${drive}/asset.bin`)
      assert.equal(asset.status, 200)
      assert.ok(asset.body.equals(BINARY))
      assert.equal(asset.headers['content-length'], String(BINARY.length))
      const script = await raw(`${drive}/gz.js`, { headers: { 'accept-encoding': 'gzip' } })
      assert.equal(script.headers['content-encoding'], 'gzip')
      assert.ok(script.body.equals(gzipSync('console.log(1)')))
      // A POST body and the headers the PIN check reads reach Sentinel unchanged, and its cookie comes back.
      const body = randomBytes(300)
      const echo = await raw(`${drive}/api/trpc/x?batch=1`, {
        method: 'POST',
        headers: {
          origin: drive,
          'x-bcc-tab': 'tab-123',
          cookie: 'bcc=abc',
          'content-type': 'application/octet-stream',
        },
        body,
      })
      assert.deepEqual(JSON.parse(echo.body.toString('utf8')), {
        method: 'POST',
        url: '/api/trpc/x?batch=1',
        host: drive.slice('http://'.length),
        origin: drive,
        tab: 'tab-123',
        cookie: 'bcc=abc',
        body: body.toString('hex'),
      })
      assert.deepEqual(echo.headers['set-cookie'], ['bcc=abc; HttpOnly; Path=/'])
    })
  })

  it('adds the shim to every HTML page, on each reload and after gzip, with a matching Content-Length', async () => {
    await withBridge(async (_bridge, { drive }) => {
      const tag = `<script src="${SHIM_FILE}"></script>`
      for (const path of ['/', '/', '/accounts', '/gzip']) {
        const page = await raw(`${drive}${path}`, { headers: { 'accept-encoding': 'gzip, br' } })
        assert.equal(page.status, 200)
        assert.equal(page.body.toString('utf8'), PAGE.replace('</head>', `${tag}</head>`), path)
        assert.equal(page.headers['content-length'], String(page.body.length), path)
        assert.equal(page.headers['content-encoding'], undefined, path)
      }
      const bare = await raw(`${drive}/no-head`)
      assert.equal(bare.body.toString('utf8'), `<p>bare</p>${tag}</body>`)
      const shim = await raw(`${drive}${SHIM_FILE}`)
      assert.match(shim.headers['content-type'] ?? '', /^text\/javascript/)
      assert.match(shim.body.toString('utf8'), /bcc-verify\.webhid-shim/)
    })
  })

  it('serves the Ledger routes only to its own origin', async () => {
    await withBridge(async (_bridge, { drive }) => {
      const mine = await raw(`${drive}${SHIM_ROUTE}/session`, { headers: { origin: drive } })
      assert.equal(mine.status, 200)
      assert.match(mine.body.toString('utf8'), /attached=1&model=flex&productId=28689/)
      const other = await raw(`${drive}${SHIM_ROUTE}/session`, {
        method: 'POST',
        headers: { origin: 'http://evil.test' },
      })
      assert.equal(other.status, 403)
      const crossSite = await raw(`${drive}${SHIM_ROUTE}/session`, { headers: { 'sec-fetch-site': 'cross-site' } })
      assert.equal(crossSite.status, 403)
    })
  })

  it('refuses a page whose name only resolves to loopback (DNS rebinding), on every Ledger route', async () => {
    await withBridge(async (bridge, { drive }) => {
      const port = bridge.drivePort
      // The browser sends the page's own name as Host and Origin, and calls the request same-origin.
      const forged = {
        host: `rebind.test:${port}`,
        origin: `http://rebind.test:${port}`,
        'sec-fetch-site': 'same-origin',
      }
      for (const [method, path] of [
        ['GET', 'session'],
        ['POST', 'session'],
        ['GET', 'events'],
        ['POST', 'apdu'],
      ] as const) {
        const answer = await raw(`${drive}${SHIM_ROUTE}/${path}`, { method, headers: forged })
        assert.equal(answer.status, 403, `${method} ${path}`)
      }
      // Another port on loopback is another origin too.
      const otherPort = await raw(`${drive}${SHIM_ROUTE}/session`, { headers: { host: `127.0.0.1:${port + 1}` } })
      assert.equal(otherPort.status, 403)
      for (const name of ['127.0.0.1', 'localhost']) {
        const authority = `${name}:${port}`
        const ok = await raw(`${drive}${SHIM_ROUTE}/session`, {
          method: 'POST',
          headers: { host: authority, origin: `http://${authority}`, 'sec-fetch-site': 'same-origin' },
        })
        assert.equal(ok.status, 200, name)
      }
    })
  })

  it('makes the control port refuse a forged Host even with the token', async () => {
    await withBridge(async (bridge, { control, token }) => {
      const forged = await raw(`${control}/status`, {
        headers: { authorization: `Bearer ${token}`, host: `rebind.test:${bridge.controlPort}` },
      })
      assert.equal(forged.status, 403)
      const ok = await raw(`${control}/status`, { headers: { authorization: `Bearer ${token}` } })
      assert.equal(ok.status, 200)
    })
  })

  it('adds the shim to a page only once, even when the page already carries it', () => {
    const once = injectShim(PAGE)
    assert.equal(injectShim(once), once)
  })

  it('ends the browser answer when Sentinel resets after its headers, and keeps serving', async () => {
    await withBridge(async (_bridge, { drive }) => {
      for (const path of ['/reset.bin', '/reset.html']) {
        // The browser sees the answer cut short, as from Sentinel itself, instead of a hang.
        await assert.rejects(
          fetch(`${drive}${path}`, { signal: AbortSignal.timeout(3_000) }).then(async (answer) => answer.text()),
          /terminated|fetch failed/,
          path,
        )
      }
      // The daemon is still up: the next request is proxied as usual.
      assert.equal((await raw(`${drive}/asset.bin`)).status, 200)
    })
  })
})

describe('control port', { timeout: 20_000 }, () => {
  it('answers only the bearer token, never a page, and is not on the drive port', async () => {
    await withBridge(async (bridge, { drive, control, token }) => {
      assert.equal((await raw(`${control}/status`)).status, 401)
      assert.equal((await raw(`${control}/status`, { headers: { authorization: 'Bearer wrong' } })).status, 401)
      // A page that learned the token still can't use it: a browser always sends Origin, and no CORS header comes back.
      const fromPage = await raw(`${control}/status`, { headers: { authorization: `Bearer ${token}`, origin: drive } })
      assert.equal(fromPage.status, 403)
      assert.equal(fromPage.headers['access-control-allow-origin'], undefined)
      const preflight = await raw(`${control}/press`, {
        method: 'OPTIONS',
        headers: { origin: drive, 'access-control-request-method': 'POST' },
      })
      assert.equal(preflight.status, 403)
      assert.equal(preflight.headers['access-control-allow-origin'], undefined)
      // The drive port proxies these paths to Sentinel instead of driving anything.
      const viaDrive = await raw(`${drive}/press`, { method: 'POST', headers: { authorization: `Bearer ${token}` } })
      assert.match(viaDrive.body.toString('utf8'), /"url":"\/press"/)

      const status = await bridgeControl({
        pid: 1,
        drivePort: bridge.drivePort,
        controlPort: bridge.controlPort,
        token,
      }).status()
      assert.deepEqual(status, { model: 'flex', mode: 'manual', generation: 1, queued: 0, inFlight: null })
      assert.equal(
        (await raw(`${control}/press`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{bad' }))
          .status,
        400,
      )
    })
  })

  it('turns auto-approve off at the first manual press', async () => {
    const sentinel = await serve(fakeSentinel)
    const token = randomBytes(32).toString('hex')
    const bridge = await startBridge({
      target: sentinel.url,
      speculosUrl: 'http://127.0.0.1:1',
      model: 'flex',
      mode: 'auto',
      token,
      shim: '',
      api: quietApi,
      log: () => {},
    })
    try {
      const control = bridgeControl(
        { pid: 1, drivePort: bridge.drivePort, controlPort: bridge.controlPort, token },
        15_000,
      )
      assert.equal((await control.status()).mode, 'auto')
      const pressed = await control.press()
      assert.equal(pressed.ok, false)
      assert.equal(bridge.mode(), 'manual')
      assert.equal((await control.status()).mode, 'manual')
    } finally {
      await bridge.close()
      await close(sentinel.server)
    }
  })
})

/** Opens a session on the bridge and posts one APDU, keeping the request so a test can drop it. */
async function openSession(drive: string): Promise<string> {
  const opened = await raw(`${drive}${SHIM_ROUTE}/session`, { method: 'POST', headers: { origin: drive } })
  return new URLSearchParams(opened.body.toString('utf8')).get('session') ?? ''
}

/** The bridge's answer to a page's APDU as the page sees it: the HTTP status and body, or 0 when it dropped. */
interface PageAnswer {
  status: number
  text: string
}

interface PostedApdu {
  answer: Promise<PageAnswer>
  /** Drops the connection, as a page that goes away does. */
  drop: () => void
}

function postApdu(drive: string, session: string, apdu: string): PostedApdu {
  const sent = request(`${drive}${SHIM_ROUTE}/apdu`, { method: 'POST', headers: { origin: drive } })
  const answer = new Promise<PageAnswer>((done) => {
    sent.on('response', (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      res.on('end', () => {
        done({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
      })
    })
    sent.on('error', () => {
      done({ status: 0, text: 'dropped' })
    })
  })
  sent.end(new URLSearchParams({ session, channel: '257', apdu }).toString())
  return {
    answer,
    drop: () => {
      sent.destroy()
    },
  }
}

describe('bridge APDU path', { timeout: 20_000 }, () => {
  it('holds the slot until Speculos has sent its whole answer, then forwards the next', async () => {
    await withBridge(async (bridge, { drive, releaseApdu }) => {
      const session = await openSession(drive)
      const first = postApdu(drive, session, 'e0c4000000')
      const second = postApdu(drive, session, 'b001000000')
      for (let i = 0; i < 100 && bridge.queue.current() === null; i += 1) {
        await wait(10)
      }
      // Speculos sent its headers and half the body: the first still holds the slot.
      await wait(100)
      assert.equal(bridge.queue.current()?.apdu.toString('hex'), 'e0c4000000')
      assert.equal(bridge.queue.queued(), 1)
      await releaseApdu()
      assert.equal((await first.answer).status, 200)
      for (let i = 0; i < 100 && bridge.queue.current()?.apdu.toString('hex') !== 'b001000000'; i += 1) {
        await wait(10)
      }
      await releaseApdu()
      assert.deepEqual(await second.answer, { status: 200, text: '9000' })
    })
  })

  it('reads a dropped request as the page leaving, but lets a slow healthy answer finish', async () => {
    await withBridge(
      async (bridge, { drive }) => {
        const session = await openSession(drive)
        // Healthy and slow: the request body is long consumed, the answer comes after 600 ms, nothing cancels it.
        const slow = postApdu(drive, session, 'e04200000100')
        await wait(300)
        assert.equal(bridge.queue.current()?.aborted, false)
        assert.deepEqual(await slow.answer, { status: 200, text: '9000' })

        const dropped = postApdu(drive, session, 'e04200000101')
        for (let i = 0; i < 100 && bridge.queue.current() === null; i += 1) {
          await wait(10)
        }
        const item = bridge.queue.current()
        dropped.drop()
        for (let i = 0; i < 100 && item?.aborted !== true; i += 1) {
          await wait(10)
        }
        assert.equal(item?.aborted, true)
        assert.equal((await dropped.answer).status, 0)
      },
      { apduDelayMs: 600 },
    )
  })

  it('refuses a stale page with 409 once a reload opened a new session', async () => {
    await withBridge(
      async (_bridge, { drive }) => {
        const old = await openSession(drive)
        await openSession(drive)
        const stale = postApdu(drive, old, 'b001000000')
        assert.deepEqual(await stale.answer, { status: 409, text: 'another page now owns the Ledger' })
      },
      { apduDelayMs: 10 },
    )
  })

  it('tells pages over SSE when the bridge closes, so the shim can report a disconnect', async () => {
    const seen: string[] = []
    let ended: Promise<void> = Promise.resolve()
    await withBridge(async (bridge, { drive }) => {
      await new Promise<void>((ready) => {
        request(`${drive}${SHIM_ROUTE}/events`, { headers: { origin: drive } }, (res) => {
          res.setEncoding('utf8')
          ended = new Promise((done) => {
            res.on('end', done)
            res.on('close', done)
          })
          res.on('data', (chunk: string) => {
            seen.push(chunk)
            ready()
          })
        }).end()
      })
      await bridge.close()
      await ended
    })
    assert.match(seen.join(''), /event: state\ndata: generation=1&attached=1\n\n/)
    assert.match(seen.join(''), /event: state\ndata: generation=2&attached=0\n\n/)
  })
})

/** PIDs of a run's bridge daemons still running, found by the run ID on their command line. */
function bridgeDaemons(runId: string): string[] {
  return runCommandResult('pgrep', ['-f', `ledger-bridge-daemon.ts --run ${runId} `], { env: ChildEnv.with() })
    .stdout.split('\n')
    .filter(Boolean)
}

/** A run folder for the real daemon, which finds it through runPaths; removed with any bridge left in it. */
async function withDaemonRun(fn: (paths: RunPaths, sentinelUrl: string) => Promise<void>): Promise<void> {
  const paths = runPaths(`bridge-${Math.random().toString(36).slice(2, 10)}`)
  mkdirSync(paths.runDir, { recursive: true })
  const sentinel = await serve(fakeSentinel)
  try {
    await fn(paths, sentinel.url)
  } finally {
    const journal = readProcessesFile(paths)
    for (const recorded of journal.status === 'ok' ? journal.value : []) {
      await stopProcess(recorded)
    }
    await close(sentinel.server)
    rmSync(paths.runDir, { recursive: true, force: true })
  }
}

/** A run.json with no emulators, as a launched run has before its Ledger starts. */
function minimalRunState(runId: string, url: string): RunState {
  return {
    runId,
    launchedAt: '2026-11-28T10:00:00Z',
    fresh: false,
    desktop: false,
    electron: false,
    setupPinInUi: false,
    pin: false,
    build: { commit: 'abc', tree: 't', dirty: false },
    url,
    sentinel: { name: 'sentinel', pid: 999_999, startedAt: 'never', port: 9 },
    fakes: { name: 'fakes', pid: 999_998, startedAt: 'never', electrumPort: 10, mempoolPort: 11 },
  }
}

describe('launchBridge', { timeout: 60_000 }, () => {
  it('starts the real daemon as its own group, waits for its record, and stops with it', async () => {
    await withDaemonRun(async (paths, target) => {
      const launched = await launchBridge(paths, {
        mode: 'manual',
        target,
        model: 'nanosp',
        speculosUrl: 'http://127.0.0.1:9',
      })
      const bridge = launched.expect('the bridge starts')
      assert.equal(bridge.mode, 'manual')
      const record = readJsonFile(BridgeRecordSchema, bridgeRecordFile(paths))
      assert.equal(record.status === 'ok' ? record.value.pid : null, bridge.pid)
      assert.equal(statSync(bridgeRecordFile(paths)).mode & 0o777, 0o600)
      assert.equal(portOwnedBy(bridge.port, bridge.pid), true)
      assert.equal(portOwnedBy(bridge.controlPort, bridge.pid), true)
      const page = await raw(`${bridge.url}/`)
      assert.match(page.body.toString('utf8'), /<script src="\/__bcc_verify\/webhid-shim\.js"><\/script><\/head>/)
      const shim = await raw(`${bridge.url}${SHIM_FILE}`)
      assert.match(shim.body.toString('utf8'), /bcc-verify\.webhid-shim/)
      assert.deepEqual(readProcessesFile(paths), {
        status: 'ok',
        value: [{ name: 'ledger-bridge', pid: bridge.pid, startedAt: bridge.startedAt }],
      })
      await stopProcess(bridge)
      // This test started the leader, so it lingers until Node reaps it.
      await until(() => !isOurProcess(bridge), 'the leader to be reaped')
      await until(() => !existsSync(bridgeRecordFile(paths)), 'the record to go')
    })
  })

  it('stops the bridge it started, and leaves no record, when the process journal does not parse', async () => {
    await withDaemonRun(async (paths, target) => {
      writeFileSync(paths.processesFile, '{not json')
      const launched = await launchBridge(paths, {
        mode: 'manual',
        target,
        model: 'flex',
        speculosUrl: 'http://127.0.0.1:9',
      })
      assert.match(launched.isErr() ? launched.unwrapErr() : '', /the Ledger bridge did not start: .*processes\.json/)
      await until(() => bridgeDaemons(paths.runId).length === 0, 'the daemon to stop')
      await wait(500)
      assert.deepEqual(bridgeDaemons(paths.runId), [])
      assert.equal(existsSync(bridgeRecordFile(paths)), false)
    })
  })

  it('asks again when the first start-time read fails, and owns the bridge it started', async () => {
    await withDaemonRun(async (paths, target) => {
      let reads = 0
      const flaky = (pid: number): string | null => (++reads === 1 ? null : processStartTime(pid))
      const bridge = (
        await launchBridge(paths, { mode: 'manual', target, model: 'flex', speculosUrl: 'http://127.0.0.1:9' }, flaky)
      ).expect('the bridge starts after a second read')
      assert.equal(bridge.startedAt, processStartTime(bridge.pid))
      assert.equal(portOwnedBy(bridge.controlPort, bridge.pid), true)
    })
  })

  it('stops the group it started, confirmed gone, and leaves no record when the start time never reads', async () => {
    await withDaemonRun(async (paths, target) => {
      const launched = await launchBridge(
        paths,
        { mode: 'manual', target, model: 'flex', speculosUrl: 'http://127.0.0.1:9' },
        () => null,
      )
      assert.match(launched.isErr() ? launched.unwrapErr() : '', /its start time could not be read/)
      // Stopped before the call returned, so the daemon never gets to write its record afterwards.
      assert.deepEqual(bridgeDaemons(paths.runId), [])
      await wait(1_500)
      assert.deepEqual(bridgeDaemons(paths.runId), [])
      assert.equal(existsSync(bridgeRecordFile(paths)), false)
    })
  })

  it('lets emulator stop find a bridge that only the process journal names, as after a starter died', async () => {
    await withDaemonRun(async (paths, target) => {
      // A run.json with no Ledger yet: the starter died after recording the bridge's process, before run.json.
      writeJson(paths.stateFile, minimalRunState(paths.runId, target))
      const bridge = (
        await launchBridge(paths, { mode: 'manual', target, model: 'flex', speculosUrl: 'http://127.0.0.1:9' })
      ).expect('the bridge starts')
      const stop = runCommandResult(
        join(REPO_ROOT, HELPER),
        ['emulator', 'stop', '--device', 'ledger', '--run', paths.runId],
        { cwd: REPO_ROOT, env: ChildEnv.with() },
      )
      assert.equal(stop.status, 0, `${stop.stdout}${stop.stderr}`)
      assert.match(stop.stdout, new RegExp(`ledger-bridge: stopped PID ${bridge.pid}`))
      await until(() => bridgeDaemons(paths.runId).length === 0, 'the daemon to stop')
      await assert.rejects(fetch(bridge.url, { signal: AbortSignal.timeout(2_000) }))
      assert.equal(existsSync(bridgeRecordFile(paths)), false)
    })
  })

  it('stops the genuine bridge even when an older journal entry with the same PID comes first', async () => {
    await withDaemonRun(async (paths, target) => {
      writeJson(paths.stateFile, minimalRunState(paths.runId, target))
      const bridge = (
        await launchBridge(paths, { mode: 'manual', target, model: 'flex', speculosUrl: 'http://127.0.0.1:9' })
      ).expect('the bridge starts')
      // An entry from an earlier process that had the same PID: another start time, so another process.
      writeJson(paths.processesFile, [
        { name: 'ledger-bridge', pid: bridge.pid, startedAt: 'Mon Jan  1 00:00:00 2024' },
        { name: 'ledger-bridge', pid: bridge.pid, startedAt: bridge.startedAt },
      ])
      const stop = runCommandResult(
        join(REPO_ROOT, HELPER),
        ['emulator', 'stop', '--device', 'ledger', '--run', paths.runId],
        { cwd: REPO_ROOT, env: ChildEnv.with() },
      )
      assert.equal(stop.status, 0, `${stop.stdout}${stop.stderr}`)
      assert.match(stop.stdout, new RegExp(`ledger-bridge: stopped PID ${bridge.pid}`))
      await until(() => bridgeDaemons(paths.runId).length === 0, 'the daemon to stop')
      await assert.rejects(fetch(bridge.url, { signal: AbortSignal.timeout(2_000) }))
      assert.equal(existsSync(bridgeRecordFile(paths)), false)
    })
  })
})

const box = (text: string, x: number, y: number, w: number, h: number): ScreenElement => ({ text, x, y, w, h })
const FLEX_HOME = [
  box('Bitcoin', 0, 0, 10, 10),
  box('This app enables signing', 0, 20, 10, 10),
  box('Quit app', 0, 40, 10, 10),
]
const REJECT = box('Reject', 32, 534, 128, 36)
/** A message prompt as the Flex pages it: three review pages, then Hold to sign. */
const MESSAGE_PAGES: ScreenElement[][] = [
  [box('Review message', 95, 262, 289, 44), box('Swipe to review', 134, 326, 212, 36), REJECT],
  [box('Path', 32, 40, 61, 36), box("84'/0'/0'/0/0", 32, 80, 186, 44), REJECT],
  [box('Message content', 32, 40, 229, 36), box('I, the owner', 32, 80, 200, 36), REJECT],
  [box('Sign message?', 110, 200, 260, 44), REJECT, box('Hold to sign', 32, 408, 209, 44)],
]

/**
 * A Flex that shows a message prompt for each APDU it is sent and answers it only once decided on the device: 9000
 * approved, 6985 rejected. It records every press, and how many ran at once.
 */
class PromptingFlex implements SpeculosApi {
  public readonly presses: string[] = []
  public mostAtOnce = 0
  /** Each tap waits this long, so a test can act between the steps of one drive. */
  public tapMs = 30
  private pressing = 0
  private page = -1
  private confirming = false
  private result: string | null = null
  private readonly pending: Array<(sw: string) => void> = []

  /** Shows a new prompt and resolves with the status word once it is decided. */
  public async prompt(): Promise<string> {
    return new Promise((done) => {
      this.pending.push(done)
      if (this.page < 0 && this.result === null) {
        this.page = 0
      }
    })
  }

  public shown(): boolean {
    return this.page >= 0
  }

  public async screen(): Promise<ScreenElement[]> {
    if (this.result !== null) {
      return [box(this.result, 99, 304, 281, 44)]
    }
    if (this.confirming) {
      return [
        box('Reject message?', 89, 252, 302, 44),
        box('Go back to message', 98, 534, 416, 36),
        box('Yes, reject', 167, 442, 416, 36),
      ]
    }
    return this.page < 0 ? FLEX_HOME : (MESSAGE_PAGES[this.page] ?? [])
  }

  public async screenshot(): Promise<Buffer> {
    return Buffer.from('png')
  }

  public async button(): Promise<void> {}

  public async finger(x: number, y: number, delay: number): Promise<void> {
    this.pressing += 1
    this.mostAtOnce = Math.max(this.mostAtOnce, this.pressing)
    await wait(this.tapMs)
    this.pressing -= 1
    const hit = (await this.screen()).find((e) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h)?.text
    this.presses.push(hit ?? (x > 380 && y > 520 ? 'next' : 'dismiss'))
    if (this.result !== null) {
      this.result = null
      this.page = this.pending.length > 0 ? 0 : -1
      return
    }
    if (this.confirming) {
      if (hit === 'Yes, reject') {
        this.decide('6985', 'Message rejected')
      }
      return
    }
    if (hit === 'Reject') {
      this.confirming = true
    } else if (hit === 'Hold to sign' && delay >= 2) {
      this.decide('9000', 'Message signed')
    } else if (hit === undefined && x > 380 && y > 520 && this.page < MESSAGE_PAGES.length - 1) {
      this.page += 1
    }
  }

  private decide(sw: string, result: string): void {
    this.confirming = false
    this.page = -1
    this.result = result
    this.pending.shift()?.(sw)
  }
}

/** A bridge on the prompting Flex, whose Speculos /apdu answers once the prompt is decided. */
async function withPromptingBridge(
  mode: 'manual' | 'auto',
  fn: (ctx: { bridge: Bridge; device: PromptingFlex; drive: string; control: BridgeControl }) => Promise<void>,
): Promise<void> {
  const device = new PromptingFlex()
  const speculos = await serve((req, res) => {
    req.resume()
    req.on('end', () => {
      void device.prompt().then((sw) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: sw }))
      })
    })
  })
  const sentinel = await serve(fakeSentinel)
  const token = randomBytes(32).toString('hex')
  const bridge = await startBridge({
    target: sentinel.url,
    speculosUrl: speculos.url,
    model: 'flex',
    mode,
    token,
    shim: '',
    api: device,
    pollMs: 20,
    log: () => {},
  })
  try {
    const control = bridgeControl(
      { pid: 1, drivePort: bridge.drivePort, controlPort: bridge.controlPort, token },
      20_000,
    )
    await fn({ bridge, device, drive: `http://127.0.0.1:${bridge.drivePort}`, control })
  } finally {
    await bridge.close()
    await close(sentinel.server)
    await close(speculos.server)
  }
}

async function until(check: () => boolean, what: string, ms = 5_000): Promise<void> {
  for (const deadline = Date.now() + ms; !check();) {
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${what}`)
    }
    await wait(10)
  }
}

describe('bridge driving', { timeout: 30_000 }, () => {
  it('never overlaps two presses sent at once, and each approves one prompt', async () => {
    await withPromptingBridge('manual', async ({ device, drive, control }) => {
      const session = await openSession(drive)
      const first = postApdu(drive, session, 'e04e000001')
      await until(() => device.shown(), 'the prompt')
      const presses = await Promise.all([control.press(), control.press()])
      assert.equal(presses[0].ok, true)
      assert.deepEqual(await first.answer, { status: 200, text: '9000' })
      // The second found no prompt left and failed instead of pressing into the first drive.
      assert.equal(presses[1].ok, false)
      assert.equal(device.mostAtOnce, 1)
      assert.equal(device.presses.filter((press) => press === 'Hold to sign').length, 1)
    })
  })

  it('rejects, once and with no approving press, a prompt whose page left before anyone pressed', async () => {
    await withPromptingBridge('manual', async ({ device, drive }) => {
      const session = await openSession(drive)
      const left = postApdu(drive, session, 'e04e000001')
      await until(() => device.shown(), 'the prompt')
      left.drop()
      await until(() => device.presses.includes('Yes, reject'), 'the reject')
      await wait(200)
      assert.equal(device.presses.filter((press) => press === 'Yes, reject').length, 1)
      assert.equal(device.presses.includes('Hold to sign'), false)
    })
  })

  it('approves on its own in auto mode', async () => {
    await withPromptingBridge('auto', async ({ device, drive }) => {
      const session = await openSession(drive)
      assert.deepEqual(await postApdu(drive, session, 'e04e000001').answer, { status: 200, text: '9000' })
      assert.equal(device.presses.filter((press) => press === 'Hold to sign').length, 1)
    })
  })

  it('calls off an auto approval whose page leaves mid-drive, and rejects the prompt instead', async () => {
    await withPromptingBridge('auto', async ({ device, drive }) => {
      device.tapMs = 150
      const session = await openSession(drive)
      const left = postApdu(drive, session, 'e04e000001')
      await until(() => device.presses.includes('next'), 'the auto drive to start')
      left.drop()
      await until(() => device.presses.includes('Yes, reject'), 'the reject')
      assert.equal(device.presses.includes('Hold to sign'), false)
      assert.equal(device.presses.filter((press) => press === 'Yes, reject').length, 1)
    })
  })

  it('lets a manual reject during an auto drive win, never approving, and acts on that prompt', async () => {
    await withPromptingBridge('auto', async ({ bridge, device, drive, control }) => {
      device.tapMs = 150
      const session = await openSession(drive)
      const pending = postApdu(drive, session, 'e04e000001')
      await until(() => device.presses.includes('next'), 'the auto drive to start')
      const rejected = await control.reject()
      assert.equal(rejected.ok, true, rejected.ok ? '' : rejected.reason)
      assert.deepEqual(await pending.answer, { status: 200, text: '6985' })
      assert.equal(device.presses.includes('Hold to sign'), false)
      assert.equal(bridge.mode(), 'manual')
      // Auto stays off: the next prompt waits for a person, who approves it.
      const next = postApdu(drive, session, 'e04e000001')
      await until(() => device.shown(), 'the next prompt')
      await wait(200)
      assert.equal(device.presses.includes('Hold to sign'), false)
      assert.equal((await control.press()).ok, true)
      assert.deepEqual(await next.answer, { status: 200, text: '9000' })
    })
  })
})

describe('stopRecordedGroups', { timeout: 30_000 }, () => {
  it('reports a recorded group that is still running after its stop, and nothing once it is gone', async () => {
    const log = openSync('/dev/null', 'w')
    const child = startGroup('sleep', ['60'], { cwd: REPO_ROOT, env: ChildEnv.with(), log })
    closeSync(log)
    const recorded = { name: 'ledger-bridge', pid: child.pid ?? 0, startedAt: processStartTime(child.pid ?? 0) ?? '' }
    const exited = new Promise<void>((done) => {
      child.on('exit', () => {
        done()
      })
    })
    try {
      // A stop that fails to stop it: the group is reported, so emulator stop keeps every record and exits 1.
      assert.deepEqual(await stopRecordedGroups([recorded, recorded], async () => {}), [recorded])
      assert.deepEqual(await stopRecordedGroups([recorded]), [])
      await exited
    } finally {
      await stopOwnGroup(recorded.pid)
    }
  })
})

describe('bridgeModeNow', { timeout: 20_000 }, () => {
  it('sends the token only to a control port held by the bridge, as evidence and launch read the mode', async () => {
    const paths = runPaths(`mode-${Math.random().toString(36).slice(2, 10)}`)
    mkdirSync(paths.runDir, { recursive: true })
    const seen: Array<string | undefined> = []
    const impostor = await serve((req, res) => {
      seen.push(req.headers.authorization)
      res.end('{}')
    })
    try {
      const port = boundPort(impostor.server.address())
      // This worker holds the port, but it is not its own process group's leader, so it is not the bridge.
      const bridge = {
        name: 'ledger-bridge',
        pid: process.pid,
        startedAt: 'x',
        port,
        url: impostor.url,
        controlPort: port,
        mode: 'manual' as const,
      }
      writeJson(bridgeRecordFile(paths), {
        pid: process.pid,
        drivePort: port,
        controlPort: port,
        token: 'c'.repeat(64),
      })
      assert.deepEqual(await bridgeModeNow(paths, bridge), {
        problem: `control port ${port} is not held by the bridge (PID ${process.pid})`,
      })
      assert.deepEqual(seen, [])

      // A real bridge in this worker's group, recorded under the group's leader, answers with its mode.
      await withBridge(async (real, { token }) => {
        const leader = processGroup(process.pid) ?? 0
        writeJson(bridgeRecordFile(paths), {
          pid: leader,
          drivePort: real.drivePort,
          controlPort: real.controlPort,
          token,
        })
        const owned = { ...bridge, pid: leader, port: real.drivePort, controlPort: real.controlPort }
        assert.deepEqual(await bridgeModeNow(paths, owned), { mode: 'manual' })
      })
    } finally {
      await close(impostor.server)
      rmSync(paths.runDir, { recursive: true, force: true })
    }
  })
})
