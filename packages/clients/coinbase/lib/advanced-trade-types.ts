import { openEnum } from '@hoseki/packages/schemas'
import { z } from 'zod'

export interface AccountListArgs {
  /**
   * A pagination limit with default of 49 and maximum of 250.
   * If has_next is true, additional orders are available to be fetched with pagination and
   * the cursor value in the response can be passed as cursor parameter in the subsequent request.
   */
  limit?: number
  /** Cursor used for pagination. When provided, the response returns responses after this cursor. */
  cursor?: string
}

// We can't rely on any of these fields being defined in the response unfortunately,
// even though they are documented in the API, testing has shown that they are not always present.
export const Error = z.object({
  error: z.string().optional().nullable(),
  code: z.number().optional().nullable(),
  message: z.string().optional().nullable(),
  details: z
    .array(
      z.object({
        type_url: z.string().optional().nullable(),
        value: z.string().optional().nullable(),
      }),
    )
    .optional()
    .nullable(),
})

export const AccountType = openEnum([
  'ACCOUNT_TYPE_UNSPECIFIED',
  'ACCOUNT_TYPE_CRYPTO',
  'ACCOUNT_TYPE_FIAT',
  'ACCOUNT_TYPE_VAULT',
  'ACCOUNT_TYPE_PERP_FUTURES',
])
export type AccountType = z.infer<typeof AccountType>

export const Account = z.object({
  /** Unique identifier for account. */
  uuid: z.string(),
  /** Name for the account. */
  name: z.string(),
  /** Currency symbol for the account. */
  currency: z.string(),
  available_balance: z.object({
    /** Amount of currency that this object represents. */
    value: z.string(),
    /** Denomination of the currency. */
    currency: z.string(),
  }),
  /** Whether or not this account is the user's primary account */
  default: z.boolean(),
  /** Whether or not this account is active and okay to use. */
  active: z.boolean(),
  /** Time at which this account was created. */
  created_at: z.coerce.date().optional().nullable(),
  /** Time at which this account was updated. */
  updated_at: z.coerce.date().optional().nullable(),
  /** Time at which this account was deleted. */
  deleted_at: z.coerce.date().optional().nullable(),
  type: AccountType,
  /** Whether or not this account is ready to trade. */
  ready: z.boolean(),
  hold: z.object({
    /** Amount of currency that this object represents. */
    value: z.string(),
    /** Denomination of the currency. */
    currency: z.string(),
  }),
})
export interface Account extends z.infer<typeof Account> {}

export const AccountList = z.object({
  accounts: z.array(Account),
  /** Whether there are additional pages for this query. */
  has_next: z.boolean(),
  /**
   * Cursor for paginating.
   * Users can use this string to pass in the next call to this endpoint,
   * and repeat this process to fetch all accounts through pagination.
   */
  cursor: z.string().optional().nullable(),
  /** Number of accounts returned */
  size: z.number(),
})
export interface AccountList extends z.infer<typeof AccountList> {}
