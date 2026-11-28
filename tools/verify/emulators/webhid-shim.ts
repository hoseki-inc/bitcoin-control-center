// Runs in the page the Ledger bridge's drive proxy serves (ledger-bridge.ts bundles it with esbuild), never in Node.
// It replaces navigator.hid with one Ledger whose HID reports travel to the bridge over HTTP, so Control Center's own
// WebHID transport, and DMK's, drive the Speculos emulator unchanged. Frames follow Ledger's HID framing: channel (2
// bytes), tag 0x05, sequence (2), then on the first frame the APDU length (2), zero-padded to 64 bytes. Every answer
// frame carries the channel the host wrote on, and each is dispatched to `inputreport` listeners and to
// `oninputreport`, because LedgerJS listens one way and DMK the other.

export const LEDGER_VENDOR_ID = 0x2c97
export const SHIM_ROUTE = '/__bcc_verify/ledger'
const FRAME_SIZE = 64
const HEADER_SIZE = 5
const TAG_APDU = 0x05
const GRANT_KEY = 'bcc-verify:hid-granted'

/** The 64-byte frames that carry `data` to the host on `channel`. */
export function responseFrames(channel: number, data: Uint8Array): Uint8Array[] {
  const payload = new Uint8Array(data.length + 2)
  payload.set([data.length >> 8, data.length & 0xff])
  payload.set(data, 2)
  const frames: Uint8Array[] = []
  for (let offset = 0, seq = 0; offset < payload.length; seq += 1) {
    const frame = new Uint8Array(FRAME_SIZE)
    frame.set([channel >> 8, channel & 0xff, TAG_APDU, seq >> 8, seq & 0xff])
    const chunk = payload.subarray(offset, offset + FRAME_SIZE - HEADER_SIZE)
    frame.set(chunk, HEADER_SIZE)
    offset += chunk.length
    frames.push(frame)
  }
  return frames
}

/** Joins the host's frames back into one APDU, refusing a frame with the wrong tag, sequence or channel. */
export class ApduAssembler {
  private channel = 0
  private seq = 0
  private length = 0
  private received: number[] = []

  public push(frame: Uint8Array): { channel: number; apdu: Uint8Array } | null {
    const channel = ((frame[0] ?? 0) << 8) | (frame[1] ?? 0)
    const seq = ((frame[3] ?? 0) << 8) | (frame[4] ?? 0)
    if (frame[2] !== TAG_APDU || seq !== this.seq || (seq > 0 && channel !== this.channel)) {
      this.seq = 0
      this.received = []
      throw new Error(`HID frame ${seq} on channel ${channel} does not continue the APDU being written`)
    }
    let body = frame.subarray(HEADER_SIZE)
    if (seq === 0) {
      this.channel = channel
      this.length = ((body[0] ?? 0) << 8) | (body[1] ?? 0)
      this.received = []
      body = body.subarray(2)
    }
    this.received.push(...body.subarray(0, this.length - this.received.length))
    this.seq += 1
    if (this.received.length < this.length) {
      return null
    }
    this.seq = 0
    return { channel, apdu: Uint8Array.from(this.received) }
  }
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16))

/** What the page needs from its window. A test passes its own. */
export interface ShimScope {
  navigator: object
  fetch: typeof fetch
  /** The page's EventSource; only `addEventListener` is used. */
  EventSource?: new (url: string) => EventTarget
  localStorage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
}

interface LedgerInfo {
  productId: number
  productName: string
}

/** An HIDInputReportEvent: the device, report 0, and one 64-byte frame. */
export class ShimInputReport extends Event {
  public readonly device: ShimDevice
  public readonly reportId = 0
  public readonly data: DataView

  public constructor(device: ShimDevice, data: DataView) {
    super('inputreport')
    this.device = device
    this.data = data
  }
}

/** An HIDConnectionEvent for the device going away. */
export class ShimConnectionEvent extends Event {
  public readonly device: ShimDevice

  public constructor(type: 'connect' | 'disconnect', device: ShimDevice) {
    super(type)
    this.device = device
  }
}

/** One emulated Ledger: an HIDDevice whose reports go to the bridge. */
export class ShimDevice extends EventTarget {
  public readonly vendorId = LEDGER_VENDOR_ID
  public readonly productId: number
  public readonly productName: string
  public readonly collections = [{ usagePage: 0xffa0, usage: 0x01, inputReports: [], outputReports: [] }]
  public oninputreport: ((this: ShimDevice, event: ShimInputReport) => void) | null = null
  public opened = false
  /** The bridge session this page holds, and the device generation it was opened on. */
  public session: string | null = null
  public generation: string | null = null
  private readonly scope: ShimScope
  private readonly assembler = new ApduAssembler()

  public constructor(scope: ShimScope, info: LedgerInfo) {
    super()
    this.scope = scope
    this.productId = info.productId
    this.productName = info.productName
  }

  public async open(): Promise<void> {
    const response = await this.scope.fetch(`${SHIM_ROUTE}/session`, { method: 'POST' })
    if (!response.ok) {
      throw new DOMException('Failed to open the device.', 'NetworkError')
    }
    const answer = new URLSearchParams(await response.text())
    this.session = answer.get('session')
    this.generation = answer.get('generation')
    this.opened = true
  }

  public async close(): Promise<void> {
    this.opened = false
    this.session = null
  }

