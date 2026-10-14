import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm'
import type { SentinelDb } from '../../db/drizzle'
import { btcQuoteCache, btcQuoteDownloads } from '../../db/schema'

export interface HistoryPoint {
  timestamp: number
  price: string
}

export interface CachedQuote {
  timestamp: number
  providerUrl: string
  price: string
}

/** One price source's downloaded history. Sources never read or replace each other's prices. */
export class QuoteCache {
  private readonly db: SentinelDb
  private readonly providerUrl: string

  public constructor(db: SentinelDb, providerUrl: string) {
    this.db = db
    this.providerUrl = providerUrl
  }

  /** This source's closest quote to `target` within the window, preferring the earlier one on a tie. */
  public async find(
    currency: StatementQuoteCurrency,
    target: number,
    oldest: number,
    newest: number,
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
          eq(btcQuoteCache.providerUrl, this.providerUrl),
          eq(btcQuoteCache.quoteCurrency, currency),
          gte(btcQuoteCache.timestamp, oldest),
          lte(btcQuoteCache.timestamp, newest),
        ),
      )
      .orderBy(sql`abs(${btcQuoteCache.timestamp} - ${target})`, asc(btcQuoteCache.timestamp))
      .limit(1)
    return row
  }

  /** When this source last downloaded its history in this currency, in Unix ms. */
  public async downloadedAt(currency: StatementQuoteCurrency): Promise<number | undefined> {
    const [row] = await this.db
      .select({ downloadedAt: btcQuoteDownloads.downloadedAt })
      .from(btcQuoteDownloads)
      .where(and(eq(btcQuoteDownloads.provider, this.providerUrl), eq(btcQuoteDownloads.quoteCurrency, currency)))
    return row?.downloadedAt
  }

  /**
   * Replaces this source's history in a currency with a new download, and records when. One
   * statement inserts all of it: tens of thousands of rows take a fraction of the time they would
   * as separate inserts, which matters because saving holds the database.
   */
  public async saveHistory(
    currency: StatementQuoteCurrency,
    points: HistoryPoint[],
    downloadedAt: number,
  ): Promise<void> {
    const rows = JSON.stringify(points.map((point) => [point.timestamp, point.price]))
    await this.db.transaction(async (tx) => {
      await tx
        .delete(btcQuoteCache)
        .where(and(eq(btcQuoteCache.providerUrl, this.providerUrl), eq(btcQuoteCache.quoteCurrency, currency)))
      // `WHERE true` lets SQLite parse the upsert after a SELECT; a repeated time keeps its last price.
      await tx.run(sql`
        INSERT INTO ${btcQuoteCache} (provider_url, quote_currency, timestamp, price)
        SELECT ${this.providerUrl}, ${currency}, value ->> 0, value ->> 1 FROM json_each(${rows}) WHERE true
        ON CONFLICT (provider_url, quote_currency, timestamp) DO UPDATE SET price = excluded.price
      `)
      await tx
        .insert(btcQuoteDownloads)
        .values({ provider: this.providerUrl, quoteCurrency: currency, downloadedAt })
        .onConflictDoUpdate({
          target: [btcQuoteDownloads.provider, btcQuoteDownloads.quoteCurrency],
          set: { downloadedAt },
        })
    })
  }
}
