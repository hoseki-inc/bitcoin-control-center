import { literalUnion } from '@hoseki/packages/schemas/literal-union'
import { z } from 'zod'

const Country = z.object({
  code: z.string(),
  name: z.string(),
  is_in_europe: z.boolean().nullish(),
})

const Tiers = z.object({
  completed_description: z.string().nullish(),
  upgrade_button_text: z.string().nullish(),
  header: z.string().nullish(),
  body: z.string().nullish(),
})

const ReferralMoney = z.object({
  amount: z.string(),
  currency: z.string(),
  currency_symbol: z.string(),
  referral_threshold: z.string(),
})

// These are all undocumented fields that can show up if using an API key instead of OAuth
export const ApiUser = z.object({
  profile_location: z.string().nullish(),
  legacy_id: z.string().nullish(),
  time_zone: z.string().nullish(),
  native_currency: z.string().nullish(),
  bitcoin_unit: z.string().nullish(),
  state: z.string().nullish(),
  country: Country.nullish(),
  nationality: Country.nullish(),
  region_supports_fiat_transfers: z.boolean().nullish(),
  region_supports_crypto_to_crypto_transfers: z.boolean().nullish(),
  created_at: z.string().nullish(),
  supports_rewards: z.boolean().nullish(),
  tiers: Tiers.nullish(),
  referral_money: ReferralMoney.nullish(),
  has_blocking_buy_restrictions: z.boolean().nullish(),
  has_made_a_purchase: z.boolean().nullish(),
  has_buy_deposit_payment_methods: z.boolean().nullish(),
  has_unverified_buy_deposit_payment_methods: z.boolean().nullish(),
  needs_kyc_remediation: z.boolean().nullish(),
  show_instant_ach_ux: z.boolean().nullish(),
  user_type: z.string().nullish(),
})

/**
 * https://docs.cdp.coinbase.com/sign-in-with-coinbase/docs/api-users/
 */
export const User = z.object({
  data: z
    .object({
      /** Resource ID */
      id: z.string(),
      /** User's public name */
      name: z.string().nullish(),
      /** Payment method's native currency */
      username: z.string().nullish(),
      /** Location for user's public profile */
      profile: z.string().nullish(),
      /** Bio for user's public profile */
      profile_bio: z.string().nullish(),
      /** Public profile location if user has one */
      profile_url: z.string().nullish(),
      /** User's avatar url */
      avatar_url: z.string().nullish(),
      resource: z.literal('user').nullish(),
      resource_path: z.string().nullish(),
    })
    .merge(ApiUser),
})
export type User = z.infer<typeof User>

export const TransactionTypeSchema = literalUnion([
  /** Fills for an advanced trade order */
  'advanced_trade_fill',
  /** Buy a digital asset */
  'buy',
  /** Recover money already disbursed */
  'clawback',
  /** Daily settlement between spot and futures accounts for US futures product */
  'derivatives_settlement',
  /** Payout for user earn on Coinbase */
  'earn_payout',
  /** Deposit funds into a fiat account from a financial institution */
  'fiat_deposit',
  /** Withdraw funds from a fiat account */
  'fiat_withdrawal',
  /** Redemptions for Incentive & Referral campaigns */
  'incentives_rewards_payout',
  /** Clawback incentive payout from customer account */
  'incentives_shared_clawback',
  /** Deposit crypto to customer international account */
  'intx_deposit',
  /** Withdraw crypto from customer international account */
  'intx_withdrawal',
  /** Receive a digital asset */
  'receive',
  /** Request a digital asset from a user or email */
  'request',
  /** Sweep of dust balance from the account */
  'retail_simple_dust',
  /** ETH2 deprecation transaction */
  'retail_eth2_deprecation',
  /** Sell a digital asset */
  'sell',
  /** Send a supported digital asset to a corresponding address or email. Note: Previously functioned as a default catch-all type., Now it is restricted to send transactions only.  */
  'send',
  /** Funds from primary account moved to staked account */
  'staking_transfer',
  /** Transaction for Coinbase subscription rebate */
  'subscription_rebate',
  /** Transaction for Coinbase subscription */
  'subscription',
  /** Exchange one cryptocurrency for another cryptocurrency or fiat currency */
  'trade',
  /** Transfer funds between two of your own accounts */
  'transfer',
  /** Default transaction type, uncategorized. Note: Previously defined as the send type. */
  'tx',
  /** Funds from staked funds moved to primary account */
  'unstaking_transfer',
  /** Staking reward payout */
  'staking_reward',
  /** Recover unsupported ERC-20s deposited to Coinbase on ethereum mainnet */
  'unsupported_asset_recovery',
  /** Unwrap wrapped assets, e.g. cbETH, to wrappable assets, e.g. staked ETH */
  'unwrap_asset',
  /** Withdraw funds from a vault account */
  'vault_withdrawal',
  /** Wrap wrappable assets, e.g. staked ETH, to wrapped assets, e.g. cbETH */
  'wrap_asset',
  /** Conversion of USDC to USD to support the anticipated margin requirement for a futures trade */
  'fcm_futures_usdc_sell',
  /** Conversion of USDC to USD to support additional margin requirements or cover losses for open futures positions */
  'fcm_futures_usdc_sell_additional_encumberment_rollup',
  // *** Undocumented variants ***
  'pro_withdrawal',
  'pro_deposit',
  'exchange_deposit',
  'exchange_withdrawal',
  'interest',
  'credit_card_reward',
])
export type TransactionType = z.infer<typeof TransactionTypeSchema>

