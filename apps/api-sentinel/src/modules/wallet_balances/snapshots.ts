import { and, desc, eq, isNull } from 'drizzle-orm'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import { accounts, balanceSnapshots } from '../../db/schema'

/** Whether the wallet exists and isn't archived. */
export async function isWalletActive(db: SentinelDb | SentinelTx, accountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt)))
  return rows.length > 0
}

export async function upsertWalletSnapshot(
  db: SentinelDb | SentinelTx,
  accountId: string,
  balanceSats: string,
  timestamp: string,
): Promise<void> {
  await db
    .insert(balanceSnapshots)
    .values({ accountId, timestamp, balanceSats })
    .onConflictDoUpdate({ target: [balanceSnapshots.accountId, balanceSnapshots.timestamp], set: { balanceSats } })
}

/** Records a wallet's balance unless the wallet was archived or deleted meanwhile. */
export async function recordWalletSnapshot(
  db: SentinelDb,
  accountId: string,
  balanceSats: string,
  timestamp: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await isWalletActive(tx, accountId))) {
      return false
    }
    await upsertWalletSnapshot(tx, accountId, balanceSats, timestamp)
    return true
  })
}

export async function getLatestWalletSnapshot(
  db: SentinelDb | SentinelTx,
  accountId: string,
): Promise<{ balanceSats: bigint; timestamp: string } | null> {
  const [row] = await db
    .select({ balanceSats: balanceSnapshots.balanceSats, timestamp: balanceSnapshots.timestamp })
    .from(balanceSnapshots)
    .where(eq(balanceSnapshots.accountId, accountId))
    .orderBy(desc(balanceSnapshots.timestamp))
    .limit(1)
  return row ? { balanceSats: BigInt(row.balanceSats), timestamp: row.timestamp } : null
}
