import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { ZodError } from 'zod'
import type { AppContext } from '../../context'
import type { RequestAuth } from '../auth/request'
import type { Session } from '../auth/service'

const transformer = registerCustomSerializers(superjson)

export interface TRPCContext {
  app: AppContext
  /** The HTTP request's cookie and tab; absent for in-process callers such as tests. */
  request?: RequestAuth
}

export const t = initTRPC.context<TRPCContext>().create({
  transformer,
  errorFormatter(input) {
    const errorDetails = input.shape
    const { error } = input
    const message =
      error.cause instanceof ZodError
        ? error.cause.issues.length === 1 && error.cause.issues[0]
          ? error.cause.issues[0].message
          : `The following fields are invalid: ${error.cause.issues.map((issue) => issue.path.join('.')).join(', ')}.`
        : errorDetails.message

    return { ...errorDetails, message }
  },
})

/** Only for the sign-in routes. Everything else uses `protectedProcedure`. */
export const openProcedure = t.procedure

function currentSession(ctx: TRPCContext): Session | null {
  const { auth } = ctx.app
  if (!auth.required) {
    return null
  }
  if (auth.refuses(ctx.request?.encrypted ?? false)) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Open Control Center at its HTTPS address' })
  }
  const session = auth.resolve(ctx.request?.browserKey ?? null, ctx.request?.tabId ?? null)
  if (!session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Enter your PIN' })
  }
  return session
}

/**
 * Every route needs a signed-in tab when the platform requires a PIN. `session` is null only while PINs are
 * off (tests, and platforms that haven't turned them on).
 */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) =>
  next({ ctx: { ...ctx, session: currentSession(ctx) } }),
)

/** Routes that act on this tab's session, which exists only while PINs are required. */
export const sessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PINs are not turned on' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})

/** For actions that ask for the PIN again: the PIN must have been entered in this tab within `maxAgeMs`. */
export function recentPinProcedure(maxAgeMs: number): typeof protectedProcedure {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (ctx.session && !ctx.app.auth.pinEnteredWithin(ctx.session, maxAgeMs)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Enter your PIN again' })
    }
    return next()
  })
}
