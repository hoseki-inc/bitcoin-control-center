import {
  ETF_CONFIGS,
  type EtfTicker,
  computeBtcPerShare,
  computeHoldingBtcSats,
  getEtfConfig,
} from '@hoseki/packages/etfs/holdings'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { Logger } from 'pino'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import { etfAccounts, etfBalanceSnapshots, etfHoldings } from '../../db/schema'

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

export class EtfService {
  private readonly db: SentinelDb
  private readonly logger: Logger

  public constructor(deps: { db: SentinelDb; logger: Logger }) {
    this.db = deps.db
    this.logger = deps.logger.child({ module: 'etf-service' })
  }

  public async createAccount(args: {
    displayName: string
    holdings: Array<{ ticker: EtfTicker; shares: string; datePurchased?: string }>
  }): Promise<Result<EtfAccountDto, Error>> {
    const id = nanoid()
    const now = new Date().toISOString()
    const balanceSats = await this.db.transaction(async (tx) => {
      await tx.insert(etfAccounts).values({ id, displayName: args.displayName, createdAt: now })
      for (const holding of args.holdings) {
        await tx.insert(etfHoldings).values({
          id: nanoid(),
          accountId: id,
          ticker: holding.ticker,
          shares: holding.shares,
          datePurchased: holding.datePurchased ?? null,
          createdAt: now,
        })
      }
      const balance = await this.computeBalance(tx, id)
      await this.insertSnapshot(tx, id, balance.toString(), now)
      return balance.toString()
    })
    this.logger.info({ id, displayName: args.displayName, holdings: args.holdings.length }, 'ETF account created')
    return Ok({ id, displayName: args.displayName, balanceSats, createdAt: now })
  }

  public async listAccounts(): Promise<EtfAccountDto[]> {
    const rows = await this.db.select().from(etfAccounts).orderBy(desc(etfAccounts.createdAt))
    return Promise.all(
      rows.map(async (row) => ({
        id: row.id,
        displayName: row.displayName,
        createdAt: row.createdAt,
        balanceSats: (await this.computeAccountBalance(row.id)).toString(),
      })),
    )
  }

  public async getAccount(id: string): Promise<EtfAccountDto | null> {
    const [row] = await this.db.select().from(etfAccounts).where(eq(etfAccounts.id, id))
    return row ? { ...row, balanceSats: (await this.computeAccountBalance(id)).toString() } : null
  }

  public async renameAccount(args: { accountId: string; displayName: string }): Promise<Result<void, Error>> {
    const result = await this.db
      .update(etfAccounts)
      .set({ displayName: args.displayName })
      .where(eq(etfAccounts.id, args.accountId))
    if (result.rowsAffected === 0) {
      return Err(new Error('ETF account not found'))
    }
    this.logger.info({ accountId: args.accountId, displayName: args.displayName }, 'ETF account renamed')
    return Ok(undefined)
  }

  public async removeAccount(accountId: string): Promise<Result<void, Error>> {
    const result = await this.db.delete(etfAccounts).where(eq(etfAccounts.id, accountId))
    if (result.rowsAffected === 0) {
      return Err(new Error('ETF account not found'))
    }
    this.logger.info({ accountId }, 'ETF account removed')
    return Ok(undefined)
  }

  public async addHolding(args: {
    accountId: string
    ticker: EtfTicker
    shares: string
    datePurchased?: string
  }): Promise<Result<EtfHoldingDto, Error>> {
    const [account] = await this.db
      .select({ id: etfAccounts.id })
      .from(etfAccounts)
      .where(eq(etfAccounts.id, args.accountId))
    if (!account) {
      return Err(new Error('ETF account not found'))
    }
    const id = nanoid()
    const now = new Date().toISOString()
    await this.db.transaction(async (tx) => {
      await tx.insert(etfHoldings).values({
        id,
        accountId: args.accountId,
        ticker: args.ticker,
        shares: args.shares,
        datePurchased: args.datePurchased ?? null,
        createdAt: now,
      })
      const balanceSats = await this.computeBalance(tx, args.accountId)
      await this.insertSnapshot(tx, args.accountId, balanceSats.toString(), now)
    })
    const config = ETF_CONFIGS[args.ticker]
    const asOf = new Date()
    this.logger.info({ holdingId: id, accountId: args.accountId, ticker: args.ticker }, 'ETF holding added')
    return Ok({
      id,
      accountId: args.accountId,
      ticker: args.ticker,
      shares: args.shares,
      btcPerShare: computeBtcPerShare(config, asOf),
      btcSats: computeHoldingBtcSats(config, parseFloat(args.shares), asOf).toString(),
      datePurchased: args.datePurchased ?? null,
      createdAt: now,
    })
  }

