import { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import type { Block, TransactionEntry } from '@hoseki/packages/bitcoin/onchain'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { IndexMap, IndexSet } from '@hoseki/packages/collection'
import { Err, Ok, tryBlock } from '@hoseki/packages/result'
import type { AsyncResult, Result } from '@hoseki/packages/result'
import type { Timezone } from '@hoseki/packages/schemas'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import type { Logger } from 'pino'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import {
  accountHistorySyncs,
  accounts as accountTable,
  balanceSnapshots,
  exchangeBalanceSnapshots,
} from '../../db/schema'
import type { EtfService } from '../etf/service'
import type { ExchangeService } from '../exchange/service'
import type { ManualService } from '../manual/service'
import type { PriceService } from '../price/service'
import {
  type BalanceDataPoint,
  type BalanceEntry,
  type CustomDateRange,
  type TimeRange,
  buildHistoricalData,
  daysBetween,
  resolveHistoryRange,
} from './history-range'

export type { BalanceDataPoint, CustomDateRange, TimeRange } from './history-range'

// ─── Types ──────────────────────────────────────────────────────────────────

const DEFAULT_TIMEZONE: Timezone = 'UTC'

export interface ControlCenterData {
  currentTotalBalance: string
  currentBtcPrice: string
  historicalData: BalanceDataPoint[]
  verifiedClaimsCount: number
  exchangeAccountCount: number
  manualAccountCount: number
  etfAccountCount: number
  historySyncingAccountIds: string[]
  historySyncedAccountIds: string[]
  historyRefreshingAccountIds: string[]
  historyFailedAccountIds: string[]
}

interface BalanceSnapshotRow {
  balance_sats: string
  timestamp: string
}

interface BlockRange {
  fromBlockHeight: number
  toBlockHeight: number
}

interface AccountHistoryStatus {
  historySyncingAccountIds: string[]
  historySyncedAccountIds: string[]
  historyRefreshingAccountIds: string[]
  historyFailedAccountIds: string[]
}

// ─── Service ────────────────────────────────────────────────────────────────

export class ControlCenterService {
  private readonly db: SentinelDb
  private readonly logger: Logger
  private readonly onchainProvider: ElectrumProvider
  private readonly exchangeService: ExchangeService
  private readonly manualService: ManualService
  private readonly etfService: EtfService
  private readonly priceService: PriceService
  private readonly accountHistoryBackfillsInFlight = new Set<string>()
  private readonly accountHistoryBackfillCooldownUntil = new Map<string, number>()
  private readonly accountHistoryBackfillFailureCounts = new Map<string, number>()
  private readonly accountHistoryBackfillGenerations = new Map<string, number>()

  public constructor(deps: {
    db: SentinelDb
    logger: Logger
    onchainProvider: ElectrumProvider
    exchangeService: ExchangeService
    manualService: ManualService
    etfService: EtfService
    priceService: PriceService
  }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'control-center' })
    this.onchainProvider = deps.onchainProvider
    this.exchangeService = deps.exchangeService
    this.manualService = deps.manualService
    this.etfService = deps.etfService
    this.priceService = deps.priceService
  }

  public getData = (args: {
    timeRange?: TimeRange
    accountIds?: string[]
    exchangeAccountIds?: string[]
    manualAccountIds?: string[]
    etfAccountIds?: string[]
    timezone?: Timezone
    customDateRange?: CustomDateRange
  }): AsyncResult<ControlCenterData, Error> => {
    const { logger, onchainProvider, exchangeService, manualService, etfService, priceService } = this
    const self = this
    return tryBlock(async function* () {
      const timeRange = args.timeRange ?? '30d'
      const timezone = args.timezone ?? DEFAULT_TIMEZONE
      const now = new Date()
      const historyRange = yield* resolveHistoryRange(timeRange, args.customDateRange, timezone, now)
      const shouldSyncFullHistory = args.customDateRange !== undefined || timeRange === 'all'
      logger.info({ timeRange, customDateRange: args.customDateRange, timezone }, 'Getting control center data')

      // ─── Fetch on-chain accounts ────────────────────────────────
      let accountRows = await self.getAccountRows(args.accountIds)
      const initiallySelectedAccountIds = new Set(accountRows.map(({ id }) => id))
      const accounts = new IndexSet<Account>()

      for (const row of accountRows) {
        const accountResult = Account.fromDescriptor(row.descriptor)
        if (accountResult.isErr()) {
          logger.warn({ accountId: row.id }, 'Skipping invalid descriptor')
          continue
        }
        accounts.add(accountResult.unwrap())
      }

      // ─── Fetch on-chain balances ────────────────────────────────
      const balancesByAccountId = new Map<string, bigint>()

      if (accounts.size > 0) {
        // Anchor before balance discovery so a backfill can reuse this result
        // only if the same chain tip still holds after scanning history.
        const balanceTipResult = await onchainProvider.getBlocksTip()
        const balancesResult = await onchainProvider.getConfirmedAccountBalances(accounts)
        accountRows = (await self.getAccountRows(args.accountIds)).filter(({ id }) =>
          initiallySelectedAccountIds.has(id),
        )
        if (balancesResult.isErr()) {
          logger.warn({ err: balancesResult.unwrapErr() }, 'Failed to fetch on-chain balances')
          for (const row of accountRows) {
            const latestSnapshotBalance = (await self.getLatestAccountSnapshotBalance(row.id)) ?? 0n
            balancesByAccountId.set(row.id, latestSnapshotBalance)

            if (shouldSyncFullHistory) {
              const accountResult = Account.fromDescriptor(row.descriptor)
              if (accountResult.isOk()) {
                await self.queueAccountHistoryBackfill(
                  row.id,
                  accountResult.unwrap(),
                  latestSnapshotBalance,
                  historyRange.start,
                  true,
                )
              }
            }
          }
        } else {
          const accountBalances = new Map<string, bigint>()
          for (const [account, balance] of balancesResult.unwrap()) {
            accountBalances.set(account.toString(), balance)
          }

          // Self-custody charts read snapshots first. Electrum transaction history
          // is only used to lazily backfill missing snapshot ranges.
          for (const row of accountRows) {
            const accountResult = Account.fromDescriptor(row.descriptor)
            if (accountResult.isErr()) {
              continue
            }

            const account = accountResult.unwrap()
            const accountBalance = accountBalances.get(account.toString()) ?? 0n
            balancesByAccountId.set(row.id, accountBalance)
            await self.queueAccountHistoryBackfill(
              row.id,
              account,
              accountBalance,
              historyRange.start,
              shouldSyncFullHistory,
              balanceTipResult.isOk() ? balanceTipResult.unwrap() : undefined,
            )
          }
        }
      }

      // ─── Fetch exchange data ────────────────────────────────────
      let exchangeBalance = 0n
      const exchangeEntries: BalanceEntry[] = []

      const exchangeAccounts = await exchangeService.listAccounts()
      const exchangeAccountIds = args.exchangeAccountIds
      const filteredExchangeAccounts = exchangeAccountIds
        ? exchangeAccounts.filter((a) => exchangeAccountIds.includes(a.id))
        : exchangeAccounts
      const connectedExchangeAccounts = filteredExchangeAccounts.filter((a) => a.connectionStatus === 'connected')

      logger.info(
        {
          totalExchangeAccounts: exchangeAccounts.length,
          filteredCount: filteredExchangeAccounts.length,
          connectedCount: connectedExchangeAccounts.length,
          accounts: connectedExchangeAccounts.map((a) => ({
            id: a.id,
            exchange: a.exchange,
            balanceSats: a.balanceSats,
          })),
        },
        'Exchange accounts for control center',
      )

      for (const account of connectedExchangeAccounts) {
        if (account.balanceSats != null && account.balanceSats !== '') {
          exchangeBalance += BigInt(account.balanceSats)
        }
      }

      // Coinbase: use real transaction history from the Coinbase API
      const coinbaseAccounts = connectedExchangeAccounts.filter((a) => a.exchange === 'coinbase')
      if (coinbaseAccounts.length > 0) {
        const coinbaseIds = coinbaseAccounts.map((a) => a.id)
        const coinbaseEntries = await exchangeService.getCoinbaseTransactionEntries(coinbaseIds)
        if (coinbaseEntries.isOk()) {
          exchangeEntries.push(...coinbaseEntries.unwrap())
        } else {
          logger.warn({ err: coinbaseEntries.unwrapErr() }, 'Failed to fetch Coinbase transactions')
        }
      }

      // Kraken: use real transaction history from the Kraken Ledgers API
      const krakenAccounts = connectedExchangeAccounts.filter((a) => a.exchange === 'kraken')
      if (krakenAccounts.length > 0) {
        const krakenIds = krakenAccounts.map((a) => a.id)
        const krakenEntries = await exchangeService.getKrakenTransactionEntries(krakenIds)
        if (krakenEntries.isOk()) {
          exchangeEntries.push(...krakenEntries.unwrap())
        } else {
          logger.warn({ err: krakenEntries.unwrapErr() }, 'Failed to fetch Kraken transactions')
        }
      }

      // Non-transaction exchanges (Strike, Robinhood): use imported statement transactions
      // for history before the first snapshot, then snapshots as source of truth after.
      const snapshotOnlyAccounts = connectedExchangeAccounts.filter(
        (a) => a.exchange !== 'coinbase' && a.exchange !== 'kraken',
      )
      for (const account of snapshotOnlyAccounts) {
        const snapshots = await self.getExchangeSnapshots(account.id)
        const firstSnapshotTimestamp = snapshots[0]?.timestamp
        const firstSnapshotTime =
          firstSnapshotTimestamp != null && firstSnapshotTimestamp !== '' ? new Date(firstSnapshotTimestamp) : null

        // Use imported transactions for the period before our first snapshot
        let previousBalance = 0n
        const stmtTxs = await exchangeService.listStatementTransactions(account.id)
        if (stmtTxs.length > 0 && firstSnapshotTime) {
          for (const tx of stmtTxs) {
            const txTime = new Date(tx.transactedAt)
            if (txTime >= firstSnapshotTime) {
              break
            } // snapshots take over from here
            const sats = BigInt(Math.round(parseFloat(tx.amountBtc) * 1e8))
            if (sats !== 0n) {
              exchangeEntries.push({ timestamp: txTime, value: sats })
              previousBalance += sats
            }
          }
        } else if (stmtTxs.length > 0 && !firstSnapshotTime) {
          // No snapshots at all — use all imported transactions
          for (const tx of stmtTxs) {
            const sats = BigInt(Math.round(parseFloat(tx.amountBtc) * 1e8))
            if (sats !== 0n) {
              exchangeEntries.push({ timestamp: new Date(tx.transactedAt), value: sats })
            }
          }
        }

        // Reconcile the first snapshot against imported history; later snapshots
        // continue from the preceding snapshot's balance.
        for (const snapshot of snapshots) {
          const balance = BigInt(snapshot.balance_sats)
          const delta = balance - previousBalance
          if (delta !== 0n) {
            exchangeEntries.push({
              timestamp: new Date(snapshot.timestamp),
              value: delta,
            })
          }
          previousBalance = balance
        }
      }

      // ─── Fetch manual holdings data ─────────────────────────────
      let manualBalance = 0n
      const manualEntries: BalanceEntry[] = []

      const manualAccounts = await manualService.listAccounts()
      const manualAccountIds = args.manualAccountIds
      const filteredManualAccounts = manualAccountIds
        ? manualAccounts.filter((a) => manualAccountIds.includes(a.id))
        : manualAccounts

      for (const account of filteredManualAccounts) {
        manualBalance += BigInt(account.balanceSats)
      }

      // Get transaction entries for accumulation chart
      const manualTxEntries = await manualService.getTransactionEntries(filteredManualAccounts.map((a) => a.id))
      manualEntries.push(...manualTxEntries)

      // ─── Fetch ETF holdings data ──────────────────────────────
      let etfBalance = 0n
      const etfEntries: BalanceEntry[] = []

      const etfAccounts = await etfService.listAccounts()
      const etfAccountIds = args.etfAccountIds
      const filteredEtfAccounts = etfAccountIds ? etfAccounts.filter((a) => etfAccountIds.includes(a.id)) : etfAccounts

      for (const account of filteredEtfAccounts) {
        etfBalance += BigInt(account.balanceSats)
      }

      // Use holdings' purchase dates for accumulation chart entries
      const etfAccumulationEntries = await etfService.getAccumulationEntries(filteredEtfAccounts.map((a) => a.id))
      etfEntries.push(...etfAccumulationEntries)

      // ─── Fetch BTC price ───────────────────────────────────────
      let currentBtcPrice = '0'
      const priceResult = await priceService.getCurrentBtcPrice()
      if (priceResult.isOk()) {
        currentBtcPrice = priceResult.unwrap().value.toString()
      } else {
        logger.warn({ err: priceResult.unwrapErr() }, 'Failed to fetch BTC price')
      }

      // Inspect completion before reading snapshots. There must be no await
      // between the final snapshot reads and response construction: a backfill
      // must never be reported complete alongside history read before it finished.
      const historyStatus = await self.getAccountHistoryStatus(accountRows, historyRange.start, shouldSyncFullHistory)
      accountRows = (
        await Promise.all(accountRows.map(async (row) => ((await self.isAccountActive(row.id)) ? row : null)))
      ).filter((row): row is NonNullable<typeof row> => row !== null)
      const onchainEntries = (
        await Promise.all(accountRows.map(async ({ id }) => self.getAccountSnapshotEntries(id)))
      ).flat()
      if (!args.accountIds) {
        onchainEntries.push(...(await self.getArchivedAccountSnapshotEntries()))
      }
      const onchainBalance = accountRows.reduce((sum, { id }) => sum + (balancesByAccountId.get(id) ?? 0n), 0n)

      // ─── Compute totals ─────────────────────────────────────────
      const currentTotalBalance = onchainBalance + exchangeBalance + manualBalance + etfBalance
      logger.info(
        {
          onchainBalance: onchainBalance.toString(),
          exchangeBalance: exchangeBalance.toString(),
          manualBalance: manualBalance.toString(),
          etfBalance: etfBalance.toString(),
          currentTotalBalance: currentTotalBalance.toString(),
        },
        'Control center totals',
      )

      // ─── Build historical data ──────────────────────────────────
      const allEntries = [...onchainEntries, ...exchangeEntries, ...manualEntries, ...etfEntries].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      )

      logger.info(
        {
          onchainEntryCount: onchainEntries.length,
          exchangeEntryCount: exchangeEntries.length,
          manualEntryCount: manualEntries.length,
          etfEntryCount: etfEntries.length,
          totalEntryCount: allEntries.length,
        },
        'Building historical data',
      )

      const historicalData = buildHistoricalData(allEntries, currentTotalBalance, historyRange, timezone)

      logger.info({ historicalDataPoints: historicalData.length }, 'Historical data built')

      return Ok({
        currentTotalBalance: currentTotalBalance.toString(),
        currentBtcPrice,
        historicalData,
        verifiedClaimsCount: accountRows.length,
        exchangeAccountCount: connectedExchangeAccounts.length,
        manualAccountCount: filteredManualAccounts.length,
        etfAccountCount: filteredEtfAccounts.length,
        historySyncingAccountIds: historyStatus.historySyncingAccountIds,
        historySyncedAccountIds: historyStatus.historySyncedAccountIds,
        historyRefreshingAccountIds: historyStatus.historyRefreshingAccountIds,
        historyFailedAccountIds: historyStatus.historyFailedAccountIds,
      })
    })
  }

  // ─── Snapshot Recording ────────────────────────────────────────────────

  /**
   * Record a balance snapshot for an on-chain account.
   * Should be called periodically (e.g., daily) to build historical chart data.
   */
  public async recordAccountSnapshot(accountId: string, balanceSats: string, timestamp: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      if (!(await this.isAccountActive(accountId, tx))) {
        return false
      }
      await this.upsertAccountSnapshot(tx, accountId, balanceSats, timestamp)
      return true
    })
  }

  public archiveAccount = (accountId: string): AsyncResult<void, Error> => {
    const { db } = this
    const self = this
    return tryBlock(async function* () {
      const [row] = await db
        .select({ descriptor: accountTable.descriptor })
        .from(accountTable)
        .where(and(eq(accountTable.id, accountId), isNull(accountTable.deletedAt)))
      if (!row) {
        return Err(new Error('Claim not found or already archived'))
      }

      const accountResult = Account.fromDescriptor(row.descriptor)
      if (accountResult.isErr()) {
        return Err(new Error('Failed to preserve account history: invalid descriptor'))
      }

      const account = accountResult.unwrap()
      const preservedBalance = await self.ensureAccountHistorySnapshots(
        accountId,
        account,
        undefined,
        new Date(0),
        true,
      )
      if (preservedBalance === null) {
        return Err(new Error('Failed to preserve full account history'))
      }

      const archivedAt = new Date().toISOString()
      const archived = await db.transaction(async (tx): Promise<boolean> => {
        const updated = await tx
          .update(accountTable)
          .set({ deletedAt: archivedAt })
          .where(and(eq(accountTable.id, accountId), isNull(accountTable.deletedAt)))
        if (updated.rowsAffected === 0) {
          return false
        }
        await self.upsertAccountSnapshot(tx, accountId, preservedBalance.toString(), archivedAt)
        return true
      })

      if (!archived) {
        return Err(new Error('Claim not found or already archived'))
      }
      self.invalidateAccountHistoryBackfill(accountId)
      return Ok(undefined)
    })
  }

  public async restoreAccount(accountId: string): Promise<Result<void, Error>> {
    const restored = await this.db.transaction(async (tx): Promise<boolean> => {
      const result = await tx
        .update(accountTable)
        .set({ deletedAt: null })
        .where(and(eq(accountTable.id, accountId), isNotNull(accountTable.deletedAt)))
      if (result.rowsAffected === 0) {
        return false
      }
      await tx.delete(accountHistorySyncs).where(eq(accountHistorySyncs.accountId, accountId))
      return true
    })

    if (!restored) {
      return Err(new Error('Claim not found or not archived'))
    }
    this.clearAccountHistoryBackfillState(accountId)
    return Ok(undefined)
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private async upsertAccountSnapshot(
    tx: SentinelTx,
    accountId: string,
    balanceSats: string,
    timestamp: string,
  ): Promise<void> {
    await tx
      .insert(balanceSnapshots)
      .values({ accountId, timestamp, balanceSats })
      .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.timestamp], set: { balanceSats } })
  }

  private async isAccountActive(accountId: string, db: SentinelDb | SentinelTx = this.db): Promise<boolean> {
    const rows = await db
      .select({ id: accountTable.id })
      .from(accountTable)
      .where(and(eq(accountTable.id, accountId), isNull(accountTable.deletedAt)))
    return rows.length > 0
  }

  private async getAccountRows(
    filterIds?: string[],
  ): Promise<Array<{ id: string; descriptor: string; network: string }>> {
    if (filterIds?.length === 0) {
      return []
    }
    return this.db
      .select({ id: accountTable.id, descriptor: accountTable.descriptor, network: accountTable.network })
      .from(accountTable)
      .where(and(filterIds ? inArray(accountTable.id, filterIds) : undefined, isNull(accountTable.deletedAt)))
      .orderBy(desc(accountTable.createdAt))
  }

  private async recordExchangeSnapshot(accountId: string, balanceSats: string, timestamp: string): Promise<void> {
    await this.db
      .insert(exchangeBalanceSnapshots)
      .values({ accountId, timestamp, balanceSats })
      .onConflictDoUpdate({
        target: [exchangeBalanceSnapshots.accountId, exchangeBalanceSnapshots.timestamp],
        set: { balanceSats },
      })
  }

  private async getExchangeSnapshots(accountId: string): Promise<Array<{ balance_sats: string; timestamp: string }>> {
    return this.db
      .select({ balance_sats: exchangeBalanceSnapshots.balanceSats, timestamp: exchangeBalanceSnapshots.timestamp })
      .from(exchangeBalanceSnapshots)
      .where(eq(exchangeBalanceSnapshots.accountId, accountId))
      .orderBy(asc(exchangeBalanceSnapshots.timestamp))
  }

  private async getAccountSnapshotEntries(accountId: string, throughTimestamp?: string): Promise<BalanceEntry[]> {
    const snapshots = await this.getAccountSnapshots(accountId, throughTimestamp)
    const entries: BalanceEntry[] = []
    let previousBalance = 0n

    for (const snapshot of snapshots) {
      const balance = BigInt(snapshot.balance_sats)
      const delta = balance - previousBalance
      if (delta !== 0n) {
        entries.push({
          timestamp: new Date(snapshot.timestamp),
          value: delta,
        })
      }
      previousBalance = balance
    }

    return entries
  }

  private async getArchivedAccountSnapshotEntries(): Promise<BalanceEntry[]> {
    const activeRows = await this.db
      .select({ descriptor: accountTable.descriptor, network: accountTable.network })
      .from(accountTable)
      .where(isNull(accountTable.deletedAt))
    const activeAccounts = new Set(activeRows.map((row) => accountDescriptorNetworkKey(row.descriptor, row.network)))
    const archivedRows = await this.db
      .select({
        id: accountTable.id,
        descriptor: accountTable.descriptor,
        network: accountTable.network,
        deleted_at: accountTable.deletedAt,
      })
      .from(accountTable)
      .where(isNotNull(accountTable.deletedAt))
      .orderBy(desc(accountTable.createdAt))

    const allEntries: BalanceEntry[] = []

    for (const row of archivedRows) {
      if (activeAccounts.has(accountDescriptorNetworkKey(row.descriptor, row.network))) {
        continue
      }

      if (row.deleted_at === null) {
        continue
      }
      const entries = await this.getAccountSnapshotEntries(row.id, row.deleted_at)
      allEntries.push(...entries)

      const finalBalance = entries.reduce((sum, e) => sum + e.value, 0n)
      if (finalBalance !== 0n) {
        allEntries.push({
          timestamp: new Date(row.deleted_at),
          value: -finalBalance,
        })
      }
    }

    return allEntries
  }

  private async getAccountSnapshots(accountId: string, throughTimestamp?: string): Promise<BalanceSnapshotRow[]> {
    return this.db
      .select({ balance_sats: balanceSnapshots.balanceSats, timestamp: balanceSnapshots.timestamp })
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.accountId, accountId),
          throughTimestamp !== undefined ? lte(balanceSnapshots.timestamp, throughTimestamp) : undefined,
        ),
      )
      .orderBy(asc(balanceSnapshots.timestamp))
  }

  private async getLatestAccountSnapshotBalance(accountId: string): Promise<bigint | null> {
    const [row] = await this.db
      .select({ balance_sats: balanceSnapshots.balanceSats })
      .from(balanceSnapshots)
      .where(eq(balanceSnapshots.accountId, accountId))
      .orderBy(desc(balanceSnapshots.timestamp))
      .limit(1)

    return row ? BigInt(row.balance_sats) : null
  }

  private async queueAccountHistoryBackfill(
    accountId: string,
    account: Account,
    currentBalance: bigint,
    rangeStart: Date,
    fullHistory: boolean,
    balanceTip?: Block,
  ): Promise<void> {
    if (!(await this.isAccountActive(accountId))) {
      return
    }
    const generation = this.getAccountHistoryBackfillGeneration(accountId)
    const cooldownUntil = this.accountHistoryBackfillCooldownUntil.get(accountId)
    if (cooldownUntil !== undefined) {
      if (cooldownUntil > Date.now()) {
        return
      }
      this.accountHistoryBackfillCooldownUntil.delete(accountId)
    }
    if (this.accountHistoryBackfillsInFlight.has(accountId)) {
      return
    }

    this.accountHistoryBackfillsInFlight.add(accountId)

    void this.ensureAccountHistorySnapshots(
      accountId,
      account,
      currentBalance,
      rangeStart,
      fullHistory,
      generation,
      balanceTip,
    )
      .then(async (preservedBalance) => {
        if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
          return
        }
        if (preservedBalance !== null) {
          this.clearAccountHistoryBackfillRetry(accountId)
          return
        }

        const retryDelayMs = this.scheduleAccountHistoryBackfillRetry(accountId)
        this.logger.warn({ accountId, retryDelayMs }, 'Self-custody history backfill retry scheduled')
      })
      .catch(async (cause: unknown) => {
        if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
          return
        }
        const retryDelayMs = this.scheduleAccountHistoryBackfillRetry(accountId)
        this.logger.warn({ accountId, err: cause, retryDelayMs }, 'Self-custody history backfill failed')
      })
      .finally(() => {
        if (this.getAccountHistoryBackfillGeneration(accountId) !== generation) {
          return
        }
        this.accountHistoryBackfillsInFlight.delete(accountId)
      })
  }

  private clearAccountHistoryBackfillState(accountId: string): void {
    this.accountHistoryBackfillsInFlight.delete(accountId)
    this.clearAccountHistoryBackfillRetry(accountId)
  }

  private invalidateAccountHistoryBackfill(accountId: string): void {
    this.accountHistoryBackfillGenerations.set(accountId, this.getAccountHistoryBackfillGeneration(accountId) + 1)
    this.clearAccountHistoryBackfillState(accountId)
  }

  private getAccountHistoryBackfillGeneration(accountId: string): number {
    return this.accountHistoryBackfillGenerations.get(accountId) ?? 0
  }

  private async canContinueAccountHistoryBackfill(
    accountId: string,
    generation: number,
    db: SentinelDb | SentinelTx = this.db,
  ): Promise<boolean> {
    return (
      (await this.isAccountActive(accountId, db)) && this.getAccountHistoryBackfillGeneration(accountId) === generation
    )
  }

  private clearAccountHistoryBackfillRetry(accountId: string): void {
    this.accountHistoryBackfillCooldownUntil.delete(accountId)
    this.accountHistoryBackfillFailureCounts.delete(accountId)
  }

  private scheduleAccountHistoryBackfillRetry(accountId: string): number {
    const failureCount = (this.accountHistoryBackfillFailureCounts.get(accountId) ?? 0) + 1
    const retryDelayMs = accountHistoryBackfillRetryDelayMs(failureCount)

    this.accountHistoryBackfillFailureCounts.set(accountId, failureCount)
    this.accountHistoryBackfillCooldownUntil.set(accountId, Date.now() + retryDelayMs)

    return retryDelayMs
  }

  private async getAccountHistoryStatus(
    accountRows: Array<{ id: string; descriptor: string; network: string }>,
    rangeStart: Date,
    fullHistory: boolean,
  ): Promise<AccountHistoryStatus> {
    if (accountRows.length === 0) {
      return {
        historySyncingAccountIds: [],
        historySyncedAccountIds: [],
        historyRefreshingAccountIds: [],
        historyFailedAccountIds: [],
      }
    }

    const tipResult = await this.onchainProvider.getBlocksTip()
    if (tipResult.isErr()) {
      this.logger.warn({ err: tipResult.unwrapErr() }, 'Failed to inspect chain tip for history completion status')
      const activeIds = (
        await Promise.all(accountRows.map(async (row) => ((await this.isAccountActive(row.id)) ? row.id : null)))
      ).filter((id): id is string => id !== null)
      return {
        // Keep polling after a connection failure, but never certify an unknown tip.
        historySyncingAccountIds: activeIds,
        historySyncedAccountIds: [],
        historyRefreshingAccountIds: (
          await Promise.all(
            activeIds.map(async (id) =>
              (await this.hasCurrentVersionAccountHistorySync(id, fullHistory)) ? id : null,
            ),
          )
        ).filter((id): id is string => id !== null),
        historyFailedAccountIds: activeIds,
      }
    }

    const tip = tipResult.unwrap()
    const requestedRange = fullHistory
      ? { fromBlockHeight: 0, toBlockHeight: tip.height }
      : historySyncRangeForStartDate(rangeStart, tip)
    const historySyncingAccountIds: string[] = []
    const historySyncedAccountIds: string[] = []
    const historyRefreshingAccountIds: string[] = []
    const historyFailedAccountIds: string[] = []

    for (const row of accountRows) {
      if (!(await this.isAccountActive(row.id))) {
        continue
      }
      const missingRanges = await this.getMissingAccountHistorySyncRanges(row.id, requestedRange)
      if (missingRanges.length === 0) {
        // Completion of a narrower request says nothing about a wider job's
        // retry state. Only the job itself may clear its cooldown and failures.
        historySyncedAccountIds.push(row.id)
        continue
      }

      historySyncingAccountIds.push(row.id)
      // A certified prefix with only a missing tail can remain visible while
      // catching up. This does not mark the newer blocks as complete.
      const [missingRange] = missingRanges
      if (
        missingRanges.length === 1 &&
        missingRange !== undefined &&
        missingRange.fromBlockHeight > requestedRange.fromBlockHeight &&
        missingRange.toBlockHeight === requestedRange.toBlockHeight
      ) {
        historyRefreshingAccountIds.push(row.id)
      }
      if ((this.accountHistoryBackfillFailureCounts.get(row.id) ?? 0) > 0) {
        historyFailedAccountIds.push(row.id)
      }
    }

    return { historySyncingAccountIds, historySyncedAccountIds, historyRefreshingAccountIds, historyFailedAccountIds }
  }

  private async ensureAccountHistorySnapshots(
    accountId: string,
    account: Account,
    currentBalance: bigint | undefined,
    rangeStart: Date,
    fullHistory = false,
    generation = this.getAccountHistoryBackfillGeneration(accountId),
    balanceTip?: Block,
  ): Promise<bigint | null> {
    if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
      return null
    }
    const tipResult = await this.onchainProvider.getBlocksTip()
    if (tipResult.isErr()) {
      this.logger.warn({ accountId, err: tipResult.unwrapErr() }, 'Failed to inspect chain tip for history backfill')
      return null
    }
    if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
      return null
    }

    let tip = tipResult.unwrap()
    const requestedRange = fullHistory
      ? { fromBlockHeight: 0, toBlockHeight: tip.height }
      : historySyncRangeForStartDate(rangeStart, tip)
    let missingRanges = await this.getMissingAccountHistorySyncRanges(accountId, requestedRange)
    // The dashboard already fetched this balance. Only archival (which passes
    // no balance) needs to validate it when the requested history is cached.
    if (missingRanges.length === 0 && currentBalance !== undefined) {
      return currentBalance
    }
    const backfillFromBlockHeight =
      missingRanges.length > 0 ? Math.min(...missingRanges.map((range) => range.fromBlockHeight)) : tip.height + 1
    const stopBeforeBlockHeight = Math.max(0, backfillFromBlockHeight - 1)
    let transactionEntries: TransactionEntry[] = []

    if (missingRanges.length > 0) {
      const entriesResult = await this.getTransactionEntriesByAccountSinceBlock(account, stopBeforeBlockHeight)
      if (entriesResult.isErr()) {
        this.logger.warn(
          { accountId, err: entriesResult.unwrapErr() },
          'Failed to backfill self-custody history from Electrum',
        )
        return null
      }
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
        return null
      }
      transactionEntries = entriesResult.unwrap()
    }

    let reconstructionBalance: bigint
    const accounts = new IndexSet([account])
    let reusableBalance = balanceTip?.height === tip.height && balanceTip.hash === tip.hash ? currentBalance : undefined
    for (;;) {
      let boundaryBalance = reusableBalance
      // Never carry the original balance into a newer tip's tail scan.
      reusableBalance = undefined
      if (boundaryBalance === undefined) {
        const balanceResult = await this.onchainProvider.getConfirmedAccountBalances(accounts)
        if (balanceResult.isErr()) {
          this.logger.warn({ accountId, err: balanceResult.unwrapErr() }, 'Failed to fetch history boundary balance')
          return null
        }
        boundaryBalance = balanceResult.unwrap().get(account) ?? 0n
      }
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
        return null
      }

      const verifiedTipResult = await this.onchainProvider.getBlocksTip()
      if (verifiedTipResult.isErr()) {
        this.logger.warn({ accountId, err: verifiedTipResult.unwrapErr() }, 'Failed to verify history chain tip')
        return null
      }
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
        return null
      }

      const verifiedTip = verifiedTipResult.unwrap()
      if (verifiedTip.height === tip.height && verifiedTip.hash === tip.hash) {
        reconstructionBalance = boundaryBalance
        break
      }

      // A normal new block must not throw away a long history scan. Verify its
      // anchor is still on the chain, retain entries through that block, and
      // fetch only the new tail. Reorganizations still require a fresh scan.
      if (verifiedTip.height <= tip.height) {
        return null
      }
      const anchorResult = await this.onchainProvider.getBlock(tip.height)
      if (anchorResult.isErr() || anchorResult.unwrap().hash !== tip.hash) {
        return null
      }
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
        return null
      }

      const tailResult = await this.getTransactionEntriesByAccountSinceBlock(account, tip.height)
      if (tailResult.isErr()) {
        return null
      }
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation))) {
        return null
      }
      transactionEntries = [
        ...transactionEntries.filter((entry) => entry.blockHeight !== null && entry.blockHeight <= tip.height),
        ...tailResult.unwrap().filter((entry) => entry.blockHeight !== null && entry.blockHeight > tip.height),
      ]
      tip = verifiedTip
      requestedRange.toBlockHeight = tip.height
      missingRanges = await this.getMissingAccountHistorySyncRanges(accountId, requestedRange)
    }

    if (missingRanges.length === 0) {
      return reconstructionBalance
    }

    const deltas = transactionDeltasFromEntries(transactionEntries, stopBeforeBlockHeight, requestedRange.toBlockHeight)
    const startBalance = reconstructionBalance - deltas.reduce((sum, entry) => sum + entry.value, 0n)
    // A full reconstruction must also correct old snapshots before the
    // estimated block-zero date (average block times can drift by months).
    const rangeStartTime =
      backfillFromBlockHeight === 0 ? new Date(0) : estimateTimestampForBlockHeight(backfillFromBlockHeight, tip)
    const currentSnapshotTime = new Date()
    // Fetch and verify Electrum history before taking the transaction. Publish
    // snapshots, corrections and certified coverage together, or not at all.
    const reconciledSnapshotCount = await this.db.transaction(async (tx): Promise<number | null> => {
      if (!(await this.canContinueAccountHistoryBackfill(accountId, generation, tx))) {
        return null
      }
      let runningBalance = startBalance
      await this.upsertAccountSnapshot(tx, accountId, startBalance.toString(), rangeStartTime.toISOString())
      for (const delta of deltas) {
        runningBalance += delta.value
        await this.upsertAccountSnapshot(tx, accountId, runningBalance.toString(), delta.timestamp.toISOString())
      }
      await this.upsertAccountSnapshot(
        tx,
        accountId,
        reconstructionBalance.toString(),
        currentSnapshotTime.toISOString(),
      )
      const reconciledCount = await this.reconcileAccountSnapshots(
        tx,
        accountId,
        rangeStartTime,
        currentSnapshotTime,
        startBalance,
        deltas,
      )
      for (const missingRange of missingRanges) {
        await this.recordAccountHistorySync(accountId, missingRange, tip, tx)
      }
      return reconciledCount
    })
    if (reconciledSnapshotCount === null) {
      return null
    }

    this.logger.info(
      {
        accountId,
        backfillFromBlockHeight,
        stopBeforeBlockHeight,
        toBlockHeight: requestedRange.toBlockHeight,
        missingRangeCount: missingRanges.length,
        backfilledRangeCount: missingRanges.length,
        snapshotDeltaCount: deltas.length,
        reconciledSnapshotCount,
      },
      'Backfilled self-custody balance snapshots',
    )

    return reconstructionBalance
  }

  private async getTransactionEntriesByAccountSinceBlock(
    account: Account,
    stopBeforeBlockHeight: number,
  ): Promise<Result<TransactionEntry[], Error>> {
    const discoveredResult = await this.onchainProvider.discoverAccount(account)
    if (discoveredResult.isErr()) {
      return Err(discoveredResult.unwrapErr())
    }

    const { lastUsedReceiveIndex, lastUsedChangeIndex } = discoveredResult.unwrap()
    const addresses = new IndexMap<Address, number | null>()

    for (const address of account.receiveAddresses(0, lastUsedReceiveIndex + 1, this.onchainProvider.network)) {
      addresses.set(address, stopBeforeBlockHeight)
    }
    for (const address of account.changeAddresses(0, lastUsedChangeIndex + 1, this.onchainProvider.network)) {
      addresses.set(address, stopBeforeBlockHeight)
    }

    const entries: TransactionEntry[] = []
    const gen = this.onchainProvider.getTransactionEntries(addresses)
    for await (const entry of gen) {
      if (entry.isErr()) {
        return Err(entry.unwrapErr())
      }
      entries.push(entry.unwrap())
    }

    return Ok(entries)
  }

  private async reconcileAccountSnapshots(
    tx: SentinelTx,
    accountId: string,
    rangeStart: Date,
    rangeEnd: Date,
    startBalance: bigint,
    deltas: BalanceEntry[],
  ): Promise<number> {
    const snapshots = await tx
      .select({ balance_sats: balanceSnapshots.balanceSats, timestamp: balanceSnapshots.timestamp })
      .from(balanceSnapshots)
      .where(
        and(
          eq(balanceSnapshots.accountId, accountId),
          gte(balanceSnapshots.timestamp, rangeStart.toISOString()),
          lte(balanceSnapshots.timestamp, rangeEnd.toISOString()),
        ),
      )
      .orderBy(asc(balanceSnapshots.timestamp))

    let runningBalance = startBalance
    let deltaIndex = 0
    let updatedCount = 0

    for (const snapshot of snapshots) {
      const snapshotTime = new Date(snapshot.timestamp)

      while (deltaIndex < deltas.length) {
        const delta = deltas[deltaIndex]
        if (!delta || delta.timestamp > snapshotTime) {
          break
        }
        runningBalance += delta.value
        deltaIndex++
      }

      if (BigInt(snapshot.balance_sats) === runningBalance) {
        continue
      }

      await this.upsertAccountSnapshot(tx, accountId, runningBalance.toString(), snapshot.timestamp)
      updatedCount++
    }

    return updatedCount
  }

  private async hasCurrentVersionAccountHistorySync(accountId: string, fromGenesis = false): Promise<boolean> {
    const rows = await this.db
      .select({ id: accountHistorySyncs.id })
      .from(accountHistorySyncs)
      .where(
        and(
          eq(accountHistorySyncs.accountId, accountId),
          gte(accountHistorySyncs.syncVersion, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION),
          fromGenesis ? eq(accountHistorySyncs.fromBlockHeight, 0) : undefined,
        ),
      )
      .limit(1)
    return rows.length > 0
  }

  private async getMissingAccountHistorySyncRanges(
    accountId: string,
    requestedRange: BlockRange,
  ): Promise<BlockRange[]> {
    const rows = await this.db
      .select({
        from_block_height: accountHistorySyncs.fromBlockHeight,
        to_block_height: accountHistorySyncs.toBlockHeight,
        sync_version: accountHistorySyncs.syncVersion,
      })
      .from(accountHistorySyncs)
      .where(
        and(
          eq(accountHistorySyncs.accountId, accountId),
          gte(accountHistorySyncs.syncVersion, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION),
          gte(accountHistorySyncs.toBlockHeight, requestedRange.fromBlockHeight),
          lte(accountHistorySyncs.fromBlockHeight, requestedRange.toBlockHeight),
        ),
      )
      .orderBy(asc(accountHistorySyncs.fromBlockHeight))

    const missingRanges: BlockRange[] = []
    let cursor = requestedRange.fromBlockHeight

    for (const row of rows) {
      const rowFrom = Math.max(row.from_block_height, requestedRange.fromBlockHeight)
      const rowTo = Math.min(row.to_block_height, requestedRange.toBlockHeight)
      if (rowTo < cursor) {
        continue
      }

      if (rowFrom > cursor) {
        missingRanges.push({ fromBlockHeight: cursor, toBlockHeight: rowFrom - 1 })
      }

      cursor = Math.max(cursor, rowTo + 1)
      if (cursor > requestedRange.toBlockHeight) {
        break
      }
    }

    if (cursor <= requestedRange.toBlockHeight) {
      missingRanges.push({ fromBlockHeight: cursor, toBlockHeight: requestedRange.toBlockHeight })
    }

    return missingRanges
  }

  private async recordAccountHistorySync(
    accountId: string,
    range: BlockRange,
    tip: Block,
    transaction?: SentinelTx,
  ): Promise<void> {
    const record = async (tx: SentinelTx): Promise<void> => {
      if (!(await this.isAccountActive(accountId, tx))) {
        return
      }
      // Coalesce only equally certified coverage. Never bridge an unscanned
      // block or promote an older version's range without actually scanning it.
      const rows = await tx
        .select({
          from_block_height: accountHistorySyncs.fromBlockHeight,
          to_block_height: accountHistorySyncs.toBlockHeight,
          sync_version: accountHistorySyncs.syncVersion,
        })
        .from(accountHistorySyncs)
        .where(
          and(
            eq(accountHistorySyncs.accountId, accountId),
            eq(accountHistorySyncs.syncVersion, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION),
          ),
        )
      const ranges = [
        range,
        ...rows.map((row) => ({ fromBlockHeight: row.from_block_height, toBlockHeight: row.to_block_height })),
      ].sort((left, right) => left.fromBlockHeight - right.fromBlockHeight)
      const combined: BlockRange[] = []
      for (const next of ranges) {
        const previous = combined.at(-1)
        if (previous && next.fromBlockHeight <= previous.toBlockHeight + 1) {
          previous.toBlockHeight = Math.max(previous.toBlockHeight, next.toBlockHeight)
        } else {
          combined.push({ ...next })
        }
      }
      const mergedRange = combined.find(
        (candidate) =>
          candidate.fromBlockHeight <= range.fromBlockHeight && candidate.toBlockHeight >= range.toBlockHeight,
      )
      if (!mergedRange) {
        return
      }

      // Replace just the connected range containing this successful scan.
      // Deletion and insertion must roll back together if either write fails.
      await tx
        .delete(accountHistorySyncs)
        .where(
          and(
            eq(accountHistorySyncs.accountId, accountId),
            eq(accountHistorySyncs.syncVersion, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION),
            gte(accountHistorySyncs.fromBlockHeight, mergedRange.fromBlockHeight),
            lte(accountHistorySyncs.toBlockHeight, mergedRange.toBlockHeight),
          ),
        )
      const rangeStart = estimateTimestampForBlockHeight(mergedRange.fromBlockHeight, tip).toISOString()
      const rangeEnd = estimateTimestampForBlockHeight(mergedRange.toBlockHeight, tip).toISOString()
      const syncedAt = new Date().toISOString()
      await tx
        .insert(accountHistorySyncs)
        .values({
          accountId,
          fromBlockHeight: mergedRange.fromBlockHeight,
          toBlockHeight: mergedRange.toBlockHeight,
          rangeStart,
          rangeEnd,
          syncVersion: CURRENT_ACCOUNT_HISTORY_SYNC_VERSION,
          syncedAt,
        })
        .onConflictDoUpdate({
          target: [
            accountHistorySyncs.accountId,
            accountHistorySyncs.fromBlockHeight,
            accountHistorySyncs.toBlockHeight,
          ],
          set: { rangeStart, rangeEnd, syncVersion: CURRENT_ACCOUNT_HISTORY_SYNC_VERSION, syncedAt },
        })
    }
    if (transaction === undefined) {
      await this.db.transaction(record)
    } else {
      await record(transaction)
    }
  }

  /**
   * Collect snapshots independently for on-chain, exchange, manual and ETF accounts.
   * Keep successful writes and log failures without aborting other accounts/sources.
   * Called on startup and periodically to build chart data.
   */
  public recordAllSnapshots = (): AsyncResult<void, Error> => {
    const { logger, onchainProvider, exchangeService, manualService, etfService } = this
    const self = this
    return tryBlock(async function* () {
      const now = new Date().toISOString()
      const collectSource = async (source: string, collect: () => Promise<void>): Promise<void> => {
        try {
          await collect()
        } catch {
          // Provider exceptions can contain descriptors or credentials; log context only.
          logger.warn({ source }, 'Failed to collect balance snapshots for source')
        }
      }
      const collectAccount = async (
        source: string,
        accountId: string,
        collect: () => Promise<boolean>,
      ): Promise<boolean> => {
        try {
          return await collect()
        } catch {
          logger.warn({ source, accountId }, 'Failed to collect balance snapshot')
          return false
        }
      }

      // ─── On-chain accounts ─────────────────────────────────────
      await collectSource('on-chain', async () => {
        const accountRows = await self.getAccountRows()

        if (accountRows.length === 0) {
          return
        }
        const accounts = new IndexSet<Account>()
        const idMap = new Map<string, string>()

        for (const row of accountRows) {
          const parsed = Account.fromDescriptor(row.descriptor)
          if (parsed.isOk()) {
            accounts.add(parsed.unwrap())
            idMap.set(row.descriptor, row.id)
          }
        }

        if (accounts.size > 0) {
          const balancesResult = await onchainProvider.getConfirmedAccountBalances(accounts)
          if (balancesResult.isErr()) {
            logger.warn({ source: 'on-chain' }, 'Failed to record on-chain snapshots')
          } else {
            let recorded = 0
            for (const [account, balance] of balancesResult.unwrap()) {
              const accountId = idMap.get(account.toString())
              if (accountId != null && accountId !== '') {
                if (
                  await collectAccount('on-chain', accountId, async () =>
                    self.recordAccountSnapshot(accountId, balance.toString(), now),
                  )
                ) {
                  recorded++
                }
              }
            }
            logger.info({ count: recorded }, 'Recorded on-chain balance snapshots')
          }
        }
      })

      // ─── Exchange accounts (Strike, Robinhood, etc.) ───────────
      await collectSource('exchange', async () => {
        const exchangeAccounts = await exchangeService.listAccounts()
        if (exchangeAccounts.length > 0) {
          let recorded = 0
          for (const account of exchangeAccounts) {
            const collected = await collectAccount('exchange', account.id, async () => {
              const result = await exchangeService.refreshBalance(account.id)
              if (result.isErr()) {
                logger.warn(
                  { accountId: account.id, exchange: account.exchange },
                  'Failed to refresh exchange balance for snapshot',
                )
                return false
              }
              const refreshed = result.unwrap()
              await self.recordExchangeSnapshot(account.id, refreshed.balanceSats ?? '0', now)
              return true
            })
            if (collected) {
              recorded++
            }
          }
          logger.info({ count: recorded }, 'Recorded exchange balance snapshots')
        }
      })

      // ─── Manual accounts (no refresh — just persist stored balance) ─
      await collectSource('manual', async () => {
        const manualAccounts = await manualService.listAccounts()
        let recorded = 0
        for (const account of manualAccounts) {
          if (
            await collectAccount('manual', account.id, async () => {
              await manualService.recordSnapshot(account.id, account.balanceSats, now)
              return true
            })
          ) {
            recorded++
          }
        }
        if (manualAccounts.length > 0) {
          logger.info({ count: recorded }, 'Recorded manual account balance snapshots')
        }
      })

      // ─── ETF accounts (recompute balance — expense decay changes daily) ─
      await collectSource('ETF', async () => {
        const etfAccounts = await etfService.listAccounts()
        let recorded = 0
        for (const account of etfAccounts) {
          if (
            await collectAccount('ETF', account.id, async () => {
              await etfService.recordSnapshot(account.id, account.balanceSats, now)
              return true
            })
          ) {
            recorded++
          }
        }
        if (etfAccounts.length > 0) {
          logger.info({ count: recorded }, 'Recorded ETF account balance snapshots')
        }
      })

      return Ok(undefined)
    })
  }
}

