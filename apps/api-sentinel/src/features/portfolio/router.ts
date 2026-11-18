import { parseUnknown } from '@hoseki/packages/result'
import { TimezoneSchema } from '@hoseki/packages/schemas'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../../modules/trpc/init'

export const portfolioRouter = router({
  getData: protectedProcedure
    .input(
      z
        .object({
          timeRange: z.enum(['7d', '30d', '90d', '1y', 'all']).default('30d'),
          claimIds: z.array(z.string()).optional(),
          exchangeAccountIds: z.array(z.string()).optional(),
          manualAccountIds: z.array(z.string()).optional(),
          etfAccountIds: z.array(z.string()).optional(),
          timezone: z.string().default('UTC'),
          customDateRange: z
            .object({
              startDate: z.string(),
              endDate: z.string(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const timezone = parseUnknown(TimezoneSchema, input?.timezone ?? 'UTC')
      if (timezone.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid timezone' })
      }

      const result = await ctx.app.controlCenterService.getData({
        timeRange: input?.timeRange,
        accountIds: input?.claimIds,
        exchangeAccountIds: input?.exchangeAccountIds,
        manualAccountIds: input?.manualAccountIds,
        etfAccountIds: input?.etfAccountIds,
        timezone: timezone.unwrap(),
        customDateRange: input?.customDateRange,
      })
      if (result.isErr()) {
        throw new TRPCError({
          code: input?.customDateRange ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: result.unwrapErr().message,
        })
      }
      return result.unwrap()
    }),
})
