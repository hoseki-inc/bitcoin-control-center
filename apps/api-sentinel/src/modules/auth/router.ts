import type { Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { type TRPCContext, openProcedure, sessionProcedure, t } from '../trpc/init'
import type { RequestAuth } from './request'
import type { PinFailure, SignedIn } from './service'

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

/** Sign-in and setup need this tab's ID, and refuse the PIN over a connection the platform won't accept. */
function signingIn(ctx: TRPCContext): RequestAuth & { tabId: string } {
  const { request } = ctx
  if (!request || request.tabId === null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Reload the page and try again' })
  }
  if (ctx.app.auth.refuses(request.encrypted)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Open Control Center at its HTTPS address' })
  }
  return { ...request, tabId: request.tabId }
}

function signedIn(request: RequestAuth, result: Result<SignedIn, PinFailure>): PinOutcome {
  if (result.isOk()) {
    request.setBrowserKey(result.unwrap().browserKey)
  }
  return outcome(result)
}

export const authRouter = t.router({
  status: openProcedure.query(async ({ ctx }) =>
    ctx.app.auth.status(ctx.request?.browserKey ?? null, ctx.request?.tabId ?? null, ctx.request?.encrypted ?? false),
  ),

  signIn: openProcedure.input(z.object({ pin: pinInput })).mutation(async ({ ctx, input }) => {
    const request = signingIn(ctx)
    return signedIn(request, await ctx.app.auth.signIn(input.pin, request.browserKey, request.tabId))
  }),

  setFirstPin: openProcedure.input(z.object({ pin: pinInput })).mutation(async ({ ctx, input }) => {
    const request = signingIn(ctx)
    return signedIn(request, await ctx.app.auth.setFirstPin(input.pin, request.browserKey, request.tabId))
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
