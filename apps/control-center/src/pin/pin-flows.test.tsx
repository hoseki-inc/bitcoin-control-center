// @vitest-environment node
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { Toaster } from 'sonner'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { UserInfo } from '../components/layout/user-info'
import { SecuritySettings } from '../pages/settings/security-settings'
import { baseTrpc, queryClient } from '../trpc'
import { INITIAL_GATE, useGate } from './gate'
import { SessionGate } from './session-gate'
import { tabId } from './tab'

const browser = await vi.hoisted(async () => {
  const { createBrowserDom, installBrowserDom } = await import('@hoseki/packages/testing/browser-dom')
  let initialDom: ReturnType<typeof createBrowserDom> | undefined = createBrowserDom()
  installBrowserDom(initialDom)
  return {
    acquire: () => {
      const dom = initialDom ?? createBrowserDom()
      initialDom = undefined
      installBrowserDom(dom)
      return dom
    },
  }
})

const PIN = '482915'
const TAB_HEADER = 'x-bcc-tab'

type Platform = 'startos' | 'umbrel' | 'desktop' | null

interface StatusState {
  platform: Platform
  pinSet: boolean
  insecure: boolean
  signedIn: boolean
  retryAfterMs: number | null
  pinWasReset: boolean
}

// The one place that knows the status wire shape.
function statusJson({ platform, pinSet, insecure, signedIn, retryAfterMs, pinWasReset }: StatusState): Json {
  if (platform === null) {
    return { platform }
  }
  const state = insecure ? 'insecure' : !pinSet ? 'no-pin' : signedIn ? 'signed-in' : 'signed-out'
  return { platform, state, retryAfterMs, pinWasReset }
}

function resetAppState(): void {
  useGate.setState(INITIAL_GATE, true)
}

/** What a fake Sentinel answer can hold. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

// tRPC sends a mutation's input as superjson in the request body.
const RequestBody = z.object({
  json: z.object({ pin: z.string(), currentPin: z.string(), newPin: z.string() }).partial().optional(),
})

type WrongOutcome = { freeAttemptsLeft: number; retryAfterMs: number | null } | { waitMs: number }

/** A Sentinel that knows one PIN, keeps sessions per tab, and records each call's route and tab. */
function fakeSentinel({
  platform = 'umbrel',
  pinSet = true,
  insecure = false,
  retryAfterMs = null,
  pinWasReset = false,
  wrong = [],
  failing = [],
}: {
  platform?: Platform
  pinSet?: boolean
  insecure?: boolean
  retryAfterMs?: number | null
  pinWasReset?: boolean
  /** Answers to wrong PINs, in order; after these, a plain wrong PIN. */
  wrong?: WrongOutcome[]
  /** Routes that fail as if the network were down. */
  failing?: string[]
} = {}) {
  let pin: string | null = pinSet ? PIN : null
  const retryUntil = retryAfterMs === null ? null : Date.now() + retryAfterMs
  const sessions = new Set<string>()
  const calls: { route: string; tab: string | null; input: unknown }[] = []
  const data = (json: Json): Response => Response.json({ result: { data: { json } } })
  const error = (httpStatus: number, message: string): Response =>
    Response.json({ error: { json: { message, code: -32001, data: { httpStatus } } } }, { status: httpStatus })
  const wrongPin = (): Response => {
    const next = wrong.shift() ?? { freeAttemptsLeft: 4, retryAfterMs: null }
    return data(
      'waitMs' in next
        ? { ok: false, reason: 'wait', retryAfterMs: next.waitMs }
        : { ok: false, reason: 'wrong', ...next },
    )
  }

  const fetchMock = vi.fn<typeof fetch>(async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : request.toString(), 'http://localhost')
    const route = url.pathname.replace('/', '')
    const tab = new Headers(init?.headers).get(TAB_HEADER)
    const text = parseUnknown(z.string(), init?.body)
    const body = text.isOk() ? parseUnknown(RequestBody, JSON.parse(text.unwrap())) : null
    const input = body?.isOk() === true ? body.unwrap().json : undefined
    calls.push({ route, tab, input })
    if (failing.includes(route)) {
      throw new TypeError('Failed to fetch')
    }
    const signedIn = platform !== null && !insecure && tab !== null && sessions.has(tab)
    switch (route) {
      case 'auth.status':
        return data(
          statusJson({
            platform,
            pinSet: pin !== null,
            insecure,
            signedIn,
            retryAfterMs: retryUntil === null || retryUntil <= Date.now() ? null : retryUntil - Date.now(),
            pinWasReset,
          }),
        )
      case 'auth.setFirstPin':
        if (pin !== null) {
          return error(409, 'A PIN is already set')
        }
        pin = input?.pin ?? null
        sessions.add(tab ?? '')
        return data({ ok: true })
      case 'auth.signIn':
        if (input?.pin !== pin) {
          return wrongPin()
        }
        sessions.add(tab ?? '')
        return data({ ok: true })
    }
    if (!signedIn) {
      return error(401, 'Enter your PIN')
    }
    switch (route) {
      case 'auth.lock':
        sessions.delete(tab)
        return data(null)
      case 'auth.confirmPin':
        return input?.pin === pin ? data({ ok: true }) : wrongPin()
      case 'auth.changePin':
        if (input?.currentPin !== pin) {
          return wrongPin()
        }
        pin = input.newPin ?? null
        return data({ ok: true })
      case 'auth.signOutEverywhere':
        sessions.clear()
        return data(null)
      default:
        return data(null)
    }
  })
  return {
    fetchMock,
    calls,
    sessions,
    tabsFor: (route: string) => calls.filter((call) => call.route === route).map((call) => call.tab),
    /** The PIN changes elsewhere, as from StartOS or another device. */
    setPin: (next: string) => {
      pin = next
    },
  }
}

