import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import type { LedgerModel } from '../run'

// Reads the Speculos screen and works its buttons (Nano S Plus) or touchscreen (Flex) as a person would. Each screen
// is classified strictly from its text; a screen the driver doesn't know stops it with a screenshot, so it never
// presses through something it can't read.

const ElementSchema = z.object({ text: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const EventsSchema = z.object({ events: z.array(ElementSchema) })
export type ScreenElement = z.infer<typeof ElementSchema>

/** The screen in the body of a Speculos `/events` answer, or null when it isn't one. */
export function screenFromEvents(body: string): ScreenElement[] | null {
  let decoded: unknown
  try {
    decoded = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = parseUnknown(EventsSchema, decoded)
  return parsed.isOk() ? parsed.unwrap().events : null
}

export const NANO_BUTTONS = ['left', 'right', 'both'] as const
export type NanoButton = (typeof NANO_BUTTONS)[number]

/** The Speculos REST API the driver uses. */
export interface SpeculosApi {
  screen: () => Promise<ScreenElement[]>
  screenshot: () => Promise<Buffer>
  button: (button: NanoButton) => Promise<void>
  finger: (x: number, y: number, delay: number) => Promise<void>
}

export function speculosApi(baseUrl: string): SpeculosApi {
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      throw new Error(`Speculos ${init.method ?? 'GET'} ${path} answered HTTP ${response.status}`)
    }
    return response
  }
  const post = async (path: string, body: Readonly<Record<string, string | number>>): Promise<void> => {
    await (
      await call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    ).arrayBuffer()
  }
  return {
    screen: async () => {
      const elements = screenFromEvents(await (await call('/events?currentscreenonly=true')).text())
      if (elements === null) {
        throw new Error('Speculos /events did not answer the expected JSON')
      }
      return elements
    },
    screenshot: async () => Buffer.from(await (await call('/screenshot')).arrayBuffer()),
    button: async (button) => post(`/button/${button}`, { action: 'press-and-release' }),
    finger: async (x, y, delay) => post('/finger', { action: 'press-and-release', x, y, delay }),
  }
}

export type ScreenKind =
  /** The Bitcoin app's home screen. */
  | 'idle'
  /** A page of a review to page through. */
  | 'review'
  /** The page whose confirm action approves. */
  | 'approve'
  /** Nano S Plus: the page whose confirm action rejects. */
  | 'reject'
  /** Flex: "Reject …?", answered with "Yes, reject". */
  | 'confirm-reject'
  /** The outcome shown after a decision; the Flex keeps it until tapped. */
  | 'result'
  | 'unknown'

export interface Screen {
  kind: ScreenKind
  texts: string[]
}

// Screen text from app-bitcoin 2.5.1 under Speculos 0.27.4 (LEDGER-EMU-SPIKE.md), matched exactly.
const NANO_REVIEW = /^(?:Review message|Confirm public key|Path|Message \(\d+\/\d+\)|Public key \(\d+\/\d+\))$/
const NANO_APPROVE = new Set(['Sign message', 'Approve public key'])
const NANO_REJECT = new Set(['Reject message', 'Reject operation'])
const RESULTS = new Set(['Public key approved', 'Public key rejected', 'Message signed', 'Message rejected'])
// A message too long to share the Path page gets a page of its own, headed "Message content".
const FLEX_REVIEW = new Set(['Review message', 'Confirm public key', 'Path', 'Message content'])

function kindOf(model: LedgerModel, texts: readonly string[]): ScreenKind {
  const has = (text: string): boolean => texts.includes(text)
  const [first = ''] = texts
  const joined = texts.join(' ')
  if (RESULTS.has(joined)) {
    return 'result'
  }
  if (model === 'nanosp') {
    if (joined === 'Bitcoin app is ready') {
      return 'idle'
    }
    if (NANO_APPROVE.has(joined)) {
      return 'approve'
    }
    if (NANO_REJECT.has(joined)) {
      return 'reject'
    }
    return NANO_REVIEW.test(first) ? 'review' : 'unknown'
  }
  if (first === 'Bitcoin' && has('This app enables signing') && has('Quit app')) {
    return 'idle'
  }
  if ((first === 'Reject message?' || first === 'Reject operation?') && has('Yes, reject')) {
    return 'confirm-reject'
  }
  if (!has('Reject')) {
    return 'unknown'
  }
  // "Approve public key" is the page's title; only the exact "Approve" element is the button.
  if ((first === 'Approve public key' && has('Approve')) || (first === 'Sign message?' && has('Hold to sign'))) {
    return 'approve'
  }
  return FLEX_REVIEW.has(first) ? 'review' : 'unknown'
}

export function classifyScreen(model: LedgerModel, elements: readonly ScreenElement[]): Screen {
  const texts = elements.map((element) => element.text)
  return { kind: kindOf(model, texts), texts }
}

/** One thing to do to the device. */
export type DeviceAction =
  | { type: 'button'; button: NanoButton }
  | { type: 'tap'; x: number; y: number; delay: number; label: string }

/** The Flex's text-less Next arrow and the spot that dismisses a result screen. */
export const FLEX_NEXT = { x: 415, y: 550 } as const
export const FLEX_DISMISS = { x: 240, y: 300 } as const
const TAP_DELAY = 0.1
/** Flex "Hold to sign" needs a long press. */
export const HOLD_DELAY = 2.5

function tapOn(elements: readonly ScreenElement[], text: string, delay = TAP_DELAY): DeviceAction | null {
  const element = elements.find((candidate) => candidate.text === text)
  return element === undefined
    ? null
    : {
        type: 'tap',
        x: Math.round(element.x + element.w / 2),
        y: Math.round(element.y + element.h / 2),
        delay,
        label: text,
      }
}

export type Decision = 'approve' | 'reject'

/**
 * What to do on this screen to carry `decision` through, or null when the device needs nothing (idle, or a Nano
 * result screen that returns by itself). Undefined means the screen can't be handled and the driver must stop.
 */
export function nextAction(
  model: LedgerModel,
  screen: Screen,
  elements: readonly ScreenElement[],
  decision: Decision,
): DeviceAction | null | undefined {
  if (screen.kind === 'idle') {
    return null
  }
  if (model === 'nanosp') {
    switch (screen.kind) {
      case 'review':
        return { type: 'button', button: 'right' }
      case 'approve':
        return { type: 'button', button: decision === 'approve' ? 'both' : 'right' }
      case 'reject':
        return decision === 'reject' ? { type: 'button', button: 'both' } : undefined
      case 'result':
        // The Nano S Plus returns to idle by itself.
        return null
      case 'confirm-reject':
      case 'unknown':
        return undefined
    }
  }
  switch (screen.kind) {
    case 'result':
      return { type: 'tap', ...FLEX_DISMISS, delay: TAP_DELAY, label: 'dismiss' }
    case 'confirm-reject':
      return decision === 'reject' ? (tapOn(elements, 'Yes, reject') ?? undefined) : undefined
    case 'review':
      return decision === 'reject'
        ? (tapOn(elements, 'Reject') ?? undefined)
        : { type: 'tap', ...FLEX_NEXT, delay: TAP_DELAY, label: 'next' }
    case 'approve':
      if (decision === 'reject') {
        return tapOn(elements, 'Reject') ?? undefined
      }
      return tapOn(elements, 'Approve') ?? tapOn(elements, 'Hold to sign', HOLD_DELAY) ?? undefined
    case 'reject':
    case 'unknown':
      return undefined
  }
}

export async function perform(api: SpeculosApi, action: DeviceAction): Promise<void> {
  return action.type === 'button' ? api.button(action.button) : api.finger(action.x, action.y, action.delay)
}

export const describeAction = (action: DeviceAction): string =>
  action.type === 'button' ? `press ${action.button}` : `tap ${action.label} at (${action.x}, ${action.y})`

const sleep = async (ms: number): Promise<void> =>
  new Promise((done) => {
    setTimeout(done, ms)
  })

const POLL_MS = 150

/** Waits until the screen is the idle screen. Null when it is; otherwise what it showed last. */
export async function waitForIdle(api: SpeculosApi, model: LedgerModel, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs
  let last = 'no answer from the Speculos API'
  for (;;) {
    try {
      const screen = classifyScreen(model, await api.screen())
      if (screen.kind === 'idle') {
        return null
      }
      last = `screen shows ${JSON.stringify(screen.texts)}`
    } catch (error) {
      last = error instanceof Error ? error.message : String(error)
    }
    if (Date.now() > deadline) {
      return last
    }
    await sleep(POLL_MS)
  }
}

/** The screen once it is one the driver knows, or the unknown one still showing at `deadline`. */
async function settledScreen(api: SpeculosApi, model: LedgerModel, deadline: number): Promise<Screen> {
  for (;;) {
    const screen = classifyScreen(model, await api.screen())
    if (screen.kind !== 'unknown' || Date.now() > deadline) {
      return screen
    }
    await sleep(POLL_MS)
  }
}

/** Waits for a screen other than `before`, returning its elements; null once the time runs out. */
async function nextScreen(api: SpeculosApi, before: string, timeoutMs: number): Promise<ScreenElement[] | null> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const elements = await api.screen()
    if (JSON.stringify(elements.map((element) => element.text)) !== before) {
      return elements
    }
    if (Date.now() > deadline) {
      return null
    }
    await sleep(POLL_MS)
  }
}

