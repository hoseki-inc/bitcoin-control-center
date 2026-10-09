import { Account } from '@hoseki/packages/bitcoin/account'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { STATEMENT_CLOSING_DELAY_DAYS, getLatestStatementClosingDate } from '@hoseki/packages/lib/statement-dates'
import { parseUnknown } from '@hoseki/packages/result'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import Decimal from 'decimal.js'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import { z } from 'zod'
import type { SentinelDb } from '../../db/drizzle'
import { accounts, exchangeBalanceSnapshots, statementCounter, statements } from '../../db/schema'
import type { ExchangeService } from '../exchange/service'
import type { DailyRates } from '../price/daily_rates'
import type { DailyRatesService } from '../price/daily_rates'
import type { AggregatedTransaction, StatementAccountTransactions } from './mapper'
import { getRequiredRateDates, validateStatementRates } from './rate_dates'
import { fetchTransactionEntries } from './tx_fetcher'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatementTransactions {
  [accountId: string]: StatementAccountTransactions
}

export interface StatementDto {
  id: string
  createdAt: Date
  updatedAt: Date
  counter: number
  timezone: string
  openingDate: Date
  closingDate: Date
  status: 'pending' | 'completed' | 'failed'
  user: { name: string | null; email: string | null }
  integrator: { name: string } | null
  userId: string
  quoteCurrency: StatementQuoteCurrency
  errorMessage: string | null
}

type StatementRow = typeof statements.$inferSelect

export interface GenerateStatementInput {
  quoteCurrency?: StatementQuoteCurrency
  claimIds: string[]
  exchangeAccountIds?: string[]
  openingDate: Date
  closingDate: Date
  timezone: string
  name?: string | null
  address?: string | null
}

const SerializedAggregatedTransactionSchema = z
  .object({
    address: z.string(),
    hash: z.string(),
    balanceChange: z.string(),
    block: z.number().nullable(),
    transactedAt: z.string(),
    confirmed: z.boolean(),
    accountName: z.string(),
  })
  .passthrough()
type SerializedAggregatedTransaction = z.infer<typeof SerializedAggregatedTransactionSchema>

const SerializedDailyRateSchema = z.object({
  timestamp: z.string(),
  providerUrl: z.string().optional(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
})
type SerializedDailyRate = z.infer<typeof SerializedDailyRateSchema>

const MAX_STATEMENT_RANGE_YEARS = 2
const MAX_STATEMENT_RANGE_DAYS = MAX_STATEMENT_RANGE_YEARS * 366
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Accepts any zone the runtime can format: aliases such as Asia/Kolkata, fixed offsets such as
 * Etc/GMT+8 or +05:30, and names in any letter case. Browsers report some of these, but
 * Intl.supportedValuesOf omits them.
 */
function isUsableTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}

export function validateStatementInput(input: GenerateStatementInput, now = new Date()): Result<void, Error> {
  const { openingDate, closingDate } = input
  if (parseUnknown(StatementQuoteCurrencySchema, input.quoteCurrency ?? 'USD').isErr()) {
    return Err(new Error('Unsupported statement quote currency.'))
  }
  if (!isUsableTimezone(input.timezone)) {
    return Err(new Error('Invalid statement timezone.'))
  }
  if (Number.isNaN(openingDate.getTime()) || Number.isNaN(closingDate.getTime())) {
    return Err(new Error('Statement dates must be valid'))
  }

  if (openingDate > closingDate) {
    return Err(new Error('Statement opening date must be before closing date'))
  }

  const latestClosingDate = getLatestStatementClosingDate(now, input.timezone)
  if (latestClosingDate.isErr()) {
    return Err(latestClosingDate.unwrapErr())
  }
  if (closingDate > latestClosingDate.unwrap()) {
    return Err(
      new Error(
        `Statements must end at least ${STATEMENT_CLOSING_DELAY_DAYS} days ago, so recent transactions have time to confirm`,
      ),
    )
  }
  if (closingDate > now) {
    return Err(new Error('Statement dates cannot be in the future.'))
  }

  const rangeDays = Math.ceil((closingDate.getTime() - openingDate.getTime()) / MS_PER_DAY) + 1
  if (rangeDays > MAX_STATEMENT_RANGE_DAYS) {
    return Err(new Error(`Statement date range cannot exceed ${MAX_STATEMENT_RANGE_YEARS} years`))
  }

  return Ok(undefined)
}