let root: Root
let desktopLock: (() => void) | undefined
let desktopResetting: (() => void) | undefined

/** A page whose data never arrives, so the reveal waits as long as it may. */
function SlowPage(): null {
  useQuery({ queryKey: ['slow-page'], queryFn: async () => new Promise<never>(() => undefined) })
  return null
}

async function render(
  sentinel: ReturnType<typeof fakeSentinel>,
  { resetPin = async () => false, slow = false }: { resetPin?: () => Promise<boolean>; slow?: boolean } = {},
): Promise<void> {
  const dom = browser.acquire()
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    resetAppState()
    vi.unstubAllGlobals()
    dom.window.close()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', sentinel.fetchMock)
  desktopLock = undefined
  desktopResetting = undefined
  dom.window.desktop = {
    pin: {
      resetPin,
      onResetting: (listener) => {
        desktopResetting = listener
        return () => undefined
      },
      onLock: (listener) => {
        desktopLock = listener
        return () => undefined
      },
    },
  }
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChakraProvider>
          <MemoryRouter>
            <SessionGate>
              <Toaster />
              <UserInfo />
              <SecuritySettings />
              {slow && <SlowPage />}
              <p>Your holdings</p>
            </SessionGate>
          </MemoryRouter>
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
}

function showing(text: string): boolean {
  return document.body.textContent.includes(text)
}

/** Leaves out a screen or step fading out, which is hidden from assistive technology. */
function onScreen(text: string): boolean {
  const page = document.body.cloneNode(true)
  assert(page instanceof HTMLElement, 'Expected the body')
  for (const hidden of page.querySelectorAll('[aria-hidden="true"]')) {
    hidden.remove()
  }
  return page.textContent.includes(text)
}

async function see(text: string, timeout = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(onScreen(text)).toBe(true)
    },
    { timeout },
  )
}

/** The newest PIN field: an earlier screen or step can still be fading out, hidden from assistive technology. */
async function pinField(): Promise<HTMLInputElement> {
  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')]
      .filter((input) => input.closest('[aria-hidden="true"]') === null)
      .at(-1)
    assert.exists(found, 'Expected a PIN field')
    return found
  })
}

async function type(value: string): Promise<void> {
  const input = await pinField()
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    assert(descriptor?.set !== undefined, 'Expected the input value setter')
    descriptor.set.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(name: string): Promise<void> {
  const button = await vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>('button, a')]
      .filter((element) => element.textContent === name || element.getAttribute('aria-label') === name)
      .filter((element) => element.closest('[aria-hidden="true"]') === null)
      .at(-1)
    assert.exists(found, `Expected the ${name} button`)
    return found
  })
  await act(async () => {
    button.click()
  })
}

