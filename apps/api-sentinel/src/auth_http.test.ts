import { Ok, asyncFn } from '@hoseki/packages/result'
import { parse } from '@hoseki/packages/result/lib/parse'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { AppContext } from './context'
import { setupServiceDatabase } from './fixtures/service-database'
import { type SentinelServer, main } from './main'
import { Pin, hashPin } from './modules/auth/pin'
import { BROWSER_COOKIE, TAB_HEADER } from './modules/auth/request'
import { AuthService, type PinPlatform } from './modules/auth/service'

const TAB = 'tab-aaaaaaaaaaaaaaaa'

async function start(
  allowedHosts?: string,
  platform: PinPlatform | null = 'desktop',
): Promise<{ base: string; auth: AuthService }> {
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('LOG_LEVEL', 'fatal')
  const { db, logger } = await setupServiceDatabase()
  const auth = new AuthService(db, logger, platform)
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
  // SAFETY: these tests call only the auth routes, which read `auth`, a protected route that reads nothing, and /health.
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

/** The status of a protected route that needs nothing but a signed-in tab. */
async function protectedStatus(base: string, headers: Record<string, string> = {}): Promise<number> {
  return (
    await fetch(`${base}/trpc/portalProve.registry.claims.getCountLimit`, {
      headers: { [TAB_HEADER]: TAB, ...headers },
    })
  ).status
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
    await expect(protectedStatus(base, { cookie })).resolves.toBe(200)
    await expect(protectedStatus(base, { cookie, [TAB_HEADER]: 'tab-bbbbbbbbbbbbbbbb' })).resolves.toBe(401)
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
    const { base, auth } = await start('127.0.0.1', 'startos')
    await auth.setPlatformPin(await hashPin(parse(Pin, '482915').expect('a PIN')))

    const plain = await mutate(base, 'auth.signIn', { pin: '482915' })
    expect(plain.status).toBe(403)
    expect(browserCookie(plain)).toBe('')

    const secure = await mutate(base, 'auth.signIn', { pin: '482915' }, { 'x-forwarded-proto': 'https' })
    const cookie = browserCookie(secure)
    expect(cookie).not.toBe('')
    await expect(protectedStatus(base, { cookie, 'x-forwarded-proto': 'https' })).resolves.toBe(200)
    await expect(protectedStatus(base, { cookie })).resolves.toBe(401)
  })

  it('accepts the PIN over plain HTTP to a Tor onion address, without a Secure cookie', async () => {
    const onion = { 'x-forwarded-host': 'exampleonionaddressexampleonionaddressexampleonionad.onion' }
    const { base, auth } = await start('127.0.0.1,*.onion', 'startos')
    await auth.setPlatformPin(await hashPin(parse(Pin, '482915').expect('a PIN')))

    const signedIn = await mutate(base, 'auth.signIn', { pin: '482915' }, onion)
    expect(signedIn.status).toBe(200)
    expect(signedIn.headers.get('set-cookie')).not.toMatch(/Secure/)
    const cookie = browserCookie(signedIn)
    expect(cookie).not.toBe('')
    await expect(protectedStatus(base, { cookie, ...onion })).resolves.toBe(200)

    // The same address typed with a trailing dot.
    const dotted = { 'x-forwarded-host': `${onion['x-forwarded-host']}.` }
    await expect(protectedStatus(base, { cookie, ...dotted })).resolves.toBe(200)

    // Plain HTTP to any other address still can't sign in.
    expect((await mutate(base, 'auth.signIn', { pin: '482915' })).status).toBe(403)
  })
})

