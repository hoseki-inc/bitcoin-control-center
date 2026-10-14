import { type StatementQuoteCurrency, StatementQuoteCurrencySchema } from '@hoseki/packages/schemas/statement-quote'
import { and, asc, eq, gt, gte, lte, sql } from 'drizzle-orm'
import type { SentinelDb } from '../../db/drizzle'
import { btcQuoteCache, btcQuoteDownloads, btcQuoteLookups } from '../../db/schema'

export interface HistoryPoint {
  timestamp: number
  price: string
}

/** Rows per insert, well under SQLite's limit on bound parameters. */
const SAVE_BATCH = 500

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
          eq(btcQuoteCache.quoteCurrency, currency),
          gte(btcQuoteCache.timestamp, oldest),
          lte(btcQuoteCache.timestamp, newest),
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
            await tx
              .insert(btcQuoteCache)
              .values({ providerUrl: this.providerUrl, quoteCurrency: currency, timestamp, price })
              .onConflictDoUpdate({
                target: [btcQuoteCache.quoteCurrency, btcQuoteCache.timestamp],
                set: { price, providerUrl: this.providerUrl },
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

  /** Saves a downloaded history over any earlier prices at the same times, then records the download. */
  public async saveHistory(
    currency: StatementQuoteCurrency,
    points: HistoryPoint[],
    downloadedAt: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < points.length; i += SAVE_BATCH) {
        await tx
          .insert(btcQuoteCache)
          .values(
            points.slice(i, i + SAVE_BATCH).map((point) => ({
              providerUrl: this.providerUrl,
              quoteCurrency: currency,
              timestamp: point.timestamp,
              price: point.price,
            })),
          )
          .onConflictDoUpdate({
            target: [btcQuoteCache.quoteCurrency, btcQuoteCache.timestamp],
            set: { price: sql`excluded.price`, providerUrl: sql`excluded.provider_url` },
          })
      }
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