// ─── Service ────────────────────────────────────────────────────────────────

export class StatementService {
  private readonly db: SentinelDb
  private readonly onchainProvider: ElectrumProvider
  private readonly dailyRatesService: DailyRatesService
  private readonly exchangeService: ExchangeService
  private readonly mempoolApiUrl: string
  private readonly logger: Logger
  private readonly sleep: ((ms: number) => Promise<void>) | undefined

  public constructor(deps: {
    db: SentinelDb
    onchainProvider: ElectrumProvider
    dailyRatesService: DailyRatesService
    exchangeService: ExchangeService
    mempoolApiUrl: string
    logger: Logger
    /** Waits between transaction lookup retries; tests replace it to avoid real delays. */
    sleep?: (ms: number) => Promise<void>
  }) {
    this.db = deps.db
    this.onchainProvider = deps.onchainProvider
    this.dailyRatesService = deps.dailyRatesService
    this.exchangeService = deps.exchangeService
    this.mempoolApiUrl = deps.mempoolApiUrl
    this.logger = deps.logger.child({ module: 'statement-service' })
    this.sleep = deps.sleep
  }

  /** Insert a pending statement row. */
  public async create(input: GenerateStatementInput): Promise<Result<string, Error>> {
    const valid = validateStatementInput(input)
    if (valid.isErr()) {
      return Err(valid.unwrapErr())
    }
    const id = `st_stmt_${nanoid()}`
    await this.db.transaction(async (tx) => {
      const [next] = await tx
        .update(statementCounter)
        .set({ lastCounter: sql`${statementCounter.lastCounter} + 1` })
        .where(eq(statementCounter.id, 1))
        .returning({ counter: statementCounter.lastCounter })
      if (next === undefined) {
        throw new Error('Statement counter is missing')
      }
      await tx.insert(statements).values({
        id,
        status: 'pending',
        timezone: input.timezone,
        openingDate: input.openingDate.toISOString(),
        closingDate: input.closingDate.toISOString(),
        accountIds: JSON.stringify(input.claimIds),
        exchangeAccountIds: input.exchangeAccountIds ? JSON.stringify(input.exchangeAccountIds) : null,
        userName: input.name ?? null,
        userAddress: input.address ?? null,
        quoteCurrency: input.quoteCurrency ?? 'USD',
        counter: next.counter,
      })
    })

    return Ok(id)
  }

  /** Mark a statement as completed with transaction data. */
  public async complete(
    id: string,
    transactionMap: StatementTransactions,
    dailyRates: DailyRates,
  ): Promise<Result<void, Error>> {
    const [row] = await this.db.select().from(statements).where(eq(statements.id, id))
    if (row?.status !== 'pending') {
      return Err(new Error('Statement is not pending.'))
    }
    if (row.quoteCurrency !== dailyRates.quoteCurrency) {
      return Err(new Error('Statement quote currency does not match its saved rates.'))
    }
    const dates = getRequiredRateDates(
      new Date(row.openingDate),
      new Date(row.closingDate),
      row.timezone,
      transactionMap,
    )
    const valid = validateStatementRates(dates, dailyRates)
    if (valid.isErr()) {
      return Err(valid.unwrapErr())
    }
    // Serialize bigint values in transactionMap to strings for JSON storage
    const serializedMap: Record<string, { displayName: string; transactions: SerializedAggregatedTransaction[] }> = {}
    for (const [key, account] of Object.entries(transactionMap)) {
      serializedMap[key] = {
        displayName: account.displayName,
        // oxlint-disable-next-line oxc/no-map-spread -- Preserve caller-owned transactions while converting values for storage.
        transactions: account.transactions.map((tx) => ({
          ...tx,
          balanceChange: tx.balanceChange.toString(),
          transactedAt: tx.transactedAt.toISOString(),
        })),
      }
    }

    // Serialize Decimal values in dailyRates
    const serializedRates: Record<string, SerializedDailyRate> = {}
    for (const [key, rate] of Object.entries(dailyRates.rates)) {
      serializedRates[key] = {
        timestamp: rate.timestamp.toISOString(),
        providerUrl: rate.providerUrl,
        open: rate.open.toString(),
        high: rate.high.toString(),
        low: rate.low.toString(),
        close: rate.close.toString(),
      }
    }

    const [completed] = await this.db
      .update(statements)
      .set({
        status: 'completed',
        transactionMap: JSON.stringify(serializedMap),
        dailyRates: JSON.stringify({
          rates: serializedRates,
          source: dailyRates.source,
          quoteCurrency: dailyRates.quoteCurrency,
          providerUrl: dailyRates.providerUrl,
          providerUrls: dailyRates.providerUrls,
        }),
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(statements.id, id), eq(statements.status, 'pending')))
      .returning({ id: statements.id })
    if (completed === undefined) {
      return Err(new Error('Statement is not pending.'))
    }
    return Ok(undefined)
  }

