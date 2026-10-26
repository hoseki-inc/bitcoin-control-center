import { Account } from '@hoseki/packages/bitcoin/account'
import type { Network } from '@hoseki/packages/bitcoin/network'
import type { DiscoveredIndexes, DiscoveryIndexStore } from '@hoseki/packages/bitcoin/onchain/types'
import { type AsyncResult, Result } from '@hoseki/packages/result'
import { eq, inArray, sql } from 'drizzle-orm'
import type { SentinelDb } from '../../db/drizzle'
import { accounts, discoveryCache } from '../../db/schema'

/**
 * Keeps the address indexes discovery found for each wallet in `discovery_cache`, so the next
 * balance or history scan resumes from the last used addresses instead of from index 0.
 *
 * Wallets are matched by descriptor, so archived rows count too and a wallet added again starts
 * where it left off. Scans of wallets that aren't saved, such as while adding one, keep nothing.
 */
export class DiscoveryIndexes implements DiscoveryIndexStore {
  private readonly db: SentinelDb
  /** Each saved descriptor's canonical form, or null if it doesn't parse. A row's descriptor never changes. */
  private readonly canonical = new Map<string, string | null>()

  public constructor(db: SentinelDb) {
    this.db = db
  }

  public load(account: Account, network: Network): AsyncResult<DiscoveredIndexes | null, Error> {
    return Result.fromPromise(
      (async (): Promise<DiscoveredIndexes | null> => {
        const ids = await this.accountIds(account, network)
        if (ids.length === 0) {
          return null
        }
        const [row] = await this.db
          .select({
            receive: sql<number | null>`max(${discoveryCache.lastUsedReceiveIndex})`,
            change: sql<number | null>`max(${discoveryCache.lastUsedChangeIndex})`,
          })
          .from(discoveryCache)
          .where(inArray(discoveryCache.accountId, ids))
        if (row?.receive == null || row.change == null) {
          return null
        }
        return { lastUsedReceiveIndex: row.receive, lastUsedChangeIndex: row.change }
      })(),
    )
  }

  public save(
    account: Account,
    network: Network,
    indexes: DiscoveredIndexes,
    mode: 'raise' | 'replace',
  ): AsyncResult<void, Error> {
    return Result.fromPromise(
      (async (): Promise<void> => {
        const ids = await this.accountIds(account, network)
        if (ids.length === 0) {
          return
        }
        const { lastUsedReceiveIndex, lastUsedChangeIndex } = indexes
        await this.db
          .insert(discoveryCache)
          .values(ids.map((accountId) => ({ accountId, lastUsedReceiveIndex, lastUsedChangeIndex })))
          .onConflictDoUpdate({
            target: discoveryCache.accountId,
            set:
              mode === 'replace'
                ? {
                    lastUsedReceiveIndex: sql`excluded.last_used_receive_index`,
                    lastUsedChangeIndex: sql`excluded.last_used_change_index`,
                    updatedAt: sql`(datetime('now'))`,
                  }
                : {
                    // A slower scan that started earlier can finish last; it must not lower what a newer one found.
                    lastUsedReceiveIndex: sql`max(${discoveryCache.lastUsedReceiveIndex}, excluded.last_used_receive_index)`,
                    lastUsedChangeIndex: sql`max(${discoveryCache.lastUsedChangeIndex}, excluded.last_used_change_index)`,
                    updatedAt: sql`(datetime('now'))`,
                  },
          })
      })(),
    )
  }

  private async accountIds(account: Account, network: Network): Promise<string[]> {
    const rows = await this.db
      .select({ id: accounts.id, descriptor: accounts.descriptor })
      .from(accounts)
      .where(eq(accounts.network, network.kind === 'Mainnet' ? 'mainnet' : 'testnet'))
    const key = account.key()
    return rows.filter((row) => this.canonicalForm(row.descriptor) === key).map((row) => row.id)
  }

  private canonicalForm(descriptor: string): string | null {
    let canonical = this.canonical.get(descriptor)
    if (canonical === undefined) {
      const parsed = Account.fromDescriptor(descriptor)
      canonical = parsed.isOk() ? parsed.unwrap().key() : null
      this.canonical.set(descriptor, canonical)
    }
    return canonical
  }
}