/** The app is on screen and no longer behind the lock screen. */
async function appOpen(): Promise<void> {
  await vi.waitFor(
    () => {
      const holdings = [...document.querySelectorAll('p')].find((found) => found.textContent === 'Your holdings')
      assert.exists(holdings, 'Expected the app')
      expect(holdings.closest('[aria-hidden="true"]')).toBeNull()
    },
    { timeout: 6000 },
  )
}

it('opens the app directly when PINs are off, with no lock button or Security section', async () => {
  const sentinel = fakeSentinel({ platform: null })
  await render(sentinel)
  await appOpen()
  expect(showing('Enter your PIN')).toBe(false)
  expect(document.querySelector('button[aria-label="Lock"]')).toBeNull()
  expect(showing('Change PIN')).toBe(false)
})

/** Mounts the gate afresh, as a reload does: the tab keeps its ID, and nothing else survives. */
async function reload(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  queryClient.clear()
  resetAppState()
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <ChakraProvider>
          <MemoryRouter>
            <SessionGate>
              <p>Your holdings</p>
            </SessionGate>
          </MemoryRouter>
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
}

it('opens the app directly when this tab is still signed in, as after a reload', async () => {
  const sentinel = fakeSentinel()
  await render(sentinel)
  // Sign in once to learn this tab's ID, then reload the gate with that session alive.
  await type(PIN)
  await appOpen()
  await reload()
  await appOpen()
  expect(showing('Enter your PIN')).toBe(false)
  expect(sentinel.tabsFor('auth.signIn')).toHaveLength(1)
}, 15_000)

it('waits for the PIN to be set in StartOS, then asks for it', async () => {
  const sentinel = fakeSentinel({ platform: 'startos', pinSet: false })
  await render(sentinel)
  await see('Set your PIN in StartOS')
  expect(showing('Open StartOS, go to Bitcoin Control Center, and run the Set PIN action. Then come back here.')).toBe(
    true,
  )
  sentinel.setPin(PIN)
  // Asked again every 5 seconds.
  await see('Enter your PIN', 8000)
}, 15_000)

it('refuses an unencrypted connection on StartOS', async () => {
  await render(fakeSentinel({ platform: 'startos', insecure: true }))
  await see('Insecure connection not allowed')
  expect(showing('Open Control Center at an address that starts with https://, or over Tor.')).toBe(true)
  expect(document.querySelector('input[type="password"]')).toBeNull()
})

it('explains wrong PINs, warns before the delay, and counts the delay down', async () => {
  const sentinel = fakeSentinel({
    wrong: [
      { freeAttemptsLeft: 4, retryAfterMs: null },
      { freeAttemptsLeft: 2, retryAfterMs: null },
      { freeAttemptsLeft: 1, retryAfterMs: null },
      { freeAttemptsLeft: 0, retryAfterMs: 2000 },
    ],
  })
  await render(sentinel)
  await type('111111')
  await see('Wrong PIN. Try again.')
  await vi.waitFor(async () => {
    expect((await pinField()).value).toBe('')
  })
  await type('111111')
  await see('Wrong PIN. 2 more tries before a short wait.')
  await vi.waitFor(async () => {
    expect((await pinField()).value).toBe('')
  })
  await type('111111')
  await see('Wrong PIN. 1 more try before a short wait.')
  await vi.waitFor(async () => {
    expect((await pinField()).value).toBe('')
  })
  await type('111111')
  await see('Too many wrong PINs. Try again in ')
  await see(' second')
  expect((await pinField()).disabled).toBe(true)

  // Once the delay passes, the field takes a PIN again.
  await vi.waitFor(
    async () => {
      expect((await pinField()).disabled).toBe(false)
      expect(showing('Too many wrong PINs')).toBe(false)
    },
    { timeout: 4000 },
  )
  await type(PIN)
  await appOpen()
}, 20_000)

it('shows a delay that is already running when the page opens', async () => {
  await render(fakeSentinel({ retryAfterMs: 61_000 }))
  await see('Too many wrong PINs. Try again in 1:0')
  expect((await pinField()).disabled).toBe(true)
})

it('says when Sentinel can’t be reached while signing in', async () => {
  await render(fakeSentinel({ failing: ['auth.signIn'] }))
  await type(PIN)
  await see('Couldn’t reach Control Center. Try again.')
  expect(showing('Your holdings')).toBe(false)
})