describe('PIN sessions over HTTP', () => {
  const OTHER_TAB = 'tab-bbbbbbbbbbbbbbbb'

  it('needs this tab’s ID to sign in', async () => {
    const { base } = await start()
    const response = await fetch(`${base}/trpc/auth.setFirstPin`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { pin: '482915' } }),
    })
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { json: { message: 'Reload the page and try again' } },
    })
  })

  it('locks only this tab', async () => {
    const { base } = await start()
    const cookie = browserCookie(await mutate(base, 'auth.setFirstPin', { pin: '482915' }))
    await mutate(base, 'auth.signIn', { pin: '482915' }, { cookie, [TAB_HEADER]: OTHER_TAB })

    expect((await mutate(base, 'auth.lock', undefined, { cookie })).status).toBe(200)
    await expect(protectedStatus(base, { cookie })).resolves.toBe(401)
    await expect(protectedStatus(base, { cookie, [TAB_HEADER]: OTHER_TAB })).resolves.toBe(200)
  })

  it('changes the PIN, keeping this tab and signing out the rest', async () => {
    const { base } = await start()
    const cookie = browserCookie(await mutate(base, 'auth.setFirstPin', { pin: '482915' }))
    await mutate(base, 'auth.signIn', { pin: '482915' }, { cookie, [TAB_HEADER]: OTHER_TAB })

    const changed = await mutate(base, 'auth.changePin', { currentPin: '482915', newPin: '135790' }, { cookie })
    await expect(changed.json()).resolves.toMatchObject({ result: { data: { json: { ok: true } } } })
    await expect(protectedStatus(base, { cookie })).resolves.toBe(200)
    await expect(protectedStatus(base, { cookie, [TAB_HEADER]: OTHER_TAB })).resolves.toBe(401)

    const oldPin = await mutate(base, 'auth.signIn', { pin: '482915' }, { [TAB_HEADER]: OTHER_TAB })
    await expect(oldPin.json()).resolves.toMatchObject({ result: { data: { json: { ok: false } } } })
    const newPin = await mutate(base, 'auth.signIn', { pin: '135790' }, { [TAB_HEADER]: OTHER_TAB })
    await expect(newPin.json()).resolves.toMatchObject({ result: { data: { json: { ok: true } } } })
  })

  it('signs out everywhere and clears the browser cookie', async () => {
    const { base } = await start()
    const cookie = browserCookie(await mutate(base, 'auth.setFirstPin', { pin: '482915' }))
    await mutate(base, 'auth.signIn', { pin: '482915' }, { cookie, [TAB_HEADER]: OTHER_TAB })

    const response = await mutate(base, 'auth.signOutEverywhere', undefined, { cookie })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toMatch(new RegExp(`^${BROWSER_COOKIE}=;.*Max-Age=0`))
    await expect(protectedStatus(base, { cookie })).resolves.toBe(401)
    await expect(protectedStatus(base, { cookie, [TAB_HEADER]: OTHER_TAB })).resolves.toBe(401)
  })

  it('trusts a forwarded onion address only behind a platform proxy, with or without its port', async () => {
    const onion = 'exampleonionaddressexampleonionaddressexampleonionad.onion'
    const direct = await start(undefined, 'startos')
    await direct.auth.setPlatformPin(await hashPin(parse(Pin, '482915').expect('a PIN')))
    expect((await mutate(direct.base, 'auth.signIn', { pin: '482915' }, { 'x-forwarded-host': onion })).status).toBe(
      403,
    )

    const proxied = await start('127.0.0.1,*.onion', 'startos')
    await proxied.auth.setPlatformPin(await hashPin(parse(Pin, '482915').expect('a PIN')))
    const withPort = await mutate(proxied.base, 'auth.signIn', { pin: '482915' }, { 'x-forwarded-host': `${onion}:80` })
    expect(withPort.status).toBe(200)
  })
})

describe('PIN rules over HTTP', () => {
  it('refuses a malformed PIN before checking it, so it costs no attempt', async () => {
    const { base } = await start()
    await mutate(base, 'auth.setFirstPin', { pin: '482915' })
    const malformed = await mutate(base, 'auth.signIn', { pin: '12ab56' })
    expect(malformed.status).toBe(400)
    await expect(malformed.json()).resolves.toMatchObject({
      error: { json: { message: 'The PIN must be exactly 6 digits' } },
    })
    const wrong = await mutate(base, 'auth.signIn', { pin: '000000' })
    await expect(wrong.json()).resolves.toMatchObject({ result: { data: { json: { freeAttemptsLeft: 4 } } } })
  })

  it('leaves every route open while PINs are off', async () => {
    const { base } = await start(undefined, null)
    const status = await fetch(`${base}/trpc/auth.status`)
    await expect(status.json()).resolves.toMatchObject({ result: { data: { json: { platform: null } } } })
    expect((await fetch(`${base}/trpc/portalProve.registry.claims.getCountLimit`)).status).toBe(200)
  })

  it('refuses a first PIN from the app on StartOS, and a second one anywhere', async () => {
    const startos = await start('127.0.0.1', 'startos')
    expect(
      (await mutate(startos.base, 'auth.setFirstPin', { pin: '482915' }, { 'x-forwarded-proto': 'https' })).status,
    ).toBe(403)

    const { base } = await start()
    await mutate(base, 'auth.setFirstPin', { pin: '482915' })
    expect((await mutate(base, 'auth.setFirstPin', { pin: '135790' })).status).toBe(409)
  })
})
