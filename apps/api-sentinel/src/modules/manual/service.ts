import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { asc, desc, eq, inArray } from 'drizzle-orm'
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
    await this.db.transaction(async (tx) => {
      await tx.insert(manualAccounts).values({
        id,
        displayName: args.displayName,
        balanceSats: args.balanceSats,
        balanceAsOf: args.balanceAsOf,
        createdAt: now,
      })
      await this.insertSnapshot(tx, id, args.balanceSats, args.balanceAsOf)
    })
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

  public async getAccount(id: string): Promise<ManualAccountDto | null> {
    const [account] = await this.db.select().from(manualAccounts).where(eq(manualAccounts.id, id))
    return account ?? null
  }

  public async updateBalance(args: {
    accountId: string
    balanceSats: string
    balanceAsOf: string
  }): Promise<Result<ManualAccountDto, Error>> {
    const account = await this.getAccount(args.accountId)
    if (!account) {
      return Err(new Error('Manual account not found'))
    }
    const netTxTotal = await this.getNetTransactionTotal(args.accountId)
    if (BigInt(args.balanceSats) < netTxTotal) {
      return Err(new Error(`Balance cannot be less than net transaction total (${netTxTotal.toString()} sats)`))
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(manualAccounts)
        .set({ balanceSats: args.balanceSats, balanceAsOf: args.balanceAsOf })
        .where(eq(manualAccounts.id, args.accountId))
      await this.insertSnapshot(tx, args.accountId, args.balanceSats, args.balanceAsOf)
    })
    this.logger.info({ accountId: args.accountId, balanceSats: args.balanceSats }, 'Manual account balance updated')
    return Ok({ ...account, balanceSats: args.balanceSats, balanceAsOf: args.balanceAsOf })
  }

  public async renameAccount(args: {
    accountId: string
    displayName: string
  }): Promise<Result<ManualAccountDto, Error>> {
    const account = await this.getAccount(args.accountId)
    if (!account) {
      return Err(new Error('Manual account not found'))
    }
    await this.db
      .update(manualAccounts)
      .set({ displayName: args.displayName })
      .where(eq(manualAccounts.id, args.accountId))
    this.logger.info({ accountId: args.accountId, displayName: args.displayName }, 'Manual account renamed')
    return Ok({ ...account, displayName: args.displayName })
  }

  public async removeAccount(accountId: string): Promise<Result<void, Error>> {
    const removed = await this.db
      .delete(manualAccounts)
      .where(eq(manualAccounts.id, accountId))
      .returning({ id: manualAccounts.id })
    if (removed.length === 0) {
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
    const account = await this.getAccount(args.accountId)
    if (!account) {
      return Err(new Error('Manual account not found'))
    }
    const id = nanoid()
    const now = new Date().toISOString()
    const signedAmount = this.getSignedAmount(args.type, BigInt(args.amountSats))
    const currentBalance = BigInt(account.balanceSats)
    const netTxTotal = await this.getNetTransactionTotal(args.accountId)
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

    await this.db.transaction(async (tx) => {
      if (args.addToBalance === true) {
        await tx
          .update(manualAccounts)
          .set({ balanceSats: newBalance.toString(), balanceAsOf: args.transactedAt })
          .where(eq(manualAccounts.id, args.accountId))
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
      await this.insertSnapshot(tx, args.accountId, newBalance.toString(), args.transactedAt)
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
  }

  public async listTransactions(accountId: string): Promise<ManualTransactionDto[]> {
    return this.db
      .select()
      .from(manualTransactions)
      .where(eq(manualTransactions.accountId, accountId))
      .orderBy(desc(manualTransactions.transactedAt))
  }

  public async deleteTransaction(transactionId: string): Promise<Result<void, Error>> {
    const [row] = await this.db.select().from(manualTransactions).where(eq(manualTransactions.id, transactionId))
    if (!row) {
      return Err(new Error('Transaction not found'))
    }
    const account = await this.getAccount(row.accountId)
    if (!account) {
      return Err(new Error('Manual account not found'))
    }
    const newBalance = BigInt(account.balanceSats) - this.getSignedAmount(row.type, BigInt(row.amountSats))
    const now = new Date().toISOString()
    await this.db.transaction(async (tx) => {
      await tx.delete(manualTransactions).where(eq(manualTransactions.id, transactionId))
      await tx
        .update(manualAccounts)
        .set({ balanceSats: newBalance.toString() })
        .where(eq(manualAccounts.id, row.accountId))
      await this.insertSnapshot(tx, row.accountId, newBalance.toString(), now)
    })
    this.logger.info({ transactionId, accountId: row.accountId }, 'Manual transaction deleted')
    return Ok(undefined)
  }

  public async getTransactionEntries(accountIds?: string[]): Promise<Array<{ timestamp: Date; value: bigint }>> {
    if (accountIds?.length === 0) {
      return []
    }
    const rows = await this.db
      .select({
        type: manualTransactions.type,
        amountSats: manualTransactions.amountSats,
        transactedAt: manualTransactions.transactedAt,
      })
      .from(manualTransactions)
      .where(accountIds ? inArray(manualTransactions.accountId, accountIds) : undefined)
      .orderBy(asc(manualTransactions.transactedAt))
    return rows.map((row) => ({
      timestamp: new Date(row.transactedAt),
      value: this.getSignedAmount(row.type, BigInt(row.amountSats)),
    }))
  }

  public async getSnapshots(accountId: string): Promise<Array<{ balance_sats: string; timestamp: string }>> {
    const rows = await this.db
      .select({ balance_sats: manualBalanceSnapshots.balanceSats, timestamp: manualBalanceSnapshots.timestamp })
      .from(manualBalanceSnapshots)
      .where(eq(manualBalanceSnapshots.accountId, accountId))
      .orderBy(asc(manualBalanceSnapshots.timestamp))
    return rows
  }

  public async recordSnapshot(accountId: string, balanceSats: string, timestamp: string): Promise<void> {
    await this.insertSnapshot(this.db, accountId, balanceSats, timestamp)
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

  public async getNetTransactionTotal(accountId: string): Promise<bigint> {
    const rows = await this.db
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
