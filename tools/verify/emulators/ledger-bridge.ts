import { randomBytes, timingSafeEqual } from 'node:crypto'
import { type IncomingMessage, type Server, type ServerResponse, createServer, request } from 'node:http'
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { build } from 'esbuild'
import { z } from 'zod'
import { type BridgeRecord, type LedgerModel, boundPort } from '../run'
import {
  type Decision,
  type DriveResult,
  LEDGER_BUTTONS,
  type ScreenKind,
  type SpeculosApi,
  classifyScreen,
  drivePrompt,
  pressOnce,
  speculosApi,
} from './ledger-driver'
import { SHIM_ROUTE } from './webhid-shim'

// The per-run Ledger bridge. Its drive proxy serves Control Center from the run's Sentinel byte for byte, except that
// HTML pages load the WebHID shim, and it carries the shim's APDUs to Speculos one at a time. Its control server, on a
// second port that only a holder of the run's token can use, is how `emulator press|reject|status|screenshot` drive
// the device once a bridge runs, so the bridge's own auto-approve and a person's commands never interleave.

const SW_INTERRUPT = 0xe000
/** A person may take minutes to read a prompt on the device. */
const APDU_TIMEOUT_MS = 10 * 60_000
export const SHIM_FILE = '/__bcc_verify/webhid-shim.js'
const SHIM_TAG = `<script src="${SHIM_FILE}"></script>`

export const BRIDGE_MODES = ['manual', 'auto'] as const
export type BridgeMode = (typeof BRIDGE_MODES)[number]

/** USB product IDs the WebHID transports read the model from. */
const PRODUCTS: Readonly<Record<LedgerModel, { productId: number; productName: string }>> = {
  flex: { productId: 0x7011, productName: 'Ledger Flex' },
  nanosp: { productId: 0x5011, productName: 'Nano S Plus' },
}

/** A page's hold on the device, and the device generation it was opened on. */
export interface BridgeSession {
  sessionId: string
  generation: number
}

export type ApduAnswer = { status: 200; data: Buffer } | { status: 409 | 499 | 502; error: string }

export interface QueuedApdu {
  readonly sessionId: string
  readonly generation: number
  readonly channel: number
  readonly apdu: Buffer
  readonly since: number
  /** The page that sent it went away; set while it waits on the device. */
  aborted: boolean
  readonly answer: (answer: ApduAnswer) => void
}

/**
 * Speculos takes one APDU at a time, so the queue forwards one, holding the slot until Speculos's whole answer is read,
 * then the next in order. The newest session owns the device; another session's APDUs are refused with 409. An answer
 * of SW 0xE000 means the app wants the client's continuation, so until a final answer only that generation, session
 * and channel may send.
 */
export class ApduQueue {
  public generation = 1
  public owner: string | null = null
  private lock: { generation: number; sessionId: string; channel: number } | null = null
  private readonly waiting: QueuedApdu[] = []
  private busy: QueuedApdu | null = null
  private readonly send: (apdu: Buffer) => Promise<Buffer>
  private readonly onDispatch: (item: QueuedApdu) => void

  public constructor(send: (apdu: Buffer) => Promise<Buffer>, onDispatch: (item: QueuedApdu) => void = () => {}) {
    this.send = send
    this.onDispatch = onDispatch
  }

  /** A new session, which now owns the device. */
  public openSession(): BridgeSession {
    const sessionId = randomBytes(12).toString('hex')
    this.owner = sessionId
    // A continuation the old page owed can no longer come.
    this.lock = null
    this.supersede()
    this.pump()
    return { sessionId, generation: this.generation }
  }

  /** Ends every session: queued APDUs are refused and the next session gets a new generation. */
  public detach(): void {
    this.owner = null
    this.lock = null
    this.generation += 1
    this.supersede()
    this.pump()
  }

  public async submit(
    sent: { sessionId: string; channel: number; apdu: Buffer },
    signal?: AbortSignal,
  ): Promise<ApduAnswer> {
    return new Promise((settle) => {
      // A superseded APDU is answered at once and again when Speculos answers; only the first answer counts.
      let settled = false
      const answer = (result: ApduAnswer): void => {
        if (!settled) {
          settled = true
          settle(result)
        }
      }
      const item: QueuedApdu = { ...sent, generation: this.generation, since: Date.now(), aborted: false, answer }
      if (signal?.aborted === true) {
        answer({ status: 499, error: 'the page went away' })
        return
      }
      signal?.addEventListener(
        'abort',
        () => {
          this.abandon(item)
        },
        { once: true },
      )
      this.waiting.push(item)
      this.pump()
    })
  }

