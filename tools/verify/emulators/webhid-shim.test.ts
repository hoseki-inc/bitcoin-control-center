import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import createHIDframing from '@ledgerhq/hw-transport-webhid/lib/hid-framing'
import { describe, it } from 'vitest'
import { bundleShim } from './ledger-bridge'
import {
  ApduAssembler,
  LEDGER_VENDOR_ID,
  SHIM_ROUTE,
  type ShimDevice,
  type ShimHid,
  type ShimInputReport,
  type ShimScope,
  installWebHidShim,
  responseFrames,
} from './webhid-shim'

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex')
const frameOf = (event: Event): Buffer => {
  assert.ok('data' in event && event.data instanceof DataView)
  return Buffer.from(event.data.buffer)
}
const urlOf = (input: RequestInfo | URL): string => (input instanceof Request ? input.url : input.toString())

interface FakeBridge {
  fetch: typeof fetch
  sent: URLSearchParams[]
}

/** A bridge double: answers each APDU with `answer`, or with `status` when set, and logs what the shim sent. */
function fakeBridge(answer: string, status = 200): FakeBridge {
  const sent: URLSearchParams[] = []
  const fake = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = urlOf(input)
    if (url === `${SHIM_ROUTE}/session` && init?.method === 'POST') {
      return new Response('session=s1&generation=1')
    }
    if (url === `${SHIM_ROUTE}/session`) {
      return new Response('attached=1&model=flex&productId=28689&productName=Ledger+Flex')
    }
    if (url === `${SHIM_ROUTE}/apdu`) {
      sent.push(init?.body instanceof URLSearchParams ? init.body : new URLSearchParams())
      return new Response(answer, { status })
    }
    return new Response('not found', { status: 404 })
  }
  return { fetch: fake, sent }
}

/** The shim a fresh page installs. */
function install(scope: ShimScope): ShimHid {
  const hid = installWebHidShim(scope)
  assert.ok(hid !== null)
  return hid
}

async function shimDevice(scope: ShimScope): Promise<ShimDevice> {
  const [device] = await install(scope).requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] })
  assert.ok(device !== undefined)
  await device.open()
  return device
}

/** Ledger's HID framing for one APDU on `channel`, as DMK writes it: the same layout as LedgerJS, written out by hand. */
function dmkFrames(channel: number, apdu: Uint8Array): Array<Uint8Array<ArrayBuffer>> {
  const payload = Buffer.concat([Buffer.from([apdu.length >> 8, apdu.length & 0xff]), apdu])
  const frames: Array<Uint8Array<ArrayBuffer>> = []
  for (let offset = 0, seq = 0; offset < payload.length; offset += 59, seq += 1) {
    const frame = new Uint8Array(64)
    frame.set([channel >> 8, channel & 0xff, 0x05, seq >> 8, seq & 0xff])
    frame.set(payload.subarray(offset, offset + 59), 5)
    frames.push(frame)
  }
  return frames
}

/** Where a test's EventSource double hands the test its way to send the bridge's events. */
interface StateStream {
  send?: (data: string) => void
}

const GET_VERSION = Uint8Array.from([0xb0, 0x01, 0x00, 0x00, 0x00])

/** A storage double that survives a reload, as localStorage does. */
function storage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const store = new Map<string, string>()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value)
    },
    removeItem: (key) => {
      store.delete(key)
    },
  }
}