export interface DriveOptions {
  /** How long to wait for a prompt to appear when the device is idle. */
  promptTimeoutMs?: number
  /** How long one action may take to change the screen. */
  stepTimeoutMs?: number
  maxSteps?: number
  /**
   * Asked after each screen read and right before each press until the decision is made; false calls the drive off
   * before it presses again, as when the page that sent the prompt goes away or a person takes over.
   */
  shouldContinue?: () => boolean
}

export type DriveResult =
  /** `ended` is the screen the device was left on: idle, a result, or a prompt the driver left alone. */
  | { ok: true; trace: string[]; ended: Screen }
  | { ok: false; trace: string[]; reason: string; screenshot: Buffer | null }

/** What may follow a decision: the idle screen, or the start of another prompt, which the driver leaves alone. */
const LEFT_ALONE_AFTER_DECISION: ReadonlySet<ScreenKind> = new Set(['idle', 'review', 'approve', 'confirm-reject'])

/** True for the press that decides the prompt: both buttons on a Nano, or Approve, Hold to sign or Yes, reject on a Flex. */
const decides = (action: DeviceAction): boolean =>
  action.type === 'button'
    ? action.button === 'both'
    : ['Approve', 'Hold to sign', 'Yes, reject'].includes(action.label)

/**
 * Carries the prompt on screen through to `decision`, then dismisses the Flex's result screen. Waits briefly for a
 * prompt when the device is idle and fails when none comes, so it never arms a decision for a later prompt; once the
 * decision is made it stops, leaving alone any prompt that comes after it. A result screen left over from before is
 * dismissed (Flex) or waited out (Nano) without counting as the decision.
 */