  /** Mark a statement as failed. */
  public async fail(id: string, message = 'Statement generation failed. Please retry.'): Promise<void> {
    await this.db
      .update(statements)
      .set({ status: 'failed', errorMessage: message, updatedAt: sql`datetime('now')` })
      .where(and(eq(statements.id, id), eq(statements.status, 'pending')))
  }

  /** Find a statement by ID and return its DTO. */
  public async findById(id: string): Promise<StatementDto | null> {
    const [row] = await this.db.select().from(statements).where(eq(statements.id, id))
    if (!row) {
      return null
    }
    return this.rowToDto(row)
  }

  /** Load a completed statement with deserialized transaction data. */
  public async loadCompleted(
    id: string,
  ): Promise<{ row: StatementRow; transactionMap: StatementTransactions; dailyRates: DailyRates } | null> {
    const [row] = await this.db
      .select()
      .from(statements)
      .where(and(eq(statements.id, id), eq(statements.status, 'completed')))
    if (!row) {
      return null
    }

    if (row.transactionMap == null || row.dailyRates == null) {
      throw new Error('Stored completed statement is missing transaction data')
    }
    return {
      row,
      transactionMap: this.deserializeTransactionMap(row.transactionMap),
      dailyRates: this.deserializeDailyRates(row.dailyRates),
    }
  }

  /** List all statements as DTOs. */
  public async list(): Promise<StatementDto[]> {
    const rows = await this.db.select().from(statements).orderBy(desc(statements.createdAt))
    return rows.map((row) => this.rowToDto(row))
  }

