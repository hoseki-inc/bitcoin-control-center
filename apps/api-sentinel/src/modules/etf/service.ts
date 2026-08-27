import { ETF_CONFIGS, type EtfTicker, computeBtcPerShare, computeHoldingBtcSats } from '@hoseki/packages/etfs/holdings'
import { Err, Ok } from '@patina/core'
import type { Result } from '@patina/core'
import type Database from 'better-sqlite3'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface EtfAccountDto {
  id: string
  displayName: string
  balanceSats: string
  createdAt: string
}

export interface EtfHoldingDto {
  id: string
  accountId: string
  ticker: EtfTicker
  shares: string
  btcPerShare: number
  btcSats: string
  datePurchased: string | null
  createdAt: string
}

// ─── Service ────────────────────────────────────────────────────────────────

export class EtfService {
  private readonly db: Database.Database
  private readonly logger: Logger

  public constructor(deps: { db: Database.Database; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'etf-service' })
  }

  // ─── Accounts ───────────────────────────────────────────────────────────

  public createAccount(args: {
    displayName: string
    holdings: Array<{ ticker: EtfTicker; shares: string; datePurchased?: string }>
  }): Result<EtfAccountDto, Error> {
    const accountId = nanoid()
    const now = new Date().toISOString()

    this.db
      .prepare('INSERT INTO etf_accounts (id, display_name, created_at) VALUES (?, ?, ?)')
      .run(accountId, args.displayName, now)

    for (const holding of args.holdings) {
      const holdingId = nanoid()
      this.db
        .prepare(
          'INSERT INTO etf_holdings (id, account_id, ticker, shares, date_purchased, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(holdingId, accountId, holding.ticker, holding.shares, holding.datePurchased ?? null, now)
    }

    const balanceSats = this.computeAccountBalance(accountId).toString()
    this.recordSnapshot(accountId, balanceSats, now)

    this.logger.info(
      { id: accountId, displayName: args.displayName, holdings: args.holdings.length },
      'ETF account created',
    )
    return Ok({ id: accountId, displayName: args.displayName, balanceSats, createdAt: now })
  }

  public listAccounts(): EtfAccountDto[] {
    const rows = this.db.prepare('SELECT * FROM etf_accounts ORDER BY created_at DESC').all() as Array<{
      id: string
      display_name: string
      created_at: string
    }>

    return rows.map((row) => ({
      id: row.id,
      displayName: row.display_name,
      balanceSats: this.computeAccountBalance(row.id).toString(),
      createdAt: row.created_at,
    }))
  }

  public getAccount(id: string): EtfAccountDto | null {
    const row = this.db.prepare('SELECT * FROM etf_accounts WHERE id = ?').get(id) as
      | { id: string; display_name: string; created_at: string }
      | undefined

    if (!row) return null

    return {
      id: row.id,
      displayName: row.display_name,
      balanceSats: this.computeAccountBalance(row.id).toString(),
      createdAt: row.created_at,
    }
  }

  public renameAccount(args: { accountId: string; displayName: string }): Result<void, Error> {
    const result = this.db
      .prepare('UPDATE etf_accounts SET display_name = ? WHERE id = ?')
      .run(args.displayName, args.accountId)
    if (result.changes === 0) return Err(new Error('ETF account not found'))
    this.logger.info({ accountId: args.accountId, displayName: args.displayName }, 'ETF account renamed')
    return Ok(undefined)
  }

  public removeAccount(accountId: string): Result<void, Error> {
    const result = this.db.prepare('DELETE FROM etf_accounts WHERE id = ?').run(accountId)
    if (result.changes === 0) return Err(new Error('ETF account not found'))
    this.logger.info({ accountId }, 'ETF account removed')
    return Ok(undefined)
  }

  // ─── Holdings ─────────────────────────────────────────────────────────────

  public addHolding(args: {
    accountId: string
    ticker: EtfTicker
    shares: string
    datePurchased?: string
  }): Result<EtfHoldingDto, Error> {
    const account = this.db.prepare('SELECT id FROM etf_accounts WHERE id = ?').get(args.accountId) as
      | { id: string }
      | undefined
    if (!account) return Err(new Error('ETF account not found'))

    const id = nanoid()
    const now = new Date().toISOString()

    this.db
      .prepare(
        'INSERT INTO etf_holdings (id, account_id, ticker, shares, date_purchased, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, args.accountId, args.ticker, args.shares, args.datePurchased ?? null, now)

    // Update snapshot
    const balanceSats = this.computeAccountBalance(args.accountId).toString()
    this.recordSnapshot(args.accountId, balanceSats, now)

    const config = ETF_CONFIGS[args.ticker]
    const asOf = new Date()
    const btcPerShare = computeBtcPerShare(config, asOf)
    const btcSats = computeHoldingBtcSats(config, parseFloat(args.shares), asOf).toString()

    this.logger.info({ holdingId: id, accountId: args.accountId, ticker: args.ticker }, 'ETF holding added')
    return Ok({
      id,
      accountId: args.accountId,
      ticker: args.ticker,
      shares: args.shares,
      btcPerShare,
      btcSats,
      datePurchased: args.datePurchased ?? null,
      createdAt: now,
    })
  }

  public listHoldings(accountId: string): EtfHoldingDto[] {
    const rows = this.db
      .prepare('SELECT * FROM etf_holdings WHERE account_id = ? ORDER BY created_at ASC')
      .all(accountId) as Array<{
      id: string
      account_id: string
      ticker: string
      shares: string
      date_purchased: string | null
      created_at: string
    }>

    const asOf = new Date()

    return rows.map((row) => {
      const ticker = row.ticker as EtfTicker
      const config = ETF_CONFIGS[ticker]
      const shares = parseFloat(row.shares)
      return {
        id: row.id,
        accountId: row.account_id,
        ticker,
        shares: row.shares,
        btcPerShare: computeBtcPerShare(config, asOf),
        btcSats: computeHoldingBtcSats(config, shares, asOf).toString(),
        datePurchased: row.date_purchased,
        createdAt: row.created_at,
      }
    })
  }

  public removeHolding(holdingId: string): Result<string, Error> {
    const row = this.db.prepare('SELECT account_id FROM etf_holdings WHERE id = ?').get(holdingId) as
      | { account_id: string }
      | undefined
    if (!row) return Err(new Error('ETF holding not found'))

    this.db.prepare('DELETE FROM etf_holdings WHERE id = ?').run(holdingId)

    // Update snapshot
    const now = new Date().toISOString()
    const balanceSats = this.computeAccountBalance(row.account_id).toString()
    this.recordSnapshot(row.account_id, balanceSats, now)

    this.logger.info({ holdingId, accountId: row.account_id }, 'ETF holding removed')
    return Ok(row.account_id)
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  public getSnapshots(accountId: string): Array<{ balance_sats: string; timestamp: string }> {
    return this.db
      .prepare('SELECT balance_sats, timestamp FROM etf_balance_snapshots WHERE account_id = ? ORDER BY timestamp ASC')
      .all(accountId) as Array<{ balance_sats: string; timestamp: string }>
  }

  public recordSnapshot(accountId: string, balanceSats: string, timestamp: string): void {
    this.db
      .prepare(
        `INSERT INTO etf_balance_snapshots (account_id, timestamp, balance_sats)
         VALUES (?, ?, ?)
         ON CONFLICT(account_id, timestamp) DO UPDATE SET balance_sats = excluded.balance_sats`,
      )
      .run(accountId, timestamp, balanceSats)
  }

  // ─── Accumulation Entries ────────────────────────────────────────────────

  /**
   * Get accumulation entries for the chart based on holdings' purchase dates.
   * Each holding with a datePurchased generates an entry with the BTC value
   * computed at that purchase date. Holdings without a date use createdAt.
   */
  public getAccumulationEntries(accountIds: string[]): Array<{ timestamp: Date; value: bigint }> {
    if (accountIds.length === 0) return []

    const placeholders = accountIds.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT ticker, shares, date_purchased, created_at FROM etf_holdings WHERE account_id IN (${placeholders}) ORDER BY COALESCE(date_purchased, created_at) ASC`,
      )
      .all(...accountIds) as Array<{
      ticker: string
      shares: string
      date_purchased: string | null
      created_at: string
    }>

    return rows.map((row) => {
      const config = ETF_CONFIGS[row.ticker as EtfTicker]
      if (!config) return { timestamp: new Date(row.date_purchased ?? row.created_at), value: 0n }
      const purchaseDate = new Date(row.date_purchased ?? row.created_at)
      const sats = computeHoldingBtcSats(config, parseFloat(row.shares), new Date())
      return { timestamp: purchaseDate, value: sats }
    })
  }

  // ─── Balance Computation ──────────────────────────────────────────────────

  public computeAccountBalance(accountId: string): bigint {
    const rows = this.db
      .prepare('SELECT ticker, shares FROM etf_holdings WHERE account_id = ?')
      .all(accountId) as Array<{ ticker: string; shares: string }>

    const asOf = new Date()
    let totalSats = 0n

    for (const row of rows) {
      const config = ETF_CONFIGS[row.ticker as EtfTicker]
      if (!config) continue
      totalSats += computeHoldingBtcSats(config, parseFloat(row.shares), asOf)
    }

    return totalSats
  }
}
