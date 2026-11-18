import { StatementQuoteCurrencySchema } from '@hoseki/packages/schemas'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { settings } from '../../db/schema'
import { protectedProcedure, router } from '../../modules/trpc/init'
import { PRICE_FALLBACKS_SETTING, PRICE_SOURCES, PRICE_SOURCE_SETTING } from './service'

export const priceRouter = router({
  current: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.app.priceService.getCurrentBtcPrice()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    return result.unwrap()
  }),

  history: protectedProcedure
    .input(
      z.object({
        days: z.union([z.literal(7), z.literal(30), z.literal(180), z.literal(365)]),
        quoteCurrency: StatementQuoteCurrencySchema.default('USD'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await ctx.app.priceHistoryService.getHistory(input.days, input.quoteCurrency)
      if (result.isErr()) {
        ctx.app.logger.warn({ err: result.unwrapErr(), days: input.days }, 'Bitcoin price history unavailable')
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Price history for this range is not available from your allowed price sources.',
        })
      }
      return result.unwrap()
    }),

  // Answers at once, so Settings can change the source even while every source is down.
  options: protectedProcedure.query(async ({ ctx }) => ctx.app.priceService.options()),

  // Price settings change how Sentinel fetches prices, so they are saved together here and the
  // price service is told, rather than written through the generic settings `update`.
  setSettings: protectedProcedure
    .input(z.object({ source: z.enum(PRICE_SOURCES).optional(), fallbacks: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.source !== undefined && !ctx.app.priceService.isAvailable(input.source)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That price source is not available' })
      }
      await ctx.app.database.transaction(async (tx) => {
        if (input.source !== undefined) {
          await tx
            .insert(settings)
            .values({ key: PRICE_SOURCE_SETTING, value: input.source })
            .onConflictDoUpdate({ target: settings.key, set: { value: input.source } })
        }
        if (input.fallbacks !== undefined) {
          const value = String(input.fallbacks)
          await tx
            .insert(settings)
            .values({ key: PRICE_FALLBACKS_SETTING, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } })
        }
      })
      ctx.app.priceService.settingsUpdated()
      return ctx.app.priceService.options()
    }),

  status: protectedProcedure.query(async ({ ctx }) => {
    // Look the price up under the current settings, so a status never describes an earlier choice.
    const result = await ctx.app.priceService.getCurrentBtcPrice({ verifyPrimary: true })
    const price = result.isOk() ? result.unwrap() : null
    const { selected, fallbacks } = await ctx.app.priceService.options()
    return {
      selected,
      fallbacks,
      price: price ? { source: price.source, asOf: price.asOf.toISOString(), lastKnown: price.lastKnown } : null,
    }
  }),
})
