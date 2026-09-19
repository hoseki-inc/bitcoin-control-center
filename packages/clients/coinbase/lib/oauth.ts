import { type SafeResponse } from '@hoseki/packages/safe-http'
import { type AsyncResult } from '@patina/core'
import { z } from 'zod'
import { type ApiError } from './errors'
import { request } from './request'

const errorSchema = z.object({
  error: z.string().nullish(),
  error_description: z.string().nullish(),
  hint: z.string().nullish(),
})
export type OAuthError = z.infer<typeof errorSchema>

export interface AuthorizationUrlArgs {
  /** Client ID you received after registering your application. */
  client_id: string
  response_type: 'code'
  /**
   * URL in your app where users will be sent after authorization. This value needs to be URL encoded.
   * If left out, your application’s first redirect URI will be used by default.
   */
  redirect_uri?: string
  /**
   * List of permissions (scopes) your application requests access to.
   * {@link https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/sign-in-with-coinbase-permissions Required scopes are listed under endpoints in the API reference}
   */
  scope?: Scope[]
  /**
   * Unguessable random string.
   * It is used to protect against cross-site request forgery attacks.
   * {@link https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/sign-in-with-coinbase-security Read more about security}
   */
  state?: string
  /** For logged out users, login view is shown by default. You can show the sign up page instead with value signup */
  layout?: 'signup' | 'login'
  /**
   * Earn a referral bonus from new users who sign up via OAuth. Value needs to be set to developer's referral ID (username).
   * {@link https://support.coinbase.com/customer/portal/articles/683805-how-does-the-coinbase-referral-program-work- Read more}
   */
  referral?: string
}

function authorizeArgsToPayload(args: AuthorizationUrlArgs) {
  return {
    client_id: args.client_id,
    response_type: args.response_type,
    redirect_uri: args.redirect_uri,
    scope: args.scope?.join(','),
    state: args.state,
    layout: args.layout,
    referral: args.referral,
  }
}

/** https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/permissions-scopes */
export enum Scope {
  /** List user's accounts and their balances */
  WalletAccountsRead = 'wallet:accounts:read',
  /** Update account (e.g. change name) */
  WalletAccountsUpdate = 'wallet:accounts:update',
  /** Create a new account (e.g. BTC wallet) */
  WalletAccountsCreate = 'wallet:accounts:create',
  /** Delete existing account */
  WalletAccountsDelete = 'wallet:accounts:delete',

  /** List account's bitcoin or ethereum addresses */
  WalletAddressesRead = 'wallet:addresses:read',
  /** Create new bitcoin or ethereum addresses for wallets */
  WalletAddressesCreate = 'wallet:addresses:create',

  /** List account's buys */
  WalletBuysRead = 'wallet:buys:read',
  /** Buy bitcoin or ethereum */
  WalletBuysCreate = 'wallet:buys:create',

  /** List account's deposits */
  WalletDepositsRead = 'wallet:deposits:read',
  /** Create a new deposit */
  WalletDepositsCreate = 'wallet:deposits:create',

  /** List user's notifications */
  WalletNotificationsRead = 'wallet:notifications:read',

  /** List user's payment methods (e.g. bank accounts) */
  WalletPaymentMethodsRead = 'wallet:payment-methods:read',
  /** Remove existing payment methods */
  WalletPaymentMethodsDelete = 'wallet:payment-methods:delete',
  /** Get detailed limits for payment methods (useful for performing buys and sells). This permission is to be used together with `wallet:payment-methods:read` */
  WalletPaymentMethodsLimits = 'wallet:payment-methods:limits',

  /** List account's sells */
  WalletSellsRead = 'wallet:sells:read',
  /** Sell bitcoin or ethereum */
  WalletSellsCreate = 'wallet:sells:create',

  /** List account's transactions */
  WalletTransactionsRead = 'wallet:transactions:read',
  /** Send bitcoin or ethereum */
  WalletTransactionsSend = 'wallet:transactions:send',
  /** Request bitcoin or ethereum from a Coinbase user */
  WalletTransactionsRequest = 'wallet:transactions:request',
  /** Transfer funds between user's two bitcoin or ethereum accounts */
  WalletTransactionsTransfer = 'wallet:transactions:transfer',

  /** List detailed user information (public information is available without this permission) */
  WalletUserRead = 'wallet:user:read',
  /** Update current user */
  WalletUserUpdate = 'wallet:user:update',
  /** Read current user's email address */
  WalletUserEmail = 'wallet:user:email',

  /** List account's withdrawals */
  WalletWithdrawalsRead = 'wallet:withdrawals:read',
  /** Create a new withdrawal */
  WalletWithdrawalsCreate = 'wallet:withdrawals:create',

  /** Return a refresh token in response */
  OfflineAccess = 'offline_access',
}

const url = 'https://login.coinbase.com'
const prefix = '/oauth2'

/** https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/sign-in-with-coinbase-reference#authorize */
export function getAuthorizationUrl(args: AuthorizationUrlArgs): URL {
  const authorizationUrl = new URL(prefix + '/auth', url)
  Object.entries(authorizeArgsToPayload(args)).forEach(([key, value]) => {
    if (value) {
      authorizationUrl.searchParams.set(key, value)
    }
  })
  return authorizationUrl
}

export type ClientArgs = {
  /** The client ID you received after registering your application. */
  client_id: string
  /** The client secret you received after registering your application. */
  client_secret: string
}

export type RefreshTokenArgs = ClientArgs & {
  grant_type: 'refresh_token'
  refresh_token: string
}

export type AuthorizeTokenArgs = ClientArgs & {
  grant_type: 'authorization_code'
  code: string
  /** Your application's redirect URI */
  redirect_uri: string
}

export type TokenArgs = RefreshTokenArgs | AuthorizeTokenArgs

export const Token = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.literal('Bearer').or(z.literal('bearer')),
  // Not mentioned in the docs, but it's returned usually, marking it as optional for now
  expired_at: z.number().nullish(),
  // Won't exist if the client didn't request `offline_access`
  refresh_token: z.string().nullish(),
})
export type Token = z.infer<typeof Token>

/**
 * https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/sign-in-with-coinbase-reference#token
 */
export function token(args: TokenArgs): AsyncResult<
  {
    data: Token
    response: SafeResponse
  },
  ApiError
> {
  return request({
    method: 'POST',
    url,
    path: prefix + '/token',
    params: args,
    schema: Token,
    errorSchema,
  })
}

export function refresh(args: RefreshTokenArgs): AsyncResult<
  {
    data: Token
    response: SafeResponse
  },
  ApiError
> {
  return token(args)
}

export function authorize(args: AuthorizeTokenArgs): AsyncResult<
  {
    data: Token
    response: SafeResponse
  },
  ApiError
> {
  return token(args)
}

export type RevokeArgs = {
  /** Active access token */
  token: string
  /** Client ID you received after registering your application. */
  client_id: string
  /** Client secret you received after registering your application. */
  client_secret: string
}

/**
 * https://docs.cloud.coinbase.com/sign-in-with-coinbase/docs/sign-in-with-coinbase-reference#revoke
 */
export function revoke(args: RevokeArgs): AsyncResult<
  {
    data: unknown
    response: SafeResponse
  },
  ApiError
> {
  return request({
    method: 'POST',
    url,
    path: prefix + '/revoke',
    params: args,
    schema: z.unknown(),
    errorSchema,
  })
}
