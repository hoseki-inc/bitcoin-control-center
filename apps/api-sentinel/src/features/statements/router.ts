import { StatementQuoteCurrencySchema } from '@hoseki/packages/schemas'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { parseDbTimestamp } from '../../db/timestamp'
import { loggableError } from '../../lib/loggable-error'
import { protectedProcedure, router } from '../../modules/trpc/init'
import { StatementMapper } from './mapper'
import { loggableFailure, statementFailureMessage } from './service'

export const statementsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.app.statementService.list()
  }),

  initiateGeneration: protectedProcedure
    .input(
      z.object({
        claimIds: z.array(z.string()),
        exchangeAccountIds: z.array(z.string()).optional(),
        quoteCurrency: StatementQuoteCurrencySchema.default('USD'),
        openingDate: z.date(),
        closingDate: z.date(),
        timezone: z.string(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const logger = ctx.app.logger.child({ module: 'statement-generation' })
      logger.info(
        { claimIds: input.claimIds, openingDate: input.openingDate, closingDate: input.closingDate },
        'Starting statement generation',
      )

      // Reject invalid dates before saving a statement that could only fail.
      const created = await ctx.app.statementService.create(input)
      if (created.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: created.unwrapErr().message })
      }
      const statementId = created.unwrap()
      logger.info({ statementId }, 'Created pending statement')

      // Fire-and-forget: generate data in background so the client gets the pending DTO immediately
      void (async () => {
        try {
          const dataResult = await ctx.app.statementService.generateStatementData(input, statementId)
          if (dataResult.isErr()) {
            const error = dataResult.unwrapErr()
            logger.error({ statementId, ...loggableFailure(error) }, 'Statement data generation failed')
            await ctx.app.statementService.fail(statementId, statementFailureMessage(error))
            return
          }

          const { transactionMap, dailyRates } = dataResult.unwrap()
          const txCount = Object.values(transactionMap).reduce((sum, account) => sum + account.transactions.length, 0)
          logger.info(
            {
              statementId,
              accounts: Object.keys(transactionMap).length,
              transactions: txCount,
              ratesDays: Object.keys(dailyRates.rates).length,
            },
            'Statement data generated, completing',
          )

          const completed = await ctx.app.statementService.complete(statementId, transactionMap, dailyRates)
          if (completed.isErr()) {
            logger.error({ statementId, ...loggableFailure(completed.unwrapErr()) }, 'Statement could not be completed')
            await ctx.app.statementService.fail(statementId, completed.unwrapErr().message)
            return
          }
          logger.info({ statementId }, 'Statement generation completed')
        } catch (err) {
          // Database errors put the values they were saving, such as txids, in their message.
          logger.error(
            { statementId, ...(err instanceof Error ? loggableError(err) : { error: 'unknown' }) },
            'Unhandled error in statement generation',
          )
          // The same fault can stop this write too; a restart then marks the statement interrupted.
          try {
            await ctx.app.statementService.fail(statementId)
          } catch (failure) {
            logger.error(
              { statementId, ...(failure instanceof Error ? loggableError(failure) : { error: 'unknown' }) },
              'Could not mark the statement as failed',
            )
          }
        }
      })()

      // Return the pending statement immediately
      const dto = await ctx.app.statementService.findById(statementId)
      if (!dto) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Statement not found after creation' })
      }
      return dto
    }),

  retrieve: protectedProcedure.input(z.string()).query(async ({ ctx, input: statementId }) => {
    const dto = await ctx.app.statementService.findById(statementId)
    if (!dto) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
    }
    return dto
  }),

  delete: protectedProcedure.input(z.string()).mutation(async ({ ctx, input: statementId }) => {
    const deleted = await ctx.app.statementService.delete(statementId)
    if (deleted.isErr()) {
      switch (deleted.unwrapErr()) {
        case 'not_found':
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
        case 'pending':
          throw new TRPCError({ code: 'CONFLICT', message: 'Statement is still generating' })
      }
    }
  }),

  retrieveDocumentData: protectedProcedure
    .input(z.object({ statementId: z.string(), format: z.enum(['custom', 'monthly']) }))
    .query(async ({ ctx, input }) => {
      const loaded = await ctx.app.statementService.loadCompleted(input.statementId)
      if (!loaded) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Completed statement not found' })
      }

      const mapper = new StatementMapper()
      const pdfResult = mapper.toPdfStatement(
        {
          id: loaded.row.id,
          createdAt: parseDbTimestamp(loaded.row.createdAt),
          status: 'completed',
          counter: loaded.row.counter,
          timezone: loaded.row.timezone,
          openingDate: new Date(loaded.row.openingDate),
          closingDate: new Date(loaded.row.closingDate),
          user: { email: null, name: loaded.row.userName, address: loaded.row.userAddress },
          transactionMap: loaded.transactionMap,
          dailyRates: loaded.dailyRates,
        },
        input.format,
      )

      if (pdfResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: pdfResult.unwrapErr().message })
      }
      return pdfResult.unwrap()
    }),
})

// ─── portalProve (combined) ─────────────────────────────────────────────────