  /** The APDU Speculos is answering now. */
  public current(): QueuedApdu | null {
    return this.busy
  }

  public queued(): number {
    return this.waiting.length
  }

  /** True while `item`'s page is still there and owns the device on this generation. */
  private isLive(item: QueuedApdu): boolean {
    return !item.aborted && item.sessionId === this.owner && item.generation === this.generation
  }

  /**
   * After a takeover, the APDU still on the device belongs to a page that no longer owns it: answer that page now, and
   * mark the APDU abandoned so its prompt is rejected and the device frees up for the new owner.
   */
  private supersede(): void {
    const { busy } = this
    if (busy !== null && !this.isLive(busy)) {
      busy.aborted = true
      busy.answer({ status: 409, error: 'another page now owns the Ledger' })
    }
  }

  private abandon(item: QueuedApdu): void {
    const index = this.waiting.indexOf(item)
    if (index >= 0) {
      this.waiting.splice(index, 1)
      item.answer({ status: 499, error: 'the page went away' })
    } else if (this.busy === item) {
      item.aborted = true
    }
  }

  private pump(): void {
    // Refused at once, even while the device is busy, so a stale page never waits behind a prompt.
    for (const stale of this.waiting.filter((item) => !this.isLive(item))) {
      this.waiting.splice(this.waiting.indexOf(stale), 1)
      stale.answer({ status: 409, error: 'another page now owns the Ledger' })
    }
    if (this.busy !== null) {
      return
    }
    const { lock } = this
    const index =
      lock === null
        ? 0
        : this.waiting.findIndex(
            (item) =>
              item.generation === lock.generation && item.sessionId === lock.sessionId && item.channel === lock.channel,
          )
    const item = this.waiting[index]
    if (item === undefined) {
      return
    }
    this.waiting.splice(index, 1)
    this.busy = item
    this.onDispatch(item)
    void this.forward(item)
  }

  private async forward(item: QueuedApdu): Promise<void> {
    let answer: ApduAnswer
    try {
      const data = await this.send(item.apdu)
      const sw = data.length >= 2 ? data.readUInt16BE(data.length - 2) : 0
      const live = this.isLive(item)
      // Only the page that still owns the device can owe a continuation; an abandoned or superseded one never sends it.
      this.lock =
        live && sw === SW_INTERRUPT
          ? { generation: item.generation, sessionId: item.sessionId, channel: item.channel }
          : null
      answer = live ? { status: 200, data } : { status: 499, error: 'the page went away' }
    } catch (error) {
      this.lock = null
      answer = { status: 502, error: error instanceof Error ? error.message : String(error) }
    }
    this.busy = null
    item.answer(answer)
    this.pump()
  }
}

const ApduAnswerSchema = z.object({ data: z.string().regex(/^(?:[0-9a-f]{2})*$/i) })

/**
 * Speculos's `POST /apdu`, resolved only once its whole answer has been read. It uses node:http, not fetch: fetch gives
 * up on headers after 300 s, and Speculos sends none until the person has decided on the device.
 */
export function speculosApdu(baseUrl: string, timeoutMs = APDU_TIMEOUT_MS): (apdu: Buffer) => Promise<Buffer> {
  const url = new URL('/apdu', baseUrl)
  return async (apdu) => {
    const { status, body } = await new Promise<{ status: number; body: string }>((done, failed) => {
      const sent = request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json' }, timeout: timeoutMs },
        (answer) => {
          let text = ''
          answer.setEncoding('utf8')
          answer.on('data', (chunk: string) => {
            text += chunk
          })
          answer.on('end', () => {
            done({ status: answer.statusCode ?? 0, body: text })
          })
          answer.on('error', failed)
        },
      )
      sent.on('timeout', () => {
        sent.destroy(new Error(`Speculos /apdu gave no answer within ${Math.round(timeoutMs / 1000)} s`))
      })
      sent.on('error', failed)
      sent.end(JSON.stringify({ data: apdu.toString('hex') }))
    })
    let decoded: unknown
    try {
      decoded = JSON.parse(body)
    } catch {
      throw new Error(`Speculos /apdu answered HTTP ${status} with no JSON`)
    }
    const parsed = parseUnknown(ApduAnswerSchema, decoded)
    if (status !== 200 || parsed.isErr()) {
      throw new Error(`Speculos /apdu answered HTTP ${status} without an APDU`)
    }
    return Buffer.from(parsed.unwrap().data, 'hex')
  }
}

