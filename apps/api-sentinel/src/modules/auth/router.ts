import type { Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { openProcedure, protectedProcedure, t } from '../trpc/init'
import type { RequestAuth } from './request'
import type { AuthService, PinFailure, SignedIn } from './service'

// Length is checked again by the service; this only keeps large bodies out of the hash.
const pinInput = z.string().max(32)

/** Wrong PINs and delays are expected outcomes, so they come back as data rather than errors. */
export type PinOutcome =
  | { ok: true }
  | { ok: false; reason: 'wrong'; freeAttemptsLeft: number; retryAfterMs: number | null }
  | { ok: false; reason: 'wait'; retryAfterMs: number }

function outcome(result: Result<unknown, PinFailure>): PinOutcome {
  if (result.isOk()) {
    return { ok: true }
  }
  const failure = result.unwrapErr()
  switch (failure.kind) {
    case 'wrong':
      return {
        ok: false,
        reason: 'wrong',
        freeAttemptsLeft: failure.freeAttemptsLeft,
        retryAfterMs: failure.retryAfterMs,
      }
    case 'wait':
      return { ok: false, reason: 'wait', retryAfterMs: failure.retryAfterMs }
    case 'malformed':
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'The PIN must be exactly 6 digits' })
    case 'not_set':
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No PIN is set yet' })
    case 'already_set':
      throw new TRPCError({ code: 'CONFLICT', message: 'A PIN is already set' })
    case 'setup_unavailable':
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Set the PIN from your server' })
  }
}

interface TabRequest {
  request: RequestAuth
  tabId: string
}

function requireTab(auth: AuthService, request: RequestAuth | undefined): TabRequest {
  if (!request || request.tabId === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reload the page and try again' })
  }
  if (auth.needsHttps(request.secure)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Open Control Center at its HTTPS address' })
  }
  return { request, tabId: request.tabId }
}

function signedIn(request: RequestAuth, result: Result<SignedIn, PinFailure>): PinOutcome {
  if (result.isOk()) {
    request.setBrowserKey(result.unwrap().browserKey)
  }
  return outcome(result)
}

/** Routes that act on this tab's session, which only exist while PINs are required. */
const sessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PINs are not turned on' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})

export const authRouter = t.router({
  status: openProcedure.query(async ({ ctx }) =>
    ctx.app.auth.status(ctx.request?.browserKey ?? null, ctx.request?.tabId ?? null, ctx.request?.secure ?? false),
  ),

  signIn: openProcedure.input(z.object({ pin: pinInput })).mutation(async ({ ctx, input }) => {
    const { request, tabId } = requireTab(ctx.app.auth, ctx.request)
    return signedIn(request, await ctx.app.auth.signIn(input.pin, request.browserKey, tabId))
  }),

  setFirstPin: openProcedure.input(z.object({ pin: pinInput })).mutation(async ({ ctx, input }) => {
    const { request, tabId } = requireTab(ctx.app.auth, ctx.request)
    return signedIn(request, await ctx.app.auth.setFirstPin(input.pin, request.browserKey, tabId))
  }),

  touch: sessionProcedure.mutation(({ ctx }) => {
    ctx.app.auth.touch(ctx.session)
  }),

  confirmPin: sessionProcedure
    .input(z.object({ pin: pinInput }))
    .mutation(async ({ ctx, input }) => outcome(await ctx.app.auth.confirm(ctx.session, input.pin))),

  changePin: sessionProcedure
    .input(z.object({ currentPin: pinInput, newPin: pinInput }))
    .mutation(async ({ ctx, input }) =>
      outcome(await ctx.app.auth.changePin(ctx.session, input.currentPin, input.newPin)),
    ),

  lock: sessionProcedure.mutation(({ ctx }) => {
    ctx.app.auth.lock(ctx.session)
  }),

  signOutEverywhere: sessionProcedure.mutation(({ ctx }) => {
    ctx.app.auth.signOutEverywhere()
    ctx.request?.clearBrowserKey()
  }),
})
