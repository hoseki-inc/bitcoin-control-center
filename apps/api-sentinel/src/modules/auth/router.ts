import type { Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { type TRPCContext, openProcedure, sessionProcedure, t } from '../trpc/init'
import { Pin } from './pin'
import type { RequestAuth } from './request'
import type { PinFailure, PinRefusal } from './service'

const NO_REQUEST = { code: 'BAD_REQUEST', message: 'Reload the page and try again' } as const

/** Wrong PINs and delays are expected outcomes, so they come back as data rather than errors. */
export type PinOutcome = { ok: true } | ({ ok: false } & PinRefusal)

const ERRORS = {
  'no-tab': NO_REQUEST,
  insecure: { code: 'FORBIDDEN', message: 'Open Control Center at its HTTPS address' },
  'not-set': { code: 'PRECONDITION_FAILED', message: 'No PIN is set yet' },
  'already-set': { code: 'CONFLICT', message: 'A PIN is already set' },
  'setup-unavailable': { code: 'FORBIDDEN', message: 'Set the PIN from your server' },
} as const satisfies Record<
  Exclude<PinFailure['reason'], PinRefusal['reason']>,
  ConstructorParameters<typeof TRPCError>[0]
>

function outcome(result: Result<unknown, PinFailure>): PinOutcome {
  if (result.isOk()) {
    return { ok: true }
  }
  const failure = result.unwrapErr()
  if (failure.reason === 'wrong' || failure.reason === 'wait') {
    return { ok: false, ...failure }
  }
  throw new TRPCError(ERRORS[failure.reason])
}

function request(ctx: TRPCContext): RequestAuth {
  if (!ctx.request) {
    throw new TRPCError(NO_REQUEST)
  }
  return ctx.request
}

/** Sets the browser cookie once Sentinel has signed this tab in. */
function signedIn(auth: RequestAuth, result: Result<string, PinFailure>): PinOutcome {
  if (result.isOk()) {
    auth.setBrowserKey(result.unwrap())
  }
  return outcome(result)
}

export const authRouter = t.router({
  status: openProcedure.query(async ({ ctx }) =>
    ctx.app.auth.status(ctx.request ?? { browserKey: null, tabId: null, encrypted: false }),
  ),

  signIn: openProcedure.input(z.object({ pin: Pin })).mutation(async ({ ctx, input }) => {
    const auth = request(ctx)
    return signedIn(auth, await ctx.app.auth.signIn(input.pin, auth))
  }),

  setFirstPin: openProcedure.input(z.object({ pin: Pin })).mutation(async ({ ctx, input }) => {
    const auth = request(ctx)
    return signedIn(auth, await ctx.app.auth.setFirstPin(input.pin, auth))
  }),

  confirmPin: sessionProcedure
    .input(z.object({ pin: Pin }))
    .mutation(async ({ ctx, input }) => outcome(await ctx.app.auth.confirm(ctx.session, input.pin))),

  changePin: sessionProcedure
    .input(z.object({ currentPin: Pin, newPin: Pin }))
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