/** The page with the shim's script tag before `</head>`, else before `</body>`, else at the end. */
export function injectShim(html: string): string {
  if (html.includes(SHIM_TAG)) {
    return html
  }
  const at = /<\/head>/i.exec(html) ?? /<\/body>/i.exec(html)
  return at === null ? `${html}${SHIM_TAG}` : `${html.slice(0, at.index)}${SHIM_TAG}${html.slice(at.index)}`
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer | null {
  switch ((encoding ?? 'identity').trim().toLowerCase()) {
    case 'identity':
    case '':
      return body
    case 'gzip':
    case 'x-gzip':
      return gunzipSync(body)
    case 'br':
      return brotliDecompressSync(body)
    case 'deflate':
      return inflateSync(body)
    default:
      return null
  }
}

/** Header name and value pairs from Node's flat `rawHeaders`. */
function headerPairs(raw: readonly string[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let index = 0; index + 1 < raw.length; index += 2) {
    pairs.push([raw[index] ?? '', raw[index + 1] ?? ''])
  }
  return pairs
}

/** Forwards one request to Sentinel and its answer back unchanged, except that an HTML page gets the shim. */
function proxy(target: URL, req: IncomingMessage, res: ServerResponse): void {
  const upstream = request(
    { hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers: req.headers },
    (answer) => {
      const status = answer.statusCode ?? 502
      const html = /^text\/html\b/i.test(answer.headers['content-type'] ?? '')
      // Sentinel resetting after its headers ends this answer too, instead of leaving it open or throwing.
      answer.on('error', () => {
        res.destroy()
      })
      answer.on('close', () => {
        if (!answer.complete) {
          res.destroy()
        }
      })
      if (!html || req.method === 'HEAD' || status === 204 || status === 304) {
        res.writeHead(status, answer.statusMessage, answer.rawHeaders)
        answer.pipe(res)
        return
      }
      const chunks: Buffer[] = []
      answer.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })
      answer.on('end', () => {
        const raw = Buffer.concat(chunks)
        let page: Buffer | null
        try {
          page = decodeBody(raw, answer.headers['content-encoding'])
        } catch {
          page = null
        }
        if (page === null) {
          res.writeHead(status, answer.statusMessage, answer.rawHeaders)
          res.end(raw)
          return
        }
        const body = Buffer.from(injectShim(page.toString('utf8')))
        const kept = headerPairs(answer.rawHeaders).filter(
          ([name]) => !/^(?:content-length|content-encoding|transfer-encoding)$/i.test(name),
        )
        res.writeHead(status, answer.statusMessage, [...kept.flat(), 'Content-Length', String(body.length)])
        res.end(body)
      })
    },
  )
  upstream.on('error', (error) => {
    if (res.headersSent) {
      res.destroy()
      return
    }
    reply(res, 502, `The verify bridge could not reach Sentinel: ${error.message}`)
  })
  // A browser that goes away mid-answer stops Sentinel's side too.
  res.on('close', () => {
    if (!res.writableFinished) {
      upstream.destroy()
    }
  })
  req.pipe(upstream)
}

/** The `{"button"?: ...}` a press or reject sends, or null when the body is not one. */
function pressedButton(body: string): z.infer<typeof ButtonSchema> | null {
  try {
    return parseUnknown(ButtonSchema, body.trim() === '' ? {} : JSON.parse(body)).unwrapOr(null)
  } catch {
    return null
  }
}

async function readBody(req: IncomingMessage, limit = 64 * 1024): Promise<string> {
  let body = ''
  for await (const chunk of req) {
    body += String(chunk)
    if (body.length > limit) {
      throw new Error('request body too large')
    }
  }
  return body
}