function accountDescriptorNetworkKey(descriptor: string, network: string): string {
  return JSON.stringify([descriptor, network])
}

const ESTIMATED_BLOCK_INTERVAL_MS = 10 * 60 * 1000
const HISTORY_SYNC_BLOCK_CUSHION = 288
// Earlier versions could certify a partial Electrum response as complete.
const CURRENT_ACCOUNT_HISTORY_SYNC_VERSION = 5
const HISTORY_BACKFILL_RETRY_INITIAL_DELAY_MS = 5 * 1000
const HISTORY_BACKFILL_RETRY_MAX_DELAY_MS = 60 * 1000
const HISTORY_BACKFILL_RETRY_JITTER_FRACTION = 0.2

function historySyncRangeForStartDate(rangeStart: Date, tip: Block): BlockRange {
  const daysBack = daysBetween(rangeStart, tip.timestamp)
  const estimatedBlocksBack = daysBack * 144 + HISTORY_SYNC_BLOCK_CUSHION

  return {
    fromBlockHeight: Math.max(0, tip.height - estimatedBlocksBack),
    toBlockHeight: tip.height,
  }
}

function estimateTimestampForBlockHeight(blockHeight: number, tip: Block): Date {
  const blocksBehind = Math.max(0, tip.height - blockHeight)
  return new Date(tip.timestamp.getTime() - blocksBehind * ESTIMATED_BLOCK_INTERVAL_MS)
}