describe('WebHID shim framing', { timeout: 15_000 }, () => {
  // Channels (LEDGER-DMK.md and @ledgerhq/hw-transport-webhid 6.36): older LedgerJS framing used a fixed 0x0101; LedgerJS
  // now, and DMK, pick a random one. Listeners: LedgerJS uses addEventListener, DMK sets oninputreport.
  it('answers the fixed 0x0101 channel of older LedgerJS framing through oninputreport, as DMK listens', async () => {
    const bridge = fakeBridge('01059000')
    const device = await shimDevice({ navigator: {}, fetch: bridge.fetch })
    const reports: Buffer[] = []
    device.oninputreport = (event: ShimInputReport) => {
      reports.push(frameOf(event))
    }
    for (const frame of dmkFrames(0x0101, GET_VERSION)) {
      await device.sendReport(0, frame)
    }
    const [sent] = bridge.sent
    assert.ok(sent !== undefined)
    assert.equal(sent.get('channel'), String(0x0101))
    assert.equal(sent.get('apdu'), hex(GET_VERSION))
    assert.equal(reports.length, 1)
    const frame = reports[0] ?? Buffer.alloc(0)
    assert.equal(frame.length, 64)
    assert.equal(hex(frame.subarray(0, 9)), '010105000000040105')
    assert.equal(hex(frame.subarray(9, 11)), '9000')
  })

  it('answers a random channel, as LedgerJS and DMK pick, to addEventListener (LedgerJS) and oninputreport (DMK) alike', async () => {
    const channel = 0xbeef
    const framing = createHIDframing(channel, 64)
    const bridge = fakeBridge('9000')
    const device = await shimDevice({ navigator: {}, fetch: bridge.fetch })
    const viaListener: Buffer[] = []
    const viaHandler: Buffer[] = []
    device.addEventListener('inputreport', (event) => {
      viaListener.push(frameOf(event))
    })
    device.oninputreport = (event: ShimInputReport) => {
      viaHandler.push(Buffer.from(event.data.buffer))
    }
    for (const block of framing.makeBlocks(Buffer.from(GET_VERSION))) {
      await device.sendReport(0, block)
    }
    assert.equal(bridge.sent[0]?.get('channel'), String(channel))
    assert.deepEqual(viaListener, viaHandler)
    const acc = viaHandler.reduce<ReturnType<typeof framing.reduceResponse>>(
      (sum, chunk) => framing.reduceResponse(sum, chunk),
      null,
    )
    assert.equal(framing.getReducedResult(acc)?.toString('hex'), '9000')
  })

  it('splits a 113-byte answer over two frames the LedgerJS framer joins back', async () => {
    const answer = Buffer.alloc(113, 0xab)
    answer.writeUInt16BE(0x9000, 111)
    const channel = 0x1234
    const framing = createHIDframing(channel, 64)
    // A long APDU too, so the shim joins the host's frames before sending.
    const long = Buffer.alloc(150, 0x11)
    const bridge = fakeBridge(answer.toString('hex'))
    const device = await shimDevice({ navigator: {}, fetch: bridge.fetch })
    const frames: Buffer[] = []
    device.oninputreport = (event: ShimInputReport) => {
      frames.push(Buffer.from(event.data.buffer))
    }
    for (const block of framing.makeBlocks(long)) {
      await device.sendReport(0, block)
    }
    assert.equal(bridge.sent.length, 1)
    assert.equal(bridge.sent[0]?.get('apdu'), long.toString('hex'))
    assert.deepEqual(
      frames.map((frame) => [frame.length, frame.readUInt16BE(0), frame.readUInt16BE(3)]),
      [
        [64, channel, 0],
        [64, channel, 1],
      ],
    )
    const acc = frames.reduce<ReturnType<typeof framing.reduceResponse>>(
      (sum, chunk) => framing.reduceResponse(sum, chunk),
      null,
    )
    assert.equal(framing.getReducedResult(acc)?.toString('hex'), answer.toString('hex'))
    assert.deepEqual(
      responseFrames(channel, answer).map((frame) => hex(frame)),
      frames.map((frame) => hex(frame)),
    )
  })

  it('refuses a continuation frame on another channel instead of mixing two APDUs', () => {
    const assembler = new ApduAssembler()
    const [first, second] = dmkFrames(0x0101, new Uint8Array(100))
    assert.ok(first !== undefined && second !== undefined)
    assert.equal(assembler.push(first), null)
    const stray = second.slice()
    stray.set([0x02, 0x02], 0)
    assert.throws(() => assembler.push(stray), /HID frame 1 on channel 514 does not continue/)
    // After the refusal it starts over cleanly.
    assert.equal(assembler.push(first), null)
    assert.equal(assembler.push(second)?.apdu.length, 100)
  })

  it('rejects sendReport with a NetworkError naming the write when the bridge refuses a stale page', async () => {
    const bridge = fakeBridge('another page now owns the Ledger', 409)
    const device = await shimDevice({ navigator: {}, fetch: bridge.fetch })
    const [frame] = dmkFrames(0x0101, GET_VERSION)
    assert.ok(frame !== undefined)
    await assert.rejects(device.sendReport(0, frame), { name: 'NetworkError', message: /write/ })
  })

  it('rejects sendReport with a NetworkError naming the write when the bridge cannot be reached', async () => {
    const unreachable: typeof fetch = async (input, init) =>
      urlOf(input).endsWith('/apdu')
        ? Promise.reject(new TypeError('Failed to fetch'))
        : fakeBridge('').fetch(input, init)
    const device = await shimDevice({ navigator: {}, fetch: unreachable })
    const [frame] = dmkFrames(0x0101, GET_VERSION)
    assert.ok(frame !== undefined)
    await assert.rejects(device.sendReport(0, frame), (error: Error) => {
      assert.ok(error instanceof DOMException)
      return error.name === 'NetworkError' && error.message.includes('write')
    })
  })

  it('turns the bridge saying the Ledger is gone into an HID disconnect for an open device', async () => {
    // An EventSource double: the test sends the bridge's `state` events through it.
    const stream: StateStream = {}
    class FakeEventSource extends EventTarget {
      public constructor(_url: string) {
        super()
        stream.send = (data: string): void => {
          this.dispatchEvent(new MessageEvent('state', { data }))
        }
      }
    }
    const navigator = {}
    const hid = install({
      navigator,
      fetch: fakeBridge('9000').fetch,
      EventSource: FakeEventSource,
    })
    const [device] = await hid.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] })
    assert.ok(device !== undefined)
    await device.open()
    const disconnects: Array<{ type: string; device: unknown }> = []
    hid.addEventListener('disconnect', (event) => {
      disconnects.push({ type: event.type, device: 'device' in event ? event.device : null })
    })
    let handler = 0
    hid.ondisconnect = () => {
      handler += 1
    }
    const emit = stream.send
    assert.ok(emit !== undefined)
    // The same generation, still attached: nothing happens.
    emit('generation=1&attached=1')
    assert.deepEqual(disconnects, [])
    emit('generation=2&attached=0')
    assert.deepEqual(disconnects, [{ type: 'disconnect', device }])
    assert.equal(handler, 1)
    assert.equal(device.opened, false)
    await assert.rejects(device.sendReport(0, new Uint8Array(64)), { name: 'InvalidStateError' })
  })

  it('lists the device after a grant, keeps it over a reload through storage, and needs no user activation', async () => {
    const localStorage = storage()
    const bridge = fakeBridge('9000')
    const hid = install({ navigator: {}, fetch: bridge.fetch, localStorage })
    assert.deepEqual(await hid.getDevices(), [])
    // No navigator.userActivation anywhere in this scope: the chooser still answers.
    const [device] = await hid.requestDevice({ filters: [{ vendorId: LEDGER_VENDOR_ID }] })
    assert.equal(device?.productId, 0x7011)
    assert.deepEqual(await hid.requestDevice({ filters: [{ vendorId: 0x1209 }] }), [])
    const reloaded = install({ navigator: {}, fetch: bridge.fetch, localStorage })
    assert.equal((await reloaded.getDevices()).length, 1)
  })
})

