import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { TRPCError, initTRPC } from '@trpc/server'
import superjson, { type SuperJSONResult, type SuperJSONValue } from 'superjson'
import { ZodError } from 'zod'
import type { AppContext } from '../../context'
import type { RequestAuth } from '../auth/request'
import { checkRequestTypes } from './request-types'

const serializer = registerCustomSerializers(superjson)

// tRPC reports a body that fails to deserialize as a server error; it is the client's.
const transformer = {
  input: {
    serialize: (value: SuperJSONValue): SuperJSONResult => serializer.serialize(value),
    deserialize: (value: SuperJSONResult): SuperJSONValue => {
      try {
        const checked = checkRequestTypes(value.meta)
        if (checked.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid request body: ${checked.unwrapErr()}` })
        }
        return serializer.deserialize<SuperJSONValue>(value)
      } catch (cause) {
        if (cause instanceof TRPCError) {
          throw cause
        }
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid request body', cause })
      }
    },
  },
  output: serializer,
}

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

const NO_VISITOR = { browserKey: null, tabId: null, encrypted: false }

/** Every route needs a signed-in tab where the platform requires a PIN. `session` is null only while PINs are off. */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const authorized = ctx.app.auth.authorize(ctx.request ?? NO_VISITOR)
  if (authorized.isErr()) {
    const message =
      authorized.unwrapErr() === 'insecure' ? 'Open Control Center at its HTTPS address' : 'Enter your PIN'
    throw new TRPCError({ code: 'UNAUTHORIZED', message })
  }
  return next({ ctx: { ...ctx, session: authorized.unwrap() } })
})

/** Routes that act on this tab's session, which exists only while PINs are on. */
export const sessionProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'PINs are not turned on' })
  }
  return next({ ctx: { ...ctx, session: ctx.session } })
})

/** For actions that ask for the PIN again: it must have been entered in this tab within `maxAgeMs`. */
export function recentPinProcedure(maxAgeMs: number): typeof protectedProcedure {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (ctx.session && !ctx.app.auth.pinEnteredWithin(ctx.session, maxAgeMs)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Enter your PIN again' })
    }
    return next()
  })
}
