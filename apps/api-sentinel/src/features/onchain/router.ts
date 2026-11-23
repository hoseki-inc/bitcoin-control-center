import type { Account } from '@hoseki/packages/bitcoin/account'
import { NetworkAccount } from '@hoseki/packages/bitcoin/network_account'
import { IndexMap, IndexSet } from '@hoseki/packages/collection'
import { TRPCError } from '@trpc/server'
import { Decimal } from 'decimal.js'
import { and, desc, eq, lte, sql } from 'drizzle-orm'
import { z } from 'zod'
import { accounts as accountTable, balanceSnapshots } from '../../db/schema'
import { claimNetworkToNetwork } from '../../lib/claim-network'
import { protectedProcedure, router } from '../../modules/trpc/init'

function scanErrorWithoutProviderDetails(): TRPCError {
  return new TRPCError({
    code: 'INTERNAL_SERVER_ERROR',
    message:
      "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again.",
  })
}

export const onchainRouter = router({
  bitcoinAccountBalances: protectedProcedure
    .input(z.object({ accounts: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const resultMap = new Map<string, { current: Decimal; usd: Decimal | null }>()
      const archivedAccounts = new Set<string>()
      const archivedBalances = new Map<string, bigint>()
      const accountSet = new IndexSet<Account>()
      const keyToAccount = new Map<string, Account>()

      for (const raw of input.accounts) {
        const parsed = NetworkAccount.fromString(raw)
        if (parsed.isOk()) {
          const na = parsed.unwrap()
          const key = na.toString()
          const [row] = await ctx.app.database
            .select({ id: accountTable.id, deletedAt: accountTable.deletedAt })
            .from(accountTable)
            .where(
              and(
                eq(accountTable.descriptor, na.account.toString()),
                eq(accountTable.network, claimNetworkToNetwork(na.network.toString())),
              ),
            )
            .orderBy(desc(sql`${accountTable.deletedAt} IS NULL`), desc(accountTable.createdAt))
            .limit(1)

          if (row?.deletedAt != null && row.deletedAt !== '') {
            const [snapshot] = await ctx.app.database
              .select({ balanceSats: balanceSnapshots.balanceSats })
              .from(balanceSnapshots)
              .where(and(eq(balanceSnapshots.accountId, row.id), lte(balanceSnapshots.timestamp, row.deletedAt)))
              .orderBy(desc(balanceSnapshots.timestamp))
              .limit(1)
            archivedAccounts.add(key)
            archivedBalances.set(key, BigInt(snapshot?.balanceSats ?? '0'))
            continue
          }

          accountSet.add(na.account)
          keyToAccount.set(key, na.account)
        }
      }

      if (accountSet.size === 0 && archivedBalances.size === 0) {
        return { accounts: resultMap, archivedAccounts }
      }

      let balances = new IndexMap<Account, bigint>()
      if (accountSet.size > 0) {
        let balancesResult: Awaited<ReturnType<typeof ctx.app.onchainProvider.getConfirmedAccountBalances>>
        try {
          balancesResult = await ctx.app.onchainProvider.getConfirmedAccountBalances(accountSet)
        } catch (err) {
          ctx.app.logger.error({ err }, 'Error getting confirmed account balances')
          throw scanErrorWithoutProviderDetails()
        }
        if (balancesResult.isErr()) {
          throw scanErrorWithoutProviderDetails()
        }
        balances = balancesResult.unwrap()
      }

      // Get BTC price for USD conversion
      const priceResult = await ctx.app.priceService.getCurrentBtcPrice()
      const price = priceResult.isOk() ? priceResult.unwrap().value : null

      for (const [key, sats] of archivedBalances) {
        const current = new Decimal(sats.toString())
        resultMap.set(key, {
          current,
          usd: price ? current.div(100_000_000).mul(price) : null,
        })
      }

      for (const [raw, account] of keyToAccount) {
        const sats = balances.get(account) ?? 0n
        const current = new Decimal(sats.toString())
        const btcAmount = current.div(100_000_000)
        const usd = price ? btcAmount.mul(price) : null
        resultMap.set(raw, { current, usd })
      }

      return { accounts: resultMap, archivedAccounts }
    }),

  claimBalances: protectedProcedure.input(z.object({ claimIds: z.array(z.string()) })).query(async ({ ctx, input }) => {
    // Wallets are scanned one by one and recent balances reused; other callers share the same scans.
    const results = await ctx.app.walletBalanceService.getLiveBalances(input.claimIds)
    const balanceMap = new Map<string, Decimal>()
    for (const [claimId, result] of results) {
      if (result.isOk()) {
        balanceMap.set(claimId, new Decimal(result.unwrap().balanceSats.toString()))
      }
    }
    // A wallet that can't be scanned is left out, so the rest still show. Errors can quote
    // descriptors, so the request fails with a plain message, and only when no wallet could be read.
    if (results.size > 0 && balanceMap.size === 0) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Could not fetch wallet balances' })
    }
    return balanceMap
  }),

  /**
   * Each wallet's newest known balance and whether a newer one is being fetched. Never waits on
   * Electrum: out-of-date wallets start a scan, and pages poll while any wallet is syncing.
   */
  walletBalances: protectedProcedure.input(z.object({ claimIds: z.array(z.string()) })).query(async ({ ctx, input }) =>
    (await ctx.app.walletBalanceService.readBalances(input.claimIds)).map(
      ({ accountId, balanceSats, asOf, syncing, failed }) => ({
        accountId,
        balanceSats: balanceSats?.toString() ?? null,
        asOf: asOf?.toISOString() ?? null,
        syncing,
        failed,
      }),
    ),
  ),
})