/** Runs a route, answering `status` with the error when it throws before it answered. */
async function answered(res: ServerResponse, status: number, route: () => Promise<void>): Promise<void> {
  try {
    await route()
  } catch (error) {
    if (!res.headersSent) {
      reply(res, status, error instanceof Error ? error.message : String(error))
    }
  }
}

function reply(res: ServerResponse, status: number, body: string, type = 'text/plain'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done, failed) => {
    server.once('error', failed)
    server.listen(0, '127.0.0.1', () => {
      done()
    })
  })
  return boundPort(server.address())
}

const PROMPTS: ReadonlySet<ScreenKind> = new Set(['review', 'approve', 'reject', 'confirm-reject'])

const ButtonSchema = z.object({ button: z.enum(LEDGER_BUTTONS).optional() })

export interface BridgeOptions {
  /** The run's Sentinel. */
  target: string
  speculosUrl: string
  model: LedgerModel
  mode: BridgeMode
  token: string
  /** The bundled shim (`bundleShim`). */
  shim: string
  api?: SpeculosApi
  apduTimeoutMs?: number
  /** How often an APDU waiting on the device is checked for a prompt to approve or reject. */
  pollMs?: number
  log?: (line: string) => void
}

export interface Bridge {
  drivePort: number
  controlPort: number
  queue: ApduQueue
  mode: () => BridgeMode
  close: () => Promise<void>
}

/** A drive result as JSON, with any screenshot in base64. */
const DriveResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    trace: z.array(z.string()),
    ended: z.object({
      kind: z.enum(['idle', 'review', 'approve', 'reject', 'confirm-reject', 'result', 'unknown']),
      texts: z.array(z.string()),
    }),
  }),
  z.object({ ok: z.literal(false), trace: z.array(z.string()), reason: z.string(), screenshot: z.string().nullable() }),
])

const encodeResult = (result: DriveResult): z.infer<typeof DriveResultSchema> =>
  result.ok ? result : { ...result, screenshot: result.screenshot?.toString('base64') ?? null }

