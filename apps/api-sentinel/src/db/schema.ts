import { sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core'

const now = sql`(datetime('now'))`

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(),
  network: text('network').notNull().default('mainnet'),
  descriptor: text('descriptor').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull().default(now),
  status: text('status', { enum: ['pending', 'verified', 'expired'] })
    .notNull()
    .default('pending'),
  deletedAt: text('deleted_at'),
})

export const discoveryCache = sqliteTable('discovery_cache', {
  accountId: text('account_id')
    .primaryKey()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  lastUsedReceiveIndex: integer('last_used_receive_index').notNull().default(0),
  lastUsedChangeIndex: integer('last_used_change_index').notNull().default(0),
  updatedAt: text('updated_at').notNull().default(now),
})

export const balanceSnapshots = sqliteTable(
  'balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    timestamp: text('timestamp').notNull(),
    balanceSats: text('balance_sats').notNull(),
  },
  (table) => [unique('balance_snapshots_account_id_timestamp_unique').on(table.accountId, table.timestamp)],
)

export const exchangeAccounts = sqliteTable(
  'exchange_accounts',
  {
    id: text('id').primaryKey(),
    provider: text('provider', { enum: ['coinbase', 'strike', 'robinhood', 'kraken'] }).notNull(),
    displayName: text('display_name').notNull(),
    encryptedCredentials: text('encrypted_credentials').notNull(),
    balanceSats: text('balance_sats'),
    balanceAsOf: text('balance_as_of'),
    createdAt: text('created_at').notNull().default(now),
    externalAccountId: text('external_account_id'),
    credentialsConnectedAt: text('credentials_connected_at'),
  },
  (table) => [
    check('exchange_accounts_provider_check', sql`${table.provider} IN ('coinbase', 'strike', 'robinhood', 'kraken')`),
  ],
)

export const exchangeBalanceSnapshots = sqliteTable(
  'exchange_balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => exchangeAccounts.id, { onDelete: 'cascade' }),
    timestamp: text('timestamp').notNull(),
    balanceSats: text('balance_sats').notNull(),
  },
  (table) => [unique('exchange_balance_snapshots_account_id_timestamp_unique').on(table.accountId, table.timestamp)],
)

export const statements = sqliteTable(
  'statements',
  {
    id: text('id').primaryKey(),
    status: text('status', { enum: ['pending', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    timezone: text('timezone').notNull().default('UTC'),
    openingDate: text('opening_date').notNull(),
    closingDate: text('closing_date').notNull(),
    accountIds: text('account_ids').notNull(),
    userName: text('user_name'),
    userAddress: text('user_address'),
    transactionMap: text('transaction_map'),
    dailyRates: text('daily_rates'),
    counter: integer('counter').notNull().default(1),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
    exchangeAccountIds: text('exchange_account_ids'),
    quoteCurrency: text('quote_currency', { enum: ['USD', 'CAD', 'GBP', 'EUR'] })
      .notNull()
      .default('USD'),
    errorMessage: text('error_message'),
  },
  (table) => [
    check('statements_status_check', sql`${table.status} IN ('pending', 'completed', 'failed')`),
    check('statements_quote_currency_check', sql`${table.quoteCurrency} IN ('USD', 'CAD', 'GBP', 'EUR')`),
  ],
)

/** Highest statement number ever assigned, so deleting a statement never frees its number. */
export const statementCounter = sqliteTable(
  'statement_counter',
  {
    id: integer('id').primaryKey(),
    lastCounter: integer('last_counter').notNull(),
  },
  (table) => [check('statement_counter_single_row_check', sql`${table.id} = 1`)],
)

export const btcQuoteCache = sqliteTable(
  'btc_quote_cache',
  {
    providerUrl: text('provider_url').notNull(),
    quoteCurrency: text('quote_currency', { enum: ['USD', 'CAD', 'GBP', 'EUR'] }).notNull(),
    timestamp: integer('timestamp').notNull(),
    price: text('price').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.quoteCurrency, table.timestamp] }),
    check('btc_quote_cache_quote_currency_check', sql`${table.quoteCurrency} IN ('USD', 'CAD', 'GBP', 'EUR')`),
  ],
)

export const btcQuoteLookups = sqliteTable(
  'btc_quote_lookups',
  {
    provider: text('provider').notNull(),
    requestedAt: integer('requested_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.requestedAt] }),
    index('btc_quote_lookup_date').on(table.requestedAt, table.expiresAt),
  ],
)

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
})