  /** Orchestrate the full statement data pipeline: fetch transactions + daily rates. */
  public generateStatementData = asyncFn(
    async (
      input: GenerateStatementInput,
    ): Promise<Result<{ transactionMap: StatementTransactions; dailyRates: DailyRates }, Error>> => {
      const validation = validateStatementInput(input)
      if (validation.isErr()) {
        return Err(validation.unwrapErr())
      }

      this.logger.info(
        {
          claimIds: input.claimIds,
          exchangeAccountIds: input.exchangeAccountIds,
          openingDate: input.openingDate,
          closingDate: input.closingDate,
        },
        'Generating statement data',
      )

      const transactionMap: StatementTransactions = {}

      // 1. Look up on-chain account descriptors
      const claimIds = [...new Set(input.claimIds)]
      const accountRows = await this.getAccountRows(claimIds)
      const hasOnchainAccounts = accountRows.length > 0
      const hasExchangeAccounts = (input.exchangeAccountIds?.length ?? 0) > 0

      if (accountRows.length !== claimIds.length) {
        return Err(new Error('One or more selected accounts were not found'))
      }

      const unverified = accountRows.find((row) => row.status !== 'verified')
      if (unverified) {
        return Err(new Error(`Account "${unverified.display_name}" must be verified before generating a statement`))
      }

      if (!hasOnchainAccounts && !hasExchangeAccounts) {
        return Err(new Error('No accounts found for the provided IDs'))
      }

      // 2. Fetch on-chain transactions for each account
      if (hasOnchainAccounts) {
        this.logger.info({ accountCount: accountRows.length }, 'Found on-chain accounts for statement')
        for (const [i, row] of accountRows.entries()) {
          this.logger.info(
            { account: row.display_name, index: i + 1, total: accountRows.length },
            'Fetching transactions for account',
          )
          const accountResult = Account.fromDescriptor(row.descriptor)
          if (accountResult.isErr()) {
            this.logger.warn({ accountId: row.id }, 'Failed to parse descriptor')
            continue
          }

          const [activeAccount] = await this.db
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.id, row.id), isNull(accounts.deletedAt)))
          if (activeAccount === undefined) {
            return Err(new Error(`Account "${row.display_name}" was archived while generating the statement`))
          }

          const txResult = await fetchTransactionEntries({
            account: accountResult.unwrap(),
            onchainProvider: this.onchainProvider,
            mempoolApiUrl: this.mempoolApiUrl,
            logger: this.logger,
            sleep: this.sleep,
          })
          if (txResult.isErr()) {
            this.logger.error({ accountId: row.id, err: txResult.unwrapErr() }, 'Failed to fetch transactions')
            return Err(txResult.unwrapErr())
          }

          const entries = txResult.unwrap()
          const aggregated = calculateAccountTransactions(entries, row.display_name)
          const sorted = sortTxs(aggregated)
          transactionMap[row.id] = { displayName: row.display_name, transactions: sorted }
          this.logger.info(
            { account: row.display_name, rawEntries: entries.length, aggregated: aggregated.length },
            'Account transactions fetched',
          )
        }
      }

      // 3. Fetch exchange account data
      if (hasExchangeAccounts) {
        const exchangeAccountIds = input.exchangeAccountIds ?? []
        const allExchangeAccounts = await this.exchangeService.listAccounts()
        const selectedAccounts = allExchangeAccounts.filter((a) => exchangeAccountIds.includes(a.id))
        this.logger.info({ exchangeAccountCount: selectedAccounts.length }, 'Found exchange accounts for statement')

        const disconnectedAccounts = selectedAccounts.filter((a) => a.connectionStatus === 'needs_reconnect')
        if (disconnectedAccounts.length > 0) {
          return Err(
            new Error(
              `Reconnect exchange accounts before generating a statement: ${disconnectedAccounts
                .map((account) => account.displayName)
                .join(', ')}`,
            ),
          )
        }

        // Coinbase: fetch real transaction history
        const coinbaseAccounts = selectedAccounts.filter((a) => a.exchange === 'coinbase')
        for (const account of coinbaseAccounts) {
          const coinbaseEntries = await this.exchangeService.getCoinbaseTransactionEntries([account.id])
          if (coinbaseEntries.isOk()) {
            const entries = coinbaseEntries.unwrap()
            const label = exchangeStatementName(account)
            const aggregated: AggregatedTransaction[] = entries.map((entry, idx) => ({
              address: '',
              hash: `coinbase_${account.id}_${idx}`,
              balanceChange: entry.value,
              block: null,
              transactedAt: entry.timestamp,
              confirmed: true,
              accountName: label,
            }))
            transactionMap[account.id] = { displayName: label, transactions: sortTxs(aggregated) }
            this.logger.info({ account: label, entries: aggregated.length }, 'Coinbase transactions added to statement')
          } else {
            this.logger.warn(
              { err: coinbaseEntries.unwrapErr() },
              'Failed to fetch Coinbase transactions for statement',
            )
          }
        }

        // Non-Coinbase exchanges: prefer imported statement transactions, fall back to snapshot deltas
        const snapshotAccounts = selectedAccounts.filter((a) => a.exchange !== 'coinbase')
        for (const account of snapshotAccounts) {
          const label = exchangeStatementName(account)

          // Check for imported statement transactions — aggregate to daily net in/out
          const stmtTxs = await this.exchangeService.listStatementTransactions(account.id)
          if (stmtTxs.length > 0) {
            const dailyAgg = new Map<string, { netIn: bigint; netOut: bigint; date: Date }>()
            for (const tx of stmtTxs) {
              const txDate = new Date(tx.transactedAt)
              const dayKey = txDate.toISOString().slice(0, 10)
              // Use noon UTC so the date displays correctly in any timezone
              const noonUtc = new Date(dayKey + 'T12:00:00.000Z')
              const existing = dailyAgg.get(dayKey) ?? { netIn: 0n, netOut: 0n, date: noonUtc }
              const sats = BigInt(Math.round(parseFloat(tx.amountBtc) * 1e8))
              if (sats > 0n) {
                existing.netIn += sats
              } else if (sats < 0n) {
                existing.netOut += sats
              }
              dailyAgg.set(dayKey, existing)
            }

            const aggregated: AggregatedTransaction[] = []
            let idx = 0
            for (const [, { netIn, netOut, date }] of dailyAgg) {
              // Money in and money out are separate rows (PDF has separate columns)
              if (netIn > 0n) {
                aggregated.push({
                  address: '',
                  hash: `stmt_in_${account.id}_${idx}`,
                  balanceChange: netIn,
                  block: null,
                  transactedAt: date,
                  confirmed: true,
                  accountName: label,
                })
                idx++
              }
              if (netOut < 0n) {
                aggregated.push({
                  address: '',
                  hash: `stmt_out_${account.id}_${idx}`,
                  balanceChange: netOut,
                  block: null,
                  transactedAt: date,
                  confirmed: true,
                  accountName: label,
                })
                idx++
              }
            }
            transactionMap[account.id] = { displayName: label, transactions: sortTxs(aggregated) }
            this.logger.info(
              { account: label, rawTxCount: stmtTxs.length, dailyEntries: aggregated.length },
              'Daily-aggregated statement transactions added to statement',
            )
          } else {
            // Fall back to snapshot deltas
            const snapshots = await this.getExchangeSnapshots(account.id)

            const dailyBalances = new Map<string, { balance: bigint; date: Date }>()
            for (const snapshot of snapshots) {
              const date = new Date(snapshot.timestamp)
              const dayKey = date.toISOString().slice(0, 10)
              dailyBalances.set(dayKey, { balance: BigInt(snapshot.balance_sats), date })
            }

            const aggregated: AggregatedTransaction[] = []
            let previousBalance = 0n
            let idx = 0
            for (const [, { balance, date }] of dailyBalances) {
              const delta = balance - previousBalance
              if (delta !== 0n) {
                aggregated.push({
                  address: '',
                  hash: `snapshot_${account.id}_${idx}`,
                  balanceChange: delta,
                  block: null,
                  transactedAt: date,
                  confirmed: true,
                  accountName: label,
                })
                idx++
              }
              previousBalance = balance
            }
            transactionMap[account.id] = { displayName: label, transactions: sortTxs(aggregated) }
            this.logger.info(
              { account: label, snapshots: snapshots.length, dailyEntries: aggregated.length },
              'Snapshot-based exchange transactions added to statement',
            )
          }
        }
      }

      // 4. Fetch daily rates for the date range
      this.logger.info('Fetching daily rates from mempool.space')
      const requiredDates = getRequiredRateDates(input.openingDate, input.closingDate, input.timezone, transactionMap)
      const ratesResult = await this.dailyRatesService.getDailyRates(
        input.openingDate,
        input.closingDate,
        input.quoteCurrency ?? 'USD',
        requiredDates,
      )
      if (ratesResult.isErr()) {
        this.logger.error({ err: ratesResult.unwrapErr().message }, 'Failed to fetch daily rates')
        return Err(ratesResult.unwrapErr())
      }
      const coverage = validateStatementRates(requiredDates, ratesResult.unwrap())
      if (coverage.isErr()) {
        return Err(coverage.unwrapErr())
      }
      this.logger.info('Statement data generation complete')

      return Ok({ transactionMap, dailyRates: ratesResult.unwrap() })
    },
  )

  // ─── Private helpers ────────────────────────────────────────────────────────

  private async getAccountRows(
    claimIds: string[],
  ): Promise<Array<{ id: string; descriptor: string; display_name: string; network: string; status: string }>> {
    if (claimIds.length === 0) {
      return []
    }
    return this.db
      .select({
        id: accounts.id,
        descriptor: accounts.descriptor,
        display_name: accounts.displayName,
        network: accounts.network,
        status: accounts.status,
      })
      .from(accounts)
      .where(and(inArray(accounts.id, claimIds), isNull(accounts.deletedAt)))
  }

  private async getExchangeSnapshots(accountId: string): Promise<Array<{ balance_sats: string; timestamp: string }>> {
    return this.db
      .select({ balance_sats: exchangeBalanceSnapshots.balanceSats, timestamp: exchangeBalanceSnapshots.timestamp })
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, accountId))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))
  }

  private rowToDto(row: StatementRow): StatementDto {
    return {
      id: row.id,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
      counter: row.counter,
      timezone: row.timezone,
      openingDate: new Date(row.openingDate),
      closingDate: new Date(row.closingDate),
      status: row.status,
      user: { name: row.userName, email: null },
      integrator: null,
      userId: 'local',
      quoteCurrency: row.quoteCurrency,
      errorMessage: row.errorMessage,
    }
  }

  private deserializeTransactionMap(json: string): StatementTransactions {
    // SAFETY: Database JSON is untrusted until the schema below validates the complete transaction map.
    const raw = parseUnknown(
      z.record(
        z.union([
          z.array(SerializedAggregatedTransactionSchema),
          z.object({ displayName: z.string(), transactions: z.array(SerializedAggregatedTransactionSchema) }),
        ]),
      ),
      JSON.parse(json) as unknown,
    ).expect('Stored statement transactions are invalid')
    const result: StatementTransactions = {}
    for (const [key, value] of Object.entries(raw)) {
      // Older completed statements used the display name as the key.
      const displayName = Array.isArray(value) ? key : value.displayName
      const txs = Array.isArray(value) ? value : value.transactions
      result[key] = {
        displayName,
        // oxlint-disable-next-line oxc/no-map-spread -- Preserve additional stored fields in a new object with restored value types.
        transactions: txs.map((tx) => ({
          ...tx,
          balanceChange: BigInt(tx.balanceChange),
          transactedAt: new Date(tx.transactedAt),
        })),
      }
    }
    return result
  }

  private deserializeDailyRates(json: string): DailyRates {
    // SAFETY: Database JSON is untrusted until the schema below validates the complete daily-rate payload.
    const raw = parseUnknown(
      z.object({
        rates: z.record(SerializedDailyRateSchema),
        source: z.literal('mempool'),
        quoteCurrency: StatementQuoteCurrencySchema.optional(),
        providerUrl: z.string().optional(),
        providerUrls: z.array(z.string()).optional(),
      }),
      JSON.parse(json) as unknown,
    ).expect('Stored statement rates are invalid')
    const rates: DailyRates['rates'] = {}
    for (const [key, rate] of Object.entries(raw.rates)) {
      rates[key] = {
        timestamp: new Date(rate.timestamp),
        providerUrl: rate.providerUrl,
        open: new Decimal(rate.open),
        high: new Decimal(rate.high),
        low: new Decimal(rate.low),
        close: new Decimal(rate.close),
      }
    }
    return {
      rates,
      source: raw.source,
      quoteCurrency: raw.quoteCurrency ?? 'USD',
      providerUrl: raw.providerUrl,
      providerUrls: raw.providerUrls,
    }
  }
}

