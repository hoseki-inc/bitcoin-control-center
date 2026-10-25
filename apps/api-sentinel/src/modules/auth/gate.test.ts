import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { parseUnknown } from '@hoseki/packages/result'
import { parse } from '@hoseki/packages/result/lib/parse'
import { type AnyProcedure, callProcedure } from '@trpc/server'
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { Decimal } from 'decimal.js'
import Fastify from 'fastify'
import superjson from 'superjson'
import { describe, expect, it, onTestFinished } from 'vitest'
import { z } from 'zod'
import type { AppContext } from '../../context'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { type TRPCContext, recentPinProcedure, t } from '../trpc/init'
import { appRouter } from '../trpc/router'
import { Pin } from './pin'
import type { RequestAuth } from './request'
import { AuthService } from './service'

const serializer = registerCustomSerializers(superjson)

// The only routes anyone may call without a signed-in tab.
const OPEN_ROUTES = ['auth.status', 'auth.signIn', 'auth.setFirstPin']

const procedures: Record<string, AnyProcedure> = appRouter._def.procedures

const ProcedureKind = z.object({ mutation: z.boolean().optional(), subscription: z.boolean().optional() })

function procedureType(procedure: AnyProcedure): 'query' | 'mutation' | 'subscription' {
  const kind = parseUnknown(ProcedureKind, procedure._def).expect('procedure definition')
  if (kind.mutation === true) {
    return 'mutation'
  }
  return kind.subscription === true ? 'subscription' : 'query'
}

async function setup() {
  const { db, logger } = await setupServiceDatabase()
  const clock = { now: 1_700_000_000_000 }
  const auth = new AuthService(db, logger, 'desktop', () => clock.now)
  // SAFETY: the PIN check runs before every route's own code, and reads only `auth`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- No route gets past the check in these tests.
  const app = { auth } as AppContext
  const request = (browserKey: string | null, tabId: string | null): RequestAuth => ({
    browserKey,
    tabId,
    encrypted: true,
    setBrowserKey: () => undefined,
    clearBrowserKey: () => undefined,
  })
  return {
    auth,
    clock,
    context: (browserKey: string | null, tabId: string | null): TRPCContext => ({
      app,
      request: request(browserKey, tabId),
    }),
  }
}

async function call(path: string, ctx: TRPCContext): Promise<void> {
  const procedure = procedures[path]
  if (!procedure) {
    throw new Error(`No route ${path}`)
  }
  await callProcedure({
    procedures,
    path,
    rawInput: undefined,
    ctx,
    type: procedureType(procedure),
  })
}

describe('the PIN gate', () => {
  const protectedRoutes = Object.keys(procedures).filter((path) => !OPEN_ROUTES.includes(path))

  it('leaves only the sign-in routes open', () => {
    expect(protectedRoutes.length).toBeGreaterThan(50)
    expect(Object.keys(procedures)).toEqual(expect.arrayContaining(OPEN_ROUTES))
  })

  it.each(protectedRoutes)('refuses %s without a signed-in tab', async (path) => {
    const { context } = await setup()
    await expect(call(path, context(null, null))).rejects.toMatchObject({ name: 'TRPCError', code: 'UNAUTHORIZED' })
  })

  it('asks for the PIN again on routes that need a recent one', async () => {
    const { auth, context, clock } = await setup()
    const sensitive = t.router({ reveal: recentPinProcedure(60_000).query(() => 'revealed') })
    const pin = parse(Pin, '482915').expect('a PIN')
    const tab = { tabId: 'tab-aaaaaaaaaaaaaaaa', encrypted: true }
    const browserKey = (await auth.setFirstPin(pin, { browserKey: null, ...tab })).expect('first PIN')
    const session = auth.authorize({ browserKey, ...tab }).unwrap()
    if (!session) {
      throw new Error('Expected a session')
    }
    const caller = sensitive.createCaller(context(browserKey, 'tab-aaaaaaaaaaaaaaaa'))

    await expect(caller.reveal()).resolves.toBe('revealed')
    clock.now += 61_000
    await expect(caller.reveal()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await auth.confirm(session, pin)).isOk()).toBe(true)
    await expect(caller.reveal()).resolves.toBe('revealed')
  })
})