export const desktopConnectionProfiles = sqliteTable(
  'desktop_connection_profiles',
  {
    id: text('id').primaryKey(),
    nickname: text('nickname').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    protocol: text('protocol', { enum: ['tcp', 'ssl'] }).notNull(),
    torEnabled: integer('tor_enabled').notNull(),
    revision: integer('revision').notNull().default(1),
  },
  (table) => [
    check('desktop_connection_profiles_port_check', sql`${table.port} BETWEEN 1 AND 65535`),
    check('desktop_connection_profiles_protocol_check', sql`${table.protocol} IN ('tcp', 'ssl')`),
    check('desktop_connection_profiles_tor_enabled_check', sql`${table.torEnabled} IN (0, 1)`),
  ],
)

export const keystores = sqliteTable('keystores', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  wallet: text('wallet'),
  model: text('model'),
  derivationPath: text('derivation_path'),
  xpub: text('xpub').notNull(),
  createdAt: text('created_at').notNull().default(now),
})

export const challenges = sqliteTable('challenges', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  isSatisfied: integer('is_satisfied').notNull().default(0),
  completedAt: text('completed_at'),
  createdAt: text('created_at').notNull().default(now),
})

export const signedMessages = sqliteTable('signed_messages', {
  id: text('id').primaryKey(),
  challengeId: text('challenge_id')
    .notNull()
    .references(() => challenges.id, { onDelete: 'cascade' }),
  keystoreId: text('keystore_id')
    .notNull()
    .references(() => keystores.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  messageText: text('message_text').notNull(),
  signature: text('signature'),
  signedAt: text('signed_at'),
  createdAt: text('created_at').notNull().default(now),
})

export const manualAccounts = sqliteTable('manual_accounts', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  balanceSats: text('balance_sats').notNull().default('0'),
  balanceAsOf: text('balance_as_of'),
  createdAt: text('created_at').notNull().default(now),
})

export const manualTransactions = sqliteTable(
  'manual_transactions',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => manualAccounts.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['buy', 'sell', 'transfer_in', 'transfer_out'] }).notNull(),
    amountSats: text('amount_sats').notNull(),
    transactedAt: text('transacted_at').notNull(),
    note: text('note'),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [
    check('manual_transactions_type_check', sql`${table.type} IN ('buy', 'sell', 'transfer_in', 'transfer_out')`),
  ],
)

export const manualBalanceSnapshots = sqliteTable(
  'manual_balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => manualAccounts.id, { onDelete: 'cascade' }),
    timestamp: text('timestamp').notNull(),
    balanceSats: text('balance_sats').notNull(),
  },
  (table) => [unique('manual_balance_snapshots_account_id_timestamp_unique').on(table.accountId, table.timestamp)],
)

export const exchangeStatementTxs = sqliteTable(
  'exchange_statement_txs',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id')
      .notNull()
      .references(() => exchangeAccounts.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    transactedAt: text('transacted_at').notNull(),
    type: text('type').notNull(),
    amountBtc: text('amount_btc').notNull(),
    amountUsd: text('amount_usd'),
    feeUsd: text('fee_usd'),
    feeBtc: text('fee_btc'),
    exchangeRate: text('exchange_rate'),
    description: text('description'),
    txHash: text('tx_hash'),
    statementMonth: text('statement_month').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (table) => [unique('exchange_statement_txs_account_id_external_id_unique').on(table.accountId, table.externalId)],
)

export const etfAccounts = sqliteTable('etf_accounts', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull().default(now),
})

export const etfHoldings = sqliteTable('etf_holdings', {
  id: text('id').primaryKey(),
  accountId: text('account_id')
    .notNull()
    .references(() => etfAccounts.id, { onDelete: 'cascade' }),
  ticker: text('ticker').notNull(),
  shares: text('shares').notNull(),
  datePurchased: text('date_purchased'),
  createdAt: text('created_at').notNull().default(now),
})

export const etfBalanceSnapshots = sqliteTable(
  'etf_balance_snapshots',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => etfAccounts.id, { onDelete: 'cascade' }),
    timestamp: text('timestamp').notNull(),
    balanceSats: text('balance_sats').notNull(),
  },
  (table) => [unique('etf_balance_snapshots_account_id_timestamp_unique').on(table.accountId, table.timestamp)],
)

export const accountHistorySyncs = sqliteTable(
  'account_history_syncs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    fromBlockHeight: integer('from_block_height').notNull(),
    toBlockHeight: integer('to_block_height').notNull(),
    rangeStart: text('range_start').notNull(),
    rangeEnd: text('range_end').notNull(),
    syncedAt: text('synced_at').notNull().default(now),
    syncVersion: integer('sync_version').notNull().default(1),
  },
  (table) => [
    unique('account_history_syncs_account_id_from_block_height_to_block_height_unique').on(
      table.accountId,
      table.fromBlockHeight,
      table.toBlockHeight,
    ),
    index('idx_account_history_syncs_account_blocks').on(table.accountId, table.fromBlockHeight, table.toBlockHeight),
  ],
)
