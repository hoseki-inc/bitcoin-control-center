import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { create } from 'zustand'

const TAB_STORAGE_KEY = 'bcc:tab'
/** Must match Sentinel's TAB_HEADER. */
export const TAB_HEADER = 'x-bcc-tab'

let memoryTabId: string | null = null

function newTabId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

const LEFT_AT_KEY = 'bcc:left-at'
// On a reload, the new page starts loading before the old one leaves, by however long the server takes to answer.
// A closed tab that's reopened left before the new page started; allow only clock jitter in that direction.
const LEFT_BEFORE_START_MS = 1000
// An upper bound only, so a stale or garbled time can't count.
const LEFT_AFTER_START_MS = 5 * 60 * 1000

const NavigationEntry = z.object({ type: z.string() })

/**
 * Whether this page may keep the tab ID it finds in sessionStorage: only when the old page left after this one
 * started loading, as on a reload. Browsers restore sessionStorage into reopened and duplicated tabs, and those
 * must ask for the PIN. Where the browser reports the navigation, it must also be a reload; Tor Browser hides it,
 * and the timing alone tells a reload from a reopened tab.
 *
 * @param startedAt When this page started loading, on the wall clock, however long it then took.
 */
export function continuesTab(navigationType: string | null, leftAt: number | null, startedAt: number): boolean {
  return (
    (navigationType === null || navigationType === 'reload') &&
    leftAt !== null &&
    leftAt >= startedAt - LEFT_BEFORE_START_MS &&
    leftAt - startedAt <= LEFT_AFTER_START_MS
  )
}

let checkedContinuity = false

/** Once per page: drops a tab ID this page didn't earn, and notes when the page leaves, for the next reload. */
function checkContinuity(): void {
  if (checkedContinuity) {
    return
  }
  checkedContinuity = true
  try {
    const leftAt = Number.parseInt(sessionStorage.getItem(LEFT_AT_KEY) ?? '', 10)
    sessionStorage.removeItem(LEFT_AT_KEY)
    const navigation = parseUnknown(NavigationEntry, performance.getEntriesByType('navigation')[0])
    const navigationType = navigation.isOk() ? navigation.unwrap().type : null
    // From the wall clock, as `leftAt` is: Chromium's `timeOrigin` can fall behind it after the computer sleeps.
    const startedAt = Date.now() - performance.now()
    if (!continuesTab(navigationType, Number.isSafeInteger(leftAt) ? leftAt : null, startedAt)) {
      sessionStorage.removeItem(TAB_STORAGE_KEY)
    }
  } catch {
    // Storage is blocked; the in-memory ID lasts only as long as this page.
  }
  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(LEFT_AT_KEY, String(Date.now()))
    } catch {
      // Storage is blocked; a reload then asks for the PIN.
    }
  })
}

/**
 * This tab's ID. sessionStorage keeps it through a reload; a closed tab that's reopened, a duplicated tab, or a
 * new one gets a new ID, so it asks for the PIN. Where storage is blocked, it lasts until the page reloads.
 */
export function tabId(): string {
  checkContinuity()
  try {
    const saved = sessionStorage.getItem(TAB_STORAGE_KEY)
    if (saved !== null && /^[\w-]{16,64}$/.test(saved)) {
      return saved
    }
    const created = newTabId()
    sessionStorage.setItem(TAB_STORAGE_KEY, created)
    return created
  } catch {
    memoryTabId ??= newTabId()
    return memoryTabId
  }
}

/** Gives this tab a new ID, so its old session can't be resumed here, even if Sentinel never heard it end. */
export function retireTabId(): void {
  const created = newTabId()
  memoryTabId = created
  try {
    sessionStorage.setItem(TAB_STORAGE_KEY, created)
  } catch {
    // Storage is blocked; the in-memory ID applies.
  }
}

/**
 * Where the app stands behind the PIN. `checking`: waiting for Sentinel's first answer. `closed`: only a PIN screen
 * is mounted. `revealing`: signed in; the app renders under the finished check, then the lock screen fades away.
 * `open`: the app alone. `covering`: the lock screen is fading in over the app, which unmounts once it's covered.
 */
export type AppPhase = 'checking' | 'closed' | 'revealing' | 'open' | 'covering'

interface Gate {
  /** Bumped by every lock. Sign-in, setup and the reveal note it when they start, and stop if it has moved on. */
  epoch: number
  app: AppPhase
  /** The epoch in which this tab set the first PIN; setup (its Save step) lasts while that epoch is current. */
  setupEpoch: number | null
}

export const useGate = create<Gate>(() => ({ epoch: 0, app: 'checking', setupEpoch: null }))

export function currentEpoch(): number {
  return useGate.getState().epoch
}

export function isCurrent(epoch: number): boolean {
  return currentEpoch() === epoch
}

/**
 * Locks the app: whatever was signing in, setting up or revealing is void. An open app is covered by the lock
 * screen, which fades in over it; with `immediate`, or from anything but open, the app closes at once.
 */
export function lock(immediate = false): void {
  useGate.setState(({ epoch, app }) => ({
    epoch: epoch + 1,
    app: app === 'checking' ? app : !immediate && (app === 'open' || app === 'covering') ? 'covering' : 'closed',
  }))
}

/**
 * Every request to Sentinel goes through here: it sends this tab's ID (unless the request names one, as the lock
 * does for the ID it retires) and the browser cookie (cross-origin in development), and locks the app when
 * Sentinel answers that the PIN is needed. A refusal for a retired ID is old news, not a new lock.
 */
export async function sentinelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  const tab = headers.get(TAB_HEADER) ?? tabId()
  headers.set(TAB_HEADER, tab)
  const response = await fetch(input, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && tab === tabId()) {
    lock()
  }
  return response
}
