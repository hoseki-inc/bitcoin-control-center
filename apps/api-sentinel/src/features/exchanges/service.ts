import { Coinbase } from '@hoseki/packages/clients/coinbase'
import type { Account as CoinbaseAdvancedTradeAccount } from '@hoseki/packages/clients/coinbase/lib/advanced-trade-types'
import { Kraken } from '@hoseki/packages/clients/kraken'
import { RobinhoodClient, type RobinhoodHolding } from '@hoseki/packages/clients/robinhood'
import { Err, Ok, Result, asyncFn, parseUnknown } from '@hoseki/packages/result'
import Decimal from 'decimal.js'
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
import { exchangeAccounts, exchangeBalanceSnapshots, exchangeStatementTxs } from '../../db/schema'
import { normalizeDbTimestamp } from '../../db/timestamp'
import { Encrypted } from '../../lib/encrypted'
import {
  EXCHANGE_DISPLAY_NAMES,
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  ExchangeCredentialsRevokedError,
  ExchangeUserError,
  ExchangeVerificationRetryableError,
  RobinhoodAccountUnverifiableError,
  type SupportedExchange,
  classifyProviderFailure,
  describeSafeProviderFailure,
} from './provider-errors'
import {
  type CredentialMetadataChange,
  type VerifiedReconnect,
  type VerifiedReconnectIdentity,
  createCredentialMetadataChange,
  createReconnectReplacement,
  normalizeKrakenAccountId,
  verifyReconnectIdentity,
} from './reconnect-identity'
import { getStrikeBtcBalance, validateStrikeApiKey } from './strike'

export {
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  ExchangeCredentialsRevokedError,
  ExchangeUserError,
  ExchangeVerificationRetryableError,
  RobinhoodAccountUnverifiableError,
  classifyProviderFailure,
  type ExchangeErrorCode,
  type ProviderFailureKind,
  type SupportedExchange,
} from './provider-errors'

export type ExchangeConnectionStatus = 'connected' | 'needs_reconnect'

const mandatoryReconnectIntervalMs = 365 * 24 * 60 * 60 * 1000
const MAX_COINBASE_ACCOUNT_PAGES = 50

export interface ExchangeAccountDto {
  id: string
  exchange: SupportedExchange
  displayName: string
  balanceSats: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: ExchangeConnectionStatus
}

const CredentialDataSchema = z.object({
  type: z.literal('apiKey'),
  data: z.record(z.string(), z.object({ blob: z.string() })),
  portfolioUuid: z.string().optional(),
  credentialsRevoked: z.boolean().optional(),
})
type CredentialData = z.infer<typeof CredentialDataSchema>

interface ReconnectTarget {
  id: string
  provider: SupportedExchange
  displayName: string
  createdAt: string
  externalAccountId: string | null
  encryptedCredentials: string
  credentialsConnectedAt: string | null
}

interface CredentialGenerationSnapshot {
  credentialsConnectedAt: string | null
  encryptedCredentials: string
}

type ExchangeTransaction = Parameters<Parameters<SentinelDb['transaction']>[0]>[0]

async function writeCredentials(tx: ExchangeTransaction, verified: VerifiedReconnect): Promise<number> {
  const existingExternalRaw = verified.kind === 'replacement' ? nonEmpty(verified.existingExternalAccountId) : undefined
  const replacement =
    verified.kind === 'replacement'
      ? {
          displayName: verified.payload.displayName,
          balanceSats: verified.payload.balanceSats,
          balanceAsOf: verified.payload.balanceAsOf,
          credentialsConnectedAt: verified.payload.credentialsConnectedAt,
          externalAccountId: verified.nextExternalAccountId,
        }
      : undefined
  const condition =
    verified.kind === 'replacement'
      ? verified.provider !== 'strike'
        ? existingExternalRaw !== undefined
          ? and(
              eq(exchangeAccounts.provider, verified.provider),
              eq(exchangeAccounts.externalAccountId, verified.existingExternalAccountId ?? existingExternalRaw),
            )
          : and(
              eq(exchangeAccounts.provider, verified.provider),
              or(isNull(exchangeAccounts.externalAccountId), eq(exchangeAccounts.externalAccountId, '')),
            )
        : eq(exchangeAccounts.provider, verified.provider)
      : eq(exchangeAccounts.encryptedCredentials, verified.previousCredentials)
  const encryptedCredentials =
    verified.kind === 'replacement'
      ? verified.payload.encryptedCredentials
      : 'portfolioUuid' in verified.change
        ? sql`json_set(${exchangeAccounts.encryptedCredentials}, '$.portfolioUuid', ${verified.change.portfolioUuid})`
        : sql`json_set(${exchangeAccounts.encryptedCredentials}, '$.credentialsRevoked', json('true'))`
  const result = await tx
    .update(exchangeAccounts)
    .set({ ...replacement, encryptedCredentials })
    .where(and(eq(exchangeAccounts.id, verified.accountId), condition))
  return result.rowsAffected
}

function parseCredentials(json: string): Result<CredentialData, Error> {
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- Stored JSON remains unknown until CredentialDataSchema validates it.
  return Result.fromThrowable((): unknown => JSON.parse(json))
    .andThen((value) => parseUnknown(CredentialDataSchema, value))
    .mapErr(() => new ExchangeUserError('Stored exchange credentials are invalid', 'INTERNAL_SERVER_ERROR'))
}

function sameCredentialDataBlobs(a: CredentialData, b: CredentialData): boolean {
  const keysA = Object.keys(a.data)
  const keysB = Object.keys(b.data)
  if (keysA.length !== keysB.length) {
    return false
  }
  return keysA.every((key) => a.data[key]?.blob === b.data[key]?.blob)
}

function isSameCredentialGeneration(a: CredentialGenerationSnapshot, b: CredentialGenerationSnapshot): boolean {
  if (a.credentialsConnectedAt !== b.credentialsConnectedAt) {
    return false
  }
  const parsedA = parseCredentials(a.encryptedCredentials)
  const parsedB = parseCredentials(b.encryptedCredentials)
  if (parsedA.isErr() || parsedB.isErr()) {
    return a.encryptedCredentials === b.encryptedCredentials
  }
  return sameCredentialDataBlobs(parsedA.unwrap(), parsedB.unwrap())
}

