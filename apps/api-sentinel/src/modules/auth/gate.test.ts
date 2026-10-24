import { parseUnknown } from '@hoseki/packages/result'
import { type AnyProcedure, callProcedure } from '@trpc/server'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { AppContext } from '../../context'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { type TRPCContext, recentPinProcedure, t } from '../trpc/init'
import { appRouter } from '../trpc/router'
import type { RequestAuth } from './request'
import { AuthService } from './service'

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

  it('refuses a signed-in browser from another tab, and lets the signed-in tab through', async () => {
    const { auth, context } = await setup()
    const { browserKey } = (await auth.setFirstPin('482915', null, 'tab-aaaaaaaaaaaaaaaa')).expect('first PIN')

    await expect(call('auth.touch', context(browserKey, 'tab-bbbbbbbbbbbbbbbb'))).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(call('auth.touch', context(browserKey, 'tab-aaaaaaaaaaaaaaaa'))).resolves.toBeUndefined()
  })

  it('asks for the PIN again on routes that need a recent one', async () => {
    const { auth, context, clock } = await setup()
    const sensitive = t.router({ reveal: recentPinProcedure(60_000).query(() => 'revealed') })
    const { browserKey, session } = (await auth.setFirstPin('482915', null, 'tab-aaaaaaaaaaaaaaaa')).expect('first PIN')
    const caller = sensitive.createCaller(context(browserKey, 'tab-aaaaaaaaaaaaaaaa'))

    await expect(caller.reveal()).resolves.toBe('revealed')
    clock.now += 61_000
    auth.touch(session)
    await expect(caller.reveal()).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await auth.confirm(session, '482915')).isOk()).toBe(true)
    await expect(caller.reveal()).resolves.toBe('revealed')
  })
})