  public async listHoldings(accountId: string): Promise<EtfHoldingDto[]> {
    const rows = await this.db
      .select()
      .from(etfHoldings)
      .where(eq(etfHoldings.accountId, accountId))
      .orderBy(asc(etfHoldings.createdAt))
    const asOf = new Date()
    return rows.map((row) => {
      const config = getEtfConfig(row.ticker)
      if (!config) {
        throw new Error('Stored ETF ticker is unsupported')
      }
      return {
        id: row.id,
        accountId: row.accountId,
        shares: row.shares,
        datePurchased: row.datePurchased,
        createdAt: row.createdAt,
        ticker: config.ticker,
        btcPerShare: computeBtcPerShare(config, asOf),
        btcSats: computeHoldingBtcSats(config, parseFloat(row.shares), asOf).toString(),
      }
    })
  }

  public async removeHolding(holdingId: string): Promise<Result<string, Error>> {
    const [row] = await this.db
      .select({ accountId: etfHoldings.accountId })
      .from(etfHoldings)
      .where(eq(etfHoldings.id, holdingId))
    if (!row) {
      return Err(new Error('ETF holding not found'))
    }
    await this.db.transaction(async (tx) => {
      await tx.delete(etfHoldings).where(eq(etfHoldings.id, holdingId))
      const balanceSats = await this.computeBalance(tx, row.accountId)
      await this.insertSnapshot(tx, row.accountId, balanceSats.toString(), new Date().toISOString())
    })
    this.logger.info({ holdingId, accountId: row.accountId }, 'ETF holding removed')
    return Ok(row.accountId)
  }

  public async getSnapshots(accountId: string): Promise<Array<{ balance_sats: string; timestamp: string }>> {
    return this.db
      .select({ balance_sats: etfBalanceSnapshots.balanceSats, timestamp: etfBalanceSnapshots.timestamp })
      .from(etfBalanceSnapshots)
      .where(eq(etfBalanceSnapshots.accountId, accountId))
      .orderBy(asc(etfBalanceSnapshots.timestamp))
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
      .insert(etfBalanceSnapshots)
      .values({ accountId, timestamp, balanceSats })
      .onConflictDoUpdate({
        target: [etfBalanceSnapshots.accountId, etfBalanceSnapshots.timestamp],
        set: { balanceSats },
      })
  }

  public async getAccumulationEntries(accountIds: string[]): Promise<Array<{ timestamp: Date; value: bigint }>> {
    if (accountIds.length === 0) {
      return []
    }
    const rows = await this.db
      .select({
        ticker: etfHoldings.ticker,
        shares: etfHoldings.shares,
        datePurchased: etfHoldings.datePurchased,
        createdAt: etfHoldings.createdAt,
      })
      .from(etfHoldings)
      .where(inArray(etfHoldings.accountId, accountIds))
      .orderBy(asc(sql`coalesce(${etfHoldings.datePurchased}, ${etfHoldings.createdAt})`))
    return rows.map((row) => {
      const config = getEtfConfig(row.ticker)
      if (!config) {
        return { timestamp: new Date(row.datePurchased ?? row.createdAt), value: 0n }
      }
      return {
        timestamp: new Date(row.datePurchased ?? row.createdAt),
        value: computeHoldingBtcSats(config, parseFloat(row.shares), new Date()),
      }
    })
  }

  public async computeAccountBalance(accountId: string): Promise<bigint> {
    return this.computeBalance(this.db, accountId)
  }

  private async computeBalance(db: SentinelDb | SentinelTx, accountId: string): Promise<bigint> {
    const rows = await db
      .select({ ticker: etfHoldings.ticker, shares: etfHoldings.shares })
      .from(etfHoldings)
      .where(eq(etfHoldings.accountId, accountId))
    const asOf = new Date()
    let totalSats = 0n
    for (const row of rows) {
      const config = getEtfConfig(row.ticker)
      if (config) {
        totalSats += computeHoldingBtcSats(config, parseFloat(row.shares), asOf)
      }
    }
    return totalSats
  }
}
