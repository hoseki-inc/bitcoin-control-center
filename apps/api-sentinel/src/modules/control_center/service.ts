import { Account } from '@hoseki/packages/bitcoin/account'
import type { Address } from '@hoseki/packages/bitcoin/address'
import type { Block, TransactionEntry } from '@hoseki/packages/bitcoin/onchain'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { IndexMap, IndexSet } from '@hoseki/packages/collection'
import { type Timezone } from '@hoseki/packages/schemas'
import { Err, Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
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

interface AccountHistorySyncRow {
  from_block_height: number
  to_block_height: number
  sync_version: number
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
  private readonly db: Database.Database
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
    db: Database.Database
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

  public getData = asyncFn(
    async (args: {
      timeRange?: TimeRange
      accountIds?: string[]
      exchangeAccountIds?: string[]
      manualAccountIds?: string[]
      etfAccountIds?: string[]
      timezone?: Timezone
      customDateRange?: CustomDateRange
    }): Promise<Result<ControlCenterData, Error>> => {
      const timeRange = args.timeRange ?? '30d'
      const timezone = args.timezone ?? DEFAULT_TIMEZONE
      const now = new Date()
      const historyRangeResult = resolveHistoryRange(timeRange, args.customDateRange, timezone, now)
      if (historyRangeResult.isErr()) {
        return Err(historyRangeResult.unwrapErr())
      }

      const historyRange = historyRangeResult.unwrap()
      const shouldSyncFullHistory = args.customDateRange !== undefined || timeRange === 'all'
      this.logger.info({ timeRange, customDateRange: args.customDateRange, timezone }, 'Getting control center data')

      // ─── Fetch on-chain accounts ────────────────────────────────
      let accountRows = this.getAccountRows(args.accountIds)
      const initiallySelectedAccountIds = new Set(accountRows.map(({ id }) => id))
      const accounts = new IndexSet<Account>()

      for (const row of accountRows) {
        const accountResult = Account.fromDescriptor(row.descriptor)
        if (accountResult.isErr()) {
          this.logger.warn({ accountId: row.id }, 'Skipping invalid descriptor')
          continue
        }
        accounts.add(accountResult.unwrap())
      }

      // ─── Fetch on-chain balances ────────────────────────────────
      const balancesByAccountId = new Map<string, bigint>()

      if (accounts.size > 0) {
        // Anchor before balance discovery so a backfill can reuse this result
        // only if the same chain tip still holds after scanning history.
        const balanceTipResult = await this.onchainProvider.getBlocksTip()
        const balancesResult = await this.onchainProvider.getConfirmedAccountBalances(accounts)
        accountRows = this.getAccountRows(args.accountIds).filter(({ id }) => initiallySelectedAccountIds.has(id))
        if (balancesResult.isErr()) {
          this.logger.warn({ err: balancesResult.unwrapErr() }, 'Failed to fetch on-chain balances')
          for (const row of accountRows) {
            const latestSnapshotBalance = this.getLatestAccountSnapshotBalance(row.id) ?? 0n
            balancesByAccountId.set(row.id, latestSnapshotBalance)

            if (shouldSyncFullHistory) {
              const accountResult = Account.fromDescriptor(row.descriptor)
              if (accountResult.isOk()) {
                this.queueAccountHistoryBackfill(
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
            this.queueAccountHistoryBackfill(
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

      const exchangeAccounts = this.exchangeService.listAccounts()
      const exchangeAccountIds = args.exchangeAccountIds
      const filteredExchangeAccounts = exchangeAccountIds
        ? exchangeAccounts.filter((a) => exchangeAccountIds.includes(a.id))
        : exchangeAccounts
      const connectedExchangeAccounts = filteredExchangeAccounts.filter((a) => a.connectionStatus === 'connected')

      this.logger.info(
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
        if (account.balanceSats) {
          exchangeBalance += BigInt(account.balanceSats)
        }
      }

      // Coinbase: use real transaction history from the Coinbase API
      const coinbaseAccounts = connectedExchangeAccounts.filter((a) => a.exchange === 'coinbase')
      if (coinbaseAccounts.length > 0) {
        const coinbaseIds = coinbaseAccounts.map((a) => a.id)
        const coinbaseEntries = await this.exchangeService.getCoinbaseTransactionEntries(coinbaseIds)
        if (coinbaseEntries.isOk()) {
          exchangeEntries.push(...coinbaseEntries.unwrap())
        } else {
          this.logger.warn({ err: coinbaseEntries.unwrapErr() }, 'Failed to fetch Coinbase transactions')
        }
      }

      // Kraken: use real transaction history from the Kraken Ledgers API
      const krakenAccounts = connectedExchangeAccounts.filter((a) => a.exchange === 'kraken')
      if (krakenAccounts.length > 0) {
        const krakenIds = krakenAccounts.map((a) => a.id)
        const krakenEntries = await this.exchangeService.getKrakenTransactionEntries(krakenIds)
        if (krakenEntries.isOk()) {
          exchangeEntries.push(...krakenEntries.unwrap())
        } else {
          this.logger.warn({ err: krakenEntries.unwrapErr() }, 'Failed to fetch Kraken transactions')
        }
      }

      // Non-transaction exchanges (Strike, Robinhood): use imported statement transactions
      // for history before the first snapshot, then snapshots as source of truth after.
      const snapshotOnlyAccounts = connectedExchangeAccounts.filter(
        (a) => a.exchange !== 'coinbase' && a.exchange !== 'kraken',
      )
      for (const account of snapshotOnlyAccounts) {
        const snapshots = this.getExchangeSnapshots(account.id)
        const firstSnapshotTimestamp = snapshots[0]?.timestamp
        const firstSnapshotTime = firstSnapshotTimestamp ? new Date(firstSnapshotTimestamp) : null

        // Use imported transactions for the period before our first snapshot
        const stmtTxs = this.exchangeService.listStatementTransactions(account.id)
        if (stmtTxs.length > 0 && firstSnapshotTime) {
          for (const tx of stmtTxs) {
            const txTime = new Date(tx.transactedAt)
            if (txTime >= firstSnapshotTime) {
              break
            } // snapshots take over from here
            const sats = BigInt(Math.round(parseFloat(tx.amountBtc) * 1e8))
            if (sats !== 0n) {
              exchangeEntries.push({ timestamp: txTime, value: sats })
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

        // Snapshots are the source of truth from the first snapshot onward
        let previousBalance = 0n
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

      const manualAccounts = this.manualService.listAccounts()
      const manualAccountIds = args.manualAccountIds
      const filteredManualAccounts = manualAccountIds
        ? manualAccounts.filter((a) => manualAccountIds.includes(a.id))
        : manualAccounts

      for (const account of filteredManualAccounts) {
        manualBalance += BigInt(account.balanceSats)
      }

      // Get transaction entries for accumulation chart
      const manualTxEntries = this.manualService.getTransactionEntries(filteredManualAccounts.map((a) => a.id))
      manualEntries.push(...manualTxEntries)

      // ─── Fetch ETF holdings data ──────────────────────────────
      let etfBalance = 0n
      const etfEntries: BalanceEntry[] = []

      const etfAccounts = this.etfService.listAccounts()
      const etfAccountIds = args.etfAccountIds
      const filteredEtfAccounts = etfAccountIds ? etfAccounts.filter((a) => etfAccountIds.includes(a.id)) : etfAccounts

      for (const account of filteredEtfAccounts) {
        etfBalance += BigInt(account.balanceSats)
      }

      // Use holdings' purchase dates for accumulation chart entries
      const etfAccumulationEntries = this.etfService.getAccumulationEntries(filteredEtfAccounts.map((a) => a.id))
      etfEntries.push(...etfAccumulationEntries)

      // ─── Fetch BTC price ───────────────────────────────────────
      let currentBtcPrice = '0'
      const priceResult = await this.priceService.getCurrentBtcPrice()
      if (priceResult.isOk()) {
        currentBtcPrice = priceResult.unwrap().value.toString()
      } else {
        this.logger.warn({ err: priceResult.unwrapErr() }, 'Failed to fetch BTC price')
      }

      // Inspect completion before reading snapshots. There must be no await
      // between the final snapshot reads and response construction: a backfill
      // must never be reported complete alongside history read before it finished.
      const historyStatus = await this.getAccountHistoryStatus(accountRows, historyRange.start, shouldSyncFullHistory)
      accountRows = accountRows.filter(({ id }) => this.isAccountActive(id))
      const onchainEntries = accountRows.flatMap(({ id }) => this.getAccountSnapshotEntries(id))
      if (!args.accountIds) {
        onchainEntries.push(...this.getArchivedAccountSnapshotEntries())
      }
      const onchainBalance = accountRows.reduce((sum, { id }) => sum + (balancesByAccountId.get(id) ?? 0n), 0n)

      // ─── Compute totals ─────────────────────────────────────────
      const currentTotalBalance = onchainBalance + exchangeBalance + manualBalance + etfBalance
      this.logger.info(
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

      this.logger.info(
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

      this.logger.info({ historicalDataPoints: historicalData.length }, 'Historical data built')

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
    },
  )

  // ─── Snapshot Recording ────────────────────────────────────────────────

  /**
   * Record a balance snapshot for an on-chain account.
   * Should be called periodically (e.g., daily) to build historical chart data.
   */
  public recordAccountSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    if (!this.isAccountActive(accountId)) {
      return
    }
    this.upsertAccountSnapshot(accountId, balanceSats, timestamp)
  }

  public archiveAccount = asyncFn(async (accountId: string): Promise<Result<void, Error>> => {
    const row = this.db
      .prepare('SELECT descriptor FROM accounts WHERE id = ? AND deleted_at IS NULL')
      .get(accountId) as { descriptor: string } | undefined
    if (!row) {
      return Err(new Error('Claim not found or already archived'))
    }

    const accountResult = Account.fromDescriptor(row.descriptor)
    if (accountResult.isErr()) {
      return Err(new Error('Failed to preserve account history: invalid descriptor'))
    }

    const account = accountResult.unwrap()
    const preservedBalance = await this.ensureAccountHistorySnapshots(accountId, account, undefined, new Date(0), true)
    if (preservedBalance === null) {
      return Err(new Error('Failed to preserve full account history'))
    }

    const archivedAt = new Date().toISOString()
    const archived = this.db.transaction((): boolean => {
      if (!this.isAccountActive(accountId)) {
        return false
      }

      this.upsertAccountSnapshot(accountId, preservedBalance.toString(), archivedAt)
      return (
        this.db
          .prepare('UPDATE accounts SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
          .run(archivedAt, accountId).changes === 1
      )
    })()

    if (!archived) {
      return Err(new Error('Claim not found or already archived'))
    }
    this.invalidateAccountHistoryBackfill(accountId)
    return Ok(undefined)
  })

  public restoreAccount(accountId: string): Result<void, Error> {
    const restored = this.db.transaction((): boolean => {
      const result = this.db
        .prepare('UPDATE accounts SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
        .run(accountId)
      if (result.changes === 0) {
        return false
      }

      this.db.prepare('DELETE FROM account_history_syncs WHERE account_id = ?').run(accountId)
      return true
    })()

    if (!restored) {
      return Err(new Error('Claim not found or not archived'))
    }
    this.clearAccountHistoryBackfillState(accountId)
    return Ok(undefined)
  }

  // ─── Private Helpers ───────────────────────────────────────────────────

  private upsertAccountSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO balance_snapshots (account_id, timestamp, balance_sats)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, timestamp) DO UPDATE SET balance_sats = excluded.balance_sats`,
      )
      .run(accountId, timestamp, balanceSats)
  }

  private isAccountActive(accountId: string): boolean {
    return (
      this.db.prepare('SELECT 1 AS one FROM accounts WHERE id = ? AND deleted_at IS NULL').get(accountId) !== undefined
    )
  }

  private getAccountRows(
    filterIds?: string[],
    includeArchived = false,
  ): Array<{ id: string; descriptor: string; network: string }> {
    const archivedClause = includeArchived ? '' : 'WHERE deleted_at IS NULL'
    if (filterIds !== undefined) {
      if (filterIds.length === 0) {
        return []
      }
      const placeholders = filterIds.map(() => '?').join(', ')
      return this.db
        .prepare(
          `SELECT id, descriptor, network FROM accounts WHERE id IN (${placeholders})${includeArchived ? '' : ' AND deleted_at IS NULL'} ORDER BY created_at DESC`,
        )
        .all(...filterIds) as Array<{ id: string; descriptor: string; network: string }>
    }
    return this.db
      .prepare(`SELECT id, descriptor, network FROM accounts ${archivedClause} ORDER BY created_at DESC`)
      .all() as Array<{
      id: string
      descriptor: string
      network: string
    }>
  }

  private recordExchangeSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO exchange_balance_snapshots (account_id, timestamp, balance_sats)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, timestamp) DO UPDATE SET balance_sats = excluded.balance_sats`,
      )
      .run(accountId, timestamp, balanceSats)
  }

  private getExchangeSnapshots(accountId: string): Array<{ balance_sats: string; timestamp: string }> {
    return this.db
      .prepare(
        'SELECT balance_sats, timestamp FROM exchange_balance_snapshots WHERE account_id = ? ORDER BY timestamp ASC',
      )
      .all(accountId) as Array<{ balance_sats: string; timestamp: string }>
  }

  private getAccountSnapshotEntries(accountId: string, throughTimestamp?: string): BalanceEntry[] {
    const snapshots = this.getAccountSnapshots(accountId, throughTimestamp)
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

  private getArchivedAccountSnapshotEntries(): BalanceEntry[] {
    const activeAccounts = new Set(
      (
        this.db.prepare('SELECT descriptor, network FROM accounts WHERE deleted_at IS NULL').all() as Array<{
          descriptor: string
          network: string
        }>
      ).map((row) => accountDescriptorNetworkKey(row.descriptor, row.network)),
    )

    const archivedRows = this.db
      .prepare(
        'SELECT id, descriptor, network, deleted_at FROM accounts WHERE deleted_at IS NOT NULL ORDER BY created_at DESC',
      )
      .all() as Array<{ id: string; descriptor: string; network: string; deleted_at: string }>

    const allEntries: BalanceEntry[] = []

    for (const row of archivedRows) {
      if (activeAccounts.has(accountDescriptorNetworkKey(row.descriptor, row.network))) {
        continue
      }

      const entries = this.getAccountSnapshotEntries(row.id, row.deleted_at)
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

  private getAccountSnapshots(accountId: string, throughTimestamp?: string): BalanceSnapshotRow[] {
    if (throughTimestamp !== undefined) {
      return this.db
        .prepare(
          'SELECT balance_sats, timestamp FROM balance_snapshots WHERE account_id = ? AND timestamp <= ? ORDER BY timestamp ASC',
        )
        .all(accountId, throughTimestamp) as BalanceSnapshotRow[]
    }

    return this.db
      .prepare('SELECT balance_sats, timestamp FROM balance_snapshots WHERE account_id = ? ORDER BY timestamp ASC')
      .all(accountId) as BalanceSnapshotRow[]
  }

  private getLatestAccountSnapshotBalance(accountId: string): bigint | null {
    const row = this.db
      .prepare('SELECT balance_sats FROM balance_snapshots WHERE account_id = ? ORDER BY timestamp DESC LIMIT 1')
      .get(accountId) as { balance_sats: string } | undefined

    return row ? BigInt(row.balance_sats) : null
  }

  private queueAccountHistoryBackfill(
    accountId: string,
    account: Account,
    currentBalance: bigint,
    rangeStart: Date,
    fullHistory: boolean,
    balanceTip?: Block,
  ): void {
    if (!this.isAccountActive(accountId)) {
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
      .then((preservedBalance) => {
        if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
          return
        }
        if (preservedBalance !== null) {
          this.clearAccountHistoryBackfillRetry(accountId)
          return
        }

        const retryDelayMs = this.scheduleAccountHistoryBackfillRetry(accountId)
        this.logger.warn({ accountId, retryDelayMs }, 'Self-custody history backfill retry scheduled')
      })
      .catch((err: unknown) => {
        if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
          return
        }
        const retryDelayMs = this.scheduleAccountHistoryBackfillRetry(accountId)
        this.logger.warn({ accountId, err, retryDelayMs }, 'Self-custody history backfill failed')
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

  private canContinueAccountHistoryBackfill(accountId: string, generation: number): boolean {
    return this.getAccountHistoryBackfillGeneration(accountId) === generation && this.isAccountActive(accountId)
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
      const activeIds = accountRows.filter((row) => this.isAccountActive(row.id)).map((row) => row.id)
      return {
        // Keep polling after a connection failure, but never certify an unknown tip.
        historySyncingAccountIds: activeIds,
        historySyncedAccountIds: [],
        historyRefreshingAccountIds: activeIds.filter((id) =>
          this.hasCurrentVersionAccountHistorySync(id, fullHistory),
        ),
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
      if (!this.isAccountActive(row.id)) {
        continue
      }
      const missingRanges = this.getMissingAccountHistorySyncRanges(row.id, requestedRange)
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
    if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
      return null
    }
    const tipResult = await this.onchainProvider.getBlocksTip()
    if (tipResult.isErr()) {
      this.logger.warn({ accountId, err: tipResult.unwrapErr() }, 'Failed to inspect chain tip for history backfill')
      return null
    }
    if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
      return null
    }

    let tip = tipResult.unwrap()
    const requestedRange = fullHistory
      ? { fromBlockHeight: 0, toBlockHeight: tip.height }
      : historySyncRangeForStartDate(rangeStart, tip)
    let missingRanges = this.getMissingAccountHistorySyncRanges(accountId, requestedRange)
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
      if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
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
      if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
        return null
      }

      const verifiedTipResult = await this.onchainProvider.getBlocksTip()
      if (verifiedTipResult.isErr()) {
        this.logger.warn({ accountId, err: verifiedTipResult.unwrapErr() }, 'Failed to verify history chain tip')
        return null
      }
      if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
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
      if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
        return null
      }

      const tailResult = await this.getTransactionEntriesByAccountSinceBlock(account, tip.height)
      if (tailResult.isErr()) {
        return null
      }
      if (!this.canContinueAccountHistoryBackfill(accountId, generation)) {
        return null
      }
      transactionEntries = [
        ...transactionEntries.filter((entry) => entry.blockHeight !== null && entry.blockHeight <= tip.height),
        ...tailResult.unwrap().filter((entry) => entry.blockHeight !== null && entry.blockHeight > tip.height),
      ]
      tip = verifiedTip
      requestedRange.toBlockHeight = tip.height
      missingRanges = this.getMissingAccountHistorySyncRanges(accountId, requestedRange)
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
    let runningBalance = startBalance

    this.recordAccountSnapshot(accountId, startBalance.toString(), rangeStartTime.toISOString())

    for (const delta of deltas) {
      runningBalance += delta.value
      this.recordAccountSnapshot(accountId, runningBalance.toString(), delta.timestamp.toISOString())
    }

    this.recordAccountSnapshot(accountId, reconstructionBalance.toString(), currentSnapshotTime.toISOString())
    const reconciledSnapshotCount = this.reconcileAccountSnapshots(
      accountId,
      rangeStartTime,
      currentSnapshotTime,
      startBalance,
      deltas,
    )

    for (const missingRange of missingRanges) {
      this.recordAccountHistorySync(accountId, missingRange, tip)
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

  private reconcileAccountSnapshots(
    accountId: string,
    rangeStart: Date,
    rangeEnd: Date,
    startBalance: bigint,
    deltas: BalanceEntry[],
  ): number {
    const snapshots = this.db
      .prepare(
        `SELECT balance_sats, timestamp
         FROM balance_snapshots
         WHERE account_id = ? AND timestamp >= ? AND timestamp <= ?
         ORDER BY timestamp ASC`,
      )
      .all(accountId, rangeStart.toISOString(), rangeEnd.toISOString()) as BalanceSnapshotRow[]

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

      this.recordAccountSnapshot(accountId, runningBalance.toString(), snapshot.timestamp)
      updatedCount++
    }

    return updatedCount
  }

  private hasCurrentVersionAccountHistorySync(accountId: string, fromGenesis = false): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS one
         FROM account_history_syncs
         WHERE account_id = ? AND sync_version >= ?
           AND (? = 0 OR from_block_height = 0)
         LIMIT 1`,
      )
      .get(accountId, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION, Number(fromGenesis)) as { one: number } | undefined

    return row !== undefined
  }

  private getMissingAccountHistorySyncRanges(accountId: string, requestedRange: BlockRange): BlockRange[] {
    const rows = this.db
      .prepare(
        `SELECT from_block_height, to_block_height, sync_version
         FROM account_history_syncs
         WHERE account_id = ?
           AND sync_version >= ?
           AND to_block_height >= ?
           AND from_block_height <= ?
         ORDER BY from_block_height ASC`,
      )
      .all(
        accountId,
        CURRENT_ACCOUNT_HISTORY_SYNC_VERSION,
        requestedRange.fromBlockHeight,
        requestedRange.toBlockHeight,
      ) as AccountHistorySyncRow[]

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

  private recordAccountHistorySync(accountId: string, range: BlockRange, tip: Block): void {
    if (!this.isAccountActive(accountId)) {
      return
    }
    this.db.transaction(() => {
      // Coalesce only equally certified coverage. Never bridge an unscanned
      // block or promote an older version's range without actually scanning it.
      const rows = this.db
        .prepare(
          `SELECT from_block_height, to_block_height, sync_version FROM account_history_syncs
           WHERE account_id = ? AND sync_version = ?`,
        )
        .all(accountId, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION) as AccountHistorySyncRow[]
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
      this.db
        .prepare(
          `DELETE FROM account_history_syncs WHERE account_id = ? AND sync_version = ?
           AND from_block_height >= ? AND to_block_height <= ?`,
        )
        .run(accountId, CURRENT_ACCOUNT_HISTORY_SYNC_VERSION, mergedRange.fromBlockHeight, mergedRange.toBlockHeight)
      this.db
        .prepare(
          `INSERT INTO account_history_syncs (
           account_id,
           from_block_height,
           to_block_height,
           range_start,
           range_end,
           sync_version,
           synced_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id, from_block_height, to_block_height)
         DO UPDATE SET
           range_start = excluded.range_start,
           range_end = excluded.range_end,
           sync_version = excluded.sync_version,
           synced_at = excluded.synced_at`,
        )
        .run(
          accountId,
          mergedRange.fromBlockHeight,
          mergedRange.toBlockHeight,
          estimateTimestampForBlockHeight(mergedRange.fromBlockHeight, tip).toISOString(),
          estimateTimestampForBlockHeight(mergedRange.toBlockHeight, tip).toISOString(),
          CURRENT_ACCOUNT_HISTORY_SYNC_VERSION,
          new Date().toISOString(),
        )
    })()
  }

  /**
   * Record balance snapshots for ALL accounts (on-chain + exchange).
   * Called on startup and periodically to build chart data.
   */
  public recordAllSnapshots = asyncFn(async (): Promise<Result<void, Error>> => {
    const now = new Date().toISOString()

    // ─── On-chain accounts ─────────────────────────────────────
    const accountRows = this.getAccountRows()

    if (accountRows.length > 0) {
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
        const balancesResult = await this.onchainProvider.getConfirmedAccountBalances(accounts)
        if (balancesResult.isErr()) {
          this.logger.warn({ err: balancesResult.unwrapErr() }, 'Failed to record on-chain snapshots')
        } else {
          for (const [account, balance] of balancesResult.unwrap()) {
            const accountId = idMap.get(account.toString())
            if (accountId) {
              this.recordAccountSnapshot(accountId, balance.toString(), now)
            }
          }
          this.logger.info({ count: accounts.size }, 'Recorded on-chain balance snapshots')
        }
      }
    }

    // ─── Exchange accounts (Strike, Robinhood, etc.) ───────────
    const exchangeAccounts = this.exchangeService.listAccounts()
    if (exchangeAccounts.length > 0) {
      let recorded = 0
      for (const account of exchangeAccounts) {
        const result = await this.exchangeService.refreshBalance(account.id)
        if (result.isErr()) {
          this.logger.warn(
            { accountId: account.id, exchange: account.exchange, err: result.unwrapErr() },
            'Failed to refresh exchange balance for snapshot',
          )
          continue
        }
        const refreshed = result.unwrap()
        this.recordExchangeSnapshot(account.id, refreshed.balanceSats ?? '0', now)
        recorded++
      }
      this.logger.info({ count: recorded }, 'Recorded exchange balance snapshots')
    }

    // ─── Manual accounts (no refresh — just persist stored balance) ─
    const manualAccounts = this.manualService.listAccounts()
    for (const account of manualAccounts) {
      this.manualService.recordSnapshot(account.id, account.balanceSats, now)
    }
    if (manualAccounts.length > 0) {
      this.logger.info({ count: manualAccounts.length }, 'Recorded manual account balance snapshots')
    }

    // ─── ETF accounts (recompute balance — expense decay changes daily) ─
    const etfAccounts = this.etfService.listAccounts()
    for (const account of etfAccounts) {
      this.etfService.recordSnapshot(account.id, account.balanceSats, now)
    }
    if (etfAccounts.length > 0) {
      this.logger.info({ count: etfAccounts.length }, 'Recorded ETF account balance snapshots')
    }

    return Ok(undefined)
  })
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
