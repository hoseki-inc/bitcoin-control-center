import type { InStatement } from '@libsql/client'
import { Signer } from 'bip322-js'
import { eq } from 'drizzle-orm'
import { expect, it, onTestFinished, vi } from 'vitest'
import type { SentinelDb } from '../../db/drizzle'
import { accounts, balanceSnapshots, challenges, keystores, signedMessages } from '../../db/schema'
import { createSinglesigClaim, owner, setupOwnershipHarness } from './ownership.fixtures'

async function setupClaim() {
  const { registry, db } = await setupOwnershipHarness()
  const { claim } = await createSinglesigClaim(registry, owner)
  const { challengeMessage } = await registry.getOrCreateSinglesigChallengeMessage({
    network: owner.xpub.network.toString(),
    account: claim.account,
  })
  await db.insert(balanceSnapshots).values({ accountId: claim.id, timestamp: '2026-01-01', balanceSats: '123' })
  return { registry, db, claimId: claim.id, challengeMessage }
}

async function claimState(db: SentinelDb) {
  const [accountRows, keystoreRows, challengeRows, messageRows, snapshots] = await Promise.all([
    db.select().from(accounts),
    db.select().from(keystores),
    db.select().from(challenges),
    db.select().from(signedMessages),
    db.select().from(balanceSnapshots),
  ])
  return { accounts: accountRows, keystores: keystoreRows, challenges: challengeRows, messages: messageRows, snapshots }
}

function changeAfterEligibilityRead(db: SentinelDb, change: () => Promise<void>): void {
  const execute = db.$client.execute.bind(db.$client)
  const spy = vi.spyOn(db.$client, 'execute').mockImplementationOnce(async (statement: InStatement) => {
    const result = await execute(statement)
    expect(statement).toHaveProperty('sql', expect.stringMatching(/^select .* from "accounts"/))
    // The real read has finished and released the serial queue, but the
    // deletion handler has not yet received its now-stale eligibility result.
    await change()
    return result
  })
  onTestFinished(() => {
    spy.mockRestore()
  })
}

it.each(['restore', 'verify', 'archive'] as const)(
  'preserves a claim and its dependent records when %s wins before deletion',
  async (action) => {
    const { registry, db, claimId, challengeMessage } = await setupClaim()
    if (action === 'restore') {
      await db.update(accounts).set({ deletedAt: '2026-01-02' }).where(eq(accounts.id, claimId))
    }
    let expectedState = await claimState(db)
    changeAfterEligibilityRead(db, async () => {
      if (action === 'restore') {
        await registry.claims.restore({ id: claimId })
      } else if (action === 'verify') {
        const message = challengeMessage.signedMessage
        const signature = Signer.sign(owner.wif, message.address, message.messageTextToSign)
        await registry.challengeMessages.complete({ signedMessageId: message.id, signature })
        await registry.challenges.complete({ challengeId: challengeMessage.challengeId })
      } else {
        // Simulate the committed archive state without involving Electrum history fetching.
        await db.update(accounts).set({ deletedAt: '2026-01-02' }).where(eq(accounts.id, claimId))
      }
      expectedState = await claimState(db)
    })

    const attempt =
      action === 'restore' ? registry.claims.delete({ id: claimId }) : registry.claims.deletePending({ id: claimId })
    await expect(attempt).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Claim changed before it could be deleted',
    })
    await expect(claimState(db)).resolves.toEqual(expectedState)
    expect(expectedState.accounts[0]).toMatchObject(
      action === 'verify'
        ? { status: 'verified', deletedAt: null }
        : { deletedAt: action === 'restore' ? null : '2026-01-02' },
    )
  },
)

it.each(['delete', 'deletePending'] as const)(
  'rejects %s if another request already removed the claim',
  async (method) => {
    const { registry, db, claimId } = await setupClaim()
    if (method === 'delete') {
      await db.update(accounts).set({ deletedAt: '2026-01-02' }).where(eq(accounts.id, claimId))
    }
    changeAfterEligibilityRead(db, async () => {
      await db.delete(accounts).where(eq(accounts.id, claimId))
    })

    await expect(registry.claims[method]({ id: claimId })).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'Claim changed before it could be deleted',
    })
  },
)

it.each(['delete', 'deletePending'] as const)(
  '%s deletes eligible claims and cascades dependent records',
  async (method) => {
    const { registry, db, claimId } = await setupClaim()
    if (method === 'delete') {
      await db.update(accounts).set({ status: 'verified', deletedAt: '2026-01-02' }).where(eq(accounts.id, claimId))
    }
    const before = await claimState(db)
    for (const rows of Object.values(before)) {
      expect(rows).toHaveLength(1)
    }

    await registry.claims[method]({ id: claimId })

    await expect(claimState(db)).resolves.toEqual({
      accounts: [],
      keystores: [],
      challenges: [],
      messages: [],
      snapshots: [],
    })
  },
)

it.each(['delete', 'deletePending'] as const)('%s preserves the missing-claim error', async (method) => {
  const { registry } = await setupOwnershipHarness()
  await expect(registry.claims[method]({ id: 'missing' })).rejects.toMatchObject({
    code: 'NOT_FOUND',
    message: 'Claim not found',
  })
})

it.each([
  { method: 'delete', status: 'pending', deletedAt: null, message: 'Only archived claims can be permanently deleted' },
  { method: 'deletePending', status: 'verified', deletedAt: null, message: 'Claim is not pending' },
  { method: 'deletePending', status: 'expired', deletedAt: null, message: 'Claim is not pending' },
  {
    method: 'deletePending',
    status: 'pending',
    deletedAt: '2026-01-02',
    message: 'Archived claims must be permanently deleted',
  },
] as const)('$method preserves the invalid-state error for $status, archived=$deletedAt', async (state) => {
  const { registry, db, claimId } = await setupClaim()
  await db.update(accounts).set({ status: state.status, deletedAt: state.deletedAt }).where(eq(accounts.id, claimId))
  const before = await claimState(db)

  await expect(registry.claims[state.method]({ id: claimId })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: state.message,
  })
  await expect(claimState(db)).resolves.toEqual(before)
})