export async function drivePrompt(
  api: SpeculosApi,
  model: LedgerModel,
  decision: Decision,
  options: DriveOptions = {},
): Promise<DriveResult> {
  const trace: string[] = []
  return carefully(model, trace, async () => driveSteps(api, model, decision, trace, options))
}

/** A drive whose screen read failed (Speculos gone, a non-JSON answer) becomes a failure instead of a rejection. */
async function carefully(model: LedgerModel, trace: string[], run: () => Promise<DriveResult>): Promise<DriveResult> {
  try {
    return await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, trace, reason: `could not read the ${model} screen: ${detail}`, screenshot: null }
  }
}

async function driveSteps(
  api: SpeculosApi,
  model: LedgerModel,
  decision: Decision,
  trace: string[],
  { promptTimeoutMs = 5_000, stepTimeoutMs = 8_000, maxSteps = 40, shouldContinue = () => true }: DriveOptions,
): Promise<DriveResult> {
  const stop = async (reason: string): Promise<DriveResult> => ({
    ok: false,
    trace,
    reason,
    screenshot: await api.screenshot().catch(() => null),
  })
  let decided = false
  const calledOff = (): DriveResult | null =>
    !decided && !shouldContinue()
      ? { ok: false, trace, reason: `the ${decision} drive was called off before its next press`, screenshot: null }
      : null
  let steps = 0
  let waitDeadline = Date.now() + promptTimeoutMs
  while (steps < maxSteps) {
    const elements = await api.screen()
    const offAfterRead = calledOff()
    if (offAfterRead !== null) {
      return offAfterRead
    }
    const screen = classifyScreen(model, elements)
    // A redraw can show a blank or partial frame, so an unknown screen is waited out before it stops the driver. A
    // Nano reject menu after the decision means the deciding press didn't take; it gets the same wait.
    const stuckOnReject = decided && screen.kind === 'reject'
    if (screen.kind === 'unknown' || stuckOnReject) {
      if (Date.now() > waitDeadline) {
        return stop(
          stuckOnReject
            ? `the ${model} still shows its reject menu after the decision: ${JSON.stringify(screen.texts)}`
            : `the ${model} shows a screen the driver doesn't handle${decided ? ' after the decision' : ''}: ${JSON.stringify(screen.texts)}`,
        )
      }
      await sleep(POLL_MS)
      continue
    }
    if (decided && LEFT_ALONE_AFTER_DECISION.has(screen.kind)) {
      trace.push(screen.kind === 'idle' ? 'idle' : `next prompt left alone: ${JSON.stringify(screen.texts)}`)
      return { ok: true, trace, ended: screen }
    }
    const action = nextAction(model, screen, elements, decision)
    if (action === undefined) {
      return stop(
        `the ${model} shows a screen the driver doesn't handle for ${decision}: ${JSON.stringify(screen.texts)}`,
      )
    }
    if (action === null) {
      if (Date.now() > waitDeadline) {
        return stop(
          decided
            ? `the ${model} did not leave its result screen: ${JSON.stringify(screen.texts)}`
            : `no prompt appeared on the ${model} within ${promptTimeoutMs} ms`,
        )
      }
      await sleep(POLL_MS)
      continue
    }
    const offBeforePress = calledOff()
    if (offBeforePress !== null) {
      return offBeforePress
    }
    trace.push(`${JSON.stringify(screen.texts)} -> ${describeAction(action)}`)
    await perform(api, action)
    decided ||= decides(action)
    steps += 1
    if ((await nextScreen(api, JSON.stringify(screen.texts), stepTimeoutMs)) === null) {
      return stop(`the ${model} screen did not change after ${describeAction(action)}`)
    }
    waitDeadline = Date.now() + (decided ? stepTimeoutMs : promptTimeoutMs)
  }
  return stop(`gave up after ${maxSteps} steps`)
}