function nonEmpty(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

function readStoredPortfolioUuid(encryptedCredentials: string): string | undefined {
  const parsed = parseCredentials(encryptedCredentials)
  if (parsed.isErr()) {
    return undefined
  }
  return nonEmpty(parsed.unwrap().portfolioUuid)
}

function decryptCredentialField(credData: CredentialData, fieldName: string): Result<string, Error> {
  const blob = credData.data[fieldName]?.blob ?? ''
  const encrypted = Encrypted.fromString(blob)
  if (encrypted.isErr()) {
    return Err(encrypted.unwrapErr())
  }
  return encrypted.unwrap().decrypt()
}

function buildCoinbaseClient(apiKey: string, secretKey: string): Result<ReturnType<typeof Coinbase.Client>, Error> {
  const isPem = secretKey.trim().startsWith('-----BEGIN') && secretKey.includes('-----END')
  const credentials = isPem
    ? { variant: 'CdpKey' as const, name: apiKey, secret: secretKey }
    : { variant: 'ApiKey' as const, key: apiKey, secret: secretKey }

  try {
    return Ok(Coinbase.Client({ credentials }))
  } catch {
    return Err(new ExchangeUserError('Invalid Coinbase API credentials. Check your key and try again.', 'BAD_REQUEST'))
  }
}

async function listAllCoinbaseAccounts(
  client: ReturnType<typeof Coinbase.Client>,
): Promise<Result<CoinbaseAdvancedTradeAccount[], Coinbase.ApiError>> {
  const accounts: CoinbaseAdvancedTradeAccount[] = []
  let cursor: string | undefined = undefined

  for (let page = 0; page < MAX_COINBASE_ACCOUNT_PAGES; page++) {
    const accountsResult = await client.advancedTrade.accounts.list(
      cursor !== undefined ? { limit: 250, cursor } : { limit: 250 },
    )
    if (accountsResult.isErr()) {
      return Err(accountsResult.unwrapErr())
    }
    const pageData = accountsResult.unwrap().data
    accounts.push(...pageData.accounts)
    if (!pageData.has_next || pageData.cursor == null || pageData.cursor === '') {
      break
    }
    cursor = pageData.cursor
  }

  return Ok(accounts)
}

function pickPrimaryCoinbaseBtcAccount(
  accounts: CoinbaseAdvancedTradeAccount[],
): CoinbaseAdvancedTradeAccount | undefined {
  return (
    accounts.find((a) => a.currency === 'BTC' && a.type.enum === 'ACCOUNT_TYPE_CRYPTO' && a.default) ??
    accounts.find((a) => a.currency === 'BTC' && a.type.enum === 'ACCOUNT_TYPE_CRYPTO') ??
    accounts.find((a) => a.currency === 'BTC')
  )
}

async function fetchCoinbasePortfolioUuid(client: ReturnType<typeof Coinbase.Client>): Promise<string | undefined> {
  const permissionsRes = await client.advancedTrade.keyPermissions.get()
  if (permissionsRes.isErr()) {
    return undefined
  }
  return nonEmpty(permissionsRes.unwrap().data.portfolio_uuid)
}

function computeRobinhoodBtcBalanceSats(holdings: RobinhoodHolding[]): string {
  const btcHolding = holdings.find((h) => h.asset_code === 'BTC')
  if (!btcHolding) {
    return '0'
  }
  return new Decimal(btcHolding.total_quantity).mul(1e8).toFixed(0)
}

function findRobinhoodAccountNumberInHoldings(holdings: RobinhoodHolding[]): string | undefined {
  for (const holding of holdings) {
    const accountNumber = nonEmpty(holding.account_number)
    if (accountNumber !== undefined) {
      return accountNumber
    }
  }
  return undefined
}

async function resolveRobinhoodAccountId(
  client: RobinhoodClient,
  existingHoldings?: RobinhoodHolding[],
): Promise<Result<string | null, Error>> {
  const accountRes = await client.getAccount()
  if (accountRes.isOk()) {
    const accountNumber = nonEmpty(accountRes.unwrap().account_number)
    if (accountNumber !== undefined) {
      return Ok(accountNumber)
    }
  } else {
    const err = accountRes.unwrapErr()
    if (classifyProviderFailure('robinhood', err) !== 'permission_denied') {
      return Err(err)
    }
  }

  let holdings = existingHoldings
  if (holdings === undefined) {
    const holdingsRes = await client.getHoldings()
    if (holdingsRes.isOk()) {
      holdings = holdingsRes.unwrap()
    } else {
      const err = holdingsRes.unwrapErr()
      if (classifyProviderFailure('robinhood', err) !== 'permission_denied') {
        return Err(err)
      }
      holdings = []
    }
  }

  const fromHoldings = findRobinhoodAccountNumberInHoldings(holdings)
  if (fromHoldings !== undefined) {
    return Ok(fromHoldings)
  }

  const ordersRes = await client.findAccountNumberFromOrders()
  if (ordersRes.isErr()) {
    const ordersErr = ordersRes.unwrapErr()
    if (classifyProviderFailure('robinhood', ordersErr) === 'permission_denied') {
      return Ok(null)
    }
    return Err(ordersErr)
  }

  return Ok(nonEmpty(ordersRes.unwrap()) ?? null)
}

export class ExchangeService {
  private readonly db: SentinelDb
  private readonly logger: Logger

  public constructor(deps: { db: SentinelDb; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'exchange-service' })
  }

  // ─── List ──────────────────────────────────────────────────────────────

  public async listAccounts(exchange?: SupportedExchange): Promise<ExchangeAccountDto[]> {
    const rows = await this.db
      .select()
      .from(exchangeAccounts)
      .where(exchange ? eq(exchangeAccounts.provider, exchange) : undefined)
      .orderBy(desc(exchangeAccounts.createdAt))

    return rows.map((row) => {
      const connectionStatus = this.getAccountConnectionStatus(row)
      const isConnected = connectionStatus === 'connected'
      return {
        id: row.id,
        exchange: row.provider,
        displayName: row.displayName,
        balanceSats: isConnected ? row.balanceSats : null,
        balanceAsOf: isConnected ? row.balanceAsOf : null,
        createdAt: normalizeDbTimestamp(row.createdAt),
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

      const clientRes = buildCoinbaseClient(apiKey, secretKey)
      if (clientRes.isErr()) {
        return Err(clientRes.unwrapErr())
      }
      const client = clientRes.unwrap()

      const accountsResult = await listAllCoinbaseAccounts(client)
      if (accountsResult.isErr()) {
        return Err(this.toSafeConnectError('coinbase', accountsResult.unwrapErr()))
      }
      const accounts = accountsResult.unwrap()
      const keyPermissionsResult = await client.advancedTrade.keyPermissions.get()
      let keyPermissionsPortfolioUuid: string | undefined
      if (keyPermissionsResult.isOk()) {
        keyPermissionsPortfolioUuid = nonEmpty(keyPermissionsResult.unwrap().data.portfolio_uuid)
      } else {
        this.logProviderFailure('coinbase', 'backfill', keyPermissionsResult.unwrapErr())
      }

      let btcAccount: CoinbaseAdvancedTradeAccount | undefined
      let effectiveNewPortfolioUuid = keyPermissionsPortfolioUuid

      if (args.replaceAccountId != null && args.replaceAccountId !== '') {
        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'coinbase')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()

        let storedAccountUuid = nonEmpty(existing.externalAccountId)
        let storedPortfolioUuid = readStoredPortfolioUuid(existing.encryptedCredentials)

        if (storedAccountUuid === undefined || storedPortfolioUuid === undefined) {
          const backfilledRes = await this.backfillCoinbaseIdentityFromOldKey(existing, {
            needAccountUuid: storedAccountUuid === undefined,
            needPortfolioUuid: storedPortfolioUuid === undefined,
          })
          if (backfilledRes.isErr()) {
            return Err(backfilledRes.unwrapErr())
          }
          const backfilled = backfilledRes.unwrap()
          storedAccountUuid ??= backfilled.accountUuid
          storedPortfolioUuid ??= backfilled.portfolioUuid
        }

        if (
          storedPortfolioUuid !== undefined &&
          keyPermissionsPortfolioUuid !== undefined &&
          storedPortfolioUuid !== keyPermissionsPortfolioUuid
        ) {
          this.logger.warn(
            { accountId: args.replaceAccountId, provider: 'coinbase' },
            'Rejected exchange reconnect: API key belongs to a different account',
          )
          return Err(new ExchangeAccountMismatchError('coinbase'))
        }

        let matchedAccountUuid = false
        if (storedAccountUuid !== undefined) {
          btcAccount = accounts.find((a) => a.uuid === storedAccountUuid)
          if (!btcAccount) {
            this.logger.warn(
              { accountId: args.replaceAccountId, provider: 'coinbase' },
              'Rejected exchange reconnect: API key belongs to a different account',
            )
            return Err(new ExchangeAccountMismatchError('coinbase'))
          }
          matchedAccountUuid = true
        } else {
          btcAccount = pickPrimaryCoinbaseBtcAccount(accounts)
          if (!btcAccount) {
            return Err(new ExchangeUserError('No BTC account found in Coinbase.', 'BAD_REQUEST'))
          }
        }

        effectiveNewPortfolioUuid ??= nonEmpty(btcAccount.retail_portfolio_id)
        let matchedPortfolioUuid = false
        if (storedPortfolioUuid !== undefined) {
          if (effectiveNewPortfolioUuid !== undefined) {
            if (storedPortfolioUuid !== effectiveNewPortfolioUuid) {
              this.logger.warn(
                { accountId: args.replaceAccountId, provider: 'coinbase' },
                'Rejected exchange reconnect: API key belongs to a different account',
              )
              return Err(new ExchangeAccountMismatchError('coinbase'))
            }
            matchedPortfolioUuid = true
          } else if (!matchedAccountUuid) {
            if (
              keyPermissionsResult.isErr() &&
              classifyProviderFailure('coinbase', keyPermissionsResult.unwrapErr()) === 'transient'
            ) {
              return Err(new ExchangeVerificationRetryableError('coinbase'))
            }
            return Err(new ExchangeAccountUnverifiableError('coinbase'))
          }
        }

        if (!matchedAccountUuid && !matchedPortfolioUuid) {
          return Err(new ExchangeAccountUnverifiableError('coinbase'))
        }
      } else {
        btcAccount = pickPrimaryCoinbaseBtcAccount(accounts)
        if (!btcAccount) {
          return Err(new ExchangeUserError('No BTC account found in Coinbase.', 'BAD_REQUEST'))
        }
        effectiveNewPortfolioUuid ??= nonEmpty(btcAccount.retail_portfolio_id)
      }

      const balanceResult = await client.advancedTrade.accounts.get({ accountUuid: btcAccount.uuid })
      if (balanceResult.isErr()) {
        return Err(this.toSafeConnectError('coinbase', balanceResult.unwrapErr()))
      }
      const balanceData = balanceResult.unwrap()
      const btcValue = balanceData.data.account.available_balance.value
      const balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) {
        return Err(encApiKey.unwrapErr())
      }
      const encSecret = Encrypted.encrypt(secretKey)
      if (encSecret.isErr()) {
        return Err(encSecret.unwrapErr())
      }

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          secretKey: { blob: encSecret.unwrap().blob },
        },
      }
      if (effectiveNewPortfolioUuid !== undefined) {
        credentialData.portfolioUuid = effectiveNewPortfolioUuid
      }

      const displayName = btcAccount.name || 'Coinbase BTC'
      const now = new Date().toISOString()
      const saved = await this.saveConnectedAccount({
        provider: 'coinbase',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
        externalAccountId: btcAccount.uuid,
      })
      if (saved.isErr()) {
        return Err(saved.unwrapErr())
      }
      const { id, createdAt } = saved.unwrap()

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

      const balancesRes = await validateStrikeApiKey(apiKey, this.logger)
      if (balancesRes.isErr()) {
        return Err(this.toSafeConnectError('strike', balancesRes.unwrapErr()))
      }

      const btcBalance = balancesRes.unwrap().find((b) => b.currency === 'BTC')
      const balanceSats = btcBalance ? new Decimal(btcBalance.total).mul(1e8).toFixed(0) : '0'

      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) {
        return Err(encApiKey.unwrapErr())
      }

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: { apiKey: { blob: encApiKey.unwrap().blob } },
      }

      const displayName = inputName ?? 'Strike'
      const now = new Date().toISOString()
      const saved = await this.saveConnectedAccount({
        provider: 'strike',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
      })
      if (saved.isErr()) {
        return Err(saved.unwrapErr())
      }
      const { id, createdAt } = saved.unwrap()

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

      const holdingsResult = await client.getHoldings()
      if (holdingsResult.isErr()) {
        return Err(this.toSafeConnectError('robinhood', holdingsResult.unwrapErr()))
      }
      const holdings = holdingsResult.unwrap()
      const balanceSats = computeRobinhoodBtcBalanceSats(holdings)

      const isReconnect = args.replaceAccountId != null && args.replaceAccountId !== ''
      const accountIdResult = await resolveRobinhoodAccountId(client, holdings)
      let newAccountNumber: string | null = null
      if (accountIdResult.isOk()) {
        newAccountNumber = accountIdResult.unwrap()
      } else if (isReconnect) {
        return Err(this.toSafeConnectError('robinhood', accountIdResult.unwrapErr()))
      } else {
        this.logProviderFailure('robinhood', 'backfill', accountIdResult.unwrapErr())
        newAccountNumber = findRobinhoodAccountNumberInHoldings(holdings) ?? null
      }

      if (isReconnect && args.replaceAccountId !== undefined) {
        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'robinhood')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()

        if (newAccountNumber === null) {
          this.logger.warn(
            { accountId: args.replaceAccountId, provider: 'robinhood' },
            'Rejected Robinhood reconnect: could not determine account number for new key',
          )
          return Err(new RobinhoodAccountUnverifiableError())
        }

        let storedAccountNumber = nonEmpty(existing.externalAccountId)
        if (storedAccountNumber === undefined) {
          const backfilledRes = await this.backfillRobinhoodIdentityFromOldKey(existing)
          if (backfilledRes.isErr()) {
            return Err(backfilledRes.unwrapErr())
          }
          storedAccountNumber = backfilledRes.unwrap()
        }

        if (storedAccountNumber !== newAccountNumber) {
          this.logger.warn(
            { accountId: args.replaceAccountId, provider: 'robinhood' },
            'Rejected exchange reconnect: API key belongs to a different account',
          )
          return Err(new ExchangeAccountMismatchError('robinhood'))
        }
      }

      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) {
        return Err(encApiKey.unwrapErr())
      }
      const encPrivateKey = Encrypted.encrypt(privateKeyBase64)
      if (encPrivateKey.isErr()) {
        return Err(encPrivateKey.unwrapErr())
      }

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          privateKey: { blob: encPrivateKey.unwrap().blob },
        },
      }

      const displayName = inputName ?? 'Robinhood'
      const now = new Date().toISOString()
      const saved = await this.saveConnectedAccount({
        provider: 'robinhood',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
        externalAccountId: newAccountNumber ?? undefined,
      })
      if (saved.isErr()) {
        return Err(saved.unwrapErr())
      }
      const { id, createdAt } = saved.unwrap()

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

      const balanceResult = await client.getBalance()
      if (balanceResult.isErr()) {
        return Err(this.toSafeConnectError('kraken', balanceResult.unwrapErr()))
      }

      const balances = balanceResult.unwrap().data
      // Kraken uses XXBT or XBT for Bitcoin
      const btcValue = balances['XXBT'] ?? balances['XBT'] ?? '0'
      const balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      const isReconnect = args.replaceAccountId != null && args.replaceAccountId !== ''
      const keyInfoResult = await client.getApiKeyInfo()
      let newAccountId: string | undefined
      if (keyInfoResult.isOk()) {
        newAccountId = normalizeKrakenAccountId(keyInfoResult.unwrap().data.iban)
      } else if (isReconnect) {
        return Err(this.toSafeConnectError('kraken', keyInfoResult.unwrapErr()))
      } else {
        this.logProviderFailure('kraken', 'backfill', keyInfoResult.unwrapErr())
      }

      if (isReconnect && args.replaceAccountId !== undefined) {
        if (newAccountId === undefined) {
          return Err(new ExchangeVerificationRetryableError('kraken'))
        }

        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'kraken')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()

        let storedAccountId = normalizeKrakenAccountId(existing.externalAccountId)
        if (storedAccountId === undefined) {
          const backfilledRes = await this.backfillKrakenIdentityFromOldKey(existing)
          if (backfilledRes.isErr()) {
            return Err(backfilledRes.unwrapErr())
          }
          storedAccountId = backfilledRes.unwrap()
        }

        if (storedAccountId !== newAccountId) {
          this.logger.warn(
            { accountId: args.replaceAccountId, provider: 'kraken' },
            'Rejected exchange reconnect: API key belongs to a different account',
          )
          return Err(new ExchangeAccountMismatchError('kraken'))
        }
      }

      const encApiKey = Encrypted.encrypt(apiKey)
      if (encApiKey.isErr()) {
        return Err(encApiKey.unwrapErr())
      }
      const encSecret = Encrypted.encrypt(secretKey)
      if (encSecret.isErr()) {
        return Err(encSecret.unwrapErr())
      }

      const credentialData: CredentialData = {
        type: 'apiKey',
        data: {
          apiKey: { blob: encApiKey.unwrap().blob },
          secretKey: { blob: encSecret.unwrap().blob },
        },
      }

      const displayName = 'Kraken'
      const now = new Date().toISOString()
      const saved = await this.saveConnectedAccount({
        provider: 'kraken',
        replaceAccountId: args.replaceAccountId,
        displayName,
        credentialData,
        balanceSats,
        balanceAsOf: now,
        credentialsConnectedAt: now,
        externalAccountId: newAccountId,
      })
      if (saved.isErr()) {
        return Err(saved.unwrapErr())
      }
      const { id, createdAt } = saved.unwrap()

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
    const [row] = await this.db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))

    if (!row) {
      return Err(new ExchangeUserError('Exchange account not found', 'NOT_FOUND'))
    }
    if (this.getAccountConnectionStatus(row) === 'needs_reconnect') {
      return Err(
        new ExchangeUserError(
          'Exchange credentials are unavailable or expired. Reconnect this exchange account.',
          'PRECONDITION_FAILED',
        ),
      )
    }

    const expectedGeneration: CredentialGenerationSnapshot = {
      credentialsConnectedAt: row.credentialsConnectedAt,
      encryptedCredentials: row.encryptedCredentials,
    }

    const parsedCredentials = parseCredentials(row.encryptedCredentials)
    if (parsedCredentials.isErr()) {
      return Err(parsedCredentials.unwrapErr())
    }
    const credData = parsedCredentials.unwrap()
    const provider = row.provider

    const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
    if (apiKeyEnc.isErr()) {
      return Err(apiKeyEnc.unwrapErr())
    }

    let balanceSats: string

    if (provider === 'strike') {
      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) {
        return Err(apiKey.unwrapErr())
      }

      const result = await getStrikeBtcBalance(apiKey.unwrap(), this.logger)
      if (result.isErr()) {
        const err = result.unwrapErr()
        if (classifyProviderFailure('strike', err) === 'revoked') {
          await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true })
          this.logger.info({ accountId, provider: 'strike' }, 'Marked exchange credentials as revoked')
          return Err(new ExchangeCredentialsRevokedError('strike'))
        }
        return Err(this.toSafeRefreshError('strike', err))
      }
      balanceSats = result.unwrap().toString()
    } else if (provider === 'robinhood') {
      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) {
        return Err(apiKey.unwrapErr())
      }

      const privateKeyEnc = Encrypted.fromString(credData.data['privateKey']?.blob ?? '')
      if (privateKeyEnc.isErr()) {
        return Err(privateKeyEnc.unwrapErr())
      }
      const privateKey = privateKeyEnc.unwrap().decrypt()
      if (privateKey.isErr()) {
        return Err(privateKey.unwrapErr())
      }

      const client = new RobinhoodClient({ apiKey: apiKey.unwrap(), privateKeyBase64: privateKey.unwrap() })
      const holdingsRes = await client.getHoldings()
      if (holdingsRes.isErr()) {
        const err = holdingsRes.unwrapErr()
        if (classifyProviderFailure('robinhood', err) === 'revoked') {
          await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true })
          this.logger.info({ accountId, provider: 'robinhood' }, 'Marked exchange credentials as revoked')
          return Err(new ExchangeCredentialsRevokedError('robinhood'))
        }
        return Err(this.toSafeRefreshError('robinhood', err))
      }
      const holdings = holdingsRes.unwrap()
      balanceSats = computeRobinhoodBtcBalanceSats(holdings)

      if (nonEmpty(row.externalAccountId) === undefined) {
        let backfilledId = findRobinhoodAccountNumberInHoldings(holdings)
        if (backfilledId === undefined) {
          const resolved = await resolveRobinhoodAccountId(client, holdings)
          if (resolved.isOk() && resolved.unwrap() !== null) {
            backfilledId = resolved.unwrap() ?? undefined
          } else if (resolved.isErr()) {
            this.logProviderFailure('robinhood', 'backfill', resolved.unwrapErr())
          }
        }
        if (backfilledId !== undefined) {
          await this.backfillExternalAccountId(accountId, backfilledId, expectedGeneration)
        }
      }
    } else if (provider === 'kraken') {
      const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
      if (secretEnc.isErr()) {
        return Err(secretEnc.unwrapErr())
      }

      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) {
        return Err(apiKey.unwrapErr())
      }
      const secret = secretEnc.unwrap().decrypt()
      if (secret.isErr()) {
        return Err(secret.unwrapErr())
      }

      const client = new Kraken.Client({ apiKey: apiKey.unwrap(), secretKey: secret.unwrap() })
      const result = await client.getBalance()
      if (result.isErr()) {
        const err = result.unwrapErr()
        if (classifyProviderFailure('kraken', err) === 'revoked') {
          await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true })
          this.logger.info({ accountId, provider: 'kraken' }, 'Marked exchange credentials as revoked')
          return Err(new ExchangeCredentialsRevokedError('kraken'))
        }
        return Err(this.toSafeRefreshError('kraken', err))
      }

      const balances = result.unwrap().data
      const btcValue = balances['XXBT'] ?? balances['XBT'] ?? '0'
      balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      if (normalizeKrakenAccountId(row.externalAccountId) === undefined) {
        const keyInfoRes = await client.getApiKeyInfo()
        if (keyInfoRes.isOk()) {
          const normalizedId = normalizeKrakenAccountId(keyInfoRes.unwrap().data.iban)
          if (normalizedId !== undefined) {
            await this.backfillExternalAccountId(accountId, normalizedId, expectedGeneration)
          }
        } else {
          this.logProviderFailure('kraken', 'backfill', keyInfoRes.unwrapErr())
        }
      }
    } else {
      const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
      if (secretEnc.isErr()) {
        return Err(secretEnc.unwrapErr())
      }

      const apiKey = apiKeyEnc.unwrap().decrypt()
      if (apiKey.isErr()) {
        return Err(apiKey.unwrapErr())
      }
      const secret = secretEnc.unwrap().decrypt()
      if (secret.isErr()) {
        return Err(secret.unwrapErr())
      }

      const clientRes = buildCoinbaseClient(apiKey.unwrap(), secret.unwrap())
      if (clientRes.isErr()) {
        return Err(clientRes.unwrapErr())
      }
      const client = clientRes.unwrap()

      let accountUuid = nonEmpty(row.externalAccountId)
      if (accountUuid === undefined) {
        const accountsRes = await listAllCoinbaseAccounts(client)
        if (accountsRes.isErr()) {
          const err = accountsRes.unwrapErr()
          if (classifyProviderFailure('coinbase', err) === 'revoked') {
            await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true })
            this.logger.info({ accountId, provider: 'coinbase' }, 'Marked exchange credentials as revoked')
            return Err(new ExchangeCredentialsRevokedError('coinbase'))
          }
          return Err(this.toSafeRefreshError('coinbase', err))
        }
        const btcAccount = pickPrimaryCoinbaseBtcAccount(accountsRes.unwrap())
        if (!btcAccount) {
          return Err(new ExchangeUserError('No BTC account found in Coinbase.', 'INTERNAL_SERVER_ERROR'))
        }
        accountUuid = btcAccount.uuid
        await this.backfillExternalAccountId(accountId, accountUuid, expectedGeneration)
      }

      const balanceRes = await client.advancedTrade.accounts.get({ accountUuid })
      if (balanceRes.isErr()) {
        const err = balanceRes.unwrapErr()
        if (classifyProviderFailure('coinbase', err) === 'revoked') {
          await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true })
          this.logger.info({ accountId, provider: 'coinbase' }, 'Marked exchange credentials as revoked')
          return Err(new ExchangeCredentialsRevokedError('coinbase'))
        }
        return Err(this.toSafeRefreshError('coinbase', err))
      }

      const balanceAccount = balanceRes.unwrap().data.account
      const btcValue = balanceAccount.available_balance.value
      balanceSats = new Decimal(btcValue).mul(1e8).toFixed(0)

      if (nonEmpty(credData.portfolioUuid) === undefined) {
        const discoveredPortfolioUuid =
          (await fetchCoinbasePortfolioUuid(client)) ?? nonEmpty(balanceAccount.retail_portfolio_id)
        if (discoveredPortfolioUuid !== undefined) {
          await this.updateCredentialMetadata(accountId, expectedGeneration, { portfolioUuid: discoveredPortfolioUuid })
        }
      }
    }

    const now = new Date().toISOString()
    const written = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
          encryptedCredentials: exchangeAccounts.encryptedCredentials,
        })
        .from(exchangeAccounts)
        .where(eq(exchangeAccounts.id, accountId))

      if (!current || !isSameCredentialGeneration(current, expectedGeneration)) {
        return false
      }

      const updated = await tx
        .update(exchangeAccounts)
        .set({ balanceSats, balanceAsOf: now })
        .where(
          and(
            eq(exchangeAccounts.id, accountId),
            eq(exchangeAccounts.encryptedCredentials, current.encryptedCredentials),
          ),
        )

      if (updated.rowsAffected !== 1) {
        return false
      }

      await tx
        .insert(exchangeBalanceSnapshots)
        .values({ accountId, balanceSats, timestamp: now })
        .onConflictDoUpdate({
          target: [exchangeBalanceSnapshots.accountId, exchangeBalanceSnapshots.timestamp],
          set: { balanceSats },
        })

      return true
    })

    if (!written) {
      return Err(
        new ExchangeUserError('Exchange account credentials changed during refresh. Please try again.', 'CONFLICT'),
      )
    }

    this.logger.info({ accountId, balanceSats }, 'Exchange balance refreshed')
    return Ok({
      id: row.id,
      exchange: provider,
      displayName: row.displayName,
      balanceSats,
      balanceAsOf: now,
      createdAt: normalizeDbTimestamp(row.createdAt),
      connectionStatus: 'connected',
    })
  })

  // ─── Refresh All Balances ─────────────────────────────────────────────

  public refreshAllBalances = asyncFn(async (): Promise<Result<void, Error>> => {
    const accounts = (await this.listAccounts()).filter((account) => account.connectionStatus === 'connected')
    const errors: string[] = []

    for (const account of accounts) {
      const result = await this.refreshBalance(account.id)
      if (result.isErr()) {
        const err = result.unwrapErr()
        this.logProviderWarning(account.exchange, 'refresh', account.id, err, 'Failed to refresh balance')
        errors.push(`${account.displayName}: ${err instanceof ExchangeUserError ? err.message : 'Refresh failed'}`)
      }
    }

    if (errors.length > 0 && errors.length === accounts.length) {
      return Err(new Error(`All refreshes failed: ${errors.join('; ')}`))
    }

    return Ok(undefined)
  })

  // ─── Remove ────────────────────────────────────────────────────────────

  public async removeAccount(accountId: string): Promise<Result<void, Error>> {
    const removed = await this.db.delete(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))
    if (removed.rowsAffected === 0) {
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
      const rows = await this.db
        .select({
          id: exchangeAccounts.id,
          encryptedCredentials: exchangeAccounts.encryptedCredentials,
          externalAccountId: exchangeAccounts.externalAccountId,
          credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
        })
        .from(exchangeAccounts)
        .where(
          and(
            eq(exchangeAccounts.provider, 'coinbase'),
            filterAccountIds !== undefined && filterAccountIds.length > 0
              ? inArray(exchangeAccounts.id, filterAccountIds)
              : undefined,
          ),
        )

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getCoinbaseTransactionEntries: queried exchange_accounts',
      )

      const allEntries: { timestamp: Date; value: bigint }[] = []

      for (const row of rows) {
        const parsedCredentials = parseCredentials(row.encryptedCredentials)
        if (parsedCredentials.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Invalid stored credentials — skipping')
          continue
        }
        const credData = parsedCredentials.unwrap()

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

        const clientRes = buildCoinbaseClient(apiKey.unwrap(), secret.unwrap())
        if (clientRes.isErr()) {
          this.logProviderWarning(
            'coinbase',
            'client_init',
            row.id,
            clientRes.unwrapErr(),
            'getCoinbaseTransactionEntries: failed to create Coinbase client — skipping',
          )
          continue
        }
        const client = clientRes.unwrap()

        // Discover and backfill external_account_id if missing (pre-migration accounts)
        let accountUuid = nonEmpty(row.externalAccountId)
        if (accountUuid === undefined) {
          this.logger.info({ accountId: row.id }, 'Discovering Coinbase BTC account UUID')
          const accountsRes = await listAllCoinbaseAccounts(client)
          if (accountsRes.isErr()) {
            this.logProviderWarning(
              'coinbase',
              'backfill',
              row.id,
              accountsRes.unwrapErr(),
              'Failed to list Coinbase accounts — skipping',
            )
            continue
          }
          const btcAccount = pickPrimaryCoinbaseBtcAccount(accountsRes.unwrap())
          if (!btcAccount) {
            this.logger.warn({ accountId: row.id }, 'No BTC account found in Coinbase — skipping')
            continue
          }
          accountUuid = btcAccount.uuid
          await this.backfillExternalAccountId(row.id, accountUuid, {
            credentialsConnectedAt: row.credentialsConnectedAt,
            encryptedCredentials: row.encryptedCredentials,
          })
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
            this.logProviderWarning(
              'coinbase',
              'transactions',
              row.id,
              txResult.unwrapErr(),
              'Failed to fetch Coinbase transactions — stopping pagination',
            )
            break
          }

          const { pagination, data: transactions } = txResult.unwrap().data

          this.logger.info(
            {
              accountId: row.id,
              transactionCount: transactions.length,
              hasNextUri: pagination.next_uri != null && pagination.next_uri !== '',
              startingAfter,
            },
            'getCoinbaseTransactionEntries: page fetched',
          )

          for (const tx of transactions) {
            // Include all completed BTC transactions regardless of type.
            // The amount.amount field is already signed: positive for inflows, negative for outflows.
            if (tx.status !== 'completed' || tx.amount.currency !== 'BTC') {
              continue
            }

            const amountSats = new Decimal(tx.amount.amount).mul(1e8).toFixed(0)
            allEntries.push({
              timestamp: tx.created_at,
              value: BigInt(amountSats),
            })
          }

          if (pagination.next_uri != null && pagination.next_uri !== '' && transactions.length > 0) {
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
      const rows = await this.db
        .select({ id: exchangeAccounts.id, encryptedCredentials: exchangeAccounts.encryptedCredentials })
        .from(exchangeAccounts)
        .where(
          and(
            eq(exchangeAccounts.provider, 'kraken'),
            filterAccountIds !== undefined && filterAccountIds.length > 0
              ? inArray(exchangeAccounts.id, filterAccountIds)
              : undefined,
          ),
        )

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getKrakenTransactionEntries: queried exchange_accounts',
      )

      const allEntries: { timestamp: Date; value: bigint }[] = []

      for (const row of rows) {
        const parsedCredentials = parseCredentials(row.encryptedCredentials)
        if (parsedCredentials.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Invalid stored credentials — skipping')
          continue
        }
        const credData = parsedCredentials.unwrap()

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
            this.logProviderWarning(
              'kraken',
              'transactions',
              row.id,
              ledgersResult.unwrapErr(),
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
            const amountSats = new Decimal(entry.amount).sub(entry.fee).mul(1e8).toFixed(0)
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

  public async importStatementTransactions(args: {
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
  }): Promise<Result<{ imported: number; skipped: number }, Error>> {
    return this.db.transaction(async (db) => {
      const [account] = await db
        .select({ id: exchangeAccounts.id })
        .from(exchangeAccounts)
        .where(eq(exchangeAccounts.id, args.accountId))
      if (!account) {
        return Err(new Error('Exchange account not found'))
      }

      let imported = 0
      let skipped = 0
      for (const item of args.transactions) {
        const inserted = await db
          .insert(exchangeStatementTxs)
          .values({
            id: nanoid(),
            accountId: args.accountId,
            externalId: item.externalId,
            transactedAt: item.transactedAt,
            type: item.type,
            amountBtc: item.amountBtc,
            amountUsd: item.amountUsd ?? null,
            feeUsd: item.feeUsd ?? null,
            feeBtc: item.feeBtc ?? null,
            exchangeRate: item.exchangeRate ?? null,
            description: item.description ?? null,
            txHash: item.txHash ?? null,
            statementMonth: item.statementMonth,
          })
          .onConflictDoNothing({ target: [exchangeStatementTxs.accountId, exchangeStatementTxs.externalId] })
        if (inserted.rowsAffected > 0) {
          imported++
        } else {
          skipped++
        }
      }
      this.logger.info(
        { accountId: args.accountId, imported, skipped, total: args.transactions.length },
        'Imported strike statement transactions',
      )

      return Ok({ imported, skipped })
    })
  }

  public async listStatementTransactions(
    accountId: string,
    statementMonth?: string,
  ): Promise<
    Array<{
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
    }>
  > {
    return this.db
      .select({
        id: exchangeStatementTxs.id,
        externalId: exchangeStatementTxs.externalId,
        transactedAt: exchangeStatementTxs.transactedAt,
        type: exchangeStatementTxs.type,
        amountBtc: exchangeStatementTxs.amountBtc,
        amountUsd: exchangeStatementTxs.amountUsd,
        feeUsd: exchangeStatementTxs.feeUsd,
        feeBtc: exchangeStatementTxs.feeBtc,
        exchangeRate: exchangeStatementTxs.exchangeRate,
        description: exchangeStatementTxs.description,
        txHash: exchangeStatementTxs.txHash,
        statementMonth: exchangeStatementTxs.statementMonth,
      })
      .from(exchangeStatementTxs)
      .where(
        and(
          eq(exchangeStatementTxs.accountId, accountId),
          statementMonth !== undefined && statementMonth !== ''
            ? eq(exchangeStatementTxs.statementMonth, statementMonth)
            : undefined,
        ),
      )
      .orderBy(asc(exchangeStatementTxs.transactedAt))
  }

  public async listStatementMonths(accountId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ month: exchangeStatementTxs.statementMonth })
      .from(exchangeStatementTxs)
      .where(eq(exchangeStatementTxs.accountId, accountId))
      .orderBy(desc(exchangeStatementTxs.statementMonth))
    return rows.map((r) => r.month)
  }

  public async deleteStatementMonth(accountId: string, statementMonth: string): Promise<number> {
    const result = await this.db
      .delete(exchangeStatementTxs)
      .where(
        and(eq(exchangeStatementTxs.accountId, accountId), eq(exchangeStatementTxs.statementMonth, statementMonth)),
      )
    return result.rowsAffected
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private logProviderFailure(
    provider: SupportedExchange,
    operation: 'connect' | 'verify_old_key' | 'refresh' | 'backfill',
    err: Error,
  ): void {
    this.logger.debug({ ...describeSafeProviderFailure(provider, err), operation }, 'Exchange API request failed')
  }

  private logProviderWarning(
    provider: SupportedExchange,
    operation: 'client_init' | 'backfill' | 'transactions' | 'refresh',
    accountId: string,
    err: Error,
    message: string,
  ): void {
    this.logger.warn({ accountId, ...describeSafeProviderFailure(provider, err), operation }, message)
  }

  private toSafeConnectError(provider: SupportedExchange, err: Error): ExchangeUserError {
    this.logProviderFailure(provider, 'connect', err)
    const displayName = EXCHANGE_DISPLAY_NAMES[provider]
    if (classifyProviderFailure(provider, err) !== 'transient') {
      return new ExchangeUserError(
        `Invalid ${displayName} API credentials. Check your key and permissions, then try again.`,
        'BAD_REQUEST',
      )
    }
    return new ExchangeUserError(
      `Couldn't connect to ${displayName} right now. Please check your credentials and try again.`,
      'BAD_REQUEST',
    )
  }

  private toSafeRefreshError(provider: SupportedExchange, err: Error): ExchangeUserError {
    this.logProviderFailure(provider, 'refresh', err)
    return new ExchangeUserError(
      `Couldn't refresh your ${EXCHANGE_DISPLAY_NAMES[provider]} balance right now. Please try again.`,
      'INTERNAL_SERVER_ERROR',
    )
  }

  private async updateCredentialMetadata(
    accountId: string,
    expectedGeneration: CredentialGenerationSnapshot,
    change: CredentialMetadataChange,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const done = await this.db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
            encryptedCredentials: exchangeAccounts.encryptedCredentials,
          })
          .from(exchangeAccounts)
          .where(eq(exchangeAccounts.id, accountId))

        if (!current || !isSameCredentialGeneration(current, expectedGeneration)) {
          return true
        }

        const parsed = parseCredentials(current.encryptedCredentials)
        if (parsed.isErr()) {
          return true
        }
        const credData = parsed.unwrap()
        if (
          'portfolioUuid' in change
            ? nonEmpty(credData.portfolioUuid) !== undefined
            : credData.credentialsRevoked === true
        ) {
          return true
        }

        const rowsAffected = await writeCredentials(
          tx,
          createCredentialMetadataChange({
            accountId,
            previousCredentials: current.encryptedCredentials,
            change,
          }),
        )
        return rowsAffected === 1
      })
      if (done) {
        return
      }
    }
  }

  private async getReconnectTarget(
    replaceAccountId: string,
    provider: SupportedExchange,
  ): Promise<Result<ReconnectTarget, Error>> {
    const [existing] = await this.db
      .select({
        id: exchangeAccounts.id,
        provider: exchangeAccounts.provider,
        displayName: exchangeAccounts.displayName,
        createdAt: exchangeAccounts.createdAt,
        externalAccountId: exchangeAccounts.externalAccountId,
        encryptedCredentials: exchangeAccounts.encryptedCredentials,
        credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
      })
      .from(exchangeAccounts)
      .where(eq(exchangeAccounts.id, replaceAccountId))

    if (!existing) {
      return Err(new ExchangeUserError('Exchange account not found', 'NOT_FOUND'))
    }
    if (existing.provider !== provider) {
      return Err(
        new ExchangeUserError(
          `Cannot reconnect ${provider} credentials to a ${existing.provider} account`,
          'BAD_REQUEST',
        ),
      )
    }
    return Ok(existing)
  }

  private async backfillExternalAccountId(
    accountId: string,
    externalAccountId: string,
    expectedGeneration: CredentialGenerationSnapshot,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
          encryptedCredentials: exchangeAccounts.encryptedCredentials,
        })
        .from(exchangeAccounts)
        .where(eq(exchangeAccounts.id, accountId))

      if (!current || !isSameCredentialGeneration(current, expectedGeneration)) {
        return
      }

      await tx
        .update(exchangeAccounts)
        .set({ externalAccountId })
        .where(
          and(
            eq(exchangeAccounts.id, accountId),
            eq(exchangeAccounts.encryptedCredentials, current.encryptedCredentials),
            or(isNull(exchangeAccounts.externalAccountId), eq(exchangeAccounts.externalAccountId, '')),
          ),
        )
    })
  }

  private async backfillCoinbaseIdentityFromOldKey(
    existing: ReconnectTarget,
    needs: { needAccountUuid: boolean; needPortfolioUuid: boolean },
  ): Promise<Result<{ accountUuid?: string; portfolioUuid?: string }, Error>> {
    const hasAnyStoredId = !needs.needAccountUuid || !needs.needPortfolioUuid
    const expectedGeneration: CredentialGenerationSnapshot = {
      credentialsConnectedAt: existing.credentialsConnectedAt,
      encryptedCredentials: existing.encryptedCredentials,
    }

    const parsed = parseCredentials(existing.encryptedCredentials)
    if (parsed.isErr()) {
      return hasAnyStoredId ? Ok({}) : Err(new ExchangeAccountUnverifiableError('coinbase'))
    }
    const credData = parsed.unwrap()
    const apiKeyRes = decryptCredentialField(credData, 'apiKey')
    const secretRes = decryptCredentialField(credData, 'secretKey')
    if (apiKeyRes.isErr() || secretRes.isErr()) {
      return hasAnyStoredId ? Ok({}) : Err(new ExchangeAccountUnverifiableError('coinbase'))
    }

    const clientRes = buildCoinbaseClient(apiKeyRes.unwrap(), secretRes.unwrap())
    if (clientRes.isErr()) {
      return hasAnyStoredId ? Ok({}) : Err(new ExchangeAccountUnverifiableError('coinbase'))
    }
    const oldClient = clientRes.unwrap()

    let accountUuid: string | undefined
    let fallbackPortfolioUuid: string | undefined
    if (needs.needAccountUuid) {
      const accountsRes = await listAllCoinbaseAccounts(oldClient)
      if (accountsRes.isErr()) {
        const err = accountsRes.unwrapErr()
        this.logProviderFailure('coinbase', 'verify_old_key', err)
        const failureKind = classifyProviderFailure('coinbase', err)
        if (failureKind === 'transient') {
          return Err(new ExchangeVerificationRetryableError('coinbase'))
        }
        if (failureKind === 'revoked') {
          return hasAnyStoredId ? Ok({}) : Err(new ExchangeAccountUnverifiableError('coinbase'))
        }
      } else {
        const btcAccount = pickPrimaryCoinbaseBtcAccount(accountsRes.unwrap())
        if (btcAccount) {
          accountUuid = nonEmpty(btcAccount.uuid)
          fallbackPortfolioUuid = nonEmpty(btcAccount.retail_portfolio_id)
        }
      }
    }

    let portfolioUuid: string | undefined
    if (needs.needPortfolioUuid) {
      const permissionsRes = await oldClient.advancedTrade.keyPermissions.get()
      if (permissionsRes.isOk()) {
        portfolioUuid = nonEmpty(permissionsRes.unwrap().data.portfolio_uuid)
      } else {
        const err = permissionsRes.unwrapErr()
        this.logProviderFailure('coinbase', 'verify_old_key', err)
        if (!hasAnyStoredId && accountUuid === undefined && fallbackPortfolioUuid === undefined) {
          if (classifyProviderFailure('coinbase', err) === 'transient') {
            return Err(new ExchangeVerificationRetryableError('coinbase'))
          }
        }
      }
      portfolioUuid ??= fallbackPortfolioUuid
      const existingUuid = nonEmpty(existing.externalAccountId)
      if (portfolioUuid === undefined && !needs.needAccountUuid && existingUuid !== undefined) {
        const accountRes = await oldClient.advancedTrade.accounts.get({ accountUuid: existingUuid })
        if (accountRes.isOk()) {
          portfolioUuid = nonEmpty(accountRes.unwrap().data.account.retail_portfolio_id)
        }
      }
    }

    if (!hasAnyStoredId && accountUuid === undefined && portfolioUuid === undefined) {
      return Err(new ExchangeAccountUnverifiableError('coinbase'))
    }

    if (accountUuid !== undefined) {
      await this.backfillExternalAccountId(existing.id, accountUuid, expectedGeneration)
    }
    if (portfolioUuid !== undefined) {
      await this.updateCredentialMetadata(existing.id, expectedGeneration, { portfolioUuid })
    }

    return Ok({ accountUuid, portfolioUuid })
  }

  private async backfillKrakenIdentityFromOldKey(existing: ReconnectTarget): Promise<Result<string, Error>> {
    const expectedGeneration: CredentialGenerationSnapshot = {
      credentialsConnectedAt: existing.credentialsConnectedAt,
      encryptedCredentials: existing.encryptedCredentials,
    }
    const parsed = parseCredentials(existing.encryptedCredentials)
    if (parsed.isErr()) {
      return Err(new ExchangeAccountUnverifiableError('kraken'))
    }
    const credData = parsed.unwrap()
    const apiKeyRes = decryptCredentialField(credData, 'apiKey')
    const secretRes = decryptCredentialField(credData, 'secretKey')
    if (apiKeyRes.isErr() || secretRes.isErr()) {
      return Err(new ExchangeAccountUnverifiableError('kraken'))
    }

    const oldClient = new Kraken.Client({ apiKey: apiKeyRes.unwrap(), secretKey: secretRes.unwrap() })
    const keyInfoRes = await oldClient.getApiKeyInfo()
    if (keyInfoRes.isErr()) {
      const err = keyInfoRes.unwrapErr()
      this.logProviderFailure('kraken', 'verify_old_key', err)
      if (classifyProviderFailure('kraken', err) === 'transient') {
        return Err(new ExchangeVerificationRetryableError('kraken'))
      }
      return Err(new ExchangeAccountUnverifiableError('kraken'))
    }
    const normalizedId = normalizeKrakenAccountId(keyInfoRes.unwrap().data.iban)
    if (normalizedId === undefined) {
      return Err(new ExchangeAccountUnverifiableError('kraken'))
    }
    await this.backfillExternalAccountId(existing.id, normalizedId, expectedGeneration)
    return Ok(normalizedId)
  }

  private async backfillRobinhoodIdentityFromOldKey(existing: ReconnectTarget): Promise<Result<string, Error>> {
    const expectedGeneration: CredentialGenerationSnapshot = {
      credentialsConnectedAt: existing.credentialsConnectedAt,
      encryptedCredentials: existing.encryptedCredentials,
    }
    const parsed = parseCredentials(existing.encryptedCredentials)
    if (parsed.isErr()) {
      return Err(new ExchangeAccountUnverifiableError('robinhood'))
    }
    const credData = parsed.unwrap()
    const apiKeyRes = decryptCredentialField(credData, 'apiKey')
    const privateKeyRes = decryptCredentialField(credData, 'privateKey')
    if (apiKeyRes.isErr() || privateKeyRes.isErr()) {
      return Err(new ExchangeAccountUnverifiableError('robinhood'))
    }

    const oldClient = new RobinhoodClient({ apiKey: apiKeyRes.unwrap(), privateKeyBase64: privateKeyRes.unwrap() })
    const accountIdRes = await resolveRobinhoodAccountId(oldClient)
    if (accountIdRes.isErr()) {
      const err = accountIdRes.unwrapErr()
      this.logProviderFailure('robinhood', 'verify_old_key', err)
      if (classifyProviderFailure('robinhood', err) === 'transient') {
        return Err(new ExchangeVerificationRetryableError('robinhood'))
      }
      return Err(new ExchangeAccountUnverifiableError('robinhood'))
    }
    const oldId = nonEmpty(accountIdRes.unwrap())
    if (oldId === undefined) {
      return Err(new ExchangeAccountUnverifiableError('robinhood'))
    }
    await this.backfillExternalAccountId(existing.id, oldId, expectedGeneration)
    return Ok(oldId)
  }

  private async saveConnectedAccount(args: {
    provider: SupportedExchange
    replaceAccountId?: string
    displayName: string
    credentialData: CredentialData
    balanceSats: string
    balanceAsOf: string
    credentialsConnectedAt: string
    externalAccountId?: string
  }): Promise<Result<{ id: string; createdAt: string }, Error>> {
    return this.db.transaction(async (tx) => {
      if (args.replaceAccountId != null && args.replaceAccountId !== '') {
        const replaceAccountId = args.replaceAccountId
        // Reconnect must preserve the internal account id. Balance snapshots,
        // imported statements, and generated statement references are keyed to
        // this id, so never delete/reinsert during a credential replacement.
        const [existing] = await tx
          .select({
            provider: exchangeAccounts.provider,
            createdAt: exchangeAccounts.createdAt,
            externalAccountId: exchangeAccounts.externalAccountId,
            encryptedCredentials: exchangeAccounts.encryptedCredentials,
          })
          .from(exchangeAccounts)
          .where(eq(exchangeAccounts.id, replaceAccountId))

        if (!existing) {
          return Err(new ExchangeUserError('Exchange account not found', 'NOT_FOUND'))
        }
        if (existing.provider !== args.provider) {
          return Err(
            new ExchangeUserError(
              `Cannot reconnect ${args.provider} credentials to a ${existing.provider} account`,
              'BAD_REQUEST',
            ),
          )
        }

        const verifiedResult = verifyReconnectIdentity({
          accountId: replaceAccountId,
          provider: args.provider,
          existingExternalAccountId: existing.externalAccountId,
          existingPortfolioUuid: readStoredPortfolioUuid(existing.encryptedCredentials),
          incomingExternalAccountId: args.externalAccountId,
          incomingPortfolioUuid: args.credentialData.portfolioUuid,
        })
        if (verifiedResult.isErr()) {
          const err = verifiedResult.unwrapErr()
          if (err instanceof ExchangeAccountMismatchError) {
            this.logger.warn(
              { accountId: replaceAccountId, provider: args.provider },
              'Rejected exchange reconnect: API key belongs to a different account',
            )
          }
          return Err(err)
        }

        return this.applyVerifiedReconnectUpdate(tx, verifiedResult.unwrap(), {
          existingCreatedAt: existing.createdAt,
          displayName: args.displayName,
          credentialData: args.credentialData,
          balanceSats: args.balanceSats,
          balanceAsOf: args.balanceAsOf,
          credentialsConnectedAt: args.credentialsConnectedAt,
        })
      }

      const id = nanoid()
      await tx.insert(exchangeAccounts).values({
        id,
        provider: args.provider,
        displayName: args.displayName,
        encryptedCredentials: JSON.stringify(args.credentialData),
        balanceSats: args.balanceSats,
        balanceAsOf: args.balanceAsOf,
        credentialsConnectedAt: args.credentialsConnectedAt,
        externalAccountId: nonEmpty(args.externalAccountId) ?? null,
      })

      await tx
        .insert(exchangeBalanceSnapshots)
        .values({ accountId: id, timestamp: args.balanceAsOf, balanceSats: args.balanceSats })
        .onConflictDoUpdate({
          target: [exchangeBalanceSnapshots.accountId, exchangeBalanceSnapshots.timestamp],
          set: { balanceSats: args.balanceSats },
        })

      return Ok({ id, createdAt: args.balanceAsOf })
    })
  }

  private async applyVerifiedReconnectUpdate(
    tx: ExchangeTransaction,
    verified: VerifiedReconnectIdentity,
    args: {
      existingCreatedAt: string
      displayName: string
      credentialData: CredentialData
      balanceSats: string
      balanceAsOf: string
      credentialsConnectedAt: string
    },
  ): Promise<Result<{ id: string; createdAt: string }, Error>> {
    const finalCredentialData: CredentialData =
      verified.provider === 'coinbase' && verified.nextPortfolioUuid !== undefined
        ? { ...args.credentialData, portfolioUuid: verified.nextPortfolioUuid }
        : args.credentialData

    const rowsAffected = await writeCredentials(
      tx,
      createReconnectReplacement(verified, {
        displayName: args.displayName,
        encryptedCredentials: JSON.stringify(finalCredentialData),
        balanceSats: args.balanceSats,
        balanceAsOf: args.balanceAsOf,
        credentialsConnectedAt: args.credentialsConnectedAt,
      }),
    )

    if (rowsAffected === 0) {
      return Err(new ExchangeAccountMismatchError(verified.provider))
    }

    await tx
      .insert(exchangeBalanceSnapshots)
      .values({ accountId: verified.accountId, timestamp: args.balanceAsOf, balanceSats: args.balanceSats })
      .onConflictDoUpdate({
        target: [exchangeBalanceSnapshots.accountId, exchangeBalanceSnapshots.timestamp],
        set: { balanceSats: args.balanceSats },
      })

    return Ok({ id: verified.accountId, createdAt: normalizeDbTimestamp(args.existingCreatedAt) })
  }

  private getAccountConnectionStatus(row: {
    encryptedCredentials: string
    createdAt?: string | null
    credentialsConnectedAt?: string | null
  }): ExchangeConnectionStatus {
    if (this.areCredentialsExpired(row.credentialsConnectedAt ?? row.createdAt ?? null)) {
      return 'needs_reconnect'
    }
    return this.getCredentialConnectionStatus(row.encryptedCredentials)
  }

  private areCredentialsExpired(connectedAt: string | null): boolean {
    if (connectedAt == null || connectedAt === '') {
      return true
    }
    const connectedAtMs = Date.parse(normalizeDbTimestamp(connectedAt))
    if (!Number.isFinite(connectedAtMs)) {
      return true
    }
    return Date.now() - connectedAtMs >= mandatoryReconnectIntervalMs
  }

  private getCredentialConnectionStatus(encryptedCredentials: string): ExchangeConnectionStatus {
    try {
      const parsed = parseCredentials(encryptedCredentials)
      if (parsed.isErr()) {
        return 'needs_reconnect'
      }
      const credData = parsed.unwrap()
      if (credData.credentialsRevoked === true) {
        return 'needs_reconnect'
      }
      const credentialBlobs = Object.values(credData.data)
      if (credentialBlobs.length === 0) {
        return 'needs_reconnect'
      }

      for (const credential of credentialBlobs) {
        const encrypted = Encrypted.fromString(credential.blob)
        if (encrypted.isErr()) {
          return 'needs_reconnect'
        }
        const decrypted = encrypted.unwrap().decrypt()
        if (decrypted.isErr()) {
          return 'needs_reconnect'
        }
      }

      return 'connected'
    } catch {
      return 'needs_reconnect'
    }
  }
}
