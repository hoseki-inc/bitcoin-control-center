import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import fc from 'fast-check'
import pino from 'pino'
import { describe, expect, it, onTestFinished } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { manualAccounts, manualBalanceSnapshots } from '../../db/schema'
import { ManualService, type ManualTransactionType } from './service'

const GENERIC_REFUSAL = 'This would take the balance below zero. Update the balance first, then log the sell.'

const utcDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function datedRefusal(timestamp: string): string {
  const formatted = utcDateFormatter.format(new Date(timestamp))
  return `This would take the balance on ${formatted} below zero. Update the balance first, then log the sell.`
}

function isoForDay(day: number): string {
  return `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-manual-prop-'))
  const logger = pino({ level: 'silent' })
  const database = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    database.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return { db: database, service: new ManualService({ db: database, logger }) }
}

async function history(service: ManualService, accountIds?: string[]): Promise<Array<[string, string]>> {
  return (await service.getHistoryEntries(accountIds)).map((entry) => [
    entry.timestamp.toISOString(),
    entry.value.toString(),
  ])
}

function predictCheckedAdd(args: {
  liveBalance: bigint
  snapshots: Array<{ timestamp: string; balanceSats: bigint }>
  type: ManualTransactionType
  amount: bigint
  txTimestamp: string
}): { ok: true } | { ok: false; message: string } {
  const delta = args.type === 'buy' || args.type === 'transfer_in' ? args.amount : -args.amount
  if (delta >= 0n) {
    return { ok: true }
  }

  const sorted = [...args.snapshots].sort((a, b) =>
    a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0,
  )
  const latest = sorted.at(-1)
  const isBackDated = latest !== undefined && args.txTimestamp < latest.timestamp

  const atOrBefore = sorted.filter((row) => row.timestamp <= args.txTimestamp).at(-1)
  let earliestNegativeDate: string | null = null
  if (atOrBefore && atOrBefore.timestamp !== args.txTimestamp && atOrBefore.balanceSats + delta < 0n) {
    earliestNegativeDate = args.txTimestamp
  } else {
    const firstFailing = sorted.find((row) => row.timestamp >= args.txTimestamp && row.balanceSats + delta < 0n)
    earliestNegativeDate = firstFailing?.timestamp ?? null
  }

  const liveFails = args.liveBalance + delta < 0n

  if (isBackDated) {
    if (earliestNegativeDate !== null) {
      return { ok: false, message: datedRefusal(earliestNegativeDate) }
    }
    if (liveFails) {
      return { ok: false, message: GENERIC_REFUSAL }
    }
    return { ok: true }
  }

  if (liveFails) {
    return { ok: false, message: GENERIC_REFUSAL }
  }
  if (earliestNegativeDate !== null) {
    return { ok: false, message: datedRefusal(earliestNegativeDate) }
  }
  return { ok: true }
}

const timelineArbitrary = fc
  .uniqueArray(fc.integer({ min: 2, max: 25 }), { minLength: 1, maxLength: 5 })
  .chain((days) => {
    const sortedDays = [...days].sort((a, b) => a - b)
    const firstDay = sortedDays[0] ?? 2
    const lastDay = sortedDays.at(-1) ?? 25
    return fc.record({
      savedDays: fc
        .array(fc.integer({ min: 0, max: 20_000 }), { minLength: sortedDays.length, maxLength: sortedDays.length })
        .map((balances) => sortedDays.map((day, index) => ({ day, balance: balances[index] ?? 0 }))),
      liveOverride: fc.option(fc.integer({ min: 0, max: 20_000 }), { nil: undefined }),
      type: fc.constantFrom<ManualTransactionType>('buy', 'sell', 'transfer_in', 'transfer_out'),
      amount: fc.integer({ min: 0, max: 25_000 }),
      txDay: fc.oneof(
        fc.integer({ min: 1, max: firstDay - 1 }),
        fc.integer({ min: firstDay, max: lastDay }),
        fc.integer({ min: lastDay + 1, max: 28 }),
      ),
    })
  })

describe('ManualService checked transaction properties', () => {
  it('matches the refusal oracle, writes nothing on refusal, and round-trips every accepted checked transaction on ticked delete', async () => {
    const { db, service } = await setup()
    const snapshotsOf = async (accountId: string): Promise<Array<{ timestamp: string; balanceSats: string }>> =>
      db
        .select({ timestamp: manualBalanceSnapshots.timestamp, balanceSats: manualBalanceSnapshots.balanceSats })
        .from(manualBalanceSnapshots)
        .where(eq(manualBalanceSnapshots.accountId, accountId))
        .orderBy(manualBalanceSnapshots.timestamp)

    await fc.assert(
      fc.asyncProperty(timelineArbitrary, async (input) => {
        const [first, ...rest] = input.savedDays
        if (!first) {
          return
        }
        const account = (
          await service.createAccount({
            displayName: 'Prop',
            balanceSats: String(first.balance),
            balanceAsOf: isoForDay(first.day),
          })
        ).unwrap()
        for (const point of rest) {
          await service.updateBalance({
            accountId: account.id,
            balanceSats: String(point.balance),
            balanceAsOf: isoForDay(point.day),
          })
        }
        if (input.liveOverride !== undefined) {
          await db
            .update(manualAccounts)
            .set({ balanceSats: String(input.liveOverride) })
            .where(eq(manualAccounts.id, account.id))
        }

        const beforeAccount = await service.getAccount(account.id)
        const beforeSnapshots = await snapshotsOf(account.id)
        const beforeHistory = await history(service, [account.id])
        const txTimestamp = isoForDay(input.txDay)

        const expected = predictCheckedAdd({
          liveBalance: BigInt(beforeAccount?.balanceSats ?? '0'),
          snapshots: beforeSnapshots.map((row) => ({
            timestamp: row.timestamp,
            balanceSats: BigInt(row.balanceSats),
          })),
          type: input.type,
          amount: BigInt(input.amount),
          txTimestamp,
        })

        const added = await service.addTransaction({
          accountId: account.id,
          type: input.type,
          amountSats: String(input.amount),
          transactedAt: txTimestamp,
          addToBalance: true,
        })

        expect(added.isOk()).toBe(expected.ok)

        if (!expected.ok) {
          expect(added.unwrapErr().message).toBe(expected.message)
          await expect(service.getAccount(account.id)).resolves.toEqual(beforeAccount)
          await expect(snapshotsOf(account.id)).resolves.toEqual(beforeSnapshots)
          await expect(service.listTransactions(account.id)).resolves.toEqual([])
          await expect(history(service, [account.id])).resolves.toEqual(beforeHistory)
          return
        }

        const midAccount = await service.getAccount(account.id)
        expect(BigInt(midAccount?.balanceSats ?? '-1')).toBeGreaterThanOrEqual(0n)
        for (const snap of await snapshotsOf(account.id)) {
          expect(BigInt(snap.balanceSats)).toBeGreaterThanOrEqual(0n)
        }

        const deleted = await service.deleteTransaction({ transactionId: added.unwrap().id, removeFromBalance: true })
        expect(deleted.isOk()).toBe(true)

        const afterAccount = await service.getAccount(account.id)
        const afterSnapshots = await snapshotsOf(account.id)
        expect(afterAccount?.balanceSats).toBe(beforeAccount?.balanceSats)
        await expect(service.listTransactions(account.id)).resolves.toEqual([])
        await expect(history(service, [account.id])).resolves.toEqual(beforeHistory)

        const beforeByTime = new Map(beforeSnapshots.map((row) => [row.timestamp, row.balanceSats]))
        const afterByTime = new Map(afterSnapshots.map((row) => [row.timestamp, row.balanceSats]))
        for (const [timestamp, balanceSats] of beforeByTime) {
          expect(afterByTime.get(timestamp)).toBe(balanceSats)
        }
        for (const row of afterSnapshots) {
          if (!beforeByTime.has(row.timestamp)) {
            expect(row.timestamp).toBe(txTimestamp)
            const prior = beforeSnapshots.filter((snap) => snap.timestamp < row.timestamp).at(-1)
            expect(row.balanceSats).toBe(prior?.balanceSats)
          }
        }
      }),
      { numRuns: 250 },
    )
  }, 120_000)
})