it('ignores letters, and takes a pasted PIN with a dash', async () => {
  await render(fakeSentinel())
  await type('12ab')
  expect((await pinField()).value).toBe('')
  await type('482-915')
  await appOpen()
})

it('sets up a PIN: choose, confirm, save, then into the app', async () => {
  const sentinel = fakeSentinel({ pinSet: false })
  await render(sentinel)
  await see('Set up your PIN')
  expect(showing('6 digits you’ll enter each time you open Control Center.')).toBe(true)

  await type(PIN)
  await see('Confirm your PIN')
  expect(showing('Enter the same 6 digits again.')).toBe(true)
  await type('000000')
  await see('Those PINs didn’t match. Choose your PIN again.')
  await see('Set up your PIN')

  await type(PIN)
  await see('Confirm your PIN')
  await type(PIN)
  await see('Your PIN is set')
  expect(
    showing(
      'Keep a copy in your password manager. If you forget it, you can reset it from the umbrelOS terminal, keeping your accounts and history.',
    ),
  ).toBe(true)
  expect(showing(PIN)).toBe(false)
  await click('Show PIN')
  expect(showing(PIN)).toBe(true)
  await click('Hide PIN')
  expect(showing(PIN)).toBe(false)

  await click('Continue')
  await appOpen()
  expect(sentinel.calls.filter((call) => call.route === 'auth.setFirstPin')).toHaveLength(1)
}, 15_000)

it('tells desktop users an administrator can reset a forgotten PIN', async () => {
  await render(fakeSentinel({ platform: 'desktop', pinSet: false }))
  await type(PIN)
  await see('Confirm your PIN')
  await type(PIN)
  await see(
    'Keep a copy in your password manager. If you forget it, an administrator of this computer can reset it, keeping your accounts and history.',
  )
})

it('says the accounts are still here after a reset, until the new PIN is chosen', async () => {
  await render(fakeSentinel({ pinSet: false, pinWasReset: true }))
  await see('Choose a new PIN')
  expect(showing('Your PIN was reset. Your accounts and history are as you left them.')).toBe(true)
  await type(PIN)
  await see('Confirm your PIN')
  expect(onScreen('Your PIN was reset.')).toBe(false)
})

it('goes back from confirming to choosing, with fresh circles', async () => {
  await render(fakeSentinel({ pinSet: false }))
  await type(PIN)
  await see('Confirm your PIN')
  await type('12')
  await click('Back')
  await see('Set up your PIN')
  expect((await pinField()).value).toBe('')
})

it('takes focus to the title on the Save step, so screen readers announce it', async () => {
  await render(fakeSentinel({ pinSet: false }))
  await type(PIN)
  await see('Confirm your PIN')
  await type(PIN)
  await see('Your PIN is set')
  await vi.waitFor(() => {
    expect(document.activeElement?.textContent).toBe('Your PIN is set')
  })
})

it('copies the new PIN', async () => {
  await render(fakeSentinel({ pinSet: false }))
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  await type(PIN)
  await see('Confirm your PIN')
  await type(PIN)
  await see('Your PIN is set')
  await click('Copy PIN')
  expect(writeText).toHaveBeenCalledWith(PIN)
  await see('Copied')
})

it('starts setup over when Sentinel can’t be reached', async () => {
  await render(fakeSentinel({ pinSet: false, failing: ['auth.setFirstPin'] }))
  await type(PIN)
  await see('Confirm your PIN')
  await type(PIN)
  await see('Couldn’t reach Control Center. Try again.')
  await see('Set up your PIN')
})

it.each([
  [
    'umbrel',
    [
      'Open the umbrelOS terminal (Settings, Advanced settings).',
      'sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin',
      'Restart Bitcoin Control Center, then set a new PIN right away.',
    ],
  ],
  [
    'startos',
    [
      'Open StartOS and go to Bitcoin Control Center.',
      'Choose Actions, then Set PIN.',
      'Come back here and enter your new PIN.',
    ],
  ],
] as const)('explains how to reset a forgotten PIN on %s', async (platform, steps) => {
  await render(fakeSentinel({ platform }))
  await click('Forgot PIN?')
  await see('Reset your PIN')
  for (const step of steps) {
    expect(showing(step)).toBe(true)
  }
  expect(showing('Your accounts and history stay as they are.')).toBe(true)
  // The steps stay on screen, with the way back to the field.
  await click('Back')
  await see('Enter your PIN')
  expect(onScreen('Your accounts and history stay as they are.')).toBe(false)
})

