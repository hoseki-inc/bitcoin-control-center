// @vitest-environment node
import { TestChakraProvider as ChakraProvider } from '@hoseki/packages/testing/chakra-provider'
import { QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import { type Root, createRoot } from 'react-dom/client'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { queryClient } from '../trpc'
import { TAB_HEADER, useLockState } from './session'
import { SessionGate } from './session-gate'
import type { PinStatus } from './status'

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

/** A Sentinel that knows one PIN, records the tab each request names, and ends sessions on lock. */
function fakeSentinel(
  initial: Pick<PinStatus, 'pinSet'>,
  { holdSetup = false, failedStatusChecks = 0 }: { holdSetup?: boolean; failedStatusChecks?: number } = {},
) {
  let pinSet = initial.pinSet
  let statusFailuresLeft = failedStatusChecks
  // Holds the setup response until released, like a slow server.
  let releaseSetup: () => void = () => {}
  const setupHeld = new Promise<void>((resolve) => {
    releaseSetup = resolve
  })
  const sessions = new Set<string>()
  const calls: { route: string; tab: string | null }[] = []
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    const route = new URL(url, 'http://localhost').pathname.replace('/', '')
    const tab = new Headers(init?.headers).get(TAB_HEADER)
    calls.push({ route, tab })
    const data = (json: PinStatus | { ok: true } | null): Response => Response.json({ result: { data: { json } } })
    if (route === 'auth.status') {
      if (statusFailuresLeft > 0) {
        statusFailuresLeft -= 1
        throw new TypeError('Failed to fetch')
      }
      return data({
        required: true,
        pinSet,
        inAppSetup: true,
        recovery: 'admin',
        needsHttps: false,
        signedIn: tab !== null && sessions.has(tab),
        retryAfterMs: null,
      } satisfies PinStatus)
    }
    if (route === 'auth.setFirstPin' && pinSet) {
      return Response.json(
        { error: { json: { message: 'A PIN is already set', data: { httpStatus: 409, code: 'CONFLICT' } } } },
        { status: 409 },
      )
    }
    if (route === 'auth.signIn' || route === 'auth.setFirstPin') {
      if (route === 'auth.setFirstPin' && holdSetup) {
        await setupHeld
      }
      pinSet = true
      if (tab !== null) {
        sessions.add(tab)
      }
      return data({ ok: true })
    }
    if (route === 'auth.lock') {
      if (tab !== null) {
        sessions.delete(tab)
      }
      return data(null)
    }
    return Response.json({ error: { json: { message: 'Enter your PIN', data: { httpStatus: 401 } } } }, { status: 401 })
  })
  return {
    fetchMock,
    calls,
    sessions,
    releaseSetup,
    /** Another device sets the PIN. */
    setPinElsewhere: () => {
      pinSet = true
    },
  }
}

let root: Root
let desktopLock: (() => void) | undefined

async function withTestSetup(sentinel: ReturnType<typeof fakeSentinel>, run: () => Promise<void>): Promise<void> {
  const dom = browser.acquire()
  onTestFinished(async () => {
    await act(async () => {
      root.unmount()
    })
    queryClient.clear()
    useLockState.setState({ locked: false })
    vi.unstubAllGlobals()
    dom.window.close()
  })
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('fetch', sentinel.fetchMock)
  desktopLock = undefined
  dom.window.desktop = {
    pin: {
      resetPin: async () => false,
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
          <SessionGate>
            <p>Your holdings</p>
          </SessionGate>
        </ChakraProvider>
      </QueryClientProvider>,
    )
  })
  await run()
}

async function enterPin(pin: string): Promise<void> {
  const input = await vi.waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[type="password"]')
    assert.exists(found, 'Expected the PIN field')
    return found
  })
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
    assert(descriptor?.set !== undefined, 'Expected the input value setter')
    descriptor.set.call(input, pin)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function showing(text: string): boolean {
  return document.body.textContent.includes(text)
}

it('locks a desktop sign-in that is still opening the app, and keeps the app closed', async () => {
  const sentinel = fakeSentinel({ pinSet: true })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    // The app renders underneath the finished check while the reveal waits.
    await vi.waitFor(
      () => {
        expect(showing('Your holdings')).toBe(true)
      },
      { timeout: 5000 },
    )
    const signedInTab = sentinel.calls.find((call) => call.route === 'auth.signIn')?.tab
    assert.exists(signedInTab)

    await act(async () => {
      desktopLock?.()
    })

    await vi.waitFor(
      () => {
        expect(showing('Your holdings')).toBe(false)
        expect(showing('Enter your PIN')).toBe(true)
      },
      { timeout: 5000 },
    )
    // Sentinel ended the session it had just opened, by the tab's old ID.
    expect(sentinel.calls.filter((call) => call.route === 'auth.lock').map((call) => call.tab)).toEqual([signedInTab])
    expect(sentinel.sessions.size).toBe(0)
  })
}, 15_000)

