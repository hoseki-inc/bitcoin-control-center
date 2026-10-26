import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { dispatch } from './gate'

/** Must match Sentinel's TAB_HEADER. */
export const TAB_HEADER = 'x-bcc-tab'
const TAB_KEY = 'bcc:tab'
const LEFT_AT_KEY = 'bcc:left-at'
const TAB_ID_PATTERN = /^[\w-]{16,64}$/
// On a reload, the new page starts loading before the old one leaves, by however long the server takes to answer.
// A closed tab that's reopened left before the new page started; allow only clock jitter in that direction.
const LEFT_BEFORE_START_MS = 1000
// An upper bound only, so a stale or garbled time can't count.
const LEFT_AFTER_START_MS = 5 * 60 * 1000

const NavigationEntry = z.object({ type: z.string() })

/**
 * Whether this page may keep the tab ID it finds in sessionStorage: only when the old page left after this one
 * started loading, as on a reload. Browsers restore sessionStorage into reopened and duplicated tabs, and those must
 * ask for the PIN. Where the browser reports the navigation, it must also be a reload; Tor Browser hides it, and the
 * timing alone tells a reload from a reopened tab.
 *
 * @param startedAt When this page started loading, on the wall clock.
 */
export function continuesTab(navigationType: string | null, leftAt: number | null, startedAt: number): boolean {
  return (
    (navigationType === null || navigationType === 'reload') &&
    leftAt !== null &&
    leftAt >= startedAt - LEFT_BEFORE_START_MS &&
    leftAt - startedAt <= LEFT_AFTER_START_MS
  )
}

function newTabId(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(18))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

// Used where sessionStorage is blocked, and for the rest of this page once read: storage can't change under us.
let current: string | null = null

/** Once per page: keeps the stored tab ID only if this page earned it, and notes when the page leaves. */
function readTabId(): string {
  try {
    const leftAt = Number.parseInt(sessionStorage.getItem(LEFT_AT_KEY) ?? '', 10)
    sessionStorage.removeItem(LEFT_AT_KEY)
    const navigation = parseUnknown(NavigationEntry, performance.getEntriesByType('navigation')[0])
    // From the wall clock, as `leftAt` is: Chromium's `timeOrigin` can fall behind it after the computer sleeps.
    const startedAt = Date.now() - performance.now()
    const saved = sessionStorage.getItem(TAB_KEY)
    const kept =
      saved !== null &&
      TAB_ID_PATTERN.test(saved) &&
      continuesTab(
        navigation.isOk() ? navigation.unwrap().type : null,
        Number.isSafeInteger(leftAt) ? leftAt : null,
        startedAt,
      )
    window.addEventListener('pagehide', () => {
      try {
        sessionStorage.setItem(LEFT_AT_KEY, String(Date.now()))
      } catch {
        // Storage is blocked; a reload then asks for the PIN.
      }
    })
    return kept ? saved : storeTabId(newTabId())
  } catch {
    return newTabId()
  }
}

function storeTabId(id: string): string {
  try {
    sessionStorage.setItem(TAB_KEY, id)
  } catch {
    // Storage is blocked; the ID lasts as long as this page.
  }
  return id
}

/**
 * This tab's ID. sessionStorage keeps it through a reload; a closed tab that's reopened, a duplicated tab, or a new
 * one gets a new ID, so it asks for the PIN.
 */
export function tabId(): string {
  current ??= readTabId()
  return current
}

/** Gives this tab a new ID, so its old session can't be resumed here, even if Sentinel never heard it end. */
export function retireTabId(): string {
  const retired = tabId()
  current = storeTabId(newTabId())
  return retired
}

/**
 * Every request to Sentinel goes through here: it sends this tab's ID (unless the request names one, as the lock does
 * for the ID it retires) and the browser cookie (cross-origin in development). When Sentinel answers that this tab
 * needs the PIN, the app locks; an answer about a retired ID changes nothing.
 */
export async function sentinelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  if (!headers.has(TAB_HEADER)) {
    headers.set(TAB_HEADER, tabId())
  }
  const response = await fetch(input, { ...init, headers, credentials: 'include' })
  if (response.status === 401 && headers.get(TAB_HEADER) === tabId()) {
    // Like any lock, so a late answer to an earlier request can't lock the next sign-in.
    retireTabId()
    dispatch({ type: 'lock', at: 'fade' })
  }
  return response
}