function accountHistoryBackfillRetryDelayMs(failureCount: number): number {
  const exponent = Math.max(0, failureCount - 1)
  const baseDelayMs = Math.min(
    HISTORY_BACKFILL_RETRY_MAX_DELAY_MS,
    HISTORY_BACKFILL_RETRY_INITIAL_DELAY_MS * 2 ** exponent,
  )
  const jitter = 1 + (Math.random() * 2 - 1) * HISTORY_BACKFILL_RETRY_JITTER_FRACTION

  return Math.max(1_000, Math.round(baseDelayMs * jitter))
}

function transactionDeltasFromEntries(
  entries: TransactionEntry[],
  fromBlockHeight: number,
  toBlockHeight: number,
): BalanceEntry[] {
  const byTimestamp = new Map<string, bigint>()

  for (const entry of entries) {
    if (
      entry.blockHeight === null ||
      entry.blockHeight <= fromBlockHeight ||
      entry.blockHeight > toBlockHeight ||
      entry.value === 0n
    ) {
      continue
    }

    const timestamp = entry.timestamp.toISOString()
    byTimestamp.set(timestamp, (byTimestamp.get(timestamp) ?? 0n) + entry.value)
  }

  return Array.from(byTimestamp.entries())
    .map(([timestamp, value]) => ({
      timestamp: new Date(timestamp),
      value,
    }))
    .filter((entry) => entry.value !== 0n)
    .sort((a, b) => {
      const timeDelta = a.timestamp.getTime() - b.timestamp.getTime()
      if (timeDelta !== 0) {
        return timeDelta
      }
      return Number(a.value - b.value)
    })
}