export async function startBridge(options: BridgeOptions): Promise<Bridge> {
  const log = options.log ?? console.log
  const api = options.api ?? speculosApi(options.speculosUrl)
  const { model } = options
  const pollMs = options.pollMs ?? 300
  const target = new URL(options.target)
  const expectedAuth = Buffer.from(`Bearer ${options.token}`)
  let mode = options.mode
  let attached = true

  // One drive at a time: a person's press or reject, auto-approve, or rejecting a prompt whose page went away.
  let driving: Promise<unknown> = Promise.resolve()
  const drive = async <T>(fn: () => Promise<T>): Promise<T> => {
    const run = driving.then(fn, fn)
    driving = run.catch(() => undefined)
    return run
  }

  const sleep = async (ms: number): Promise<void> =>
    new Promise((done) => {
      setTimeout(done, ms)
    })

  /** Watches an APDU on the device: approves its prompt in auto mode, and rejects it once its page has gone. */
  const watch = async (item: QueuedApdu): Promise<void> => {
    const wanted = (): Decision | null => (item.aborted ? 'reject' : mode === 'auto' ? 'approve' : null)
    while (queue.current() === item) {
      if (wanted() !== null) {
        await drive(async () => {
          const decision = wanted()
          const screen = queue.current() === item && decision !== null ? await api.screen().catch(() => null) : null
          if (decision === null || screen === null || !PROMPTS.has(classifyScreen(model, screen).kind)) {
            return
          }
          // A person taking over, or the page leaving, calls an auto-approval off before its next press.
          const result = await drivePrompt(api, model, decision, {
            shouldContinue: () => queue.current() === item && wanted() === decision,
          })
          log(
            `${decision === 'reject' ? 'rejected the prompt of a page that went away' : 'auto-approved a prompt'}: ${result.ok ? 'ok' : result.reason}`,
          )
        })
      }
      await sleep(pollMs)
    }
  }

  const queue = new ApduQueue(speculosApdu(options.speculosUrl, options.apduTimeoutMs), (item) => {
    void watch(item)
  })

  const events = new Set<ServerResponse>()
  const state = (): string => `generation=${queue.generation}&attached=${attached ? 1 : 0}`
  const broadcast = (): void => {
    for (const listener of events) {
      listener.write(`event: state\ndata: ${state()}\n\n`)
    }
  }

  // The ports the servers bound, once listening. Requests must name one of them as their Host, so a page whose own
  // name resolves to loopback (DNS rebinding) can't pass for the drive page.
  let drivePort = 0
  let controlPort = 0
  const loopbackHost = (req: IncomingMessage, port: number): string | null => {
    const host = (req.headers.host ?? '').toLowerCase()
    return host === `127.0.0.1:${port}` || host === `localhost:${port}` ? host : null
  }

  const ledgerRoute = async (req: IncomingMessage, res: ServerResponse, path: string): Promise<void> => {
    // A page on another origin must not drive the device through a visitor's browser.
    const { origin } = req.headers
    const host = loopbackHost(req, drivePort)
    if (
      host === null ||
      req.headers['sec-fetch-site'] === 'cross-site' ||
      (origin !== undefined && origin !== `http://${host}`)
    ) {
      reply(res, 403, 'cross-origin requests are not allowed')
      return
    }
    if (path === 'session' && req.method === 'GET') {
      const { productId, productName } = PRODUCTS[model]
      reply(
        res,
        200,
        new URLSearchParams({
          attached: attached ? '1' : '0',
          model,
          productId: String(productId),
          productName,
        }).toString(),
      )
      return
    }
    if (path === 'session' && req.method === 'POST') {
      if (!attached) {
        reply(res, 409, 'the Ledger is gone')
        return
      }
      const { sessionId, generation } = queue.openSession()
      log(`page opened session ${sessionId.slice(0, 6)} (generation ${generation})`)
      reply(res, 200, new URLSearchParams({ session: sessionId, generation: String(generation) }).toString())
      return
    }
    if (path === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
      res.write(`event: state\ndata: ${state()}\n\n`)
      events.add(res)
      res.on('close', () => {
        events.delete(res)
      })
      return
    }
    if (path === 'apdu' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req))
      const channel = Number(form.get('channel'))
      const hex = form.get('apdu') ?? ''
      const sessionId = form.get('session') ?? ''
      if (!Number.isInteger(channel) || channel < 0 || channel > 0xffff || !/^(?:[0-9a-f]{2})+$/i.test(hex)) {
        reply(res, 400, 'expected session, channel and apdu')
        return
      }
      // The request body is already read, so its own close event says nothing; the response closing early does.
      const gone = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) {
          gone.abort()
        }
      })
      const answer = await queue.submit({ sessionId, channel, apdu: Buffer.from(hex, 'hex') }, gone.signal)
      if (answer.status === 200) {
        log(`APDU of ${hex.length / 2} bytes answered with SW ${answer.data.subarray(-2).toString('hex')}`)
        reply(res, 200, answer.data.toString('hex'))
      } else {
        log(`APDU of ${hex.length / 2} bytes not answered: ${answer.error}`)
        reply(res, answer.status, answer.error)
      }
      return
    }
    reply(res, 404, 'unknown bridge route')
  }

  const driveServer = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://bridge').pathname
    if (path === SHIM_FILE) {
      reply(res, 200, options.shim, 'text/javascript; charset=utf-8')
      return
    }
    if (path.startsWith(`${SHIM_ROUTE}/`)) {
      void answered(res, 400, async () => ledgerRoute(req, res, path.slice(SHIM_ROUTE.length + 1)))
      return
    }
    proxy(target, req, res)
  })

  const controlRoute = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const path = new URL(req.url ?? '/', 'http://bridge').pathname
    if (path === '/status' && req.method === 'GET') {
      const busy = queue.current()
      reply(
        res,
        200,
        JSON.stringify({
          model,
          mode,
          generation: queue.generation,
          queued: queue.queued(),
          inFlight:
            busy === null ? null : { seconds: Math.round((Date.now() - busy.since) / 1000), aborted: busy.aborted },
        }),
        'application/json',
      )
      return
    }
    if (path === '/screenshot' && req.method === 'GET') {
      const png = await drive(async () => api.screenshot())
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(png)
      return
    }
    if ((path === '/press' || path === '/reject') && req.method === 'POST') {
      const pressed = pressedButton(await readBody(req))
      if (pressed === null) {
        reply(res, 400, 'expected {"button"?: one of the Ledger buttons}')
        return
      }
      if (mode === 'auto') {
        log('a manual press or reject turned auto-approve off')
      }
      mode = 'manual'
      const { button } = pressed
      const result = await drive(async () =>
        path === '/reject'
          ? drivePrompt(api, model, 'reject')
          : button === undefined
            ? drivePrompt(api, model, 'approve')
            : pressOnce(api, model, button),
      )
      reply(res, 200, JSON.stringify(encodeResult(result)), 'application/json')
      return
    }
    reply(res, 404, 'unknown control route')
  }

  const controlServer = createServer((req, res) => {
    const auth = Buffer.from(req.headers.authorization ?? '')
    // Browsers send Origin on every request a page makes here; the CLI never does. No CORS headers are ever sent.
    if (req.headers.origin !== undefined || loopbackHost(req, controlPort) === null) {
      reply(res, 403, 'the control API is not for web pages')
      return
    }
    if (auth.length !== expectedAuth.length || !timingSafeEqual(auth, expectedAuth)) {
      reply(res, 401, 'missing or wrong bearer token')
      return
    }
    void answered(res, 500, async () => controlRoute(req, res))
  })

  drivePort = await listen(driveServer)
  controlPort = await listen(controlServer)
  return {
    drivePort,
    controlPort,
    queue,
    mode: () => mode,
    close: async () => {
      attached = false
      queue.detach()
      broadcast()
      for (const listener of events) {
        listener.end()
      }
      for (const server of [driveServer, controlServer]) {
        server.closeAllConnections()
        await new Promise<void>((done) => {
          server.close(() => {
            done()
          })
        })
      }
    },
  }
}