it('ends setup when the desktop locks on the Save step', async () => {
  const sentinel = fakeSentinel({ pinSet: false })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    await vi.waitFor(() => {
      expect(showing('Enter it again')).toBe(true)
    })
    await enterPin(PIN)
    await vi.waitFor(
      () => {
        expect(showing('Continue')).toBe(true)
      },
      { timeout: 5000 },
    )

    await act(async () => {
      desktopLock?.()
    })

    // The setup screen may still be fading out; the sign-in screen replaces it.
    await vi.waitFor(() => {
      expect(showing('Enter your PIN')).toBe(true)
    })
    expect(showing('Your holdings')).toBe(false)
    expect(sentinel.sessions.size).toBe(0)
  })
}, 15_000)

it('never shows the new PIN when the desktop locks before setup is confirmed', async () => {
  const sentinel = fakeSentinel({ pinSet: false }, { holdSetup: true })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    await vi.waitFor(() => {
      expect(showing('Enter it again')).toBe(true)
    })
    await enterPin(PIN)
    await vi.waitFor(() => {
      expect(sentinel.calls.some((call) => call.route === 'auth.setFirstPin')).toBe(true)
    })

    await act(async () => {
      desktopLock?.()
    })
    await act(async () => {
      sentinel.releaseSetup()
    })

    await vi.waitFor(() => {
      expect(showing('Enter your PIN')).toBe(true)
    })
    // Long enough for the save step to have appeared, had setup carried on.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 2500)
      })
    })
    expect(document.querySelector('button[aria-label="Show PIN"]')).toBeNull()
    expect(showing('Continue')).toBe(false)
  })
}, 15_000)

it('keeps the app closed when the desktop locks during the sign-in check', async () => {
  const sentinel = fakeSentinel({ pinSet: true })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    await vi.waitFor(() => {
      expect(sentinel.calls.some((call) => call.route === 'auth.signIn')).toBe(true)
    })

    await act(async () => {
      desktopLock?.()
    })
    // Long enough for the check to finish and the reveal to have opened the app.
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 3500)
      })
    })
    expect(showing('Your holdings')).toBe(false)
    expect(showing('Enter your PIN')).toBe(true)
  })
}, 15_000)

it('stays closed and offers to try again when Sentinel can’t be asked about the PIN', async () => {
  const sentinel = fakeSentinel({ pinSet: true }, { failedStatusChecks: 3 })
  await withTestSetup(sentinel, async () => {
    const retry = await vi.waitFor(
      () => {
        const button = [...document.querySelectorAll('button')].find((found) => found.textContent === 'Try again')
        assert.exists(button, 'Expected the Try again button')
        return button
      },
      { timeout: 8000 },
    )
    expect(showing('Your holdings')).toBe(false)

    await act(async () => {
      retry.click()
    })
    await vi.waitFor(() => {
      expect(showing('Enter your PIN')).toBe(true)
    })
    expect(showing('Your holdings')).toBe(false)
  })
}, 15_000)

it('moves to sign-in when another device set the PIN during setup', async () => {
  const sentinel = fakeSentinel({ pinSet: false })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    await vi.waitFor(() => {
      expect(showing('Enter it again')).toBe(true)
    })
    sentinel.setPinElsewhere()
    await enterPin(PIN)

    await vi.waitFor(
      () => {
        expect(showing('Enter your PIN')).toBe(true)
      },
      { timeout: 5000 },
    )
  })
}, 15_000)

it('locks a page the browser brings back from Back or Forward', async () => {
  const sentinel = fakeSentinel({ pinSet: true })
  await withTestSetup(sentinel, async () => {
    await enterPin(PIN)
    // Open: the app is no longer hidden behind the lock screen.
    await vi.waitFor(
      () => {
        const holdings = [...document.querySelectorAll('p')].find((found) => found.textContent === 'Your holdings')
        assert.exists(holdings, 'Expected the app')
        expect(holdings.closest('[aria-hidden="true"]')).toBeNull()
      },
      { timeout: 5000 },
    )

    await act(async () => {
      const restored = new Event('pageshow')
      Object.defineProperty(restored, 'persisted', { value: true })
      window.dispatchEvent(restored)
    })

    await vi.waitFor(() => {
      expect(showing('Your holdings')).toBe(false)
      expect(showing('Enter your PIN')).toBe(true)
    })
    expect(sentinel.sessions.size).toBe(0)
  })
}, 15_000)
