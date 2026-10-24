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
}

// The one place that knows the status wire shape.
function statusJson({ platform, pinSet, insecure, signedIn, retryAfterMs }: StatusState): Json {
  if (platform === null) {
    return { platform }
  }
  const state = insecure ? 'insecure' : !pinSet ? 'no-pin' : signedIn ? 'signed-in' : 'signed-out'
  return { platform, state, retryAfterMs }
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
  wrong = [],
  failing = [],
}: {
  platform?: Platform
  pinSet?: boolean
  insecure?: boolean
  retryAfterMs?: number | null
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

/** A page whose data never arrives, so the reveal waits its full 1.5 s. */
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
  dom.window.desktop = {
    pin: {
      resetPin,
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

async function see(text: string, timeout = 5000): Promise<void> {
  await vi.waitFor(
    () => {
      expect(showing(text)).toBe(true)
    },
    { timeout },
  )
}

/** The newest PIN field: an earlier screen can still be fading out. */
async function pinField(): Promise<HTMLInputElement> {
  return vi.waitFor(() => {
    const found = [...document.querySelectorAll<HTMLInputElement>('input[type="password"]')].at(-1)
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
  await see('Too many wrong PINs. Try again in 0:0')
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
  expect(showing('You’ll enter it each time you open Control Center.')).toBe(true)

  await type(PIN)
  await see('Enter it again')
  expect(showing('To make sure it’s the PIN you meant.')).toBe(true)
  await type('000000')
  await see('Those PINs didn’t match. Choose your PIN again.')
  await see('Set up your PIN')

  await type(PIN)
  await see('Enter it again')
  await type(PIN)
  await see('Save your PIN')
  expect(
    showing('Keep it in your password manager. If you forget it, you’ll need to reset it from the umbrelOS terminal.'),
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

it('tells desktop users the administrator password resets a forgotten PIN', async () => {
  await render(fakeSentinel({ platform: 'desktop', pinSet: false }))
  await type(PIN)
  await see('Enter it again')
  await type(PIN)
  await see(
    'Keep it in your password manager. If you forget it, you’ll need this computer’s administrator password to reset it.',
  )
})

it('copies the new PIN', async () => {
  await render(fakeSentinel({ pinSet: false }))
  const writeText = vi.fn(async () => undefined)
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true })
  await type(PIN)
  await see('Enter it again')
  await type(PIN)
  await see('Save your PIN')
  await click('Copy PIN')
  expect(writeText).toHaveBeenCalledWith(PIN)
  await see('Copied')
})

it('starts setup over when Sentinel can’t be reached', async () => {
  await render(fakeSentinel({ pinSet: false, failing: ['auth.setFirstPin'] }))
  await type(PIN)
  await see('Enter it again')
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
      'Restart Bitcoin Control Center, then set a new PIN.',
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
})

it('resets a forgotten PIN on desktop through the computer’s administrator prompt', async () => {
  const resetPin = vi.fn(async () => false)
  await render(fakeSentinel({ platform: 'desktop' }), { resetPin })
  await click('Forgot PIN?')
  await see('Forgot your PIN?')
  await click('Reset PIN')
  expect(resetPin).toHaveBeenCalledOnce()
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
  await see('Current PIN')
}

it('changes the PIN: current, new, then confirm', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('New PIN')
  await type('135790')
  await see('Confirm')
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
  expect(showing('New PIN')).toBe(false)
}, 15_000)

it('keeps the mismatch message on the New PIN step until typing', async () => {
  const sentinel = fakeSentinel()
  await openChangePin(sentinel)
  await type(PIN)
  await see('New PIN')
  await type('135790')
  await see('Confirm')
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
  await see('New PIN')
  sentinel.setPin('999999')
  await type('135790')
  await see('Confirm')
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
  await pause(400)
  await revealing()
  await appOpen()
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
  await see('New PIN')
  await type('135790')
  await see('Confirm')
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