/** The shim as one browser script, bundled from webhid-shim.ts in memory. */
export async function bundleShim(): Promise<string> {
  const result = await build({
    stdin: {
      contents: "import { installWebHidShim } from './webhid-shim'\ninstallWebHidShim(globalThis)\n",
      resolveDir: import.meta.dirname,
      sourcefile: 'webhid-shim-entry.ts',
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
  })
  const [file] = result.outputFiles
  if (file === undefined) {
    throw new Error('esbuild produced no shim')
  }
  return file.text
}

const BridgeStatusSchema = z.object({
  model: z.string(),
  mode: z.enum(BRIDGE_MODES),
  generation: z.number(),
  queued: z.number(),
  inFlight: z.object({ seconds: z.number(), aborted: z.boolean() }).nullable(),
})
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>

/** The control API, as the CLI, doctor and evidence use it. */
export interface BridgeControl {
  status: () => Promise<BridgeStatus>
  press: (button?: string) => Promise<DriveResult>
  reject: () => Promise<DriveResult>
  screenshot: () => Promise<Buffer>
}

export function bridgeControl(record: BridgeRecord, timeoutMs = 120_000): BridgeControl {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(`http://127.0.0.1:${record.controlPort}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${record.token}`, 'content-type': 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      throw new Error(`the bridge's control API answered HTTP ${response.status}: ${await response.text()}`)
    }
    return response
  }
  const driven = async (path: string, body: { button?: string }): Promise<DriveResult> => {
    const answer = await call(path, { method: 'POST', body: JSON.stringify(body) })
    const parsed = parseUnknown(DriveResultSchema, await answer.json())
    if (parsed.isErr()) {
      throw new Error('the bridge answered a drive with an unexpected shape')
    }
    const result = parsed.unwrap()
    return result.ok
      ? result
      : { ...result, screenshot: result.screenshot === null ? null : Buffer.from(result.screenshot, 'base64') }
  }
  return {
    status: async () => {
      const parsed = parseUnknown(BridgeStatusSchema, await (await call('/status')).json())
      if (parsed.isErr()) {
        throw new Error('the bridge answered /status with an unexpected shape')
      }
      return parsed.unwrap()
    },
    press: async (button) => driven('/press', button === undefined ? {} : { button }),
    reject: async () => driven('/reject', {}),
    screenshot: async () => Buffer.from(await (await call('/screenshot')).arrayBuffer()),
  }
}
