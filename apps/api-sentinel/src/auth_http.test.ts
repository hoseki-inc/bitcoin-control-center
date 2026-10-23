import { Ok, asyncFn } from '@hoseki/packages/result'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AppContext } from './context'
import { setupServiceDatabase } from './fixtures/service-database'
import { type SentinelServer, main } from './main'
import { hashPin } from './modules/auth/pin'
import { BROWSER_COOKIE, TAB_HEADER } from './modules/auth/request'
import { type AuthPolicy, AuthService, PLATFORM_AUTH_POLICIES } from './modules/auth/service'

const TAB = 'tab-aaaaaaaaaaaaaaaa'

async function start(
  allowedHosts?: string,
  policy: AuthPolicy = PLATFORM_AUTH_POLICIES.desktop,
): Promise<{ base: string; auth: AuthService }> {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'fatal')
  const { db, logger } = await setupServiceDatabase()
  const auth = new AuthService(db, logger, policy)
  const fake = {
    env: {
      HOST: '127.0.0.1',
      PORT: 0,
      APP_DIR: '/nonexistent-sentinel-test-assets',
      SENTINEL_ALLOWED_HOSTS: allowedHosts,
    },
    auth,
    controlCenterService: { recordAllSnapshots: async (): Promise<void> => undefined },
    releaseCheckService: { start: (): void => undefined, stop: (): void => undefined },
    stopElectrum: (): void => undefined,
    database: { $client: { close: (): void => undefined } },
  }
  // SAFETY: these tests call only the auth routes, which read `auth`, and /health.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The rest of the context is never reached.
  const context = fake as AppContext
  const server: SentinelServer = await main(
    { listenPort: 0 },
    asyncFn(async () => Ok(context)),
  )
  onTestFinished(async () => {
    await server.shutdown()
    vi.unstubAllEnvs()
  })
  return { base: `http://127.0.0.1:${server.port}`, auth }
}

async function mutate(
  base: string,
  path: string,
  input: Record<string, string> | undefined,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}/trpc/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [TAB_HEADER]: TAB, ...headers },
    body: JSON.stringify({ json: input }),
  })
}

function browserCookie(response: Response): string {
  const cookie = response.headers.get('set-cookie') ?? ''
  const value = cookie.split(';')[0] ?? ''
  return value.startsWith(`${BROWSER_COOKIE}=`) ? value : ''
}

describe('PIN sign-in over HTTP', () => {
  it('keeps /health and the status open, and refuses other routes without a session', async () => {
    const { base } = await start()
    expect((await fetch(`${base}/health`)).status).toBe(200)
    expect((await fetch(`${base}/trpc/auth.status`)).status).toBe(200)
    expect(
      (await fetch(`${base}/trpc/settings.get?input=${encodeURIComponent('{"json":{"key":"user_name"}}')}`)).status,
    ).toBe(401)
  })

  it('sets an HttpOnly, SameSite=Strict browser cookie with no expiry, which works only with its tab', async () => {
    const { base } = await start()
    const response = await mutate(base, 'auth.setFirstPin', { pin: '482915' })
    expect(response.status).toBe(200)

    const header = response.headers.get('set-cookie') ?? ''
    expect(header).toMatch(/HttpOnly/)
    expect(header).toMatch(/SameSite=Strict/)
    expect(header).not.toMatch(/Max-Age|Expires|Secure/)

    const cookie = browserCookie(response)
    expect((await mutate(base, 'auth.touch', undefined, { cookie })).status).toBe(200)
    expect((await mutate(base, 'auth.touch', undefined, { cookie, [TAB_HEADER]: 'tab-bbbbbbbbbbbbbbbb' })).status).toBe(
      401,
    )
  })

  it('reports a wrong PIN as data, not as a signed-in session', async () => {
    const { base } = await start()
    await mutate(base, 'auth.setFirstPin', { pin: '482915' })
    const response = await mutate(base, 'auth.signIn', { pin: '000000' })
    expect(response.status).toBe(200)
    expect(browserCookie(response)).toBe('')
    await expect(response.json()).resolves.toMatchObject({
      result: { data: { json: { ok: false, reason: 'wrong', freeAttemptsLeft: 4 } } },
    })
  })

  it('refuses batched calls, so a sign-in cannot carry another route', async () => {
    const { base } = await start()
    const response = await fetch(`${base}/trpc/auth.status,settings.get?batch=1&input=${encodeURIComponent('{}')}`)
    // tRPC 10 answers a batch with a generic error when batching is off; nothing runs.
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.not.toHaveProperty('result')
  })

  it('marks the cookie Secure when a platform proxy reports HTTPS, and ignores the header elsewhere', async () => {
    const proxied = await start('127.0.0.1')
    const secure = await mutate(proxied.base, 'auth.setFirstPin', { pin: '482915' }, { 'x-forwarded-proto': 'https' })
    expect(secure.headers.get('set-cookie')).toMatch(/; Secure/)

    const direct = await start()
    const plain = await mutate(direct.base, 'auth.setFirstPin', { pin: '482915' }, { 'x-forwarded-proto': 'https' })
    expect(plain.headers.get('set-cookie')).not.toMatch(/Secure/)
  })

  it('refuses sign-in over plain HTTP where the platform needs HTTPS', async () => {
    const { base, auth } = await start('127.0.0.1', PLATFORM_AUTH_POLICIES.startos)
    await auth.replacePinHash(await hashPin('482915'))

    const plain = await mutate(base, 'auth.signIn', { pin: '482915' })
    expect(plain.status).toBe(403)
    expect(browserCookie(plain)).toBe('')

    const secure = await mutate(base, 'auth.signIn', { pin: '482915' }, { 'x-forwarded-proto': 'https' })
    const cookie = browserCookie(secure)
    expect(cookie).not.toBe('')
    expect((await mutate(base, 'auth.touch', undefined, { cookie, 'x-forwarded-proto': 'https' })).status).toBe(200)
    expect((await mutate(base, 'auth.touch', undefined, { cookie })).status).toBe(401)
  })

  it('accepts the PIN over plain HTTP to a Tor onion address, without a Secure cookie', async () => {
    const onion = { 'x-forwarded-host': 'exampleonionaddressexampleonionaddressexampleonionad.onion' }
    const { base, auth } = await start('127.0.0.1,*.onion', PLATFORM_AUTH_POLICIES.startos)
    await auth.replacePinHash(await hashPin('482915'))

    const signedIn = await mutate(base, 'auth.signIn', { pin: '482915' }, onion)
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.get('set-cookie')).not.toMatch(/Secure/)
    const cookie = browserCookie(signedIn)
    expect(cookie).not.toBe('')
    expect((await mutate(base, 'auth.touch', undefined, { cookie, ...onion })).status).toBe(200)

    // The same address typed with a trailing dot.
    const dotted = { 'x-forwarded-host': `${onion['x-forwarded-host']}.` }
    expect((await mutate(base, 'auth.touch', undefined, { cookie, ...dotted })).status).toBe(200)

    // Plain HTTP to any other address still can't sign in.
    expect((await mutate(base, 'auth.signIn', { pin: '482915' })).status).toBe(403)
  })
})
