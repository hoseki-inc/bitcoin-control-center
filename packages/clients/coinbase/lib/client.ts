import { type AsyncResult, type Result } from '@hoseki/packages/result'
import { type SafeResponse } from '@hoseki/packages/safe-http'
import { z } from 'zod'
import * as AdvancedTrade from './advanced-trade-types'
import * as App from './app_types'
import { type Credentials } from './credentials'
import { type ApiError } from './errors'
import * as Exchange from './exchange-types'
import { type RequestArgs, request } from './request'
import * as Wallets from './wallets-types'

export interface ClientInit {
  credentials?: Credentials
  version?: string
}

type CoinbaseRequest<T> = AsyncResult<{ data: T; response: SafeResponse }, ApiError>
type CoinbasePromise<T> = Promise<Result<T, ApiError>>

export interface CoinbaseClient {
  advancedTrade: {
    accounts: {
      list(args?: AdvancedTrade.AccountListArgs): CoinbaseRequest<z.infer<typeof AdvancedTrade.AccountList>>
      get(args: { accountUuid?: string }): CoinbaseRequest<{ account: z.infer<typeof AdvancedTrade.Account> }>
    }
  }
  app: {
    user: {
      showCurrent(): CoinbaseRequest<z.infer<typeof App.User>>
    }
    transactions: {
      listTransactions(
        args: App.ListTransactionsArgs,
      ): CoinbaseRequest<z.infer<typeof App.ListTransactionsResponseSchema>>
      showTransaction(args: {
        accountId: string
        transactionId: string
      }): CoinbaseRequest<z.infer<typeof App.ShowTransactionResponseSchema>>
    }
  }
  wallets: {
    users: {
      getCurrent(): CoinbaseRequest<z.infer<typeof Wallets.User>>
    }
  }
  exchange: {
    market: {
      getCandles(args: Exchange.GetCandlesArgs): CoinbasePromise<Exchange.GetCandlesResponse>
      getProductStats(
        args: Exchange.GetProductStatsArgs,
      ): CoinbasePromise<z.infer<typeof Exchange.GetProductStatsResponseSchema>['data']>
    }
  }
}

export interface Client extends CoinbaseClient {}