export const TransactionStatusSchema = literalUnion([
  /** Transaction was canceled */
  'canceled',
  /** Completed transactions (e.g., a send or a buy) */
  'completed',
  /** Conditional transaction expired due to external factors */
  'expired',
  /** Failed transactions (e.g., failed buy) */
  'failed',
  /** Pending transactions (e.g., a send or a buy) */
  'pending',
  /** Vault withdrawal is waiting to be cleared */
  'waiting_for_clearing',
  /** Vault withdrawal is waiting for approval */
  'waiting_for_signature',
])
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>

export const TransactionAmountSchema = z
  .object({
    amount: z.string(),
    currency: z.string(),
  })
  .strict()
export type TransactionAmount = z.infer<typeof TransactionAmountSchema>

const TransactionBuyOrSellSchema = z
  .object({
    id: z.string(),
    fee: TransactionAmountSchema.nullish(), // This is required in the documentation, but not in the actual API response
    payment_method_name: z.string().nullish(),
    subtotal: TransactionAmountSchema,
    total: TransactionAmountSchema,
  })
  .strict()

export const TransactionAdvancedTradeFillSchema = z
  .object({
    /** Price this fill was posted at */
    fill_price: z.string(),
    product_id: z.string(),
    /** The UUID of the order this fill belongs to */
    order_id: z.string(),
    /** Commission per fill of the order. Always represented in quote currency. */
    commission: z.string(),
    /** Side the order was placed on. Possible values: BUY, SELL */
    order_side: z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(['buy', 'sell'])),
  })
  .strict()