it('resets a forgotten PIN on desktop through the computer’s administrator prompt', async () => {
  const resetPin = vi.fn(async () => false)
  await render(fakeSentinel({ platform: 'desktop' }), { resetPin })
  await click('Forgot PIN?')
  await see('Reset your PIN')
  expect(
    showing(
      'Your accounts and history stay as they are. Your computer will ask an administrator to confirm, then you’ll choose a new PIN.',
    ),
  ).toBe(true)
  await click('Reset PIN')
  expect(resetPin).toHaveBeenCalledOnce()
  await see('PIN not reset. Nothing changed.')
})

it('copies the Umbrel reset command', async () => {
  await render(fakeSentinel({ platform: 'umbrel' }))
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  await click('Forgot PIN?')
  await see('Reset your PIN')
  await click('Copy command')
  expect(writeText).toHaveBeenCalledWith(
    'sudo docker exec bitcoin-control-center_web_1 node /app/dist/cli.js reset-pin',
  )
  await see('Copied')
})

it('says the desktop is restarting once an administrator confirms', async () => {
  // Never answers: the app restarts instead.
  const resetPin = vi.fn(async () => new Promise<boolean>(() => undefined))
  await render(fakeSentinel({ platform: 'desktop' }), { resetPin })
  await click('Forgot PIN?')
  await see('Reset your PIN')
  await click('Reset PIN')
  await vi.waitFor(() => {
    assert.exists(desktopResetting)
  })
  await act(async () => {
    desktopResetting?.()
  })
  await see('PIN reset. Restarting Control Center…')
})

it('sends a digit typed with focus elsewhere to the PIN field', async () => {
  await render(fakeSentinel())
  const input = await pinField()
  await act(async () => {
    input.blur()
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '4' }))
  })
  expect(document.activeElement).toBe(input)
  await act(async () => {
    input.blur()
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'a' }))
  })
  expect(document.activeElement).not.toBe(input)
})

it('keeps the hidden username out of the tab order', async () => {
  await render(fakeSentinel())
  await see('Enter your PIN')
  expect(document.querySelector<HTMLInputElement>('input[name="username"]')?.tabIndex).toBe(-1)
})

it('announces a wait once, rather than every second it counts down', async () => {
  await render(fakeSentinel({ retryAfterMs: 1500 }))
  await see('Too many wrong PINs. You can try again when the wait ends.')
  const live = [...document.querySelectorAll('[aria-live="polite"]')]
  expect(live.some((region) => region.textContent.includes('Try again in'))).toBe(false)
  await see('You can enter your PIN again.', 3000)
})

it('locks from the lock button, ending the session under the tab’s old ID', async () => {
  const sentinel = fakeSentinel()
  await render(sentinel)
  await type(PIN)
  await appOpen()
  const [signedInTab] = sentinel.tabsFor('auth.signIn')

  await click('Lock')
  await see('Enter your PIN')
  await vi.waitFor(() => {
    expect(showing('Your holdings')).toBe(false)
    expect(sentinel.tabsFor('auth.lock')).toEqual([signedInTab])
  })
  expect(sentinel.sessions.size).toBe(0)

  // Signing in again uses a new tab ID.
  await type(PIN)
  await appOpen()
  expect(sentinel.tabsFor('auth.signIn')[1]).not.toBe(signedInTab)
}, 15_000)

it('locks when Sentinel says the session has ended', async () => {
  const sentinel = fakeSentinel()
  await render(sentinel)
  await type(PIN)
  await appOpen()

  // Sentinel restarted, say.
  sentinel.sessions.clear()
  await act(async () => {
    await baseTrpc.auth.confirmPin.mutate({ pin: PIN }).catch(() => undefined)
  })
  await see('Enter your PIN')
  await vi.waitFor(() => {
    expect(showing('Your holdings')).toBe(false)
  })
}, 15_000)

async function openChangePin(sentinel: ReturnType<typeof fakeSentinel>): Promise<void> {
  await render(sentinel)
  await type(PIN)
  await appOpen()
  await see('Your PIN locks Control Center when you close it.')
  await click('Change PIN')
  await see('Enter your current PIN')
}

