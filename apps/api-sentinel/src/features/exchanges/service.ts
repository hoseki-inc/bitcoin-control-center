import { Coinbase } from '@hoseki/packages/clients/coinbase'
import type { Account as CoinbaseAdvancedTradeAccount } from '@hoseki/packages/clients/coinbase/lib/advanced-trade-types'
import { Kraken } from '@hoseki/packages/clients/kraken'
import { RobinhoodClient, type RobinhoodHolding } from '@hoseki/packages/clients/robinhood'
import { Err, Ok, Result, asyncFn, parseUnknown } from '@hoseki/packages/result'
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
import { exchangeAccounts, exchangeBalanceSnapshots, exchangeStatementTxs } from '../../db/schema'
import { normalizeDbTimestamp } from '../../db/timestamp'
import { Encrypted } from '../../lib/encrypted'
import {
  type InvalidProviderAmountError,
  type ValidatedSats,
  ZERO_VALIDATED_SATS,
  isHeaderSafeApiKey,
  parseBtcBalanceSats,
  parseSignedBtcAmountToSats,
  parseSignedBtcNetToSats,
  parseStoredBalanceSats,
} from './amounts'
import {
  ExchangeHistoryCache,
  type ExchangeHistoryEntry,
  type ExchangeHistoryFetchOutput,
  type ExchangeHistoryKey,
} from './history-cache'
import {
  EXCHANGE_DISPLAY_NAMES,
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  ExchangeCredentialsRevokedError,
  ExchangeHistoryIncompleteError,
  ExchangeRefreshTimeoutError,
  ExchangeUserError,
  ExchangeVerificationRetryableError,
  RobinhoodAccountUnverifiableError,
  type SupportedExchange,
  classifyProviderFailure,
  describeSafeProviderFailure,
  isRetryableProviderFailure,
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
  ExchangeHistoryIncompleteError,
  ExchangeRefreshTimeoutError,
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
const DEFAULT_EXCHANGE_REFRESH_TIMEOUT_MS = 60_000

export interface RefreshBalanceOptions {
  signal?: AbortSignal
  reuseUnchangedHistory?: boolean
}

export interface ExchangeAccountDto {
  id: string
  exchange: SupportedExchange
  displayName: string
  balanceSats: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: ExchangeConnectionStatus
}

interface BatchRefreshEntry {
  readonly controller: AbortController
  readonly bounded: Promise<Result<ExchangeAccountDto, Error>>
}

const CredentialDataSchema = z.object({
  type: z.literal('apiKey'),
  data: z.record(z.string(), z.object({ blob: z.string() })),
  portfolioUuid: z.string().optional(),
  credentialsRevoked: z.boolean().optional(),
  coinbaseAuth: z.literal('cdp').optional(),
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

interface ResolvedOldIdentity {
  externalAccountId?: string
  portfolioUuid?: string
  expectedGeneration: CredentialGenerationSnapshot
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

function buildCoinbaseClientFromCredentials(
  credentials: Coinbase.ApiKey | Coinbase.CdpKey,
): Result<ReturnType<typeof Coinbase.Client>, Error> {
  try {
    return Ok(Coinbase.Client({ credentials }))
  } catch {
    return Err(new ExchangeUserError('Invalid Coinbase API credentials. Check your key and try again.', 'BAD_REQUEST'))
  }
}

function buildCoinbaseSubmissionClient(
  apiKey: string,
  secretKey: string,
): Result<{ client: ReturnType<typeof Coinbase.Client>; credentials: Coinbase.ApiKey | Coinbase.CdpKey }, Error> {
  const credentialsRes = Coinbase.apiKeyCredentials(apiKey, secretKey)
  if (credentialsRes.isErr()) {
    return Err(credentialsRes.unwrapErr())
  }
  const credentials = credentialsRes.unwrap()
  return buildCoinbaseClientFromCredentials(credentials).map((client) => ({ client, credentials }))
}

function buildStoredCoinbaseClient(
  apiKey: string,
  secretKey: string,
  coinbaseAuth?: 'cdp',
): Result<ReturnType<typeof Coinbase.Client>, Error> {
  if (coinbaseAuth === 'cdp') {
    return buildCoinbaseClientFromCredentials({ variant: 'CdpKey', name: apiKey, secret: secretKey })
  }
  const isPem = secretKey.trim().startsWith('-----BEGIN') && secretKey.includes('-----END')
  const credentials = isPem
    ? { variant: 'CdpKey' as const, name: apiKey, secret: secretKey }
    : { variant: 'ApiKey' as const, key: apiKey, secret: secretKey }
  return buildCoinbaseClientFromCredentials(credentials)
}

function isSignalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true
}

async function listAllCoinbaseAccounts(
  client: ReturnType<typeof Coinbase.Client>,
  signal?: AbortSignal,
): Promise<Result<CoinbaseAdvancedTradeAccount[], Error>> {
  const accounts: CoinbaseAdvancedTradeAccount[] = []
  let cursor: string | undefined = undefined

  for (let page = 0; page < MAX_COINBASE_ACCOUNT_PAGES; page++) {
    if (isSignalAborted(signal)) {
      return Err(new ExchangeRefreshTimeoutError('coinbase'))
    }
    const accountsResult = await client.advancedTrade.accounts.list(
      cursor !== undefined ? { limit: 250, cursor } : { limit: 250 },
    )
    if (isSignalAborted(signal)) {
      return Err(new ExchangeRefreshTimeoutError('coinbase'))
    }
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

class CoinbaseAccountReplyMismatchError extends Error {
  public constructor() {
    super('Coinbase account reply does not match the requested BTC account')
    this.name = 'CoinbaseAccountReplyMismatchError'
  }
}

function readCoinbaseBtcAccount(
  account: CoinbaseAdvancedTradeAccount,
  accountUuid: string,
): Result<CoinbaseAdvancedTradeAccount, CoinbaseAccountReplyMismatchError> {
  if (account.uuid !== accountUuid || account.currency !== 'BTC' || account.available_balance.currency !== 'BTC') {
    return Err(new CoinbaseAccountReplyMismatchError())
  }
  return Ok(account)
}

async function fetchCoinbasePortfolioUuid(client: ReturnType<typeof Coinbase.Client>): Promise<string | undefined> {
  const permissionsRes = await client.advancedTrade.keyPermissions.get()
  if (permissionsRes.isErr()) {
    return undefined
  }
  return nonEmpty(permissionsRes.unwrap().data.portfolio_uuid)
}

function computeRobinhoodBtcBalanceSats(
  holdings: RobinhoodHolding[],
): Result<ValidatedSats, InvalidProviderAmountError> {
  const btcHolding = holdings.find((h) => h.asset_code === 'BTC')
  if (!btcHolding) {
    return Ok(ZERO_VALIDATED_SATS)
  }
  return parseBtcBalanceSats(btcHolding.total_quantity)
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
  signal?: AbortSignal,
): Promise<Result<string | null, Error>> {
  if (isSignalAborted(signal)) {
    return Err(new ExchangeRefreshTimeoutError('robinhood'))
  }
  const accountRes = await client.getAccount()
  if (isSignalAborted(signal)) {
    return Err(new ExchangeRefreshTimeoutError('robinhood'))
  }
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
    if (isSignalAborted(signal)) {
      return Err(new ExchangeRefreshTimeoutError('robinhood'))
    }
    const holdingsRes = await client.getHoldings()
    if (isSignalAborted(signal)) {
      return Err(new ExchangeRefreshTimeoutError('robinhood'))
    }
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

  if (isSignalAborted(signal)) {
    return Err(new ExchangeRefreshTimeoutError('robinhood'))
  }
  const ordersRes = await client.findAccountNumberFromOrders()
  if (isSignalAborted(signal)) {
    return Err(new ExchangeRefreshTimeoutError('robinhood'))
  }
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
  private readonly refreshTimeLimitMs: number
  private readonly batchRefreshes = new Map<string, BatchRefreshEntry>()
  private refreshAllInFlight: Promise<Result<void, Error>> | null = null
  private readonly historyCache = new ExchangeHistoryCache()

  public constructor(deps: { db: SentinelDb; logger: Logger; refreshTimeLimitMs?: number }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'exchange-service' })
    this.refreshTimeLimitMs = deps.refreshTimeLimitMs ?? DEFAULT_EXCHANGE_REFRESH_TIMEOUT_MS
  }

  public async listAccounts(exchange?: SupportedExchange): Promise<ExchangeAccountDto[]> {
    const rows = await this.db
      .select()
      .from(exchangeAccounts)
      .where(exchange ? eq(exchangeAccounts.provider, exchange) : undefined)
      .orderBy(desc(exchangeAccounts.createdAt))

    return rows.map((row) => {
      const connectionStatus = this.getAccountConnectionStatus(row)
      const isConnected = connectionStatus === 'connected'
      const balanceSats = isConnected ? parseStoredBalanceSats(row.balanceSats) : null
      return {
        id: row.id,
        exchange: row.provider,
        displayName: row.displayName,
        balanceSats,
        balanceAsOf: balanceSats !== null ? row.balanceAsOf : null,
        createdAt: normalizeDbTimestamp(row.createdAt),
        connectionStatus,
      }
    })
  }

  public connectCoinbase = asyncFn(
    async (args: {
      apiKey: string
      secretKey: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, secretKey } = args
      this.logger.info('Connecting Coinbase account via API key')

      const clientRes = buildCoinbaseSubmissionClient(apiKey, secretKey)
      if (clientRes.isErr()) {
        return Err(this.toSafeConnectError('coinbase', clientRes.unwrapErr()))
      }
      const { client, credentials } = clientRes.unwrap()
      const normalizedApiKey = credentials.variant === 'CdpKey' ? credentials.name : credentials.key
      if (!isHeaderSafeApiKey(normalizedApiKey)) {
        return Err(this.invalidCredentialsError('coinbase'))
      }

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
      let expectedGeneration: CredentialGenerationSnapshot | undefined
      let resolvedOldIdentity: ResolvedOldIdentity | undefined

      if (args.replaceAccountId != null && args.replaceAccountId !== '') {
        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'coinbase')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()
        expectedGeneration = {
          credentialsConnectedAt: existing.credentialsConnectedAt,
          encryptedCredentials: existing.encryptedCredentials,
        }

        let storedAccountUuid = nonEmpty(existing.externalAccountId)
        let storedPortfolioUuid = readStoredPortfolioUuid(existing.encryptedCredentials)

        if (storedAccountUuid === undefined || storedPortfolioUuid === undefined) {
          const resolvedRes = await this.resolveCoinbaseIdentityFromOldKey(existing, {
            needAccountUuid: storedAccountUuid === undefined,
            needPortfolioUuid: storedPortfolioUuid === undefined,
          })
          if (resolvedRes.isErr()) {
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'coinbase',
                accountId: args.replaceAccountId,
                expectedGeneration,
                error: resolvedRes.unwrapErr(),
              }),
            )
          }
          const resolved = resolvedRes.unwrap()
          resolvedOldIdentity = resolved
          storedAccountUuid ??= resolved.externalAccountId
          storedPortfolioUuid ??= resolved.portfolioUuid
        }

        if (
          storedPortfolioUuid !== undefined &&
          keyPermissionsPortfolioUuid !== undefined &&
          storedPortfolioUuid !== keyPermissionsPortfolioUuid
        ) {
          return Err(
            await this.resolveEarlyReconnectError({
              provider: 'coinbase',
              accountId: args.replaceAccountId,
              expectedGeneration,
              resolvedOldIdentity,
              error: new ExchangeAccountMismatchError('coinbase'),
            }),
          )
        }

        let matchedAccountUuid = false
        if (storedAccountUuid !== undefined) {
          btcAccount = accounts.find((a) => a.uuid === storedAccountUuid)
          if (!btcAccount) {
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'coinbase',
                accountId: args.replaceAccountId,
                expectedGeneration,
                resolvedOldIdentity,
                error: new ExchangeAccountMismatchError('coinbase'),
              }),
            )
          }
          matchedAccountUuid = true
        } else {
          btcAccount = pickPrimaryCoinbaseBtcAccount(accounts)
          if (!btcAccount) {
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'coinbase',
                accountId: args.replaceAccountId,
                expectedGeneration,
                error: new ExchangeUserError('No BTC account found in Coinbase.', 'BAD_REQUEST'),
              }),
            )
          }
        }

        effectiveNewPortfolioUuid ??= nonEmpty(btcAccount.retail_portfolio_id)
        let matchedPortfolioUuid = false
        if (storedPortfolioUuid !== undefined) {
          if (effectiveNewPortfolioUuid !== undefined) {
            if (storedPortfolioUuid !== effectiveNewPortfolioUuid) {
              return Err(
                await this.resolveEarlyReconnectError({
                  provider: 'coinbase',
                  accountId: args.replaceAccountId,
                  expectedGeneration,
                  resolvedOldIdentity,
                  error: new ExchangeAccountMismatchError('coinbase'),
                }),
              )
            }
            matchedPortfolioUuid = true
          } else if (!matchedAccountUuid) {
            const error =
              keyPermissionsResult.isErr() &&
              classifyProviderFailure('coinbase', keyPermissionsResult.unwrapErr()) === 'transient'
                ? new ExchangeVerificationRetryableError('coinbase')
                : new ExchangeAccountUnverifiableError('coinbase')
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'coinbase',
                accountId: args.replaceAccountId,
                expectedGeneration,
                error,
              }),
            )
          }
        }

        if (!matchedAccountUuid && !matchedPortfolioUuid) {
          return Err(
            await this.resolveEarlyReconnectError({
              provider: 'coinbase',
              accountId: args.replaceAccountId,
              expectedGeneration,
              error: new ExchangeAccountUnverifiableError('coinbase'),
            }),
          )
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
      const balanceAccountRes = readCoinbaseBtcAccount(balanceResult.unwrap().data.account, btcAccount.uuid)
      if (balanceAccountRes.isErr()) {
        return Err(this.toSafeConnectError('coinbase', balanceAccountRes.unwrapErr()))
      }
      const btcValue = balanceAccountRes.unwrap().available_balance.value
      const balanceSatsRes = parseBtcBalanceSats(btcValue)
      if (balanceSatsRes.isErr()) {
        return Err(this.toSafeConnectError('coinbase', balanceSatsRes.unwrapErr()))
      }
      const balanceSats = balanceSatsRes.unwrap()

      const storedApiKey = credentials.variant === 'CdpKey' ? credentials.name : credentials.key
      const storedSecretKey = credentials.secret

      const encApiKey = Encrypted.encrypt(storedApiKey)
      if (encApiKey.isErr()) {
        return Err(encApiKey.unwrapErr())
      }
      const encSecret = Encrypted.encrypt(storedSecretKey)
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
      if (credentials.variant === 'CdpKey') {
        credentialData.coinbaseAuth = 'cdp'
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
        expectedGeneration,
        resolvedOldIdentity,
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

  public connectStrike = asyncFn(
    async (args: {
      apiKey: string
      displayName?: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, displayName: inputName } = args
      this.logger.info('Connecting Strike account via API key')

      if (!isHeaderSafeApiKey(apiKey)) {
        return Err(this.invalidCredentialsError('strike'))
      }

      const balancesRes = await validateStrikeApiKey(apiKey, this.logger)
      if (balancesRes.isErr()) {
        return Err(this.toSafeConnectError('strike', balancesRes.unwrapErr()))
      }

      const btcBalance = balancesRes.unwrap().find((b) => b.currency === 'BTC')
      const balanceSatsRes = btcBalance ? parseBtcBalanceSats(btcBalance.total) : Ok(ZERO_VALIDATED_SATS)
      if (balanceSatsRes.isErr()) {
        return Err(this.toSafeConnectError('strike', balanceSatsRes.unwrapErr()))
      }
      const balanceSats = balanceSatsRes.unwrap()

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

  public connectRobinhood = asyncFn(
    async (args: {
      apiKey: string
      privateKeyBase64: string
      displayName?: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, privateKeyBase64, displayName: inputName } = args
      this.logger.info('Connecting Robinhood account via API key')

      if (!isHeaderSafeApiKey(apiKey)) {
        return Err(this.invalidCredentialsError('robinhood'))
      }

      const client = new RobinhoodClient({ apiKey, privateKeyBase64 })

      const holdingsResult = await client.getHoldings()
      if (holdingsResult.isErr()) {
        return Err(this.toSafeConnectError('robinhood', holdingsResult.unwrapErr()))
      }
      const holdings = holdingsResult.unwrap()
      const balanceSatsRes = computeRobinhoodBtcBalanceSats(holdings)
      if (balanceSatsRes.isErr()) {
        return Err(this.toSafeConnectError('robinhood', balanceSatsRes.unwrapErr()))
      }
      const balanceSats = balanceSatsRes.unwrap()

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

      let expectedGeneration: CredentialGenerationSnapshot | undefined
      let resolvedOldIdentity: ResolvedOldIdentity | undefined

      if (isReconnect && args.replaceAccountId !== undefined) {
        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'robinhood')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()
        expectedGeneration = {
          credentialsConnectedAt: existing.credentialsConnectedAt,
          encryptedCredentials: existing.encryptedCredentials,
        }

        if (newAccountNumber === null) {
          this.logger.warn(
            { accountId: args.replaceAccountId, provider: 'robinhood' },
            'Rejected Robinhood reconnect: could not determine account number for new key',
          )
          return Err(new RobinhoodAccountUnverifiableError())
        }

        let storedAccountNumber = nonEmpty(existing.externalAccountId)
        if (storedAccountNumber === undefined) {
          const resolvedRes = await this.resolveRobinhoodIdentityFromOldKey(existing)
          if (resolvedRes.isErr()) {
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'robinhood',
                accountId: args.replaceAccountId,
                expectedGeneration,
                error: resolvedRes.unwrapErr(),
              }),
            )
          }
          const resolved = resolvedRes.unwrap()
          resolvedOldIdentity = resolved
          storedAccountNumber = resolved.externalAccountId
        }

        if (storedAccountNumber !== newAccountNumber) {
          return Err(
            await this.resolveEarlyReconnectError({
              provider: 'robinhood',
              accountId: args.replaceAccountId,
              expectedGeneration,
              resolvedOldIdentity,
              error: new ExchangeAccountMismatchError('robinhood'),
            }),
          )
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
        expectedGeneration,
        resolvedOldIdentity,
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

  public connectKraken = asyncFn(
    async (args: {
      apiKey: string
      secretKey: string
      replaceAccountId?: string
    }): Promise<Result<ExchangeAccountDto, Error>> => {
      const { apiKey, secretKey } = args
      this.logger.info('Connecting Kraken account via API key')

      if (!isHeaderSafeApiKey(apiKey)) {
        return Err(this.invalidCredentialsError('kraken'))
      }

      const client = new Kraken.Client({ apiKey, secretKey })

      const balanceResult = await client.getBalance()
      if (balanceResult.isErr()) {
        return Err(this.toSafeConnectError('kraken', balanceResult.unwrapErr()))
      }

      const balances = balanceResult.unwrap().data
      const btcValue = balances['XXBT'] ?? balances['XBT']
      const balanceSatsRes = btcValue !== undefined ? parseBtcBalanceSats(btcValue) : Ok(ZERO_VALIDATED_SATS)
      if (balanceSatsRes.isErr()) {
        return Err(this.toSafeConnectError('kraken', balanceSatsRes.unwrapErr()))
      }
      const balanceSats = balanceSatsRes.unwrap()

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

      let expectedGeneration: CredentialGenerationSnapshot | undefined
      let resolvedOldIdentity: ResolvedOldIdentity | undefined

      if (isReconnect && args.replaceAccountId !== undefined) {
        if (newAccountId === undefined) {
          return Err(new ExchangeVerificationRetryableError('kraken'))
        }

        const targetRes = await this.getReconnectTarget(args.replaceAccountId, 'kraken')
        if (targetRes.isErr()) {
          return Err(targetRes.unwrapErr())
        }
        const existing = targetRes.unwrap()
        expectedGeneration = {
          credentialsConnectedAt: existing.credentialsConnectedAt,
          encryptedCredentials: existing.encryptedCredentials,
        }

        let storedAccountId = normalizeKrakenAccountId(existing.externalAccountId)
        if (storedAccountId === undefined) {
          const resolvedRes = await this.resolveKrakenIdentityFromOldKey(existing)
          if (resolvedRes.isErr()) {
            return Err(
              await this.resolveEarlyReconnectError({
                provider: 'kraken',
                accountId: args.replaceAccountId,
                expectedGeneration,
                error: resolvedRes.unwrapErr(),
              }),
            )
          }
          const resolved = resolvedRes.unwrap()
          resolvedOldIdentity = resolved
          storedAccountId = resolved.externalAccountId
        }

        if (storedAccountId !== newAccountId) {
          return Err(
            await this.resolveEarlyReconnectError({
              provider: 'kraken',
              accountId: args.replaceAccountId,
              expectedGeneration,
              resolvedOldIdentity,
              error: new ExchangeAccountMismatchError('kraken'),
            }),
          )
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
        expectedGeneration,
        resolvedOldIdentity,
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

  public refreshBalance = asyncFn(
    async (accountId: string, options?: RefreshBalanceOptions): Promise<Result<ExchangeAccountDto, Error>> => {
      const signal = options?.signal
      const isAborted = (): boolean => signal?.aborted === true

      const [row] = await this.db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))

      if (!row) {
        return Err(new ExchangeUserError('Exchange account not found', 'NOT_FOUND'))
      }
      if (isAborted()) {
        return Err(new ExchangeRefreshTimeoutError(row.provider))
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

      let balanceSats: ValidatedSats

      if (provider === 'strike') {
        const apiKey = apiKeyEnc.unwrap().decrypt()
        if (apiKey.isErr()) {
          return Err(apiKey.unwrapErr())
        }

        const result = await getStrikeBtcBalance(apiKey.unwrap(), this.logger)
        if (isAborted()) {
          return Err(new ExchangeRefreshTimeoutError('strike'))
        }
        if (result.isErr()) {
          const err = result.unwrapErr()
          if (classifyProviderFailure('strike', err) === 'revoked') {
            await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true }, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('strike'))
            }
            this.logger.info({ accountId, provider: 'strike' }, 'Marked exchange credentials as revoked')
            return Err(new ExchangeCredentialsRevokedError('strike'))
          }
          return Err(this.toSafeRefreshError('strike', err))
        }
        balanceSats = result.unwrap()
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
        if (isAborted()) {
          return Err(new ExchangeRefreshTimeoutError('robinhood'))
        }
        if (holdingsRes.isErr()) {
          const err = holdingsRes.unwrapErr()
          if (classifyProviderFailure('robinhood', err) === 'revoked') {
            await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true }, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('robinhood'))
            }
            this.logger.info({ accountId, provider: 'robinhood' }, 'Marked exchange credentials as revoked')
            return Err(new ExchangeCredentialsRevokedError('robinhood'))
          }
          return Err(this.toSafeRefreshError('robinhood', err))
        }
        const holdings = holdingsRes.unwrap()
        const balanceSatsRes = computeRobinhoodBtcBalanceSats(holdings)
        if (balanceSatsRes.isErr()) {
          return Err(this.toSafeRefreshError('robinhood', balanceSatsRes.unwrapErr()))
        }
        balanceSats = balanceSatsRes.unwrap()

        if (nonEmpty(row.externalAccountId) === undefined) {
          let backfilledId = findRobinhoodAccountNumberInHoldings(holdings)
          if (backfilledId === undefined) {
            const resolved = await resolveRobinhoodAccountId(client, holdings, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('robinhood'))
            }
            if (resolved.isOk() && resolved.unwrap() !== null) {
              backfilledId = resolved.unwrap() ?? undefined
            } else if (resolved.isErr()) {
              this.logProviderFailure('robinhood', 'backfill', resolved.unwrapErr())
            }
          }
          if (backfilledId !== undefined) {
            await this.backfillExternalAccountId(accountId, backfilledId, expectedGeneration, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('robinhood'))
            }
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
        if (isAborted()) {
          return Err(new ExchangeRefreshTimeoutError('kraken'))
        }
        if (result.isErr()) {
          const err = result.unwrapErr()
          if (classifyProviderFailure('kraken', err) === 'revoked') {
            await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true }, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('kraken'))
            }
            this.logger.info({ accountId, provider: 'kraken' }, 'Marked exchange credentials as revoked')
            return Err(new ExchangeCredentialsRevokedError('kraken'))
          }
          return Err(this.toSafeRefreshError('kraken', err))
        }

        const balances = result.unwrap().data
        const btcValue = balances['XXBT'] ?? balances['XBT']
        const balanceSatsRes = btcValue !== undefined ? parseBtcBalanceSats(btcValue) : Ok(ZERO_VALIDATED_SATS)
        if (balanceSatsRes.isErr()) {
          return Err(this.toSafeRefreshError('kraken', balanceSatsRes.unwrapErr()))
        }
        balanceSats = balanceSatsRes.unwrap()

        if (normalizeKrakenAccountId(row.externalAccountId) === undefined) {
          const keyInfoRes = await client.getApiKeyInfo()
          if (isAborted()) {
            return Err(new ExchangeRefreshTimeoutError('kraken'))
          }
          if (keyInfoRes.isOk()) {
            const normalizedId = normalizeKrakenAccountId(keyInfoRes.unwrap().data.iban)
            if (normalizedId !== undefined) {
              await this.backfillExternalAccountId(accountId, normalizedId, expectedGeneration, signal)
              if (isAborted()) {
                return Err(new ExchangeRefreshTimeoutError('kraken'))
              }
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

        const clientRes = buildStoredCoinbaseClient(apiKey.unwrap(), secret.unwrap(), credData.coinbaseAuth)
        if (clientRes.isErr()) {
          return Err(clientRes.unwrapErr())
        }
        const client = clientRes.unwrap()

        let accountUuid = nonEmpty(row.externalAccountId)
        if (accountUuid === undefined) {
          const accountsRes = await listAllCoinbaseAccounts(client, signal)
          if (isAborted()) {
            return Err(new ExchangeRefreshTimeoutError('coinbase'))
          }
          if (accountsRes.isErr()) {
            const err = accountsRes.unwrapErr()
            if (classifyProviderFailure('coinbase', err) === 'revoked') {
              await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true }, signal)
              if (isAborted()) {
                return Err(new ExchangeRefreshTimeoutError('coinbase'))
              }
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
          await this.backfillExternalAccountId(accountId, accountUuid, expectedGeneration, signal)
          if (isAborted()) {
            return Err(new ExchangeRefreshTimeoutError('coinbase'))
          }
        }

        const balanceRes = await client.advancedTrade.accounts.get({ accountUuid })
        if (isAborted()) {
          return Err(new ExchangeRefreshTimeoutError('coinbase'))
        }
        if (balanceRes.isErr()) {
          const err = balanceRes.unwrapErr()
          if (classifyProviderFailure('coinbase', err) === 'revoked') {
            await this.updateCredentialMetadata(accountId, expectedGeneration, { credentialsRevoked: true }, signal)
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('coinbase'))
            }
            this.logger.info({ accountId, provider: 'coinbase' }, 'Marked exchange credentials as revoked')
            return Err(new ExchangeCredentialsRevokedError('coinbase'))
          }
          return Err(this.toSafeRefreshError('coinbase', err))
        }

        const balanceAccountRes = readCoinbaseBtcAccount(balanceRes.unwrap().data.account, accountUuid)
        if (balanceAccountRes.isErr()) {
          return Err(this.toSafeRefreshError('coinbase', balanceAccountRes.unwrapErr()))
        }
        const balanceAccount = balanceAccountRes.unwrap()
        const btcValue = balanceAccount.available_balance.value
        const balanceSatsRes = parseBtcBalanceSats(btcValue)
        if (balanceSatsRes.isErr()) {
          return Err(this.toSafeRefreshError('coinbase', balanceSatsRes.unwrapErr()))
        }
        balanceSats = balanceSatsRes.unwrap()

        if (nonEmpty(credData.portfolioUuid) === undefined) {
          const discoveredPortfolioUuid =
            (await fetchCoinbasePortfolioUuid(client)) ?? nonEmpty(balanceAccount.retail_portfolio_id)
          if (isAborted()) {
            return Err(new ExchangeRefreshTimeoutError('coinbase'))
          }
          if (discoveredPortfolioUuid !== undefined) {
            await this.updateCredentialMetadata(
              accountId,
              expectedGeneration,
              { portfolioUuid: discoveredPortfolioUuid },
              signal,
            )
            if (isAborted()) {
              return Err(new ExchangeRefreshTimeoutError('coinbase'))
            }
          }
        }
      }

      if (isAborted()) {
        return Err(new ExchangeRefreshTimeoutError(provider))
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

        if (isAborted() || !current || !isSameCredentialGeneration(current, expectedGeneration)) {
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
        if (isAborted()) {
          return Err(new ExchangeRefreshTimeoutError(provider))
        }
        return Err(
          new ExchangeUserError('Exchange account credentials changed during refresh. Please try again.', 'CONFLICT'),
        )
      }

      if (options?.reuseUnchangedHistory !== true || balanceSats !== row.balanceSats) {
        this.historyCache.invalidate(accountId)
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
    },
  )

  public async refreshBalanceForBatch(account: {
    id: string
    exchange: SupportedExchange
  }): Promise<Result<ExchangeAccountDto, Error>> {
    const existing = this.batchRefreshes.get(account.id)
    if (existing !== undefined) {
      return existing.bounded
    }

    const controller = new AbortController()
    let resolveBounded: (result: Result<ExchangeAccountDto, Error>) => void = () => undefined
    let rejectBounded: (error: Error) => void = () => undefined
    const bounded = new Promise<Result<ExchangeAccountDto, Error>>((resolve, reject) => {
      resolveBounded = resolve
      rejectBounded = reject
    })

    const entry: BatchRefreshEntry = { controller, bounded }
    this.batchRefreshes.set(account.id, entry)

    let status: 'pending' | 'settled' | 'timed_out' = 'pending'
    const isPending = (): boolean => status === 'pending'
    const isTimedOut = (): boolean => status === 'timed_out'
    const timer = setTimeout(() => {
      if (!isPending()) {
        return
      }
      status = 'timed_out'
      controller.abort()
      const timeoutErr = new ExchangeRefreshTimeoutError(account.exchange)
      this.logger.warn(
        {
          accountId: account.id,
          ...describeSafeProviderFailure(account.exchange, timeoutErr),
          operation: 'refresh',
          timeoutMs: this.refreshTimeLimitMs,
        },
        'Exchange balance refresh timed out',
      )
      resolveBounded(Err(timeoutErr))
    }, this.refreshTimeLimitMs)

    const underlying = (async (): Promise<Result<ExchangeAccountDto, Error>> =>
      this.refreshBalance(account.id, { signal: controller.signal, reuseUnchangedHistory: true }))()

    void (async (): Promise<void> => {
      try {
        const result = await underlying
        if (isPending()) {
          status = 'settled'
          clearTimeout(timer)
          resolveBounded(result)
        }
      } catch (thrown) {
        if (isPending()) {
          status = 'settled'
          clearTimeout(timer)
          rejectBounded(thrown instanceof Error ? thrown : new Error('Exchange refresh failed'))
        } else if (isTimedOut()) {
          this.logger.debug(
            { accountId: account.id, provider: account.exchange, operation: 'refresh' },
            'Timed-out exchange balance refresh rejected after deadline',
          )
        }
      } finally {
        if (this.batchRefreshes.get(account.id) === entry) {
          this.batchRefreshes.delete(account.id)
        }
      }
    })()

    return bounded
  }

  public refreshAllBalances = asyncFn(async (): Promise<Result<void, Error>> => {
    if (this.refreshAllInFlight !== null) {
      return this.refreshAllInFlight
    }
    const run = this.runRefreshAllBalances().finally(() => {
      if (this.refreshAllInFlight === run) {
        this.refreshAllInFlight = null
      }
    })
    this.refreshAllInFlight = run
    return run
  })

  private async runRefreshAllBalances(): Promise<Result<void, Error>> {
    const accounts = (await this.listAccounts()).filter((account) => account.connectionStatus === 'connected')
    let failedCount = 0

    for (const account of accounts) {
      try {
        const result = await this.refreshBalanceForBatch(account)
        if (result.isErr()) {
          failedCount++
          const err = result.unwrapErr()
          if (!(err instanceof ExchangeRefreshTimeoutError)) {
            this.logProviderWarning(account.exchange, 'refresh', account.id, err, 'Failed to refresh balance')
          }
        }
      } catch (thrown: unknown) {
        failedCount++
        const err = thrown instanceof Error ? thrown : new Error('Unexpected refresh failure')
        this.logProviderWarning(account.exchange, 'refresh', account.id, err, 'Failed to refresh balance')
      }
    }

    if (failedCount > 0 && failedCount === accounts.length) {
      return Err(
        new ExchangeUserError('Failed to refresh exchange balances. Please try again.', 'INTERNAL_SERVER_ERROR'),
      )
    }

    return Ok(undefined)
  }

  // ─── Remove ────────────────────────────────────────────────────────────

  public async removeAccount(accountId: string): Promise<Result<void, Error>> {
    const removed = await this.db.delete(exchangeAccounts).where(eq(exchangeAccounts.id, accountId))
    if (removed.rowsAffected === 0) {
      return Err(new Error('Exchange account not found'))
    }
    this.evictBatchRefresh(accountId)
    this.historyCache.invalidate(accountId)
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
    async (filterAccountIds?: string[]): Promise<Result<ExchangeHistoryEntry[], Error>> => {
      if (filterAccountIds?.length === 0) {
        return Ok([])
      }

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
            filterAccountIds !== undefined ? inArray(exchangeAccounts.id, filterAccountIds) : undefined,
          ),
        )

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getCoinbaseTransactionEntries: queried exchange_accounts',
      )

      const results = await Promise.all(
        rows.map(async (row) => {
          const key: ExchangeHistoryKey = {
            encryptedCredentials: row.encryptedCredentials,
            externalAccountId: row.externalAccountId,
            credentialsConnectedAt: row.credentialsConnectedAt,
          }
          const result = await this.historyCache.get(row.id, key, async () => this.fetchCoinbaseAccountHistory(row))
          return { accountId: row.id, result }
        }),
      )

      const allEntries: ExchangeHistoryEntry[] = []
      let firstErr: Error | null = null
      let succeededCount = 0
      for (const { accountId, result } of results) {
        if (result.isErr()) {
          const err = result.unwrapErr()
          firstErr ??= err
          this.logProviderWarning(
            'coinbase',
            'transactions',
            accountId,
            err,
            'Skipping Coinbase account with incomplete transaction history',
          )
          continue
        }
        succeededCount += 1
        allEntries.push(...result.unwrap())
      }

      if (firstErr !== null && succeededCount === 0) {
        return Err(firstErr)
      }

      this.logger.info({ totalEntries: allEntries.length }, 'getCoinbaseTransactionEntries: complete')

      return Ok(allEntries)
    },
  )

  private async fetchCoinbaseAccountHistory(row: {
    id: string
    encryptedCredentials: string
    externalAccountId: string | null
    credentialsConnectedAt: string | null
  }): Promise<Result<ExchangeHistoryFetchOutput, Error>> {
    const parsedCredentials = parseCredentials(row.encryptedCredentials)
    if (parsedCredentials.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Invalid stored credentials — skipping')
      return Ok({ entries: [] })
    }
    const credData = parsedCredentials.unwrap()

    // Decrypt credentials — skip account on failure
    const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
    if (apiKeyEnc.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to parse apiKey blob — skipping')
      return Ok({ entries: [] })
    }
    const apiKey = apiKeyEnc.unwrap().decrypt()
    if (apiKey.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to decrypt apiKey — skipping')
      return Ok({ entries: [] })
    }

    const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
    if (secretEnc.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to parse secretKey blob — skipping')
      return Ok({ entries: [] })
    }
    const secret = secretEnc.unwrap().decrypt()
    if (secret.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to decrypt secretKey — skipping')
      return Ok({ entries: [] })
    }

    const clientRes = buildStoredCoinbaseClient(apiKey.unwrap(), secret.unwrap(), credData.coinbaseAuth)
    if (clientRes.isErr()) {
      this.logProviderWarning(
        'coinbase',
        'client_init',
        row.id,
        clientRes.unwrapErr(),
        'getCoinbaseTransactionEntries: failed to create Coinbase client — skipping',
      )
      return Ok({ entries: [] })
    }
    const client = clientRes.unwrap()

    // Discover and backfill external_account_id if missing (pre-migration accounts)
    let accountUuid = nonEmpty(row.externalAccountId)
    let resolvedExternalAccountId: string | undefined
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
        return Err(new ExchangeHistoryIncompleteError('coinbase'))
      }
      const btcAccount = pickPrimaryCoinbaseBtcAccount(accountsRes.unwrap())
      if (!btcAccount) {
        this.logger.warn({ accountId: row.id }, 'No BTC account found in Coinbase — skipping')
        return Ok({ entries: [] })
      }
      accountUuid = btcAccount.uuid
      resolvedExternalAccountId = accountUuid
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
    const entries: ExchangeHistoryEntry[] = []
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
        return Err(new ExchangeHistoryIncompleteError('coinbase'))
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
        if (tx.status !== 'completed' || tx.amount.currency !== 'BTC') {
          continue
        }

        const amountSatsRes = parseSignedBtcAmountToSats(tx.amount.amount)
        if (amountSatsRes.isErr()) {
          this.logProviderWarning(
            'coinbase',
            'transactions',
            row.id,
            amountSatsRes.unwrapErr(),
            'Skipped Coinbase transaction with invalid amount',
          )
          continue
        }
        entries.push({
          timestamp: tx.created_at,
          value: amountSatsRes.unwrap(),
        })
      }

      if (pagination.next_uri != null && pagination.next_uri !== '' && transactions.length > 0) {
        startingAfter = transactions[transactions.length - 1]?.id
      } else {
        hasMore = false
      }
    }

    return Ok({ entries, resolvedExternalAccountId })
  }

  // ─── Kraken Transaction History ───────────────────────────────────────

  /**
   * Fetch all BTC ledger entries for all connected Kraken accounts.
   * Returns entries as { timestamp, value } where value is signed satoshis.
   */
  public getKrakenTransactionEntries = asyncFn(
    async (filterAccountIds?: string[]): Promise<Result<ExchangeHistoryEntry[], Error>> => {
      if (filterAccountIds?.length === 0) {
        return Ok([])
      }

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
            eq(exchangeAccounts.provider, 'kraken'),
            filterAccountIds !== undefined ? inArray(exchangeAccounts.id, filterAccountIds) : undefined,
          ),
        )

      this.logger.info(
        { rowCount: rows.length, filterAccountIds },
        'getKrakenTransactionEntries: queried exchange_accounts',
      )

      const results = await Promise.all(
        rows.map(async (row) => {
          const key: ExchangeHistoryKey = {
            encryptedCredentials: row.encryptedCredentials,
            externalAccountId: row.externalAccountId,
            credentialsConnectedAt: row.credentialsConnectedAt,
          }
          const result = await this.historyCache.get(row.id, key, async () => this.fetchKrakenAccountHistory(row))
          return { accountId: row.id, result }
        }),
      )

      const allEntries: ExchangeHistoryEntry[] = []
      let firstErr: Error | null = null
      let succeededCount = 0
      for (const { accountId, result } of results) {
        if (result.isErr()) {
          const err = result.unwrapErr()
          firstErr ??= err
          this.logProviderWarning(
            'kraken',
            'transactions',
            accountId,
            err,
            'Skipping Kraken account with incomplete transaction history',
          )
          continue
        }
        succeededCount += 1
        allEntries.push(...result.unwrap())
      }

      if (firstErr !== null && succeededCount === 0) {
        return Err(firstErr)
      }

      this.logger.info({ totalEntries: allEntries.length }, 'getKrakenTransactionEntries: complete')

      return Ok(allEntries)
    },
  )

  private async fetchKrakenAccountHistory(row: {
    id: string
    encryptedCredentials: string
    externalAccountId: string | null
    credentialsConnectedAt: string | null
  }): Promise<Result<ExchangeHistoryFetchOutput, Error>> {
    const parsedCredentials = parseCredentials(row.encryptedCredentials)
    if (parsedCredentials.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Invalid stored credentials — skipping')
      return Ok({ entries: [] })
    }
    const credData = parsedCredentials.unwrap()

    // Decrypt credentials — skip account on failure
    const apiKeyEnc = Encrypted.fromString(credData.data['apiKey']?.blob ?? '')
    if (apiKeyEnc.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to parse apiKey blob — skipping')
      return Ok({ entries: [] })
    }
    const apiKey = apiKeyEnc.unwrap().decrypt()
    if (apiKey.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to decrypt apiKey — skipping')
      return Ok({ entries: [] })
    }

    const secretEnc = Encrypted.fromString(credData.data['secretKey']?.blob ?? '')
    if (secretEnc.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to parse secretKey blob — skipping')
      return Ok({ entries: [] })
    }
    const secret = secretEnc.unwrap().decrypt()
    if (secret.isErr()) {
      this.logger.warn({ accountId: row.id }, 'Failed to decrypt secretKey — skipping')
      return Ok({ entries: [] })
    }

    const client = new Kraken.Client({ apiKey: apiKey.unwrap(), secretKey: secret.unwrap() })

    // Paginate through all BTC ledger entries using offset
    const entries: ExchangeHistoryEntry[] = []
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
        return Err(new ExchangeHistoryIncompleteError('kraken'))
      }

      const { data } = ledgersResult.unwrap()
      const ledgerEntries = data.ledger ? Object.values(data.ledger) : []

      this.logger.info(
        { accountId: row.id, entryCount: ledgerEntries.length, offset },
        'getKrakenTransactionEntries: page fetched',
      )

      for (const entry of ledgerEntries) {
        const amountSatsRes = parseSignedBtcNetToSats(entry.amount, entry.fee)
        if (amountSatsRes.isErr()) {
          this.logProviderWarning(
            'kraken',
            'transactions',
            row.id,
            amountSatsRes.unwrapErr(),
            'Skipped Kraken ledger entry with invalid amount',
          )
          continue
        }
        const amountSats = amountSatsRes.unwrap()
        if (amountSats !== 0n) {
          entries.push({
            timestamp: new Date(entry.time * 1000),
            value: amountSats,
          })
        }
      }

      const totalCount = data.count ?? 0
      offset += ledgerEntries.length
      if (ledgerEntries.length === 0 || offset >= totalCount) {
        hasMore = false
      }
    }

    return Ok({ entries })
  }

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

  private invalidCredentialsError(provider: SupportedExchange): ExchangeUserError {
    if (provider === 'coinbase') {
      return new ExchangeUserError(
        'Invalid Coinbase API credentials. Check your API Key ID, Read permission, and IP settings in Coinbase.',
        'BAD_REQUEST',
      )
    }
    return new ExchangeUserError(
      `Invalid ${EXCHANGE_DISPLAY_NAMES[provider]} API credentials. Check your key and permissions, then try again.`,
      'BAD_REQUEST',
    )
  }

  private toSafeConnectError(provider: SupportedExchange, err: Error): ExchangeUserError {
    if (provider === 'coinbase' && err instanceof Coinbase.CoinbaseKeyFormatError) {
      this.logger.warn({ provider, errorKind: err.name }, 'Rejected malformed Coinbase API key secret')
      return new ExchangeUserError(
        'This is not a valid API Key Secret. Copy it from Coinbase and paste it again.',
        'BAD_REQUEST',
      )
    }
    this.logProviderFailure(provider, 'connect', err)
    const displayName = EXCHANGE_DISPLAY_NAMES[provider]
    if (isRetryableProviderFailure(provider, err)) {
      return new ExchangeUserError(
        `Couldn't connect to ${displayName} right now. Please try again.`,
        'INTERNAL_SERVER_ERROR',
      )
    }
    if (classifyProviderFailure(provider, err) !== 'transient') {
      return this.invalidCredentialsError(provider)
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

  private evictBatchRefresh(accountId: string): void {
    const entry = this.batchRefreshes.get(accountId)
    if (entry !== undefined) {
      entry.controller.abort()
      this.batchRefreshes.delete(accountId)
    }
  }

  private async updateCredentialMetadata(
    accountId: string,
    expectedGeneration: CredentialGenerationSnapshot,
    change: CredentialMetadataChange,
    signal?: AbortSignal,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (isSignalAborted(signal)) {
        return
      }
      const outcome = await this.db.transaction(async (tx): Promise<'updated' | 'skip' | 'retry'> => {
        if (isSignalAborted(signal)) {
          return 'skip'
        }
        const [current] = await tx
          .select({
            credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
            encryptedCredentials: exchangeAccounts.encryptedCredentials,
          })
          .from(exchangeAccounts)
          .where(eq(exchangeAccounts.id, accountId))

        if (isSignalAborted(signal) || !current || !isSameCredentialGeneration(current, expectedGeneration)) {
          return 'skip'
        }

        const parsed = parseCredentials(current.encryptedCredentials)
        if (parsed.isErr()) {
          return 'skip'
        }
        const credData = parsed.unwrap()
        if (
          'portfolioUuid' in change
            ? nonEmpty(credData.portfolioUuid) !== undefined
            : credData.credentialsRevoked === true
        ) {
          return 'skip'
        }

        const rowsAffected = await writeCredentials(
          tx,
          createCredentialMetadataChange({
            accountId,
            previousCredentials: current.encryptedCredentials,
            change,
          }),
        )
        return rowsAffected === 1 ? 'updated' : 'retry'
      })
      if (outcome !== 'retry') {
        if (outcome === 'updated' && 'credentialsRevoked' in change) {
          this.historyCache.invalidate(accountId)
        }
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
    signal?: AbortSignal,
  ): Promise<void> {
    if (isSignalAborted(signal)) {
      return
    }
    await this.db.transaction(async (tx) => {
      if (isSignalAborted(signal)) {
        return
      }
      const [current] = await tx
        .select({
          credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
          encryptedCredentials: exchangeAccounts.encryptedCredentials,
        })
        .from(exchangeAccounts)
        .where(eq(exchangeAccounts.id, accountId))

      if (isSignalAborted(signal) || !current || !isSameCredentialGeneration(current, expectedGeneration)) {
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

  private staleReconnectError(): ExchangeUserError {
    return new ExchangeUserError(
      'Exchange account credentials changed during reconnect. Please try again.',
      'INTERNAL_SERVER_ERROR',
    )
  }

  private async resolveEarlyReconnectError(args: {
    provider: SupportedExchange
    accountId: string
    expectedGeneration: CredentialGenerationSnapshot
    resolvedOldIdentity?: ResolvedOldIdentity
    error: Error
  }): Promise<Error> {
    const status = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          credentialsConnectedAt: exchangeAccounts.credentialsConnectedAt,
          encryptedCredentials: exchangeAccounts.encryptedCredentials,
        })
        .from(exchangeAccounts)
        .where(eq(exchangeAccounts.id, args.accountId))

      if (!current) {
        return 'not_found' as const
      }
      if (!isSameCredentialGeneration(current, args.expectedGeneration)) {
        return 'stale' as const
      }

      const resolved = args.resolvedOldIdentity
      if (resolved !== undefined && isSameCredentialGeneration(current, resolved.expectedGeneration)) {
        if (resolved.externalAccountId !== undefined) {
          await tx
            .update(exchangeAccounts)
            .set({ externalAccountId: resolved.externalAccountId })
            .where(
              and(
                eq(exchangeAccounts.id, args.accountId),
                eq(exchangeAccounts.encryptedCredentials, current.encryptedCredentials),
                or(isNull(exchangeAccounts.externalAccountId), eq(exchangeAccounts.externalAccountId, '')),
              ),
            )
        }
        if (resolved.portfolioUuid !== undefined) {
          const parsed = parseCredentials(current.encryptedCredentials)
          if (parsed.isOk() && nonEmpty(parsed.unwrap().portfolioUuid) === undefined) {
            await writeCredentials(
              tx,
              createCredentialMetadataChange({
                accountId: args.accountId,
                previousCredentials: current.encryptedCredentials,
                change: { portfolioUuid: resolved.portfolioUuid },
              }),
            )
          }
        }
      }

      return 'matched' as const
    })

    if (status === 'not_found') {
      return new ExchangeUserError('Exchange account not found', 'NOT_FOUND')
    }
    if (status === 'stale') {
      return this.staleReconnectError()
    }

    if (args.error instanceof ExchangeAccountMismatchError) {
      this.logger.warn(
        { accountId: args.accountId, provider: args.provider },
        'Rejected exchange reconnect: API key belongs to a different account',
      )
    }
    return args.error
  }

  private async resolveCoinbaseIdentityFromOldKey(
    existing: ReconnectTarget,
    needs: { needAccountUuid: boolean; needPortfolioUuid: boolean },
  ): Promise<Result<ResolvedOldIdentity, Error>> {
    const hasAnyStoredId = !needs.needAccountUuid || !needs.needPortfolioUuid
    const expectedGeneration: CredentialGenerationSnapshot = {
      credentialsConnectedAt: existing.credentialsConnectedAt,
      encryptedCredentials: existing.encryptedCredentials,
    }

    const parsed = parseCredentials(existing.encryptedCredentials)
    if (parsed.isErr()) {
      return hasAnyStoredId ? Ok({ expectedGeneration }) : Err(new ExchangeAccountUnverifiableError('coinbase'))
    }
    const credData = parsed.unwrap()
    const apiKeyRes = decryptCredentialField(credData, 'apiKey')
    const secretRes = decryptCredentialField(credData, 'secretKey')
    if (apiKeyRes.isErr() || secretRes.isErr()) {
      return hasAnyStoredId ? Ok({ expectedGeneration }) : Err(new ExchangeAccountUnverifiableError('coinbase'))
    }

    const clientRes = buildStoredCoinbaseClient(apiKeyRes.unwrap(), secretRes.unwrap(), credData.coinbaseAuth)
    if (clientRes.isErr()) {
      return hasAnyStoredId ? Ok({ expectedGeneration }) : Err(new ExchangeAccountUnverifiableError('coinbase'))
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
          return hasAnyStoredId ? Ok({ expectedGeneration }) : Err(new ExchangeAccountUnverifiableError('coinbase'))
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
          const oldDetailAccount = readCoinbaseBtcAccount(accountRes.unwrap().data.account, existingUuid)
          if (oldDetailAccount.isOk()) {
            portfolioUuid = nonEmpty(oldDetailAccount.unwrap().retail_portfolio_id)
          }
        }
      }
    }

    if (!hasAnyStoredId && accountUuid === undefined && portfolioUuid === undefined) {
      return Err(new ExchangeAccountUnverifiableError('coinbase'))
    }

    return Ok({ externalAccountId: accountUuid, portfolioUuid, expectedGeneration })
  }

  private async resolveKrakenIdentityFromOldKey(
    existing: ReconnectTarget,
  ): Promise<Result<ResolvedOldIdentity & { externalAccountId: string }, Error>> {
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
    return Ok({ externalAccountId: normalizedId, expectedGeneration })
  }

  private async resolveRobinhoodIdentityFromOldKey(
    existing: ReconnectTarget,
  ): Promise<Result<ResolvedOldIdentity & { externalAccountId: string }, Error>> {
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
    return Ok({ externalAccountId: oldId, expectedGeneration })
  }

  private async saveConnectedAccount(args: {
    provider: SupportedExchange
    replaceAccountId?: string
    displayName: string
    credentialData: CredentialData
    balanceSats: ValidatedSats
    balanceAsOf: string
    credentialsConnectedAt: string
    externalAccountId?: string
    expectedGeneration?: CredentialGenerationSnapshot
    resolvedOldIdentity?: ResolvedOldIdentity
  }): Promise<Result<{ id: string; createdAt: string }, Error>> {
    const saved = await this.db.transaction(async (tx) => {
      if (args.replaceAccountId != null && args.replaceAccountId !== '') {
        const replaceAccountId = args.replaceAccountId
        const [existing] = await tx
          .select({
            provider: exchangeAccounts.provider,
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
        if (existing.provider !== args.provider) {
          return Err(
            new ExchangeUserError(
              `Cannot reconnect ${args.provider} credentials to a ${existing.provider} account`,
              'BAD_REQUEST',
            ),
          )
        }

        if (args.expectedGeneration !== undefined && !isSameCredentialGeneration(existing, args.expectedGeneration)) {
          return Err(this.staleReconnectError())
        }

        const resolvedMatchesGeneration =
          args.resolvedOldIdentity !== undefined &&
          isSameCredentialGeneration(existing, args.resolvedOldIdentity.expectedGeneration)
        const effectiveExternalAccountId =
          nonEmpty(existing.externalAccountId) ??
          (resolvedMatchesGeneration ? args.resolvedOldIdentity?.externalAccountId : undefined)
        const effectivePortfolioUuid =
          readStoredPortfolioUuid(existing.encryptedCredentials) ??
          (resolvedMatchesGeneration ? args.resolvedOldIdentity?.portfolioUuid : undefined)

        const verifiedResult = verifyReconnectIdentity({
          accountId: replaceAccountId,
          provider: args.provider,
          existingExternalAccountId: effectiveExternalAccountId ?? null,
          dbExternalAccountId: existing.externalAccountId,
          existingPortfolioUuid: effectivePortfolioUuid,
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
    if (saved.isOk()) {
      const savedId = saved.unwrap().id
      if (args.replaceAccountId != null && args.replaceAccountId !== '') {
        this.evictBatchRefresh(savedId)
      }
      this.historyCache.invalidate(savedId)
    }

    return saved
  }

  private async applyVerifiedReconnectUpdate(
    tx: ExchangeTransaction,
    verified: VerifiedReconnectIdentity,
    args: {
      existingCreatedAt: string
      displayName: string
      credentialData: CredentialData
      balanceSats: ValidatedSats
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
