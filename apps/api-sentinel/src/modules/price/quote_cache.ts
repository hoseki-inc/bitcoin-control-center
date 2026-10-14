import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { and, asc, eq, gt, gte, lte, sql } from 'drizzle-orm'
import type { SentinelDb } from '../../db/drizzle'
import { btcQuoteCache, btcQuoteDownloads, btcQuoteLookups } from '../../db/schema'

export interface HistoryPoint {
  timestamp: number
  price: string
}

export interface CachedQuote {
  timestamp: number
  providerUrl: string
  price: string
}

/** One shared price cache. Source is provenance, never a price-cache partition. */
export class QuoteCache {
  private readonly db: SentinelDb
  private readonly provider: string
  private readonly providerUrl: string

  public constructor(db: SentinelDb, provider: string, providerUrl: string) {
    this.db = db
    this.provider = provider
    this.providerUrl = providerUrl
  }

  /** The closest quote to `target` in the window; with `refreshedSince`, only one confirmed since then. */
  public async find(
    currency: StatementQuoteCurrency,
    target: number,
    oldest: number,
    newest: number,
    refreshedSince?: number,
  ): Promise<CachedQuote | undefined> {
    const [row] = await this.db
      .select({
        timestamp: btcQuoteCache.timestamp,
        price: btcQuoteCache.price,
        providerUrl: btcQuoteCache.providerUrl,
      })
      .from(btcQuoteCache)
      .where(
        and(
          eq(btcQuoteCache.quoteCurrency, currency),
          gte(btcQuoteCache.timestamp, oldest),
          lte(btcQuoteCache.timestamp, newest),
          refreshedSince === undefined ? undefined : gte(btcQuoteCache.refreshedAt, refreshedSince),
        ),
      )
      .orderBy(sql`abs(${btcQuoteCache.timestamp} - ${target})`, asc(btcQuoteCache.timestamp))
      .limit(1)
    return row
  }

  /** Whether this source supplied an observation in the window, so its search produced an answer. */
  public async hasOwnQuote(currency: StatementQuoteCurrency, oldest: number, newest: number): Promise<boolean> {
    const [row] = await this.db
      .select({ timestamp: btcQuoteCache.timestamp })
      .from(btcQuoteCache)
      .where(
        and(
          eq(btcQuoteCache.quoteCurrency, currency),
          eq(btcQuoteCache.providerUrl, this.providerUrl),
          gte(btcQuoteCache.timestamp, oldest),
          lte(btcQuoteCache.timestamp, newest),
        ),
      )
      .limit(1)
    return row !== undefined
  }

  /** A recent lookup by any source lets every instance reuse an exact cached observation. */
  public async hasFreshLookup(target: number, now: number): Promise<boolean> {
    const [row] = await this.db
      .select({ requestedAt: btcQuoteLookups.requestedAt })
      .from(btcQuoteLookups)
      .where(and(eq(btcQuoteLookups.requestedAt, target), gt(btcQuoteLookups.expiresAt, now)))
      .limit(1)
    return row !== undefined
  }

  // Request receipts are tracked per source so a negative local response never
  // suppresses the first public request. The actual price rows remain shared.
  public async isFresh(target: number, now: number): Promise<boolean> {
    const [row] = await this.db
      .select({ expiresAt: btcQuoteLookups.expiresAt })
      .from(btcQuoteLookups)
      .where(and(eq(btcQuoteLookups.provider, this.provider), eq(btcQuoteLookups.requestedAt, target)))
    return row !== undefined && row.expiresAt > now
  }

  public async save(
    target: number,
    timestamp: number | null,
    quotes: Partial<Record<StatementQuoteCurrency, string>>,
    expiresAt: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      if (timestamp !== null) {
        for (const currency of StatementQuoteCurrencySchema.options) {
          const price = quotes[currency]
          if (price !== undefined) {
            const refreshedAt = Date.now()
            await tx
              .insert(btcQuoteCache)
              .values({ providerUrl: this.providerUrl, quoteCurrency: currency, timestamp, price, refreshedAt })
              .onConflictDoUpdate({
                target: [btcQuoteCache.quoteCurrency, btcQuoteCache.timestamp],
                set: { price, providerUrl: this.providerUrl, refreshedAt },
              })
          }
        }
      }
      await tx
        .insert(btcQuoteLookups)
        .values({ provider: this.provider, requestedAt: target, expiresAt })
        .onConflictDoUpdate({ target: [btcQuoteLookups.provider, btcQuoteLookups.requestedAt], set: { expiresAt } })
    })
  }

  /** When this source last downloaded its full history in this currency, in Unix ms. */
  public async downloadedAt(currency: StatementQuoteCurrency): Promise<number | undefined> {
    const [row] = await this.db
      .select({ downloadedAt: btcQuoteDownloads.downloadedAt })
      .from(btcQuoteDownloads)
      .where(and(eq(btcQuoteDownloads.provider, this.provider), eq(btcQuoteDownloads.quoteCurrency, currency)))
    return row?.downloadedAt
  }

  /**
   * Saves a downloaded history over any earlier prices at the same times, then records the download.
   * One statement for all of it: tens of thousands of rows take a fraction of the time they would
   * as separate inserts, which matters because saving holds the database.
   */
  public async saveHistory(
    currency: StatementQuoteCurrency,
    points: HistoryPoint[],
    downloadedAt: number,
  ): Promise<void> {
    const rows = JSON.stringify(points.map((point) => [point.timestamp, point.price]))
    await this.db.transaction(async (tx) => {
      // `WHERE true` lets SQLite parse the upsert after a SELECT.
      await tx.run(sql`
        INSERT INTO ${btcQuoteCache} (provider_url, quote_currency, timestamp, price, refreshed_at)
        SELECT ${this.providerUrl}, ${currency}, value ->> 0, value ->> 1, ${downloadedAt} FROM json_each(${rows}) WHERE true
        ON CONFLICT (quote_currency, timestamp) DO UPDATE
          SET price = excluded.price, provider_url = excluded.provider_url, refreshed_at = excluded.refreshed_at
      `)
      await tx
        .insert(btcQuoteDownloads)
        .values({ provider: this.provider, quoteCurrency: currency, downloadedAt })
        .onConflictDoUpdate({
          target: [btcQuoteDownloads.provider, btcQuoteDownloads.quoteCurrency],
          set: { downloadedAt },
        })
    })
  }
}
