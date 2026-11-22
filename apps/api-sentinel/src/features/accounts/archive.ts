import { Err, Ok, type Result } from '@hoseki/packages/result'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import type { SentinelDb } from '../../db/drizzle'
import { accounts as accountTable } from '../../db/schema'
import type { WalletBalanceService } from '../../modules/wallet_balances/service'
import { upsertWalletSnapshot } from '../../modules/wallet_balances/snapshots'
import type { ControlCenterService } from '../portfolio'

export interface ArchiveDeps {
  db: SentinelDb
  portfolio: ControlCenterService
  walletBalances: WalletBalanceService
}

/** Moves an account from the active list to Archived, after portfolio saves its full history so past totals stay right. */
export async function archiveAccount(deps: ArchiveDeps, accountId: string): Promise<Result<void, Error>> {
  const [row] = await deps.db
    .select({ descriptor: accountTable.descriptor })
    .from(accountTable)
    .where(and(eq(accountTable.id, accountId), isNull(accountTable.deletedAt)))
  if (!row) {
    return Err(new Error('Claim not found or already archived'))
  }

  const preserved = await deps.portfolio.preserveHistory(accountId, row.descriptor)
  if (preserved.isErr()) {
    return Err(preserved.unwrapErr())
  }

  const archivedAt = new Date().toISOString()
  const archived = await deps.db.transaction(async (tx): Promise<boolean> => {
    const updated = await tx
      .update(accountTable)
      .set({ deletedAt: archivedAt })
      .where(and(eq(accountTable.id, accountId), isNull(accountTable.deletedAt)))
    if (updated.rowsAffected === 0) {
      return false
    }
    await upsertWalletSnapshot(tx, accountId, preserved.unwrap().toString(), archivedAt)
    return true
  })

  if (!archived) {
    return Err(new Error('Claim not found or already archived'))
  }
  deps.portfolio.invalidateAccountHistoryBackfill(accountId)
  deps.walletBalances.invalidate(accountId)
  return Ok(undefined)
}

/** Brings an archived account back. Portfolio scans its history again. */
export async function restoreAccount(deps: ArchiveDeps, accountId: string): Promise<Result<void, Error>> {
  const restored = await deps.db.transaction(async (tx): Promise<boolean> => {
    const result = await tx
      .update(accountTable)
      .set({ deletedAt: null })
      .where(and(eq(accountTable.id, accountId), isNotNull(accountTable.deletedAt)))
    if (result.rowsAffected === 0) {
      return false
    }
    await deps.portfolio.forgetHistorySyncs(tx, accountId)
    return true
  })

  if (!restored) {
    return Err(new Error('Claim not found or not archived'))
  }
  deps.portfolio.clearAccountHistoryBackfillState(accountId)
  deps.walletBalances.invalidate(accountId)
  return Ok(undefined)
}
