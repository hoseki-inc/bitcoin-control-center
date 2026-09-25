import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import { ZodError } from 'zod'
import type { AppContext } from '../../context'

const transformer = registerCustomSerializers(superjson)

export interface TRPCContext {
  app: AppContext
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

/** No auth middleware - single user, local deployment. */
export const publicProcedure = t.procedure
