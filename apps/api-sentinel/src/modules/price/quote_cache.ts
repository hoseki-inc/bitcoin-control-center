import type { StatementQuoteCurrency } from '@hoseki/packages/schemas/statement-quote'
import type Database from 'better-sqlite3'

export interface CachedQuote {
  timestamp: number
  providerUrl: string
  price: string
}

/** One shared price cache. Source is provenance, never a price-cache partition. */
export class QuoteCache {
  private readonly db: Database.Database
  private readonly provider: string
  private readonly providerUrl: string

  public constructor(db: Database.Database, provider: string, providerUrl: string) {
    this.db = db
    this.provider = provider
    this.providerUrl = providerUrl
  }

  public find(
    currency: StatementQuoteCurrency,
    target: number,
    oldest: number,
    newest: number,
  ): CachedQuote | undefined {
    return this.db
      .prepare<unknown[], CachedQuote>(
        `
      SELECT timestamp, price, provider_url AS providerUrl FROM btc_quote_cache
      WHERE quote_currency = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY ABS(timestamp - ?) ASC, timestamp ASC LIMIT 1
    `,
      )
      .get(currency, oldest, newest, target)
  }

  /** Whether this source supplied an observation in the window, so its search produced an answer. */
  public hasOwnQuote(currency: StatementQuoteCurrency, oldest: number, newest: number): boolean {
    return (
      this.db
        .prepare(
          `
      SELECT 1 FROM btc_quote_cache
      WHERE quote_currency = ? AND provider_url = ? AND timestamp >= ? AND timestamp <= ? LIMIT 1
    `,
        )
        .get(currency, this.providerUrl, oldest, newest) !== undefined
    )
  }

  /** A recent lookup by any source lets every instance reuse an exact cached observation. */
  public hasFreshLookup(target: number, now: number): boolean {
    return (
      this.db
        .prepare('SELECT 1 FROM btc_quote_lookups WHERE requested_at = ? AND expires_at > ? LIMIT 1')
        .get(target, now) !== undefined
    )
  }

  // Request receipts are tracked per source so a negative local response never
  // suppresses the first public request. The actual price rows remain shared.
  public isFresh(target: number, now: number): boolean {
    const row = this.db
      .prepare<unknown[], { expires_at: number }>(
        `
      SELECT expires_at FROM btc_quote_lookups WHERE provider = ? AND requested_at = ?
    `,
      )
      .get(this.provider, target)
    return row !== undefined && row.expires_at > now
  }

  public save(
    target: number,
    timestamp: number | null,
    quotes: Partial<Record<StatementQuoteCurrency, string>>,
    expiresAt: number,
  ): void {
    this.db.transaction(() => {
      if (timestamp !== null) {
        const insert = this.db.prepare(`
          INSERT INTO btc_quote_cache(provider_url, quote_currency, timestamp, price) VALUES (?, ?, ?, ?)
          ON CONFLICT(quote_currency, timestamp) DO UPDATE SET price = excluded.price, provider_url = excluded.provider_url
        `)
        for (const [currency, price] of Object.entries(quotes)) {
          insert.run(this.providerUrl, currency, timestamp, price)
        }
      }
      this.db
        .prepare(
          `
        INSERT INTO btc_quote_lookups(provider, requested_at, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(provider, requested_at) DO UPDATE SET expires_at = excluded.expires_at
      `,
        )
        .run(this.provider, target, expiresAt)
    })()
  }
}
