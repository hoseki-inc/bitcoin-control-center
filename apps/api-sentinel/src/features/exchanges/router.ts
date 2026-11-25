import type { Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import type { Logger } from 'pino'
import { z } from 'zod'
import { protectedProcedure, router } from '../../modules/trpc/init'
import { EXCHANGE_DISPLAY_NAMES, ExchangeUserError, type SupportedExchange, safeErrorKind } from './provider-errors'

interface ExchangeAccountResponseDto {
  id: string
  exchange: SupportedExchange
  displayName: string
  currency: 'BTC'
  balance: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: 'connected' | 'needs_reconnect'
}

function exchangeAccountToDto(account: {
  id: string
  exchange: SupportedExchange
  displayName: string
  balanceSats: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: 'connected' | 'needs_reconnect'
}): ExchangeAccountResponseDto {
  return {
    id: account.id,
    exchange: account.exchange,
    displayName: account.displayName,
    currency: 'BTC' as const,
    balance: account.balanceSats,
    balanceAsOf: account.balanceAsOf,
    createdAt: account.createdAt,
    connectionStatus: account.connectionStatus,
  }
}

function toConnectTrpcError(error: Error, provider: SupportedExchange): TRPCError {
  if (error instanceof ExchangeUserError) {
    return new TRPCError({ code: error.code, message: error.message })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: `Couldn't connect to ${EXCHANGE_DISPLAY_NAMES[provider]} right now. Please try again.`,
  })
}

function toRefreshTrpcError(error: Error): TRPCError {
  if (error instanceof ExchangeUserError) {
    return new TRPCError({ code: error.code, message: error.message })
  }
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Failed to refresh exchange balance. Please try again.',
  })
}

async function runSanitizedConnect<T>(
  provider: SupportedExchange,
  logger: Logger,
  action: () => PromiseLike<Result<T, Error>>,
): Promise<T> {
  let result: Result<T, Error>
  try {
    result = await action()
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error('Unexpected error')
    logger.debug({ provider, errorKind: safeErrorKind(error) }, 'Exchange connect threw unexpectedly')
    throw toConnectTrpcError(error, provider)
  }
  if (result.isErr()) {
    throw toConnectTrpcError(result.unwrapErr(), provider)
  }
  return result.unwrap()
}

async function runSanitizedRefresh<T>(logger: Logger, action: () => PromiseLike<Result<T, Error>>): Promise<T> {
  let result: Result<T, Error>
  try {
    result = await action()
  } catch (thrown) {
    const error = thrown instanceof Error ? thrown : new Error('Unexpected error')
    logger.debug({ errorKind: safeErrorKind(error) }, 'Exchange refresh threw unexpectedly')
    throw toRefreshTrpcError(error)
  }
  if (result.isErr()) {
    throw toRefreshTrpcError(result.unwrapErr())
  }
  return result.unwrap()
}

export const exchangesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.app.exchangeService.listAccounts()
    return accounts.map(exchangeAccountToDto)
  }),

  refreshBalance: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    return runSanitizedRefresh(ctx.app.logger, () => ctx.app.exchangeService.refreshBalance(input.accountId))
  }),

  refreshAllBalances: protectedProcedure.mutation(async ({ ctx }) => {
    await runSanitizedRefresh(ctx.app.logger, () => ctx.app.exchangeService.refreshAllBalances())
  }),

  delete: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.exchangeService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  coinbase: router({
    connect: protectedProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          secretKey: z.string().min(1),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return runSanitizedConnect('coinbase', ctx.app.logger, () => ctx.app.exchangeService.connectCoinbase(input))
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('coinbase')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  strike: router({
    connect: protectedProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          displayName: z.string().optional(),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return runSanitizedConnect('strike', ctx.app.logger, () => ctx.app.exchangeService.connectStrike(input))
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('strike')
      return accounts.map(exchangeAccountToDto)
    }),

    importStatement: protectedProcedure
      .input(
        z.object({
          accountId: z.string(),
          transactions: z.array(
            z.object({
              externalId: z.string(),
              transactedAt: z.string(),
              type: z.string(),
              amountBtc: z.string(),
              amountUsd: z.string().optional(),
              feeUsd: z.string().optional(),
              feeBtc: z.string().optional(),
              exchangeRate: z.string().optional(),
              description: z.string().optional(),
              txHash: z.string().optional(),
              statementMonth: z.string(),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.importStatementTransactions(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    listStatementTransactions: protectedProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        return ctx.app.exchangeService.listStatementTransactions(input.accountId, input.statementMonth)
      }),

    listStatementMonths: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.exchangeService.listStatementMonths(input.accountId)
    }),

    deleteStatementMonth: protectedProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.app.exchangeService.deleteStatementMonth(input.accountId, input.statementMonth)
        return { deleted }
      }),
  }),

  robinhood: router({
    connect: protectedProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          privateKeyBase64: z.string().min(1),
          displayName: z.string().optional(),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return runSanitizedConnect('robinhood', ctx.app.logger, () => ctx.app.exchangeService.connectRobinhood(input))
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('robinhood')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  kraken: router({
    connect: protectedProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          secretKey: z.string().min(1),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        return runSanitizedConnect('kraken', ctx.app.logger, () => ctx.app.exchangeService.connectKraken(input))
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('kraken')
      return accounts.map(exchangeAccountToDto)
    }),
  }),
})