export const TransactionSchema = z
  .object({
    /** Transaction ID */
    id: z.string(),
    /** Transaction Type */
    type: TransactionTypeSchema,
    /** Transaction Status */
    status: TransactionStatusSchema,
    /** Amount of any supported digital asset. */
    amount: TransactionAmountSchema,
    /** Amount in user's native currency. */
    native_amount: TransactionAmountSchema,
    /** User defined description */
    description: z.string().nullish(),
    created_at: z.coerce.date(),
    /** Deprecated for List/Show Tx on 7 Feb */
    updated_at: z.coerce.date().nullish(),
    resource: z.literal('transaction'),
    resource_path: z.string(),
    /** Deprecated for List/Show Tx on 7 Feb */
    instant_exchange: z.boolean().nullish(),
    /** Only provided if the transaction type is advanced_trade_fill. Contains information about the fill posted. */
    advanced_trade_fill: TransactionAdvancedTradeFillSchema.nullish(),
    /**
     * Deprecated for List/Show Tx on 7 Feb
     * Detailed information about the transaction
     */
    details: z
      .object({
        /** Description of transaction with currency. Example: "Received Bitcoin" */
        title: z.string(),
        subsidebar_label: z.string(),
        /** Amount received, in amount and equivalent native amount. Example: "Received 0.005378 BTC ($49.92)" */
        header: z.string(),
        /** Health of transaction. Example: "Positive" */
        health: z.string(),
      })
      .nullish(),
    /** Info about crypto networks including on-chain transaction hashes. Only available for certain types of transactions. */
    network: z
      .object({
        status: literalUnion(['off_blockchain', 'confirmed', 'pending', 'unconfirmed']),
        /**
         * Deprecated for List/Show Tx on 7 Feb
         * Description of status
         */
        status_description: z.string().nullish(),
        /**
         * New for List/Show Tx on 7 Feb
         * Hash for onchain transactions; ONLY provided when transaction is a SEND
         */
        hash: z.string().nullish(),
        /**
         * New for List/Show Tx on 7 Feb
         * Transaction fee; ONLY provided when transaction is a SEND
         */
        transaction_fee: z.unknown().nullish(),
        /**
         * New for List/Show Tx on 7 Feb
         * Name of transaction network; ONLY provided when transaction is a SEND
         */
        network_name: z.string().nullish(),
      })
      .nullish(),
    /** Receiving party of a debit transaction. Usually another resource but can be another type like email. Only available for certain types of transactions. */
    to: z.unknown().nullish(),
    /** Originating party of a credit transaction. Usually another resource, but can be another type like Bitcoin network. Only available for certain types of transactions. */
    from: z.unknown().nullish(),
    /**
     * Deprecated for List/Show Tx on 7 Feb
     * Associated crypto address for received payment
     */
    address: z.unknown().nullish(),
    /**
     * Deprecated for List/Show Tx on 7 Feb
     * Associated OAuth2 application
     */
    application: z.unknown().nullish(),
    /**
     * New for List/Show Tx on 7 Feb
     * Allowed to cancel transaction; ONLY provided when transaction is a SEND
     */
    cancelable: z.boolean().nullish(),
    /**
     * New for List/Show Tx on 7 Feb
     * Idempotency key of transaction; ONLY provided when transaction is a SEND
     */
    idem: z.string().nullish(),
    /**
     * New for List/Show Tx on 7 Feb
     * Only provided if transaction type is a buy
     */
    buy: TransactionBuyOrSellSchema.nullish(),
    /**
     * New for List/Show Tx on 7 Feb
     * Only provided if transaction type is a sell
     */
    sell: TransactionBuyOrSellSchema.nullish(),
    /**
     * New for List/Show Tx on 7 Feb
     * Only provided if transaction type is a trade
     */
    trade: z
      .object({
        id: z.string(),
        payment_method_name: z.string().nullish(),
      })
      .nullish(),
  })
  .strict()
export type Transaction = z.infer<typeof TransactionSchema>

export const ShowTransactionResponseSchema = z.object({
  data: TransactionSchema,
})
export type ShowTransactionResponse = z.infer<typeof ShowTransactionResponseSchema>

export const PaginationSchema = z.object({
  ending_before: z.string().nullish(),
  starting_after: z.string().nullish(),
  limit: z.number().nullish(),
  order: z.enum(['asc', 'desc']).nullish(),
  previous_uri: z.string().nullish(),
  next_uri: z.string().nullish(),
})

/** https://docs.cdp.coinbase.com/coinbase-app/docs/pagination */
export interface PaginationArgs {
  /** Number of results per call. Accepted values: 0 - 100 */
  limit?: number
  /** Result order. Accepted values: asc, desc */
  order?: 'asc' | 'desc'
  /** Pagination cursor. Resource ID that defines your place in the list. */
  startingAfter?: string
  /** Pagination cursor. Resource ID that defines your place in the list. */
  endingBefore?: string
}

export interface ListTransactionsArgs extends PaginationArgs {
  accountId: string
}

export const ListTransactionsResponseSchema = z
  .object({
    pagination: PaginationSchema,
    data: z.array(TransactionSchema),
  })
  .strict()
export type ListTransactionsResponse = z.infer<typeof ListTransactionsResponseSchema>

export const ErrorSchema = z.object({
  errors: z
    .array(
      z.object({
        id: z.string().nullish(),
        message: z.string().nullish(),
        url: z.string().nullish(),
      }),
    )
    .nullish(),
})
export type AppError = z.infer<typeof ErrorSchema>
