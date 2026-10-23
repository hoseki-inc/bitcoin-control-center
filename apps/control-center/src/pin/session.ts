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
// A reload starts moments after the page left. A tab reopened from history, or a duplicated one, brings back an
// older time or none at all.
const RELOAD_WINDOW_MS = 10_000

const NavigationEntry = z.object({ type: z.string() })

/**
 * Whether this page may keep the tab ID it finds in sessionStorage: only when it is a reload of a page that left
 * moments ago. Browsers restore sessionStorage into reopened and duplicated tabs, and those must ask for the PIN.
 */
export function continuesTab(navigationType: string | null, leftAt: number | null, now: number): boolean {
  return navigationType === 'reload' && leftAt !== null && now >= leftAt && now - leftAt <= RELOAD_WINDOW_MS
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
    if (!continuesTab(navigationType, Number.isSafeInteger(leftAt) ? leftAt : null, Date.now())) {
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

interface LockState {
  /** Sentinel refused a request for want of a PIN, or the person locked the app. */
  locked: boolean
  /** Counts every lock, so a sign-in that was still finishing can tell one happened. */
  locks: number
  lock: () => void
  unlock: () => void
}

export const useLockState = create<LockState>((set) => ({
  locked: false,
  locks: 0,
  lock: () => {
    set((state) => ({ locked: true, locks: state.locks + 1 }))
  },
  unlock: () => {
    set({ locked: false })
  },
}))

/**
 * Every request to Sentinel goes through here: it sends this tab's ID (unless the request names one, as the lock
 * does for the ID it retires) and the browser cookie (cross-origin in development), and locks the app when
 * Sentinel answers that the PIN is needed.
 */
export async function sentinelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has(TAB_HEADER)) {
    headers.set(TAB_HEADER, tabId())
  }
  const response = await fetch(input, { ...init, headers, credentials: 'include' })
  if (response.status === 401) {
    useLockState.getState().lock()
  }
  return response
}
