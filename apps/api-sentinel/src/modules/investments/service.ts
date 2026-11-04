import { Err, Ok, type Result } from '@hoseki/packages/result'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import type { SentinelDb } from '../../db/drizzle'
import { investmentAccounts, investmentValuations } from '../../db/schema'

export interface InvestmentValuationInput {
  valueCents: string
  valuedAt: string
  note?: string
}

export interface InvestmentAccountDto {
  id: string
  displayName: string
  currency: 'USD'
  createdAt: string
  valueCents: string
  valuedAt: string
}

/** User-reported market values, kept separate from Bitcoin quantities and transaction flows. */
export class InvestmentService {
  private readonly db: SentinelDb

  public constructor(db: SentinelDb) {
    this.db = db
  }

  public async listAccounts(): Promise<InvestmentAccountDto[]> {
    // Fetch only the current valuation for each account, rather than every historical note and value.
    return this.db
      .select({
        id: investmentAccounts.id,
        displayName: investmentAccounts.displayName,
        currency: investmentAccounts.currency,
        createdAt: investmentAccounts.createdAt,
        valueCents: investmentValuations.valueCents,
        valuedAt: investmentValuations.valuedAt,
      })
      .from(investmentAccounts)
      .innerJoin(
        investmentValuations,
        and(
          eq(investmentValuations.accountId, investmentAccounts.id),
          eq(
            investmentValuations.valuedAt,
            sql`(select max(latest.valued_at) from investment_valuations latest where latest.account_id = ${investmentAccounts.id})`,
          ),
        ),
      )
      .orderBy(desc(investmentAccounts.createdAt))
  }

  /** Carry each account's last reported value forward to the next observation date. */
  public async history(): Promise<Array<{ valuedAt: string; valueCents: string }>> {
    const rows = await this.db
      .select({
        accountId: investmentValuations.accountId,
        valuedAt: investmentValuations.valuedAt,
        valueCents: investmentValuations.valueCents,
      })
      .from(investmentValuations)
      .innerJoin(investmentAccounts, eq(investmentValuations.accountId, investmentAccounts.id))
      .orderBy(asc(investmentValuations.valuedAt))
    const values = new Map<string, bigint>()
    const totals = new Map<string, string>()
    let total = 0n
    for (const row of rows) {
      const value = BigInt(row.valueCents)
      total += value - (values.get(row.accountId) ?? 0n)
      values.set(row.accountId, value)
      totals.set(row.valuedAt, total.toString())
    }
    return Array.from(totals, ([valuedAt, valueCents]) => ({ valuedAt, valueCents }))
  }

  public async getAccount(
    accountId: string,
  ): Promise<(InvestmentAccountDto & { valuations: Array<typeof investmentValuations.$inferSelect> }) | null> {
    // Keep the summary and history consistent if another request changes a valuation while this is read.
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(investmentAccounts).where(eq(investmentAccounts.id, accountId))
      if (!account) {
        return null
      }
      const valuations = await tx
        .select()
        .from(investmentValuations)
        .where(eq(investmentValuations.accountId, accountId))
        .orderBy(desc(investmentValuations.valuedAt))
      const latest = valuations[0]
      return latest ? { ...account, valueCents: latest.valueCents, valuedAt: latest.valuedAt, valuations } : null
    })
  }

  public async createAccount(input: InvestmentValuationInput & { displayName: string }): Promise<string> {
    const accountId = nanoid()
    await this.db.transaction(async (tx) => {
      await tx.insert(investmentAccounts).values({ id: accountId, displayName: input.displayName, currency: 'USD' })
      await tx.insert(investmentValuations).values({
        id: nanoid(),
        accountId,
        valueCents: BigInt(input.valueCents).toString(),
        valuedAt: input.valuedAt,
        note: input.note ?? null,
      })
    })
    return accountId
  }

  /** There is one valuation per calendar date; changes require an explicit edit. */
  public async saveValuation(
    input: InvestmentValuationInput & { accountId: string; id?: string },
  ): Promise<Result<void, Error>> {
    return this.db.transaction(async (tx) => {
      const [account] = await tx.select().from(investmentAccounts).where(eq(investmentAccounts.id, input.accountId))
      if (!account) {
        return Err(new Error('Investment account not found'))
      }
      const rows = await tx
        .select()
        .from(investmentValuations)
        .where(eq(investmentValuations.accountId, input.accountId))
      if (input.id !== undefined && !rows.some((row) => row.id === input.id)) {
        return Err(new Error('Valuation not found'))
      }
      if (rows.some((row) => row.valuedAt === input.valuedAt && row.id !== input.id)) {
        return Err(new Error('A valuation already exists for this date. Edit that valuation instead.'))
      }
      const values = {
        valueCents: BigInt(input.valueCents).toString(),
        valuedAt: input.valuedAt,
        note: input.note ?? null,
      }
      if (input.id !== undefined) {
        await tx
          .update(investmentValuations)
          .set(values)
          .where(and(eq(investmentValuations.id, input.id), eq(investmentValuations.accountId, input.accountId)))
      } else {
        await tx.insert(investmentValuations).values({ id: nanoid(), accountId: input.accountId, ...values })
      }
      return Ok(undefined)
    })
  }

  public async deleteValuation(accountId: string, id: string): Promise<Result<void, Error>> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.select().from(investmentValuations).where(eq(investmentValuations.accountId, accountId))
      if (!rows.some((row) => row.id === id)) {
        return Err(new Error('Valuation not found'))
      }
      if (rows.length === 1) {
        return Err(new Error('Keep at least one valuation. You can edit it or delete the account.'))
      }
      await tx
        .delete(investmentValuations)
        .where(and(eq(investmentValuations.id, id), eq(investmentValuations.accountId, accountId)))
      return Ok(undefined)
    })
  }

  public async renameAccount(accountId: string, displayName: string): Promise<Result<void, Error>> {
    const result = await this.db
      .update(investmentAccounts)
      .set({ displayName })
      .where(eq(investmentAccounts.id, accountId))
    return result.rowsAffected > 0 ? Ok(undefined) : Err(new Error('Investment account not found'))
  }

  public async deleteAccount(accountId: string): Promise<Result<void, Error>> {
    const result = await this.db.delete(investmentAccounts).where(eq(investmentAccounts.id, accountId))
    return result.rowsAffected > 0 ? Ok(undefined) : Err(new Error('Investment account not found'))
  }
}