  public async forget(): Promise<void> {
    await this.close()
    try {
      this.scope.localStorage?.removeItem(GRANT_KEY)
    } catch {
      // Storage is blocked; the grant only lasts this page.
    }
  }

  public async sendReport(_reportId: number, data: BufferSource): Promise<void> {
    if (!this.opened || this.session === null) {
      throw new DOMException(
        "Failed to execute 'sendReport' on 'HIDDevice': The device must be opened first.",
        'InvalidStateError',
      )
    }
    const bytes = ArrayBuffer.isView(data)
      ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice()
      : new Uint8Array(data).slice()
    const written = this.assembler.push(bytes)
    if (written === null) {
      return
    }
    const body = new URLSearchParams({
      session: this.session,
      channel: String(written.channel),
      apdu: toHex(written.apdu),
    })
    // The bridge answers once Speculos has, which for a prompt is after the decision on the device.
    // A stale session, the device gone, or the bridge unreachable: TransportWebHID reads "write" as a disconnect.
    const response = await this.scope.fetch(`${SHIM_ROUTE}/apdu`, { method: 'POST', body }).catch(() => null)
    if (response === null || !response.ok) {
      throw new DOMException('Failed to write the report.', 'NetworkError')
    }
    for (const frame of responseFrames(written.channel, fromHex(await response.text()))) {
      const event = new ShimInputReport(this, new DataView(frame.buffer))
      this.dispatchEvent(event)
      this.oninputreport?.call(this, event)
    }
  }

  public async sendFeatureReport(): Promise<void> {
    throw new DOMException('A Ledger has no feature reports.', 'NotSupportedError')
  }

  public async receiveFeatureReport(): Promise<DataView> {
    throw new DOMException('A Ledger has no feature reports.', 'NotSupportedError')
  }
}

/** navigator.hid with the bridge's Ledger as its only device. */
export class ShimHid extends EventTarget {
  public onconnect: ((this: ShimHid, event: ShimConnectionEvent) => void) | null = null
  public ondisconnect: ((this: ShimHid, event: ShimConnectionEvent) => void) | null = null
  private readonly scope: ShimScope
  private device: ShimDevice | null = null

  public constructor(scope: ShimScope) {
    super()
    this.scope = scope
  }

  /** The Ledger, once permission was granted on this origin, as Chrome keeps it across reloads. */
  public async getDevices(): Promise<ShimDevice[]> {
    let granted = false
    try {
      granted = this.scope.localStorage?.getItem(GRANT_KEY) === '1'
    } catch {
      // Storage is blocked: nothing was granted before this page.
    }
    const device = granted || this.device !== null ? await this.ledger() : null
    return device === null ? [] : [device]
  }

  /**
   * Picks the Ledger as Chrome's chooser would, with no user-activation check: Control Center asks for the device
   * inside a React state update, and a driver's click may not count as a gesture.
   */
  public async requestDevice(options?: { filters?: Array<{ vendorId?: number }> }): Promise<ShimDevice[]> {
    const filters = options?.filters ?? []
    if (
      filters.length > 0 &&
      !filters.some((filter) => filter.vendorId === undefined || filter.vendorId === LEDGER_VENDOR_ID)
    ) {
      return []
    }
    const device = await this.ledger()
    if (device !== null) {
      try {
        this.scope.localStorage?.setItem(GRANT_KEY, '1')
      } catch {
        // Storage is blocked; the grant only lasts this page.
      }
    }
    return device === null ? [] : [device]
  }

  /** Tells the page its Ledger went away, as unplugging it would. */
  public lose(): void {
    const { device } = this
    if (device === null || !device.opened) {
      return
    }
    device.opened = false
    device.session = null
    const event = new ShimConnectionEvent('disconnect', device)
    this.dispatchEvent(event)
    this.ondisconnect?.call(this, event)
  }

  public currentDevice(): ShimDevice | null {
    return this.device
  }

  private async ledger(): Promise<ShimDevice | null> {
    if (this.device !== null) {
      return this.device
    }
    const response = await this.scope.fetch(`${SHIM_ROUTE}/session`)
    const info = new URLSearchParams(response.ok ? await response.text() : '')
    if (info.get('attached') !== '1') {
      return null
    }
    this.device = new ShimDevice(this.scope, {
      productId: Number(info.get('productId')),
      productName: info.get('productName') ?? 'Ledger',
    })
    return this.device
  }
}

const INSTALLED = Symbol.for('bcc-verify.webhid-shim')

/**
 * Replaces `navigator.hid` in this page, and listens for the bridge saying the device went away. Returns the shim, or
 * null when a shim is already there, as when the script runs twice.
 */
export function installWebHidShim(scope: ShimScope): ShimHid | null {
  if (INSTALLED in scope.navigator) {
    return null
  }
  const hid = new ShimHid(scope)
  Object.defineProperty(scope.navigator, 'hid', { value: hid, configurable: true, enumerable: true })
  Object.defineProperty(scope.navigator, INSTALLED, { value: true })
  if (scope.EventSource === undefined) {
    return hid
  }
  const events = new scope.EventSource(`${SHIM_ROUTE}/events`)
  events.addEventListener('state', (event) => {
    const state = new URLSearchParams(event instanceof MessageEvent ? String(event.data) : '')
    const device = hid.currentDevice()
    if (device?.opened === true && (state.get('attached') !== '1' || state.get('generation') !== device.generation)) {
      hid.lose()
    }
  })
  return hid
}