/** Single steps for `emulator press --button`: the Nano S Plus buttons, or the Flex's Next arrow, Approve and dismiss. */
export const LEDGER_BUTTONS = ['left', 'right', 'both', 'next', 'approve', 'dismiss'] as const
export type LedgerButton = (typeof LEDGER_BUTTONS)[number]
const MODEL_BUTTONS: Readonly<Record<LedgerModel, readonly LedgerButton[]>> = {
  nanosp: ['left', 'right', 'both'],
  flex: ['next', 'approve', 'dismiss'],
}

function singleAction(
  model: LedgerModel,
  button: LedgerButton,
  screen: Screen,
  elements: readonly ScreenElement[],
): DeviceAction | undefined {
  if (button === 'left' || button === 'right' || button === 'both') {
    return { type: 'button', button }
  }
  const wanted: Readonly<Record<'next' | 'approve' | 'dismiss', ScreenKind>> = {
    next: 'review',
    approve: 'approve',
    dismiss: 'result',
  }
  return screen.kind === wanted[button] ? (nextAction(model, screen, elements, 'approve') ?? undefined) : undefined
}

/**
 * The screens each single press can lead to. A Nano's right steps to the next page, which after the approve page is
 * the reject menu; left steps back; both decides, leaving a result, idle, or the next prompt. On a Flex, Next leads to
 * the next page, Approve to the result (or the next prompt), and dismissing a result to idle or the next prompt.
 */
