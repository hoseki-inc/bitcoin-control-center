import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, router } from '../../modules/trpc/init'

export const manualRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return (await ctx.app.manualService.listAccounts()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      balanceAsOf: a.balanceAsOf,
      createdAt: a.createdAt,
    }))
  }),

  get: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
    const account = await ctx.app.manualService.getAccount(input.accountId)
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual account not found' })
    }
    return {
      id: account.id,
      displayName: account.displayName,
      currency: 'BTC' as const,
      balance: account.balanceSats,
      balanceAsOf: account.balanceAsOf,
      createdAt: account.createdAt,
    }
  }),

  create: protectedProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        balanceSats: z.string(),
        balanceAsOf: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.createAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        balanceAsOf: a.balanceAsOf,
        createdAt: a.createdAt,
      }
    }),

  updateBalance: protectedProcedure
    .input(
      z.object({
        accountId: z.string(),
        balanceSats: z.string(),
        balanceAsOf: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.updateBalance(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        balanceAsOf: a.balanceAsOf,
        createdAt: a.createdAt,
      }
    }),

  rename: protectedProcedure
    .input(z.object({ accountId: z.string(), displayName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.manualService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  transactions: router({
    list: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.manualService.listTransactions(input.accountId)
    }),

    add: protectedProcedure
      .input(
        z.object({
          accountId: z.string(),
          type: z.enum(['buy', 'sell', 'transfer_in', 'transfer_out']),
          amountSats: z.string(),
          transactedAt: z.string(),
          note: z.string().optional(),
          addToBalance: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.manualService.addTransaction(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    delete: protectedProcedure
      .input(z.object({ transactionId: z.string(), removeFromBalance: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.manualService.deleteTransaction(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
      }),
  }),
})