// This factory is not an elegant solution, but I've run out of ideas.
export function Client(init?: ClientInit): CoinbaseClient {
  function legacyRequest<Schema extends z.ZodTypeAny, ErrorSchema extends z.ZodTypeAny>(
    args: Omit<RequestArgs<Schema, ErrorSchema>, 'auth' | 'url' | 'version'>,
  ): CoinbaseRequest<z.infer<Schema>> {
    return request({
      url: 'https://api.coinbase.com',
      version: init?.version ?? '2023-05-09',
      credentials: init?.credentials,
      ...args,
    })
  }

  const prefix = '/api/v3/brokerage/accounts'
  const accounts = {
    /**
     * Get a list of authenticated accounts for the current user.
     *
     * https://docs.cloud.coinbase.com/advanced-trade-api/reference/retailbrokerageapi_getaccounts
     */
    list(args: AdvancedTrade.AccountListArgs = {}) {
      return legacyRequest({
        method: 'GET',
        path: prefix,
        query: {
          limit: 250,
          ...args,
        },
        schema: AdvancedTrade.AccountList,
        errorSchema: AdvancedTrade.Error,
      })
    },

    /**
     * Get a list of information about an account, given an account UUID.
     *
     * https://docs.cloud.coinbase.com/advanced-trade-api/reference/retailbrokerageapi_getaccount
     */
    get(args: {
      /** The account's UUID. */
      accountUuid?: string
    }) {
      return legacyRequest({
        path: `${prefix}/${args.accountUuid}`,
        method: 'GET',
        schema: z.object({ account: AdvancedTrade.Account }),
        errorSchema: AdvancedTrade.Error,
      })
    },
  }

  const advancedTrade = {
    accounts,
  }

  const appUser = {
    /**
     * https://docs.cdp.coinbase.com/coinbase-app/docs/api-users#show-current-user
     */
    showCurrent() {
      return legacyRequest({
        method: 'GET',
        path: '/v2/user',
        schema: App.User,
        errorSchema: App.ErrorSchema,
      })
    },
  }

  const appTransactions = {
    /**
     * https://docs.cdp.coinbase.com/coinbase-app/docs/api-transactions#list-transactions
     *
     * Note that query params are undocumented, so I only added the ones I could find by trial and error.
     */
    listTransactions(args: App.ListTransactionsArgs) {
      return legacyRequest({
        method: 'GET',
        path: `/v2/accounts/${args.accountId}/transactions`,
        query: {
          limit: args.limit ?? 100,
          order: args.order ?? 'desc',
          starting_after: args.startingAfter,
          ending_before: args.endingBefore,
        },
        schema: App.ListTransactionsResponseSchema,
        errorSchema: App.ErrorSchema,
      })
    },

    /** https://docs.cdp.coinbase.com/coinbase-app/docs/api-transactions#show-transaction */
    showTransaction(args: { accountId: string; transactionId: string }) {
      return legacyRequest({
        method: 'GET',
        path: `/v2/accounts/${args.accountId}/transactions/${args.transactionId}`,
        schema: App.ShowTransactionResponseSchema,
        errorSchema: App.ErrorSchema,
      })
    },
  }

  const app = {
    /** https://docs.cdp.coinbase.com/sign-in-with-coinbase/docs/api-users/ */
    user: appUser,
    /** https://docs.cdp.coinbase.com/sign-in-with-coinbase/docs/api-transactions */
    transactions: appTransactions,
  }

  function cdpRequest<Schema extends z.ZodTypeAny, ErrorSchema extends z.ZodTypeAny>(
    args: Omit<RequestArgs<Schema, ErrorSchema>, 'auth' | 'url' | 'version'>,
  ): CoinbaseRequest<z.infer<Schema>> {
    return request({
      url: 'https://api.cdp.coinbase.com/platform',
      credentials: init?.credentials,
      ...args,
    })
  }

  const walletsUsers = {
    getCurrent() {
      return cdpRequest({
        method: 'GET',
        path: '/v1/users/me',
        schema: Wallets.User,
        errorSchema: Wallets.Error,
      })
    },
  }

  const wallets = {
    /**
     * https://docs.cdp.coinbase.com/wallets/docs/users/
     */
    users: walletsUsers,
  }

  function exchangeRequest<Schema extends z.ZodTypeAny, ErrorSchema extends z.ZodTypeAny>(
    args: Omit<RequestArgs<Schema, ErrorSchema>, 'auth' | 'url' | 'version'>,
  ): CoinbaseRequest<z.infer<Schema>> {
    return request({
      url: 'https://api.exchange.coinbase.com',
      ...args,
    })
  }

  const exchangeMarket = {
    getCandles: async (args: Exchange.GetCandlesArgs): CoinbasePromise<Exchange.GetCandlesResponse> => {
      const result = await exchangeRequest<
        typeof Exchange.GetCandlesResponseSchema,
        typeof Exchange.ExchangeErrorSchema
      >({
        method: 'GET',
        path: `/products/${args.productId}/candles`,
        query: {
          granularity: args.granularity,
          start: args.start,
          end: args.end,
        },
        schema: Exchange.GetCandlesResponseSchema,
        errorSchema: Exchange.ExchangeErrorSchema,
      })
      return result.map((response) => response.data)
    },
    getProductStats: async (
      args: Exchange.GetProductStatsArgs,
    ): CoinbasePromise<z.infer<typeof Exchange.GetProductStatsResponseSchema>['data']> => {
      const result = await exchangeRequest<
        typeof Exchange.GetProductStatsResponseSchema,
        typeof Exchange.ExchangeErrorSchema
      >({
        method: 'GET',
        path: `/products/${args.productId}/stats`,
        schema: Exchange.GetProductStatsResponseSchema,
        errorSchema: Exchange.ExchangeErrorSchema,
      })
      return result.map((response) => response.data.data)
    },
  }

  const exchange = {
    market: exchangeMarket,
  }

  const client: CoinbaseClient = {
    /**
     * https://docs.cdp.coinbase.com/advanced-trade/docs/welcome/
     */
    advancedTrade,

    /**
     * https://docs.cdp.coinbase.com/coinbase-app/docs/welcome
     */
    app,

    /**
     * https://docs.cdp.coinbase.com/wallets/docs/welcome
     */
    wallets,

    /**
     * Coinbase Exchange / Pro API
     * https://docs.cloud.coinbase.com/exchange/reference/exchangerestapi_getproductcandles
     */
    exchange,
  }

  return client
}