it('names the Change PIN dialog, and goes back a step', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('Choose a new PIN')
  await type('135790')
  await see('Confirm your new PIN')
  await click('Back')
  await see('Choose a new PIN')
  await vi.waitFor(() => {
    const labelledBy = document.querySelector('[role="dialog"]')?.getAttribute('aria-labelledby') ?? ''
    expect(document.getElementById(labelledBy)?.textContent).toBe('Choose a new PIN')
  })
}, 15_000)

it('changes the PIN: current, new, then confirm', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('Choose a new PIN')
  await type('135790')
  await see('Confirm your new PIN')
  await type('135790')
  await see('PIN changed')
  const change = sentinel.calls.find((call) => call.route === 'auth.changePin')
  expect(change?.input).toEqual({ currentPin: PIN, newPin: '135790' })
}, 15_000)

it('keeps the current PIN step until Sentinel accepts it', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type('111111')
  await see('Wrong PIN. Try again.')
  expect(showing('Choose a new PIN')).toBe(false)
}, 15_000)

it('keeps the mismatch message on the New PIN step until typing', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('Choose a new PIN')
  await type('135790')
  await see('Confirm your new PIN')
  await type('246802')
  await see('Those PINs didn’t match. Choose your PIN again.')
  await vi.waitFor(() => {
    expect(document.querySelector('input[aria-label="New PIN, 6 digits"]')).not.toBeNull()
  })
  expect(showing('Those PINs didn’t match. Choose your PIN again.')).toBe(true)
  await type('1')
  expect(showing('Those PINs didn’t match.')).toBe(false)
}, 15_000)

it('goes back to the current PIN, saying why, when it changed meanwhile', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('Choose a new PIN')
  sentinel.setPin('999999')
  await type('135790')
  await see('Confirm your new PIN')
  await type('135790')
  await see('Wrong PIN. Try again.')
  await vi.waitFor(() => {
    expect(document.querySelector('input[aria-label="Current PIN"]')).not.toBeNull()
  })
}, 15_000)

it('offers to sign out everywhere off desktop, and says when it fails', async () => {
  const sentinel = fakeSentinel({ failing: ['auth.signOutEverywhere'] })
  await render(sentinel)
  await type(PIN)
  await appOpen()
  await click('Sign out everywhere')
  await see('Couldn’t sign out everywhere. Try again.')
}, 15_000)

/** The app has mounted under the finished check, still hidden while the reveal waits for its data. */
async function revealing(): Promise<void> {
  await vi.waitFor(
    () => {
      const holdings = [...document.querySelectorAll('p')].find((found) => found.textContent === 'Your holdings')
      assert.exists(holdings, 'Expected the app')
      expect(holdings.closest('[aria-hidden="true"]')).not.toBeNull()
    },
    { timeout: 4000, interval: 20 },
  )
}

async function pause(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  })
}

it('locks a reloaded desktop window that hides before Sentinel’s first answer', async () => {
  const sentinel = fakeSentinel()
  sentinel.sessions.add(tabId())
  let release = (): void => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  // Sentinel has already answered "signed in"; the answer is still on its way when the window hides.
  const slowStatus = vi.fn<typeof fetch>(async (request, init) => {
    const response = await sentinel.fetchMock(request, init)
    if ((request instanceof Request ? request.url : request.toString()).includes('auth.status')) {
      await released
    }
    return response
  })
  await render({ ...sentinel, fetchMock: slowStatus })
  await act(async () => {
    desktopLock?.()
  })
  release()
  await see('Enter your PIN')
  await pause(300)
  expect(showing('Your holdings')).toBe(false)
  expect(sentinel.sessions.size).toBe(0)
}, 15_000)

async function restoreFromBackForward(): Promise<void> {
  await act(async () => {
    const restored = new Event('pageshow')
    Object.defineProperty(restored, 'persisted', { value: true })
    window.dispatchEvent(restored)
  })
}

it('locks a page brought back from Back or Forward before Sentinel first answered', async () => {
  // Sentinel never hears the lock either, so only the tab's new ID keeps the old session from opening the app.
  const failing = ['auth.status', 'auth.lock']
  const sentinel = fakeSentinel({ failing })
  sentinel.sessions.add(tabId())
  await render(sentinel)
  await see('Couldn’t reach Control Center', 8000)
  await restoreFromBackForward()
  failing.splice(failing.indexOf('auth.status'), 1)
  await click('Try again')
  await see('Enter your PIN')
  await pause(300)
  expect(showing('Your holdings')).toBe(false)

  // The old session is still open on Sentinel; reloading must not resume it.
  expect(sentinel.sessions.size).toBe(1)
  await reload()
  await see('Enter your PIN')
  await pause(300)
  expect(showing('Your holdings')).toBe(false)
}, 20_000)

