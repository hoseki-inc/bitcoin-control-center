import { Err, Ok } from '@patina/core'
import type { Result } from '@patina/core'
import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'

// ─── Types ──────────────────────────────────────────────────────────────────

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

// ─── Service ────────────────────────────────────────────────────────────────

export class ManualService {
  private readonly db: Database.Database
  private readonly logger: Logger

  public constructor(deps: { db: Database.Database; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'manual-service' })
  }

  // ─── Accounts ───────────────────────────────────────────────────────────

  public createAccount(args: {
    displayName: string
    balanceSats: string
    balanceAsOf: string
  }): Result<ManualAccountDto, Error> {
    const id = nanoid()
    const now = new Date().toISOString()

    this.db
      .prepare(
        `INSERT INTO manual_accounts (id, display_name, balance_sats, balance_as_of, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, args.displayName, args.balanceSats, args.balanceAsOf, now)

    this.recordSnapshot(id, args.balanceSats, args.balanceAsOf)

    this.logger.info({ id, displayName: args.displayName, balanceSats: args.balanceSats }, 'Manual account created')
    return Ok({
      id,
      displayName: args.displayName,
      balanceSats: args.balanceSats,
      balanceAsOf: args.balanceAsOf,
      createdAt: now,
    })
  }

  public listAccounts(): ManualAccountDto[] {
    const rows = this.db.prepare('SELECT * FROM manual_accounts ORDER BY created_at DESC').all() as Array<{
      id: string
      display_name: string
      balance_sats: string
      balance_as_of: string | null
      created_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      balanceSats: row.balance_sats,
      balanceAsOf: row.balance_as_of,
      createdAt: row.created_at,
    }))
  }

  public getAccount(id: string): ManualAccountDto | null {
    const row = this.db.prepare('SELECT * FROM manual_accounts WHERE id = ?').get(id) as
      | {
          id: string
          display_name: string
          balance_sats: string
          balance_as_of: string | null
          created_at: string
        }
      | undefined

    if (!row) return null

    return {
      id: row.id,
      displayName: row.display_name,
      balanceSats: row.balance_sats,
      balanceAsOf: row.balance_as_of,
      createdAt: row.created_at,
    }
  }

  public updateBalance(args: {
    accountId: string
    balanceSats: string
    balanceAsOf: string
  }): Result<ManualAccountDto, Error> {
    const account = this.getAccount(args.accountId)
    if (!account) return Err(new Error('Manual account not found'))

    const netTxTotal = this.getNetTransactionTotal(args.accountId)
    const newBalance = BigInt(args.balanceSats)

    if (newBalance < netTxTotal) {
      return Err(new Error(`Balance cannot be less than net transaction total (${netTxTotal.toString()} sats)`))
    }

    this.db
      .prepare('UPDATE manual_accounts SET balance_sats = ?, balance_as_of = ? WHERE id = ?')
      .run(args.balanceSats, args.balanceAsOf, args.accountId)

    this.recordSnapshot(args.accountId, args.balanceSats, args.balanceAsOf)

    this.logger.info({ accountId: args.accountId, balanceSats: args.balanceSats }, 'Manual account balance updated')
    return Ok({
      ...account,
      balanceSats: args.balanceSats,
      balanceAsOf: args.balanceAsOf,
    })
  }

  public renameAccount(args: { accountId: string; displayName: string }): Result<ManualAccountDto, Error> {
    const account = this.getAccount(args.accountId)
    if (!account) return Err(new Error('Manual account not found'))

    this.db.prepare('UPDATE manual_accounts SET display_name = ? WHERE id = ?').run(args.displayName, args.accountId)

    this.logger.info({ accountId: args.accountId, displayName: args.displayName }, 'Manual account renamed')
    return Ok({ ...account, displayName: args.displayName })
  }

  public removeAccount(accountId: string): Result<void, Error> {
    const result = this.db.prepare('DELETE FROM manual_accounts WHERE id = ?').run(accountId)
    if (result.changes === 0) {
      return Err(new Error('Manual account not found'))
    }
    this.logger.info({ accountId }, 'Manual account removed')
    return Ok(undefined)
  }

  // ─── Transactions ───────────────────────────────────────────────────────

  public addTransaction(args: {
    accountId: string
    type: ManualTransactionType
    amountSats: string
    transactedAt: string
    note?: string
    addToBalance?: boolean
  }): Result<ManualTransactionDto, Error> {
    const account = this.getAccount(args.accountId)
    if (!account) return Err(new Error('Manual account not found'))

    const id = nanoid()
    const now = new Date().toISOString()
    const signedAmount = this.getSignedAmount(args.type, BigInt(args.amountSats))
    const currentBalance = BigInt(account.balanceSats)
    const netTxTotal = this.getNetTransactionTotal(args.accountId)
    const newNetTotal = netTxTotal + signedAmount

    let newBalance = currentBalance
    if (args.addToBalance) {
      newBalance = currentBalance + signedAmount
      if (newBalance < 0n) newBalance = 0n
      this.db
        .prepare('UPDATE manual_accounts SET balance_sats = ?, balance_as_of = ? WHERE id = ?')
        .run(newBalance.toString(), args.transactedAt, args.accountId)
      this.logger.info(
        { accountId: args.accountId, oldBalance: currentBalance.toString(), newBalance: newBalance.toString() },
        'Updated balance per addToBalance flag',
      )
    } else if (newNetTotal > currentBalance) {
      return Err(
        new Error(
          'Transaction total would exceed the current balance. Check "Add this amount to balance" or update the balance first.',
        ),
      )
    }

    this.db
      .prepare(
        `INSERT INTO manual_transactions (id, account_id, type, amount_sats, transacted_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, args.accountId, args.type, args.amountSats, args.transactedAt, args.note ?? null, now)

    this.recordSnapshot(args.accountId, newBalance.toString(), args.transactedAt)

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

  public listTransactions(accountId: string): ManualTransactionDto[] {
    const rows = this.db
      .prepare('SELECT * FROM manual_transactions WHERE account_id = ? ORDER BY transacted_at DESC')
      .all(accountId) as Array<{
      id: string
      account_id: string
      type: string
      amount_sats: string
      transacted_at: string
      note: string | null
      created_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      accountId: row.account_id,
      type: row.type as ManualTransactionType,
      amountSats: row.amount_sats,
      transactedAt: row.transacted_at,
      note: row.note,
      createdAt: row.created_at,
    }))
  }

  public deleteTransaction(transactionId: string): Result<void, Error> {
    const row = this.db
      .prepare('SELECT account_id, type, amount_sats FROM manual_transactions WHERE id = ?')
      .get(transactionId) as { account_id: string; type: string; amount_sats: string } | undefined

    if (!row) return Err(new Error('Transaction not found'))

    const account = this.getAccount(row.account_id)
    if (!account) return Err(new Error('Manual account not found'))

    // Reverse the balance effect
    const signedAmount = this.getSignedAmount(row.type as ManualTransactionType, BigInt(row.amount_sats))
    const currentBalance = BigInt(account.balanceSats)
    const newBalance = currentBalance - signedAmount

    this.db.prepare('DELETE FROM manual_transactions WHERE id = ?').run(transactionId)

    this.db
      .prepare('UPDATE manual_accounts SET balance_sats = ? WHERE id = ?')
      .run(newBalance.toString(), row.account_id)

    const now = new Date().toISOString()
    this.recordSnapshot(row.account_id, newBalance.toString(), now)

    this.logger.info({ transactionId, accountId: row.account_id }, 'Manual transaction deleted')
    return Ok(undefined)
  }

  // ─── Accumulation Chart ─────────────────────────────────────────────────

  public getTransactionEntries(accountIds?: string[]): Array<{ timestamp: Date; value: bigint }> {
    if (accountIds !== undefined && accountIds.length === 0) return []

    let query = 'SELECT type, amount_sats, transacted_at FROM manual_transactions'
    const params: string[] = []

    if (accountIds && accountIds.length > 0) {
      const placeholders = accountIds.map(() => '?').join(', ')
      query += ` WHERE account_id IN (${placeholders})`
      params.push(...accountIds)
    }

    query += ' ORDER BY transacted_at ASC'

    const rows = this.db.prepare(query).all(...params) as Array<{
      type: string
      amount_sats: string
      transacted_at: string
    }>

    return rows.map((row) => ({
      timestamp: new Date(row.transacted_at),
      value: this.getSignedAmount(row.type as ManualTransactionType, BigInt(row.amount_sats)),
    }))
  }

  // ─── Snapshots ──────────────────────────────────────────────────────────

  public getSnapshots(accountId: string): Array<{ balance_sats: string; timestamp: string }> {
    return this.db
      .prepare(
        'SELECT balance_sats, timestamp FROM manual_balance_snapshots WHERE account_id = ? ORDER BY timestamp ASC',
      )
      .all(accountId) as Array<{ balance_sats: string; timestamp: string }>
  }

  public recordSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO manual_balance_snapshots (account_id, timestamp, balance_sats)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, timestamp) DO UPDATE SET balance_sats = excluded.balance_sats`,
      )
      .run(accountId, timestamp, balanceSats)
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  public getNetTransactionTotal(accountId: string): bigint {
    const rows = this.db
      .prepare('SELECT type, amount_sats FROM manual_transactions WHERE account_id = ?')
      .all(accountId) as Array<{ type: string; amount_sats: string }>

    let total = 0n
    for (const row of rows) {
      total += this.getSignedAmount(row.type as ManualTransactionType, BigInt(row.amount_sats))
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