export const BUTTON_LANDINGS: Readonly<Record<LedgerButton, ReadonlySet<ScreenKind>>> = {
  right: new Set(['review', 'approve', 'reject']),
  left: new Set(['review', 'approve']),
  both: new Set(['idle', 'result', 'review']),
  next: new Set(['review', 'approve']),
  approve: new Set(['idle', 'result', 'review']),
  dismiss: new Set(['idle', 'review']),
}

/**
 * Presses one button, or taps one Flex control, on the prompt on screen. Waits briefly for a prompt when the device is
 * idle, refuses a button that model doesn't have or a tap that doesn't fit the screen, and fails when the screen it
 * lands on is one that press can't lead to.
 */
export async function pressOnce(
  api: SpeculosApi,
  model: LedgerModel,
  button: LedgerButton,
  options: DriveOptions = {},
): Promise<DriveResult> {
  const trace: string[] = []
  return carefully(model, trace, async () => pressStep(api, model, button, trace, options))
}

async function pressStep(
  api: SpeculosApi,
  model: LedgerModel,
  button: LedgerButton,
  trace: string[],
  { promptTimeoutMs = 5_000, stepTimeoutMs = 8_000 }: DriveOptions,
): Promise<DriveResult> {
  const stop = async (reason: string): Promise<DriveResult> => ({
    ok: false,
    trace,
    reason,
    screenshot: await api.screenshot().catch(() => null),
  })
  if (!MODEL_BUTTONS[model].includes(button)) {
    return {
      ok: false,
      trace,
      reason: `the ${model} takes --button ${MODEL_BUTTONS[model].join('|')}`,
      screenshot: null,
    }
  }
  const deadline = Date.now() + promptTimeoutMs
  for (;;) {
    const elements = await api.screen()
    const screen = classifyScreen(model, elements)
    if (screen.kind === 'unknown' && Date.now() > deadline) {
      return stop(`the ${model} shows a screen the driver doesn't handle: ${JSON.stringify(screen.texts)}`)
    }
    if (screen.kind !== 'idle' && screen.kind !== 'unknown') {
      const action = singleAction(model, button, screen, elements)
      if (action === undefined) {
        return stop(`--button ${button} doesn't fit the ${screen.kind} screen ${JSON.stringify(screen.texts)}`)
      }
      trace.push(`${JSON.stringify(screen.texts)} -> ${describeAction(action)}`)
      await perform(api, action)
      if ((await nextScreen(api, JSON.stringify(screen.texts), stepTimeoutMs)) === null) {
        return stop(`the ${model} screen did not change after ${describeAction(action)}`)
      }
      const landed = await settledScreen(api, model, Date.now() + stepTimeoutMs)
      if (landed.kind === 'unknown') {
        return stop(
          `after ${describeAction(action)} the ${model} shows a screen the driver doesn't handle: ${JSON.stringify(landed.texts)}`,
        )
      }
      return BUTTON_LANDINGS[button].has(landed.kind)
        ? { ok: true, trace, ended: landed }
        : stop(
            `after ${describeAction(action)} the ${model} shows a ${landed.kind} screen, which --button ${button} can't lead to: ${JSON.stringify(landed.texts)}`,
          )
    }
    if (Date.now() > deadline) {
      return stop(`no prompt appeared on the ${model} within ${promptTimeoutMs} ms`)
    }
    await sleep(POLL_MS)
  }
}
