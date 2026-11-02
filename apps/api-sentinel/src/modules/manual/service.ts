import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import { manualAccounts, manualBalanceSnapshots, manualTransactions } from '../../db/schema'

export type ManualTransactionType = 'buy' | 'sell' | 'transfer_in' | 'transfer_out'

export interface ManualAccountDto {
  id: string
  displayName: string
  balanceSats: string
  balanceAsOf: string | null
  createdAt: string
}

export interface ManualTransactionDto {
  id: string
  accountId: string
  type: ManualTransactionType
  amountSats: string
  transactedAt: string
  note: string | null
  createdAt: string
}

export class ManualService {
  private readonly db: SentinelDb
  private readonly logger: Logger

  public constructor(deps: { db: SentinelDb; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'manual-service' })
  }

  public async createAccount(args: {
    displayName: string
    balanceSats: string
    balanceAsOf: string
  }): Promise<Result<ManualAccountDto, Error>> {
    const id = nanoid()
    const now = new Date().toISOString()
    await this.db.batch([
      this.db.insert(manualAccounts).values({
        id,
        displayName: args.displayName,
        balanceSats: args.balanceSats,
        balanceAsOf: args.balanceAsOf,
        createdAt: now,
      }),
      this.db
        .insert(manualBalanceSnapshots)
        .values({ accountId: id, balanceSats: args.balanceSats, timestamp: args.balanceAsOf }),
    ])
    this.logger.info({ id, displayName: args.displayName, balanceSats: args.balanceSats }, 'Manual account created')
    return Ok({
      id,
      displayName: args.displayName,
      balanceSats: args.balanceSats,
      balanceAsOf: args.balanceAsOf,
      createdAt: now,
    })
  }

  public async listAccounts(): Promise<ManualAccountDto[]> {
    return this.db.select().from(manualAccounts).orderBy(desc(manualAccounts.createdAt))
  }

  public async getAccount(id: string, db: SentinelDb | SentinelTx = this.db): Promise<ManualAccountDto | null> {
    const [account] = await db.select().from(manualAccounts).where(eq(manualAccounts.id, id))
    return account ?? null
  }

  public async updateBalance(args: {
    accountId: string
    balanceSats: string
    balanceAsOf: string
  }): Promise<Result<ManualAccountDto, Error>> {
    return this.db.transaction(async (tx) => {
      const account = await this.getAccount(args.accountId, tx)
      if (!account) {
        return Err(new Error('Manual account not found'))
      }
      const netTxTotal = await this.getNetTransactionTotal(args.accountId, tx)
      if (BigInt(args.balanceSats) < netTxTotal) {
        return Err(new Error(`Balance cannot be less than net transaction total (${netTxTotal.toString()} sats)`))
      }
      await tx
        .update(manualAccounts)
        .set({ balanceSats: args.balanceSats, balanceAsOf: args.balanceAsOf })
        .where(eq(manualAccounts.id, args.accountId))
      // The new balance holds from its date on, replacing any saved after it.
      await tx
        .delete(manualBalanceSnapshots)
        .where(
          and(
            eq(manualBalanceSnapshots.accountId, args.accountId),
            gt(manualBalanceSnapshots.timestamp, args.balanceAsOf),
          ),
        )
      await this.insertSnapshot(tx, args.accountId, args.balanceSats, args.balanceAsOf)
      this.logger.info({ accountId: args.accountId, balanceSats: args.balanceSats }, 'Manual account balance updated')
      return Ok({ ...account, balanceSats: args.balanceSats, balanceAsOf: args.balanceAsOf })
    })
  }

  public async renameAccount(args: {
    accountId: string
    displayName: string
  }): Promise<Result<ManualAccountDto, Error>> {
    const [account] = await this.db
      .update(manualAccounts)
      .set({ displayName: args.displayName })
      .where(eq(manualAccounts.id, args.accountId))
      .returning()
    if (!account) {
      return Err(new Error('Manual account not found'))
    }
    this.logger.info({ accountId: args.accountId, displayName: args.displayName }, 'Manual account renamed')
    return Ok(account)
  }

  public async removeAccount(accountId: string): Promise<Result<void, Error>> {
    const removed = await this.db.delete(manualAccounts).where(eq(manualAccounts.id, accountId))
    if (removed.rowsAffected === 0) {
      return Err(new Error('Manual account not found'))
    }
    this.logger.info({ accountId }, 'Manual account removed')
    return Ok(undefined)
  }

  public async addTransaction(args: {
    accountId: string
    type: ManualTransactionType
    amountSats: string
    transactedAt: string
    note?: string
    addToBalance?: boolean
  }): Promise<Result<ManualTransactionDto, Error>> {
    return this.db.transaction(async (tx) => {
      const account = await this.getAccount(args.accountId, tx)
      if (!account) {
        return Err(new Error('Manual account not found'))
      }
      const id = nanoid()
      const now = new Date().toISOString()
      const signedAmount = this.getSignedAmount(args.type, BigInt(args.amountSats))
      const currentBalance = BigInt(account.balanceSats)
      const netTxTotal = await this.getNetTransactionTotal(args.accountId, tx)
      const newNetTotal = netTxTotal + signedAmount

      let newBalance = currentBalance
      if (args.addToBalance === true) {
        newBalance = currentBalance + signedAmount
        if (newBalance < 0n) {
          newBalance = 0n
        }
      } else if (newNetTotal > currentBalance) {
        return Err(
          new Error(
            'Transaction total would exceed the current balance. Check "Add this amount to balance" or update the balance first.',
          ),
        )
      }

      if (args.addToBalance === true) {
        await tx
          .update(manualAccounts)
          .set({ balanceSats: newBalance.toString(), balanceAsOf: args.transactedAt })
          .where(eq(manualAccounts.id, args.accountId))
        await this.addToSavedBalances(tx, args.accountId, args.transactedAt, signedAmount)
      }
      await tx.insert(manualTransactions).values({
        id,
        accountId: args.accountId,
        type: args.type,
        amountSats: args.amountSats,
        transactedAt: args.transactedAt,
        note: args.note ?? null,
        createdAt: now,
      })
      if (args.addToBalance === true) {
        this.logger.info(
          { accountId: args.accountId, oldBalance: currentBalance.toString(), newBalance: newBalance.toString() },
          'Updated balance per addToBalance flag',
        )
      }
      this.logger.info(
        { id, accountId: args.accountId, type: args.type, amountSats: args.amountSats },
        'Manual transaction added',
      )
      return Ok({
        id,
        accountId: args.accountId,
        type: args.type,
        amountSats: args.amountSats,
        transactedAt: args.transactedAt,
        note: args.note ?? null,
        createdAt: now,
      })
    })
  }

  public async listTransactions(accountId: string): Promise<ManualTransactionDto[]> {
    return this.db
      .select()
      .from(manualTransactions)
      .where(eq(manualTransactions.accountId, accountId))
      .orderBy(desc(manualTransactions.transactedAt))
  }

  public async deleteTransaction(transactionId: string): Promise<Result<void, Error>> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(manualTransactions).where(eq(manualTransactions.id, transactionId))
      if (!row) {
        return Err(new Error('Transaction not found'))
      }
      const account = await this.getAccount(row.accountId, tx)
      if (!account) {
        return Err(new Error('Manual account not found'))
      }
      const signedAmount = this.getSignedAmount(row.type, BigInt(row.amountSats))
      const newBalance = BigInt(account.balanceSats) - signedAmount
      await tx.delete(manualTransactions).where(eq(manualTransactions.id, transactionId))
      await tx
        .update(manualAccounts)
        .set({ balanceSats: newBalance.toString() })
        .where(eq(manualAccounts.id, row.accountId))
      await this.addToSavedBalances(tx, row.accountId, row.transactedAt, -signedAmount)
      this.logger.info({ transactionId, accountId: row.accountId }, 'Manual transaction deleted')
      return Ok(undefined)
    })
  }

  /**
   * Balance changes for the portfolio chart. Each saved balance is what the
   * account held from its date on; transactions logged before the first one
   * show how the account got there.
   */
  public async getHistoryEntries(accountIds?: string[]): Promise<Array<{ timestamp: Date; value: bigint }>> {
    if (accountIds?.length === 0) {
      return []
    }
    const [transactions, snapshots] = await Promise.all([
      this.db
        .select({
          accountId: manualTransactions.accountId,
          type: manualTransactions.type,
          amountSats: manualTransactions.amountSats,
          transactedAt: manualTransactions.transactedAt,
        })
        .from(manualTransactions)
        .where(accountIds ? inArray(manualTransactions.accountId, accountIds) : undefined),
      this.db
        .select({
          accountId: manualBalanceSnapshots.accountId,
          balanceSats: manualBalanceSnapshots.balanceSats,
          timestamp: manualBalanceSnapshots.timestamp,
        })
        .from(manualBalanceSnapshots)
        .where(accountIds ? inArray(manualBalanceSnapshots.accountId, accountIds) : undefined),
    ])
    // A transaction sorts before a balance saved at the same time.
    const events = [
      ...transactions.map((row) => ({
        accountId: row.accountId,
        time: new Date(row.transactedAt).getTime(),
        order: 0,
        delta: this.getSignedAmount(row.type, BigInt(row.amountSats)),
        balance: null,
      })),
      ...snapshots.map((row) => ({
        accountId: row.accountId,
        time: new Date(row.timestamp).getTime(),
        order: 1,
        delta: 0n,
        balance: BigInt(row.balanceSats),
      })),
    ].sort((a, b) => a.time - b.time || a.order - b.order)

    const balances = new Map<string, bigint>()
    const savedBalanceAccounts = new Set<string>()
    const entries: Array<{ timestamp: Date; value: bigint }> = []
    for (const event of events) {
      if (event.balance === null && savedBalanceAccounts.has(event.accountId)) {
        continue // Saved balances already include later transactions.
      }
      if (event.balance !== null) {
        savedBalanceAccounts.add(event.accountId)
      }
      const previous = balances.get(event.accountId) ?? 0n
      const next = event.balance ?? previous + event.delta
      balances.set(event.accountId, next)
      if (next !== previous) {
        entries.push({ timestamp: new Date(event.time), value: next - previous })
      }
    }
    return entries
  }

  /** Saves the account's current balance, unless a balance dated later was saved since `timestamp`. */
  public async recordSnapshot(accountId: string, timestamp: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const account = await this.getAccount(accountId, tx)
      const [later] = await tx
        .select({ id: manualBalanceSnapshots.id })
        .from(manualBalanceSnapshots)
        .where(and(eq(manualBalanceSnapshots.accountId, accountId), gt(manualBalanceSnapshots.timestamp, timestamp)))
        .limit(1)
      if (account && !later) {
        await this.insertSnapshot(tx, accountId, account.balanceSats, timestamp)
      }
    })
  }

  /**
   * Applies a balance change dated `timestamp` to every balance saved from then on, and saves
   * the changed balance at that date. Before the first saved balance, the transaction itself
   * charts the change.
   */
  private async addToSavedBalances(tx: SentinelTx, accountId: string, timestamp: string, delta: bigint): Promise<void> {
    const [atOrBefore] = await tx
      .select({ timestamp: manualBalanceSnapshots.timestamp, balanceSats: manualBalanceSnapshots.balanceSats })
      .from(manualBalanceSnapshots)
      .where(and(eq(manualBalanceSnapshots.accountId, accountId), lte(manualBalanceSnapshots.timestamp, timestamp)))
      .orderBy(desc(manualBalanceSnapshots.timestamp))
      .limit(1)
    await tx
      .update(manualBalanceSnapshots)
      .set({
        balanceSats: sql`cast(max(0, cast(${manualBalanceSnapshots.balanceSats} as integer) + cast(${delta.toString()} as integer)) as text)`,
      })
      .where(and(eq(manualBalanceSnapshots.accountId, accountId), gte(manualBalanceSnapshots.timestamp, timestamp)))
    if (atOrBefore && atOrBefore.timestamp !== timestamp) {
      const balance = BigInt(atOrBefore.balanceSats) + delta
      await this.insertSnapshot(tx, accountId, (balance < 0n ? 0n : balance).toString(), timestamp)
    }
  }

  private async insertSnapshot(
    db: SentinelDb | SentinelTx,
    accountId: string,
    balanceSats: string,
    timestamp: string,
  ): Promise<void> {
    await db
      .insert(manualBalanceSnapshots)
      .values({ accountId, timestamp, balanceSats })
      .onConflictDoUpdate({
        target: [manualBalanceSnapshots.accountId, manualBalanceSnapshots.timestamp],
        set: { balanceSats },
      })
  }

  public async getNetTransactionTotal(accountId: string, db: SentinelDb | SentinelTx = this.db): Promise<bigint> {
    const rows = await db
      .select({ type: manualTransactions.type, amountSats: manualTransactions.amountSats })
      .from(manualTransactions)
      .where(eq(manualTransactions.accountId, accountId))
    let total = 0n
    for (const row of rows) {
      total += this.getSignedAmount(row.type, BigInt(row.amountSats))
    }
    return total
  }

  private getSignedAmount(type: ManualTransactionType, amountSats: bigint): bigint {
    switch (type) {
      case 'buy':
      case 'transfer_in':
        return amountSats
      case 'sell':
      case 'transfer_out':
        return -amountSats
    }
  }
}
