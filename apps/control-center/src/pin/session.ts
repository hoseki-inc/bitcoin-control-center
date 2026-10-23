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

/**
 * This tab's ID. sessionStorage keeps it through reloads and drops it when the tab closes, so a new tab
 * asks for the PIN. Where storage is blocked, it lasts until the page reloads.
 */
export function tabId(): string {
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
  lock: () => void
  unlock: () => void
}

export const useLockState = create<LockState>((set) => ({
  locked: false,
  lock: () => {
    set({ locked: true })
  },
  unlock: () => {
    set({ locked: false })
  },
}))

/**
 * Every request to Sentinel goes through here: it sends this tab's ID and the browser cookie (cross-origin in
 * development), and locks the app when Sentinel answers that the PIN is needed.
 */
export async function sentinelFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set(TAB_HEADER, tabId())
  const response = await fetch(input, { ...init, headers, credentials: 'include' })
  if (response.status === 401) {
    useLockState.getState().lock()
  }
  return response
}
