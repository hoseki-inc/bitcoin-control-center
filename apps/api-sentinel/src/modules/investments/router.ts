import type { Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { protectedProcedure, t } from '../trpc/init'
import { InvestmentService } from './service'

const accountInput = z.object({ accountId: z.string().min(1) })
const valuationFields = {
  // Limit the value to an exact integer number of cents within JS's safe integer range.
  valueCents: z
    .string()
    .regex(/^\d{1,16}$/)
    .pipe(z.string().refine((value) => BigInt(value) <= 9007199254740991n, 'Value is too large')),
  valuedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`)
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    }, 'Enter a valid valuation date')
    .refine((value) => {
      // Calendar dates can be tomorrow in the owner's time zone while the server is still on today.
      const latestDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      return value <= latestDate
    }, 'Valuation date cannot be more than one day ahead of today'),
  note: z.string().trim().max(2000).optional(),
}
const name = z.string().trim().min(1).max(200)

function unwrap(result: Result<void, Error>): void {
  if (result.isErr()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
  }
}

export const investmentRouter = t.router({
  list: protectedProcedure.query(async ({ ctx }) => new InvestmentService(ctx.app.database).listAccounts()),
  get: protectedProcedure.input(accountInput).query(async ({ ctx, input }) => {
    const service = new InvestmentService(ctx.app.database)
    const account = await service.getAccount(input.accountId)
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Investment account not found' })
    }
    return account
  }),
  create: protectedProcedure
    .input(z.object({ displayName: name, ...valuationFields }))
    .mutation(async ({ ctx, input }) => new InvestmentService(ctx.app.database).createAccount(input)),
  rename: protectedProcedure.input(accountInput.extend({ displayName: name })).mutation(async ({ ctx, input }) => {
    unwrap(await new InvestmentService(ctx.app.database).renameAccount(input.accountId, input.displayName))
  }),
  delete: protectedProcedure.input(accountInput).mutation(async ({ ctx, input }) => {
    unwrap(await new InvestmentService(ctx.app.database).deleteAccount(input.accountId))
  }),
  saveValuation: protectedProcedure
    .input(accountInput.extend({ id: z.string().min(1).optional(), ...valuationFields }))
    .mutation(async ({ ctx, input }) => {
      unwrap(await new InvestmentService(ctx.app.database).saveValuation(input))
    }),
  deleteValuation: protectedProcedure
    .input(accountInput.extend({ id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      unwrap(await new InvestmentService(ctx.app.database).deleteValuation(input.accountId, input.id))
    }),
})