// ─── Transaction aggregation ────────────────────────────────────────────────

/**
 * Groups TransactionEntry[] by txid and sums the values to produce
 * one AggregatedTransaction per unique txid.
 */
function calculateAccountTransactions(
  accountTransactions: TransactionEntry[],
  accountName: string,
): AggregatedTransaction[] {
  const grouped = new Map<string, TransactionEntry[]>()
  for (const tx of accountTransactions) {
    const hash = tx.txid.toString()
    const group = grouped.get(hash) ?? []
    group.push(tx)
    grouped.set(hash, group)
  }

  const transactions: AggregatedTransaction[] = []

  for (const groupedTransactions of grouped.values()) {
    if (groupedTransactions.length === 0) {
      continue
    }

    let sum = 0n
    for (const tx of groupedTransactions) {
      sum += tx.value
    }

    const firstTx = groupedTransactions[0]
    if (!firstTx) {
      continue
    }

    transactions.push({
      address: firstTx.address.toString(),
      hash: firstTx.txid.toString(),
      balanceChange: sum,
      block: firstTx.blockHeight,
      transactedAt: firstTx.timestamp,
      confirmed: firstTx.confirmed,
      accountName,
    })
  }

  return transactions
}

/** Sort transactions ascending by date, tiebreak by txid hash. */
function sortTxs<T extends { hash: string; transactedAt: Date }>(txs: T[]): T[] {
  return txs.sort((a, b) => {
    const dateA = a.transactedAt.getTime()
    const dateB = b.transactedAt.getTime()
    if (dateA !== dateB) {
      return dateA - dateB
    }
    return a.hash.localeCompare(b.hash)
  })
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Names an exchange account in a statement by the name its owner gave it. */
function exchangeStatementName(account: { exchange: string; displayName: string }): string {
  const name = account.displayName.trim()
  return name === '' ? capitalize(account.exchange) : name
}