it('still opens with PINs off after a page comes back before Sentinel first answered', async () => {
  const failing = ['auth.status']
  await render(fakeSentinel({ platform: null, failing }))
  await see('Couldn’t reach Control Center', 8000)
  await restoreFromBackForward()
  failing.length = 0
  await click('Try again')
  await appOpen()
}, 20_000)

it('closes the app at once when it locks while opening', async () => {
  await render(fakeSentinel(), { slow: true })
  await type(PIN)
  await revealing()
  await act(async () => {
    desktopLock?.()
  })
  await vi.waitFor(
    () => {
      expect(showing('Your holdings')).toBe(false)
    },
    { timeout: 400, interval: 10 },
  )
}, 15_000)

it('keeps the app hidden until the reveal finishes, whatever a status check says', async () => {
  await render(fakeSentinel(), { slow: true })
  await type(PIN)
  await revealing()
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  await pause(150)
  await revealing()
  await appOpen()
}, 15_000)

it('checks again when the tab comes back, however soon, and locks after a sign-out elsewhere', async () => {
  const sentinel = fakeSentinel()
  sentinel.sessions.add(tabId())
  await render(sentinel)
  await appOpen()
  // "Sign out everywhere" on another device, moments after this tab's last check.
  sentinel.sessions.clear()
  await act(async () => {
    window.dispatchEvent(new Event('focus'))
  })
  await see('Enter your PIN')
  await vi.waitFor(() => {
    const holdings = [...document.querySelectorAll('p')].find((found) => found.textContent === 'Your holdings')
    expect(holdings === undefined || holdings.closest('[aria-hidden="true"]') !== null).toBe(true)
  })
}, 15_000)

it('gives each lock a fresh sign-in screen', async () => {
  await render(fakeSentinel())
  await type('123')
  await act(async () => {
    desktopLock?.()
  })
  await vi.waitFor(async () => {
    expect((await pinField()).value).toBe('')
  })
})

it('drops a delay once it has passed, even on a fresh sign-in screen', async () => {
  await render(fakeSentinel({ retryAfterMs: 1500 }), { slow: true })
  await see('Too many wrong PINs')
  await vi.waitFor(
    () => {
      expect(showing('Too many wrong PINs')).toBe(false)
    },
    { timeout: 3000 },
  )
  await type(PIN)
  await revealing()
  await act(async () => {
    desktopLock?.()
  })
  await vi.waitFor(
    () => {
      expect(showing('Your holdings')).toBe(false)
    },
    { timeout: 3000 },
  )
  await pause(300)
  expect(showing('Too many wrong PINs')).toBe(false)
  expect((await pinField()).disabled).toBe(false)
}, 15_000)

it('says nothing about a PIN change that a lock interrupted', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('Choose a new PIN')
  await type('135790')
  await see('Confirm your new PIN')
  await type('135790')
  await vi.waitFor(() => {
    expect(sentinel.calls.some((call) => call.route === 'auth.changePin')).toBe(true)
  })
  await act(async () => {
    desktopLock?.()
  })
  await vi.waitFor(() => {
    expect(showing('Your holdings')).toBe(false)
  })
  await type('135790')
  await appOpen()
  await pause(1500)
  expect(showing('PIN changed')).toBe(false)
}, 20_000)

it('leaves out Sign out everywhere on desktop, which has only its own window', async () => {
  await render(fakeSentinel({ platform: 'desktop' }))
  await type(PIN)
  await appOpen()
  await see('Change PIN')
  expect(showing('Sign out everywhere')).toBe(false)
}, 15_000)

it('stays open however long it sits unused', async () => {
  const sentinel = fakeSentinel()
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })
  await render(sentinel)
  await type(PIN)
  await appOpen()
  await act(async () => {
    vi.advanceTimersByTime(30 * 24 * 60 * 60_000)
  })
  await pause(300)
  await appOpen()
  expect(sentinel.sessions.size).toBe(1)
}, 15_000)
