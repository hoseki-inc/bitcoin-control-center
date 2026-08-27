import { Coinbase } from '@hoseki/packages/clients/coinbase'
import { Kraken } from '@hoseki/packages/clients/kraken'
import { RobinhoodClient } from '@hoseki/packages/clients/robinhood'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import type Database from 'better-sqlite3'
import Decimal from 'decimal.js'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import { Encrypted } from '../../lib/encrypted'
import { getStrikeBtcBalance, validateStrikeApiKey } from './strike'

export type SupportedExchange = 'coinbase' | 'strike' | 'robinhood' | 'kraken'
export type ExchangeConnectionStatus = 'connected' | 'needs_reconnect'

const mandatoryReconnectIntervalMs = 365 * 24 * 60 * 60 * 1000

export interface ExchangeAccountDto {
  id: string
  exchange: SupportedExchange
  displayName: string
  balanceSats: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: ExchangeConnectionStatus
}

interface CredentialData {
  type: 'apiKey'
  data: Record<string, { blob: string }>
}

export class ExchangeService {
  private readonly db: Database.Database
  private readonly logger: Logger

  public constructor(deps: { db: Database.Database; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'exchange-service' })
  }

  // ─── List ──────────────────────────────────────────────────────────────

  public listAccounts(exchange?: SupportedExchange): ExchangeAccountDto[] {
    const query = exchange
      ? 'SELECT * FROM exchange_accounts WHERE provider = ? ORDER BY created_at DESC'
      : 'SELECT * FROM exchange_accounts ORDER BY created_at DESC'

    const rows = (exchange ? this.db.prepare(query).all(exchange) : this.db.prepare(query).all()) as Array<{
      id: string
      provider: string
      display_name: string
      encrypted_credentials: string
      balance_sats: string | null
      balance_as_of: string | null
      created_at: string
      credentials_connected_at: string | null
    }>

    return rows.map((row) => {
      const connectionStatus = this.getAccountConnectionStatus(row)
      const isConnected = connectionStatus === 'connected'
      return {
        id: row.id,
        exchange: row.provider as SupportedExchange,
        displayName: row.display_name,
        balanceSats: isConnected ? row.balance_sats : null,
        balanceAsOf: isConnected ? row.balance_as_of : null,
        createdAt: row.created_at,
        connectionStatus,
      }
    })
  }

  // ─── Connect Coinbase ──────────────────────────────────────────────────

  public connectCoinbase = asyncFn(
    async (args: {
      apiKey: string
      secretKey: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, secretKey } = args
      this.logger.info('Connecting Coinbase account via API key')

      // Detect auth variant
      const isPem = secretKey.trim().startsWith('-----BEGIN') && secretKey.includes('-----END')
      const credentials = isPem
        ? { variant: 'CdpKey' as const, name: apiKey, secret: secretKey }
        : { variant: 'ApiKey' as const, key: apiKey, secret: secretKey }

      // Validate by fetching accounts
      let client: ReturnType<typeof Coinbase.Client>
      try {
        client = Coinbase.Client({ credentials })
      } catch (err) {
        return Err(new Error(`Failed to create Coinbase client: ${err instanceof Error ? err.message : String(err)}`))
      }

      const accountsResult = await client.advancedTrade.accounts.list()
      if (accountsResult.isErr()) {
        return Err(new Error(`Failed to list Coinbase accounts: ${accountsResult.unwrapErr().message}`))
      }
      const accounts = accountsResult.unwrap()
      const btcAccount = accounts.data.accounts?.find((a) => a.currency === 'BTC')
      if (!btcAccount) {
        return Err(new Error('No BTC account found in Coinbase'))
      }

      // Fetch balance
      const balanceResult = await client.advancedTrade.accounts.get({ accountUuid: btcAccount.uuid })
      if (balanceResult.isErr()) {
        return Err(new Error(`Failed to fetch Coinbase balance: ${balanceResult.unwrapErr().message}`))
      }
      const balanceData = balanceResult.unwrap()
      const btcValue = balanceData.data.account?.available_balance?.value ?? '0'
      const balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      // Encrypt credentials
      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) return Err(encApiKey.unwrapErr())
      const encSecret = Encrypted.encrypt(secretKey)
      if (encSecret.isErr()) return Err(encSecret.unwrapErr())

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          secretKey: { blob: encSecret.unwrap().blob },
        },
      }

      const displayName = btcAccount.name || 'Coinbase BTC'
      const now = new Date().toISOString()
      const saved = this.saveConnectedAccount({
        provider: 'coinbase',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
        externalAccountId: btcAccount.uuid,
      })
      if (saved.isErr()) return Err(saved.unwrapErr())
      const { id, createdAt } = saved.unwrap()

      // Record initial snapshot
      this.recordSnapshot(id, balanceSats, now)

      this.logger.info({ id, displayName, balanceSats }, 'Coinbase account connected')
      return Ok({
        id,
        exchange: 'coinbase',
        displayName,
        balanceSats,
        balanceAsOf: now,
        createdAt,
        connectionStatus: 'connected',
      })
    },
  )

  // ─── Connect Strike ────────────────────────────────────────────────────

  public connectStrike = asyncFn(
    async (args: {
      apiKey: string
      displayName?: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, displayName: inputName } = args
      this.logger.info('Connecting Strike account via API key')

      // Validate key and get balance
      const balancesRes = await validateStrikeApiKey(apiKey, this.logger)
      if (balancesRes.isErr()) return Err(balancesRes.unwrapErr())

      const btcBalance = balancesRes.unwrap().find((b) => b.currency === 'BTC')
      const balanceSats = btcBalance ? new Decimal(btcBalance.total).mul(1e8).toFixed(0) : '0'

      // Encrypt API key
      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) return Err(encApiKey.unwrapErr())

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: { apiKey: { blob: encApiKey.unwrap().blob } },
      }

      const displayName = inputName ?? 'Strike'
      const now = new Date().toISOString()
      const saved = this.saveConnectedAccount({
        provider: 'strike',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
      })
      if (saved.isErr()) return Err(saved.unwrapErr())
      const { id, createdAt } = saved.unwrap()

      this.recordSnapshot(id, balanceSats, now)

      this.logger.info({ id, displayName, balanceSats }, 'Strike account connected')
      return Ok({
        id,
        exchange: 'strike',
        displayName,
        balanceSats,
        balanceAsOf: now,
        createdAt,
        connectionStatus: 'connected',
      })
    },
  )

  // ─── Connect Robinhood ─────────────────────────────────────────────────

  public connectRobinhood = asyncFn(
    async (args: {
      apiKey: string
      privateKeyBase64: string
      displayName?: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, privateKeyBase64, displayName: inputName } = args
      this.logger.info('Connecting Robinhood account via API key')

      const client = new RobinhoodClient({ apiKey, privateKeyBase64 })

      // Validate key and get balance
      const balanceResult = await client.getBtcBalance()
      if (balanceResult.isErr()) return Err(balanceResult.unwrapErr())
      const balanceSats = balanceResult.unwrap().toString()

      // Encrypt credentials
      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) return Err(encApiKey.unwrapErr())
      const encPrivateKey = Encrypted.encrypt(privateKeyBase64)
      if (encPrivateKey.isErr()) return Err(encPrivateKey.unwrapErr())

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          privateKey: { blob: encPrivateKey.unwrap().blob },
        },
      }

      const displayName = inputName ?? 'Robinhood'
      const now = new Date().toISOString()
      const saved = this.saveConnectedAccount({
        provider: 'robinhood',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
      })
      if (saved.isErr()) return Err(saved.unwrapErr())
      const { id, createdAt } = saved.unwrap()

      this.recordSnapshot(id, balanceSats, now)

      this.logger.info({ id, displayName, balanceSats }, 'Robinhood account connected')
      return Ok({
        id,
        exchange: 'robinhood',
        displayName,
        balanceSats,
        balanceAsOf: now,
        createdAt,
        connectionStatus: 'connected',
      })
    },
  )

  // ─── Connect Kraken ──────────────────────────────────────────────────

  public connectKraken = asyncFn(
    async (args: {
      apiKey: string
      secretKey: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, secretKey } = args
      this.logger.info('Connecting Kraken account via API key')

      const client = new Kraken.Client({ apiKey, secretKey })

      // Validate by fetching balance
      const balanceResult = await client.getBalance()
      if (balanceResult.isErr()) {
        return Err(new Error(`Failed to fetch Kraken balance: ${balanceResult.unwrapErr().message}`))
      }

      const balances = balanceResult.unwrap().data
      // Kraken uses XXBT or XBT for Bitcoin
      const btcValue = balances['XXBT'] ?? balances['XBT'] ?? '0'
      const balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      // Encrypt credentials
      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) return Err(encApiKey.unwrapErr())
      const encSecret = Encrypted.encrypt(secretKey)
      if (encSecret.isErr()) return Err(encSecret.unwrapErr())

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          secretKey: { blob: encSecret.unwrap().blob },
        },
      }

      const displayName = 'Kraken'
      const now = new Date().toISOString()
      const saved = this.saveConnectedAccount({
        provider: 'kraken',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
      })
      if (saved.isErr()) return Err(saved.unwrapErr())
      const { id, createdAt } = saved.unwrap()

      this.recordSnapshot(id, balanceSats, now)

      this.logger.info({ id, displayName, balanceSats }, 'Kraken account connected')
      return Ok({
        id,
        exchange: 'kraken',
        displayName,
        balanceSats,
        balanceAsOf: now,
        createdAt,
        connectionStatus: 'connected',
      })
    },
  )

  // ─── Refresh Balance ───────────────────────────────────────────────────

  public refreshBalance = asyncFn(async (accountId: string): Promise<Result<ExchangeAccountDto, Error>> => {
    const row = this.db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(accountId) as
      | {
          id: string
          provider: string
          display_name: string
          encrypted_credentials: string
          external_account_id: string | null
          created_at: string
          credentials_connected_at: string | null
        }
      | undefined

    if (!row) return Err(new Error('Exchange account not found'))
    if (this.getAccountConnectionStatus(row) === 'needs_reconnect') {
      return Err(new Error('Exchange credentials are unavailable or expired. Reconnect this exchange account.'))
    }

    const credData = JSON.parse(row.encrypted_credentials) as CredentialData
    const provider = row.provider as SupportedExchange

    let balanceSats: string

    if (provider === 'strike') {
      const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
      if (apiKeyEnc.isErr()) return Err(apiKeyEnc.unwrapErr())
      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) return Err(apiKey.unwrapErr())

      const result = await getStrikeBtcBalance(apiKey.unwrap(), this.logger)
      if (result.isErr()) return Err(result.unwrapErr())
      balanceSats = result.unwrap().toString()
    } else if (provider === 'robinhood') {
      const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
      if (apiKeyEnc.isErr()) return Err(apiKeyEnc.unwrapErr())
      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) return Err(apiKey.unwrapErr())

      const privateKeyEnc = Encrypted.fromString(credData.data['privateKey']?.blob ?? '')
      if (privateKeyEnc.isErr()) return Err(privateKeyEnc.unwrapErr())
      const privateKey = privateKeyEnc.unwrap().decrypt()
      if (privateKey.isErr()) return Err(privateKey.unwrapErr())

      const client = new RobinhoodClient({ apiKey: apiKey.unwrap(), privateKeyBase64: privateKey.unwrap() })
      const result = await client.getBtcBalance()
      if (result.isErr()) return Err(result.unwrapErr())
      balanceSats = result.unwrap().toString()
    } else if (provider === 'kraken') {
      const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
      if (apiKeyEnc.isErr()) return Err(apiKeyEnc.unwrapErr())
      const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
      if (secretEnc.isErr()) return Err(secretEnc.unwrapErr())

      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) return Err(apiKey.unwrapErr())
      const secret = secretEnc.unwrap().decrypt()
      if (secret.isErr()) return Err(secret.unwrapErr())

      const client = new Kraken.Client({ apiKey: apiKey.unwrap(), secretKey: secret.unwrap() })
      const result = await client.getBalance()
      if (result.isErr()) return Err(new Error(`Kraken error: ${result.unwrapErr().message}`))

      const balances = result.unwrap().data
      const btcValue = balances['XXBT'] ?? balances['XBT'] ?? '0'
      balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)
    } else {
      // Coinbase
      const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
      if (apiKeyEnc.isErr()) return Err(apiKeyEnc.unwrapErr())
      const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
      if (secretEnc.isErr()) return Err(secretEnc.unwrapErr())

      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) return Err(apiKey.unwrapErr())
      const secret = secretEnc.unwrap().decrypt()
      if (secret.isErr()) return Err(secret.unwrapErr())

      const secretStr = secret.unwrap()
      const isPem = secretStr.trim().startsWith('-----BEGIN')
      const credentials = isPem
        ? { variant: 'CdpKey' as const, name: apiKey.unwrap(), secret: secretStr }
        : { variant: 'ApiKey' as const, key: apiKey.unwrap(), secret: secretStr }

      const client = Coinbase.Client({ credentials })

      // Use stored account UUID if available, otherwise discover it
      let accountUuid = row.external_account_id
      if (!accountUuid) {
        const accountsRes = await client.advancedTrade.accounts.list()
        if (accountsRes.isErr()) return Err(new Error(`Coinbase error: ${accountsRes.unwrapErr().message}`))
        const btcAccount = accountsRes.unwrap().data.accounts?.find((a) => a.currency === 'BTC')
        if (!btcAccount) return Err(new Error('No BTC account found'))
        accountUuid = btcAccount.uuid
        // Backfill the stored UUID for future calls
        this.db.prepare('UPDATE exchange_accounts SET external_account_id = ? WHERE id = ?').run(accountUuid, accountId)
      }

      const balanceRes = await client.advancedTrade.accounts.get({ accountUuid })
      if (balanceRes.isErr()) return Err(new Error(`Coinbase error: ${balanceRes.unwrapErr().message}`))

      const btcValue = balanceRes.unwrap().data.account?.available_balance?.value ?? '0'
      balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)
    }

    const now = new Date().toISOString()
    this.db
      .prepare('UPDATE exchange_accounts SET balance_sats = ?, balance_as_of = ? WHERE id = ?')
      .run(balanceSats, now, accountId)

    this.recordSnapshot(accountId, balanceSats, now)

    this.logger.info({ accountId, balanceSats }, 'Exchange balance refreshed')
    return Ok({
      id: row.id,
      exchange: provider,
      displayName: row.display_name,
      balanceSats,
      balanceAsOf: now,
      createdAt: row.created_at,
      connectionStatus: 'connected',
    })
  })

  // ─── Refresh All Balances ─────────────────────────────────────────────

  public refreshAllBalances = asyncFn(async (): Promise<Result<void, Error>> => {
    const accounts = this.listAccounts().filter((account) => account.connectionStatus === 'connected')
    const errors: string[] = []

    for (const account of accounts) {
      const result = await this.refreshBalance(account.id)
      if (result.isErr()) {
        this.logger.warn({ accountId: account.id, error: result.unwrapErr().message }, 'Failed to refresh balance')
        errors.push(`${account.displayName}: ${result.unwrapErr().message}`)
      }
    }

    if (errors.length > 0 && errors.length === accounts.length) {
      return Err(new Error(`All refreshes failed: ${errors.join('; ')}`))
    }

    return Ok(undefined)
  })

  // ─── Remove ────────────────────────────────────────────────────────────

  public removeAccount(accountId: string): Result<void, Error> {
    const result = this.db.prepare('DELETE FROM exchange_accounts WHERE id = ?').run(accountId)
    if (result.changes === 0) {
      return Err(new Error('Exchange account not found'))
    }
    this.logger.info({ accountId }, 'Exchange account removed')
    return Ok(undefined)
  }

  // ─── Coinbase Transaction History ──────────────────────────────────────

  /**
   * Fetch all completed BTC transaction entries for all connected Coinbase accounts.
   * Returns entries as { timestamp, value } where value is signed satoshis.
   * Strike does not have a transactions API — only Coinbase accounts are included.
   */
  public getCoinbaseTransactionEntries = asyncFn(
    async (filterAccountIds?: string[]): Promise<Result<{ timestamp: Date; value: bigint }[], Error>> => {
      let query = 'SELECT id, encrypted_credentials, external_account_id FROM exchange_accounts WHERE provider = ?'
      const params: string[] = ['coinbase']

      if (filterAccountIds && filterAccountIds.length > 0) {
        const placeholders = filterAccountIds.map(() => '?').join(', ')
        query += ` AND id IN (${placeholders})`
        params.push(...filterAccountIds)
      }

      const rows = this.db.prepare(query).all(...params) as Array<{
        id: string
        encrypted_credentials: string
        external_account_id: string | null
      }>

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getCoinbaseTransactionEntries: queried exchange_accounts',
      )

      const allEntries: { timestamp: Date; value: bigint }[] = []

      for (const row of rows) {
        const credData = JSON.parse(row.encrypted_credentials) as CredentialData

        // Decrypt credentials — skip account on failure
        const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
        if (apiKeyEnc.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to parse apiKey blob — skipping')
          continue
        }
        const apiKey = apiKeyEnc.unwrap().decrypt()
        if (apiKey.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to decrypt apiKey — skipping')
          continue
        }

        const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
        if (secretEnc.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to parse secretKey blob — skipping')
          continue
        }
        const secret = secretEnc.unwrap().decrypt()
        if (secret.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to decrypt secretKey — skipping')
          continue
        }

        const secretStr = secret.unwrap()
        const isPem = secretStr.trim().startsWith('-----BEGIN')
        const credentials = isPem
          ? { variant: 'CdpKey' as const, name: apiKey.unwrap(), secret: secretStr }
          : { variant: 'ApiKey' as const, key: apiKey.unwrap(), secret: secretStr }

        let client: ReturnType<typeof Coinbase.Client>
        try {
          client = Coinbase.Client({ credentials })
        } catch (err) {
          this.logger.warn(
            { accountId: row.id, err: err instanceof Error ? err.message : String(err) },
            'getCoinbaseTransactionEntries: failed to create Coinbase client — skipping',
          )
          continue
        }

        // Discover and backfill external_account_id if missing (pre-migration accounts)
        let accountUuid = row.external_account_id
        if (!accountUuid) {
          this.logger.info({ accountId: row.id }, 'Discovering Coinbase BTC account UUID')
          const accountsRes = await client.advancedTrade.accounts.list()
          if (accountsRes.isErr()) {
            this.logger.warn(
              { accountId: row.id, err: accountsRes.unwrapErr() },
              'Failed to list Coinbase accounts — skipping',
            )
            continue
          }
          const btcAccount = accountsRes.unwrap().data.accounts?.find((a) => a.currency === 'BTC')
          if (!btcAccount) {
            this.logger.warn({ accountId: row.id }, 'No BTC account found in Coinbase — skipping')
            continue
          }
          accountUuid = btcAccount.uuid
          this.db.prepare('UPDATE exchange_accounts SET external_account_id = ? WHERE id = ?').run(accountUuid, row.id)
          this.logger.info({ accountId: row.id, accountUuid }, 'Backfilled external_account_id')
        }

        this.logger.info(
          { accountId: row.id, accountUuid },
          'getCoinbaseTransactionEntries: fetching transactions from Coinbase API',
        )

        // Paginate through all transactions in ascending order
        let startingAfter: string | undefined = undefined
        let hasMore = true

        while (hasMore) {
          const txResult = await client.app.transactions.listTransactions({
            accountId: accountUuid,
            limit: 100,
            order: 'asc',
            startingAfter,
          })

          if (txResult.isErr()) {
            this.logger.warn(
              { accountId: row.id, err: txResult.unwrapErr() },
              'Failed to fetch Coinbase transactions — stopping pagination',
            )
            break
          }

          const { pagination, data: transactions } = txResult.unwrap().data

          this.logger.info(
            {
              accountId: row.id,
              transactionCount: transactions.length,
              hasNextUri: !!pagination.next_uri,
              startingAfter,
            },
            'getCoinbaseTransactionEntries: page fetched',
          )

          for (const tx of transactions) {
            // Include all completed BTC transactions regardless of type.
            // The amount.amount field is already signed: positive for inflows, negative for outflows.
            if (tx.status !== 'completed' || tx.amount.currency !== 'BTC') continue

            const amountSats = new Decimal(tx.amount.amount).mul(1e8).toFixed(0)
            allEntries.push({
              timestamp: tx.created_at,
              value: BigInt(amountSats),
            })
          }

          if (pagination.next_uri && transactions.length > 0) {
            startingAfter = transactions[transactions.length - 1]?.id
          } else {
            hasMore = false
          }
        }
      }

      this.logger.info({ totalEntries: allEntries.length }, 'getCoinbaseTransactionEntries: complete')

      return Ok(allEntries)
    },
  )

  // ─── Kraken Transaction History ───────────────────────────────────────

  /**
   * Fetch all BTC ledger entries for all connected Kraken accounts.
   * Returns entries as { timestamp, value } where value is signed satoshis.
   */
  public getKrakenTransactionEntries = asyncFn(
    async (filterAccountIds?: string[]): Promise<Result<{ timestamp: Date; value: bigint }[], Error>> => {
      let query = 'SELECT id, encrypted_credentials FROM exchange_accounts WHERE provider = ?'
      const params: string[] = ['kraken']

      if (filterAccountIds && filterAccountIds.length > 0) {
        const placeholders = filterAccountIds.map(() => '?').join(', ')
        query += ` AND id IN (${placeholders})`
        params.push(...filterAccountIds)
      }

      const rows = this.db.prepare(query).all(...params) as Array<{
        id: string
        encrypted_credentials: string
      }>

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getKrakenTransactionEntries: queried exchange_accounts',
      )

      const allEntries: { timestamp: Date; value: bigint }[] = []

      for (const row of rows) {
        const credData = JSON.parse(row.encrypted_credentials) as CredentialData

        // Decrypt credentials — skip account on failure
        const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
        if (apiKeyEnc.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to parse apiKey blob — skipping')
          continue
        }
        const apiKey = apiKeyEnc.unwrap().decrypt()
        if (apiKey.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to decrypt apiKey — skipping')
          continue
        }

        const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
        if (secretEnc.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to parse secretKey blob — skipping')
          continue
        }
        const secret = secretEnc.unwrap().decrypt()
        if (secret.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Failed to decrypt secretKey — skipping')
          continue
        }

        const client = new Kraken.Client({ apiKey: apiKey.unwrap(), secretKey: secret.unwrap() })

        // Paginate through all BTC ledger entries using offset
        let offset = 0
        let hasMore = true

        while (hasMore) {
          const ledgersResult = await client.getLedgers({ asset: 'XBT', ofs: offset })

          if (ledgersResult.isErr()) {
            this.logger.warn(
              { accountId: row.id, err: ledgersResult.unwrapErr() },
              'Failed to fetch Kraken ledgers — stopping pagination',
            )
            break
          }

          const { data } = ledgersResult.unwrap()
          const ledgerEntries = data.ledger ? Object.values(data.ledger) : []

          this.logger.info(
            { accountId: row.id, entryCount: ledgerEntries.length, offset },
            'getKrakenTransactionEntries: page fetched',
          )

          for (const entry of ledgerEntries) {
            const amountSats = new Decimal(entry.amount)
              .sub(entry.fee ?? 0)
              .mul(1e8)
              .toFixed(0)
            if (amountSats !== '0') {
              allEntries.push({
                timestamp: new Date(entry.time * 1000),
                value: BigInt(amountSats),
              })
            }
          }

          const totalCount = data.count ?? 0
          offset += ledgerEntries.length
          if (ledgerEntries.length === 0 || offset >= totalCount) {
            hasMore = false
          }
        }
      }

      this.logger.info({ totalEntries: allEntries.length }, 'getKrakenTransactionEntries: complete')

      return Ok(allEntries)
    },
  )

  // ─── Statement Transactions ──────────────────────────────────────────

  public importStatementTransactions(args: {
    accountId: string
    transactions: Array<{
      externalId: string
      transactedAt: string
      type: string
      amountBtc: string
      amountUsd?: string
      feeUsd?: string
      feeBtc?: string
      exchangeRate?: string
      description?: string
      txHash?: string
      statementMonth: string
    }>
  }): Result<{ imported: number; skipped: number }, Error> {
    const account = this.getAccount(args.accountId)
    if (!account) return Err(new Error('Exchange account not found'))

    const stmt = this.db.prepare(
      `INSERT INTO exchange_statement_txs (id, account_id, external_id, transacted_at, type, amount_btc, amount_usd, fee_usd, fee_btc, exchange_rate, description, tx_hash, statement_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, external_id) DO NOTHING`,
    )

    let imported = 0
    let skipped = 0

    const runAll = this.db.transaction(() => {
      for (const tx of args.transactions) {
        const result = stmt.run(
          nanoid(),
          args.accountId,
          tx.externalId,
          tx.transactedAt,
          tx.type,
          tx.amountBtc,
          tx.amountUsd ?? null,
          tx.feeUsd ?? null,
          tx.feeBtc ?? null,
          tx.exchangeRate ?? null,
          tx.description ?? null,
          tx.txHash ?? null,
          tx.statementMonth,
        )
        if (result.changes > 0) imported++
        else skipped++
      }
    })
    runAll()

    this.logger.info(
      { accountId: args.accountId, imported, skipped, total: args.transactions.length },
      'Imported strike statement transactions',
    )

    return Ok({ imported, skipped })
  }

  public listStatementTransactions(
    accountId: string,
    statementMonth?: string,
  ): Array<{
    id: string
    externalId: string
    transactedAt: string
    type: string
    amountBtc: string
    amountUsd: string | null
    feeUsd: string | null
    feeBtc: string | null
    exchangeRate: string | null
    description: string | null
    txHash: string | null
    statementMonth: string
  }> {
    const rows = (
      statementMonth
        ? this.db
            .prepare(
              'SELECT * FROM exchange_statement_txs WHERE account_id = ? AND statement_month = ? ORDER BY transacted_at ASC',
            )
            .all(accountId, statementMonth)
        : this.db
            .prepare('SELECT * FROM exchange_statement_txs WHERE account_id = ? ORDER BY transacted_at ASC')
            .all(accountId)
    ) as Array<{
      id: string
      external_id: string
      transacted_at: string
      type: string
      amount_btc: string
      amount_usd: string | null
      fee_usd: string | null
      fee_btc: string | null
      exchange_rate: string | null
      description: string | null
      tx_hash: string | null
      statement_month: string
    }>

    return rows.map((r) => ({
      id: r.id,
      externalId: r.external_id,
      transactedAt: r.transacted_at,
      type: r.type,
      amountBtc: r.amount_btc,
      amountUsd: r.amount_usd,
      feeUsd: r.fee_usd,
      feeBtc: r.fee_btc,
      exchangeRate: r.exchange_rate,
      description: r.description,
      txHash: r.tx_hash,
      statementMonth: r.statement_month,
    }))
  }

  public listStatementMonths(accountId: string): string[] {
    const rows = this.db
      .prepare(
        'SELECT DISTINCT statement_month FROM exchange_statement_txs WHERE account_id = ? ORDER BY statement_month DESC',
      )
      .all(accountId) as Array<{ statement_month: string }>
    return rows.map((r) => r.statement_month)
  }

  public deleteStatementMonth(accountId: string, statementMonth: string): number {
    const result = this.db
      .prepare('DELETE FROM exchange_statement_txs WHERE account_id = ? AND statement_month = ?')
      .run(accountId, statementMonth)
    return result.changes
  }

  private getAccount(id: string): ExchangeAccountDto | null {
    const row = this.db.prepare('SELECT * FROM exchange_accounts WHERE id = ?').get(id) as
      | {
          id: string
          provider: string
          display_name: string
          encrypted_credentials: string
          balance_sats: string | null
          balance_as_of: string | null
          created_at: string
          credentials_connected_at: string | null
        }
      | undefined
    if (!row) return null
    const connectionStatus = this.getAccountConnectionStatus(row)
    const isConnected = connectionStatus === 'connected'
    return {
      id: row.id,
      exchange: row.provider as SupportedExchange,
      displayName: row.display_name,
      balanceSats: isConnected ? row.balance_sats ?? null : null,
      balanceAsOf: isConnected ? row.balance_as_of ?? null : null,
      createdAt: row.created_at,
      connectionStatus,
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private saveConnectedAccount(args: {
    provider: SupportedExchange
    replaceAccountId?: string
    displayName: string
    credentialData: CredentialData
    balanceSats: string
    balanceAsOf: string
    credentialsConnectedAt: string
    externalAccountId?: string
  }): Result<{ id: string; createdAt: string }, Error> {
    if (args.replaceAccountId) {
      // Reconnect must preserve the internal account id. Balance snapshots,
      // imported statements, and generated statement references are keyed to
      // this id, so never delete/reinsert during a credential replacement.
      const existing = this.db
        .prepare('SELECT provider, created_at FROM exchange_accounts WHERE id = ?')
        .get(args.replaceAccountId) as { provider: string; created_at: string } | undefined

      if (!existing) return Err(new Error('Exchange account not found'))
      if (existing.provider !== args.provider) {
        return Err(new Error(`Cannot reconnect ${args.provider} credentials to a ${existing.provider} account`))
      }

      this.db
        .prepare(
          `UPDATE exchange_accounts
           SET display_name = ?,
               encrypted_credentials = ?,
               balance_sats = ?,
               balance_as_of = ?,
               credentials_connected_at = ?,
               external_account_id = ?
           WHERE id = ?`,
        )
        .run(
          args.displayName,
          JSON.stringify(args.credentialData),
          args.balanceSats,
          args.balanceAsOf,
          args.credentialsConnectedAt,
          args.externalAccountId ?? null,
          args.replaceAccountId,
        )

      return Ok({ id: args.replaceAccountId, createdAt: existing.created_at })
    }

    const id = nanoid()
    this.db
      .prepare(
        `INSERT INTO exchange_accounts (
           id,
           provider,
           display_name,
           encrypted_credentials,
           balance_sats,
           balance_as_of,
           credentials_connected_at,
           external_account_id
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        args.provider,
        args.displayName,
        JSON.stringify(args.credentialData),
        args.balanceSats,
        args.balanceAsOf,
        args.credentialsConnectedAt,
        args.externalAccountId ?? null,
      )

    return Ok({ id, createdAt: args.balanceAsOf })
  }

  private getAccountConnectionStatus(row: {
    encrypted_credentials: string
    created_at?: string | null
    credentials_connected_at?: string | null
  }): ExchangeConnectionStatus {
    if (this.areCredentialsExpired(row.credentials_connected_at ?? row.created_at ?? null)) {
      return 'needs_reconnect'
    }
    return this.getCredentialConnectionStatus(row.encrypted_credentials)
  }

  private areCredentialsExpired(connectedAt: string | null): boolean {
    if (!connectedAt) return true
    const connectedAtMs = Date.parse(this.normalizeTimestamp(connectedAt))
    if (!Number.isFinite(connectedAtMs)) return true
    return Date.now() - connectedAtMs >= mandatoryReconnectIntervalMs
  }

  private normalizeTimestamp(timestamp: string): string {
    if (timestamp.includes('T')) return timestamp
    return `${timestamp.replace(' ', 'T')}Z`
  }

  private getCredentialConnectionStatus(encryptedCredentials: string): ExchangeConnectionStatus {
    try {
      const credData = JSON.parse(encryptedCredentials) as CredentialData
      const credentialBlobs = Object.values(credData.data)
      if (credData.type !== 'apiKey' || credentialBlobs.length === 0) return 'needs_reconnect'

      for (const credential of credentialBlobs) {
        const encrypted = Encrypted.fromString(credential.blob)
        if (encrypted.isErr()) return 'needs_reconnect'
        const decrypted = encrypted.unwrap().decrypt()
        if (decrypted.isErr()) return 'needs_reconnect'
      }

      return 'connected'
    } catch {
      return 'needs_reconnect'
    }
  }

  private recordSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO exchange_balance_snapshots (account_id, timestamp, balance_sats)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, timestamp) DO UPDATE SET balance_sats = excluded.balance_sats`,
      )
      .run(accountId, timestamp, balanceSats)
  }
}
