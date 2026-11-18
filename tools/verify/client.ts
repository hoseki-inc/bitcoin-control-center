import { randomBytes } from 'node:crypto'
import type { Router } from '@hoseki/apps/api-sentinel/src/external_types'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { type CreateTRPCProxyClient, createTRPCProxyClient, httpLink } from '@trpc/client'
import superjson from 'superjson'

/**
 * The PIN `launch --pin` sets and every helper command signs in with. A test value for verify runs only: each run's
 * data folder is new and is deleted at cleanup.
 */
export const VERIFY_PIN = '246813'

/**
 * Sentinel's API as the web app calls it, as a tab of its own: a tab ID on every request, and the browser cookie
 * that signing in sets. With PINs off neither matters; with PINs on, call `signIn` before anything else.
 */
export function sentinelClient(url: string): CreateTRPCProxyClient<Router> {
  // Sentinel's tab and cookie names (TAB_HEADER, BROWSER_COOKIE in modules/auth/request.ts).
  const tabId = randomBytes(18).toString('base64url')
  let cookie: string | null = null
  return createTRPCProxyClient<Router>({
    transformer: registerCustomSerializers(superjson),
    links: [
      httpLink({
        url: `${url}/trpc`,
        headers: () => (cookie === null ? { 'x-bcc-tab': tabId } : { 'x-bcc-tab': tabId, cookie }),
        fetch: async (input, init) => {
          const response = await fetch(input, init)
          const set = response.headers.get('set-cookie')?.split(';')[0]
          if (set?.startsWith('bcc_browser=') === true) {
            cookie = set
          }
          return response
        },
      }),
    ],
  })
}

type PinOutcome = { ok: true } | { ok: false; reason: 'wrong' | 'wait' }
type PinMutation = { mutate: (input: { pin: string }) => Promise<PinOutcome> }

/** The sign-in part of Sentinel's API. */
export interface AuthClient {
  auth: {
    status: { query: () => Promise<{ platform: string | null; retryAfterMs?: number | null }> }
    signIn: PinMutation
    setFirstPin: PinMutation
  }
}

/**
 * Signs a client's tab in with the run's PIN when PINs are on. On a `launch --pin` run that has no PIN yet, `first`
 * sets it, which launch does once. Throws when Sentinel refuses. It doesn't try during a wrong-PIN wait, so a helper
 * command never makes the wait longer; a wrong PIN still counts toward the next one.
 */
export async function signIn(client: AuthClient, first = false): Promise<void> {
  const status = await client.auth.status.query()
  if (status.platform === null) {
    return
  }
  if (status.retryAfterMs != null && status.retryAfterMs > 0) {
    throw new Error(`Too many wrong PINs: wait ${Math.ceil(status.retryAfterMs / 1000)} seconds and try again.`)
  }
  const outcome = await (first ? client.auth.setFirstPin : client.auth.signIn).mutate({ pin: VERIFY_PIN })
  if (!outcome.ok) {
    throw new Error(
      outcome.reason === 'wait'
        ? 'Too many wrong PINs: wait and try again.'
        : `Sentinel refused the run's PIN ${VERIFY_PIN}. A recipe changed it: change it back in Settings.`,
    )
  }
}

/** One account list in Sentinel's API. */
export interface ListQuery {
  list: { query: () => Promise<readonly unknown[]> }
}

/** The account lists Home counts: wallets, exchange accounts, manual holdings and ETF holdings. */
export interface AccountLists {
  portalProve: { registry: { claims: ListQuery }; exchanges: ListQuery; manual: ListQuery; etf: ListQuery }
}

/** Every account the app shows, of every kind, so "no accounts" means the app is really empty. */
export async function countAccounts(client: AccountLists): Promise<number> {
  const { registry, exchanges, manual, etf } = client.portalProve
  const lists = await Promise.all([registry.claims, exchanges, manual, etf].map(async (kind) => kind.list.query()))
  return lists.reduce((total, list) => total + list.length, 0)
}