/** Runs in the page realm: picks the Ledger, opens it, sends GET VERSION on 0x0101, and resolves with the answer. */
const EXCHANGE = `(async () => {
  const [device] = await navigator.hid.requestDevice({ filters: [{ vendorId: 0x2c97 }] })
  await device.open()
  let answer = null
  device.oninputreport = (event) => { answer = new Uint8Array(event.data.buffer) }
  const frame = new Uint8Array(64)
  frame.set([0x01, 0x01, 0x05, 0x00, 0x00, 0x00, 0x05, 0xb0, 0x01, 0x00, 0x00, 0x00])
  await device.sendReport(0, frame)
  return Array.from(answer.subarray(0, 9), (b) => b.toString(16).padStart(2, '0')).join('')
})()`

describe('WebHID shim bundle', { timeout: 30_000 }, () => {
  it('runs in a bare browser-like realm with no Node or tsx helpers, and drives an APDU', async () => {
    const code = await bundleShim()
    assert.doesNotMatch(code, /\brequire\(|\bprocess\.|__dirname|import\.meta|__name\(/)
    const bridge = fakeBridge('9000')
    // Only what a page has: no require, process, Buffer or module.
    const page = { navigator: {}, fetch: bridge.fetch, Event, EventTarget, DOMException, URLSearchParams }
    runInNewContext(code, page, { filename: 'webhid-shim.js' })
    assert.ok('hid' in page.navigator)
    const { hid } = page.navigator
    assert.notEqual(hid, undefined)
    const answer: unknown = await Promise.resolve(runInNewContext(EXCHANGE, page))
    assert.equal(answer, '010105000000029000')
    assert.equal(bridge.sent[0]?.get('apdu'), hex(GET_VERSION))
    // A second run of the same script in the page leaves the first shim in place.
    runInNewContext(code, page)
    assert.equal(page.navigator.hid, hid)
  })
})
