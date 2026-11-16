import { isValidEtfShares } from '@hoseki/packages/etfs/holdings'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../../modules/trpc/init'

const etfTickerSchema = z.enum(['IBIT', 'FBTC', 'GBTC', 'ARKB', 'BITB', 'HODL', 'BTC', 'MSBT'])
const etfSharesSchema = z.string().refine(isValidEtfShares, 'Shares must be a number above zero')
// The app sends noon on the chosen local day, which can run ahead of the server's clock, so allow a day of slack.
const etfPurchaseDateSchema = z
  .string()
  .datetime()
  .refine((value) => Date.parse(value) <= Date.now() + 24 * 60 * 60 * 1000, 'Purchase date cannot be in the future')

export const etfRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return (await ctx.app.etfService.listAccounts()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      createdAt: a.createdAt,
    }))
  }),

  get: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
    const account = await ctx.app.etfService.getAccount(input.accountId)
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'ETF account not found' })
    }
    return {
      id: account.id,
      displayName: account.displayName,
      currency: 'BTC' as const,
      balance: account.balanceSats,
      createdAt: account.createdAt,
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        holdings: z.array(
          z.object({
            ticker: etfTickerSchema,
            shares: etfSharesSchema,
            datePurchased: etfPurchaseDateSchema.optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.createAccount({
        displayName: input.displayName,
        holdings: input.holdings,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        createdAt: a.createdAt,
      }
    }),

  rename: protectedProcedure
    .input(z.object({ accountId: z.string(), displayName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.etfService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  holdings: router({
    list: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.etfService.listHoldings(input.accountId)
    }),

    add: protectedProcedure
      .input(
        z.object({
          accountId: z.string(),
          ticker: etfTickerSchema,
          shares: etfSharesSchema,
          datePurchased: etfPurchaseDateSchema.optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.etfService.addHolding(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    remove: protectedProcedure.input(z.object({ holdingId: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.removeHolding(input.holdingId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),
  }),
})