describe('request bodies read before the PIN gate', () => {
  async function post(payload: string): Promise<{ statusCode: number; body: string; elapsed: number }> {
    const { context } = await setup()
    const server = Fastify()
    onTestFinished(async () => {
      await server.close()
    })
    await server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: { router: appRouter, createContext: () => context(null, null) },
    })
    const started = performance.now()
    const response = await server.inject({
      method: 'POST',
      url: '/trpc/portalProve.accounts.add',
      headers: { 'content-type': 'application/json' },
      payload,
    })
    return { statusCode: response.statusCode, body: response.body, elapsed: performance.now() - started }
  }

  it('refuses hex text sent as a Decimal without converting it', async () => {
    // decimal.js converts hex in quadratic time; this took about 2.5 s before the deserializer checked its text.
    const response = await post(
      JSON.stringify({
        json: { descriptor: `0x${'f'.repeat(65_536)}` },
        meta: { values: { descriptor: [['custom', 'Decimal']] } },
      }),
    )

    expect(response.elapsed).toBeLessThan(500)
    expect(response.statusCode).toBe(400)
    expect(response.body).not.toContain('ffff')
  })

  it.each([
    ['set', 100_000, (i: number) => i, 'descriptor.99999'],
    ['map', 50_000, (i: number) => [i, i], 'descriptor.49999.1'],
  ] as const)('refuses a %s without walking paths into it', async (type, size, entry, path) => {
    // superjson steps through a Set or Map from its start for every path that points into it; this took seconds before.
    const response = await post(
      JSON.stringify({
        json: { descriptor: Array.from({ length: size }, (_, i) => entry(i)), displayName: 1 },
        meta: {
          values: { descriptor: [type] },
          referentialEqualities: { displayName: Array.from({ length: 8_000 }, () => path) },
        },
      }),
    )

    expect(response.elapsed).toBeLessThan(500)
    expect(response.statusCode).toBe(400)
  })

  it('refuses a typed array before allocating it', async () => {
    // superjson allocates whatever length the request names; this took about a second and 50 MB before.
    const response = await post(
      JSON.stringify({
        json: { descriptor: { length: 50_000_000 } },
        meta: { values: { descriptor: [['typed-array', 'Uint8Array']] } },
      }),
    )

    expect(response.elapsed).toBeLessThan(500)
    expect(response.statusCode).toBe(400)
    expect(response.body).toContain('request type \\"typed-array\\" isn\'t accepted')
  })

  it('refuses a Set nested inside a custom type', async () => {
    // Our custom collections parse nested superjson text, which skipped the outer check; this took seconds before.
    const inner = JSON.stringify({
      json: { a: Array.from({ length: 100_000 }, (_, i) => i), b: 1 },
      meta: { values: { a: ['set'] }, referentialEqualities: { b: Array.from({ length: 8_000 }, () => 'a.99999') } },
    })
    const response = await post(
      JSON.stringify({
        json: { descriptor: { variant: 'Some', value: inner } },
        meta: { values: { descriptor: [['custom', 'Option']] } },
      }),
    )

    expect(response.elapsed).toBeLessThan(500)
    expect(response.statusCode).toBe(400)
  })

  it('refuses a long annotation path before walking it', async () => {
    // superjson copies the whole path for every annotated child; this took seconds before.
    const path = Array.from({ length: 30_000 }, () => 'a').join('.')
    const children = Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, ['undefined']]))
    const response = await post(JSON.stringify({ json: {}, meta: { values: { [path]: ['undefined', children] } } }))

    expect(response.elapsed).toBeLessThan(500)
    expect(response.statusCode).toBe(400)
  })

  it('reads the types Control Center sends and goes on to the PIN check', async () => {
    const shared = new Date('2026-01-01T00:00:00Z')
    const body = serializer.stringify({
      descriptor: 'wpkh(xpub)',
      displayName: 'Wallet',
      openingDate: shared,
      closingDate: shared,
      note: undefined,
      amount: new Decimal('1.5'),
      sats: 21n,
    })

    expect((await post(body)).statusCode).toBe(401)
  })
})
