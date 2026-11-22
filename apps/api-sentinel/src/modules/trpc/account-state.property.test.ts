import { SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { TRPCError } from '@trpc/server'
import { Signer } from 'bip322-js'
import { eq } from 'drizzle-orm'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { accounts, challenges, keystores } from '../../db/schema'
import { owner, ownershipRegistry, secondOwner, setupAppCaller, thirdOwner } from './ownership.fixtures'

// Runs random sequences of what a user can do to their accounts, through the real routes, and checks
// after every step that no account reached a state the product doesn't allow.

const wallets = [owner, secondOwner, thirdOwner]
type Wallet = (typeof wallets)[number]
const descriptorOf = (wallet: Wallet): string => new SingleSigAccount('p2wpkh', wallet.xpub).descriptor()

type Action =
  | { kind: 'create'; wallet: number; trackOnly: boolean }
  | { kind: 'track'; wallet: number }
  | { kind: 'verify'; wallet: number; signer: number }
  | { kind: 'archive'; wallet: number }
  | { kind: 'restore'; wallet: number }
  | { kind: 'deletePending'; wallet: number }
  | { kind: 'delete'; wallet: number }
  | { kind: 'setDevice'; wallet: number; device: 'ledger' | 'bitkey' | null }
  | { kind: 'rename'; wallet: number }

const walletIndex = fc.integer({ min: 0, max: wallets.length - 1 })
const actionArbitrary: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), wallet: walletIndex, trackOnly: fc.boolean() }),
  fc.record({ kind: fc.constant('track' as const), wallet: walletIndex }),
  // The signer is usually the wallet's own key, sometimes another wallet's.
  fc.record({
    kind: fc.constant('verify' as const),
    wallet: walletIndex,
    signer: fc.oneof({ weight: 3, arbitrary: fc.constant(-1) }, { weight: 1, arbitrary: walletIndex }),
  }),
  fc.record({ kind: fc.constant('archive' as const), wallet: walletIndex }),
  fc.record({ kind: fc.constant('restore' as const), wallet: walletIndex }),
  fc.record({ kind: fc.constant('deletePending' as const), wallet: walletIndex }),
  fc.record({ kind: fc.constant('delete' as const), wallet: walletIndex }),
  fc.record({
    kind: fc.constant('setDevice' as const),
    wallet: walletIndex,
    device: fc.constantFrom('ledger' as const, 'bitkey' as const, null),
  }),
  fc.record({ kind: fc.constant('rename' as const), wallet: walletIndex }),
)

// Every sequence starts by adding all the wallets, so the actions after it have accounts to act on.
const createAll = fc
  .tuple(...wallets.map(() => fc.boolean()))
  .map((trackOnly) => trackOnly.map((only, wallet): Action => ({ kind: 'create', wallet, trackOnly: only })))

type Harness = Awaited<ReturnType<typeof setupAppCaller>>

interface AccountState {
  id: string
  descriptor: string
  status: string
  archived: boolean
  device: string | null
  proven: boolean
}

async function snapshot(db: Harness['db']): Promise<Map<string, AccountState>> {
  const rows = await db.select().from(accounts)
  const states = await Promise.all(
    rows.map(async (row) => {
      const [keystore] = await db.select().from(keystores).where(eq(keystores.accountId, row.id))
      const satisfied = await db.select().from(challenges).where(eq(challenges.accountId, row.id))
      return {
        id: row.id,
        descriptor: `${row.network}:${row.descriptor}`,
        status: row.status,
        archived: row.deletedAt !== null,
        device: keystore?.wallet ?? null,
        proven: satisfied.some((challenge) => challenge.isSatisfied === 1),
      }
    }),
  )
  return new Map(states.map((state) => [state.id, state]))
}

async function accountId(db: Harness['db'], wallet: number): Promise<string | null> {
  const key = wallets[wallet]
  if (!key) {
    return null
  }
  const [row] = await db
    .select()
    .from(accounts)
    .where(eq(accounts.descriptor, descriptorOf(key)))
  return row?.id ?? null
}

async function verify(harness: Harness, claimId: string, signer: Wallet): Promise<void> {
  const registry = ownershipRegistry(harness.caller)
  const challenge = await registry.challenges.create({ claimId })
  const [keystore] = await harness.db.select().from(keystores).where(eq(keystores.accountId, claimId))
  if (!keystore) {
    return
  }
  const { signedMessage } = await registry.challengeMessages.create({
    challengeId: challenge.id,
    keystoreId: keystore.id,
  })
  let signature: string
  try {
    signature = Signer.sign(signer.wif, signedMessage.address, signedMessage.messageTextToSign)
  } catch {
    // A wallet can't sign for an address it doesn't own; the user simply has no signature to send.
    return
  }
  await registry.challengeMessages.complete({ signedMessageId: signedMessage.id, signature })
  await registry.challenges.complete({ challengeId: challenge.id })
}

async function perform(harness: Harness, action: Action): Promise<void> {
  const registry = ownershipRegistry(harness.caller)
  const key = wallets[action.wallet]
  if (!key) {
    return
  }
  if (action.kind === 'create') {
    await registry.accounts.create.singlesig({
      network: key.xpub.network.toString(),
      account: descriptorOf(key),
      displayName: 'Wallet',
      keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
      trackOnly: action.trackOnly,
    })
    return
  }
  const id = await accountId(harness.db, action.wallet)
  if (id === null) {
    return
  }
  switch (action.kind) {
    case 'track':
      await registry.accounts.track({ id })
      return
    case 'verify':
      await verify(harness, id, wallets[action.signer] ?? key)
      return
    case 'archive':
      // The archive route saves balance history from Electrum first, which tests don't have.
      await harness.db.update(accounts).set({ deletedAt: new Date().toISOString() }).where(eq(accounts.id, id))
      return
    case 'restore':
      await registry.accounts.restore({ id })
      return
    case 'deletePending':
      await registry.accounts.deletePending({ id })
      return
    case 'delete':
      await registry.accounts.delete({ id })
      return
    case 'setDevice': {
      const [keystore] = await harness.db.select().from(keystores).where(eq(keystores.accountId, id))
      if (keystore) {
        await registry.accounts.updateKeystore({ id: keystore.id, label: 'Key', wallet: action.device })
      }
      return
    }
    case 'rename':
      await registry.accounts.update({ id, displayName: 'Renamed' })
  }
}

/** Every rule that must hold between the state before an action and the state after it. */
function checkStep(action: Action, before: Map<string, AccountState>, after: Map<string, AccountState>): void {
  const descriptors = [...after.values()].map((state) => state.descriptor)
  expect(new Set(descriptors).size, 'one account per descriptor and network').toBe(descriptors.length)

  for (const state of after.values()) {
    expect(state.status === 'verified' && !state.proven, `${state.id} verified without a signed proof`).toBe(false)
    // A Bitkey can't sign the ownership proof, so a pending one could never finish.
    expect(state.status === 'pending' && state.device === 'bitkey', `${state.id} pending on a Bitkey`).toBe(false)
    const previous = before.get(state.id)
    if (!previous) {
      expect(action.kind, 'only creating adds an account').toBe('create')
      const trackOnly = action.kind === 'create' && action.trackOnly
      expect(state.status).toBe(trackOnly ? 'unverified' : 'pending')
      continue
    }
    if (previous.status !== state.status) {
      const move = `${previous.status} -> ${state.status}`
      if (state.status === 'verified') {
        expect(action.kind, move).toBe('verify')
        expect(action.kind === 'verify' && (action.signer === -1 || action.signer === action.wallet), move).toBe(true)
        expect(previous.archived, `${move} while archived`).toBe(false)
        expect(previous.device, `${move} on a Bitkey`).not.toBe('bitkey')
      } else {
        expect(move).toBe('pending -> unverified')
        const bitkey = action.kind === 'setDevice' && action.device === 'bitkey'
        expect(action.kind === 'track' || bitkey, `${move} by ${action.kind}`).toBe(true)
      }
    }
    if (action.kind !== 'archive' && action.kind !== 'restore') {
      expect(state.archived, `${state.id} archived state changed by ${action.kind}`).toBe(previous.archived)
    }
  }

  for (const [id, previous] of before) {
    if (!after.has(id)) {
      const allowed =
        (action.kind === 'deletePending' && previous.status === 'pending' && !previous.archived) ||
        (action.kind === 'delete' && previous.archived)
      expect(allowed, `${id} (${previous.status}, archived ${previous.archived}) removed by ${action.kind}`).toBe(true)
    }
  }
}

describe('account state', () => {
  it('stays valid through any sequence of user actions', async () => {
    await fc.assert(
      fc.asyncProperty(createAll, fc.array(actionArbitrary, { minLength: 1, maxLength: 12 }), async (creates, rest) => {
        const harness = await setupAppCaller()
        for (const action of [...creates, ...rest]) {
          const before = await snapshot(harness.db)
          try {
            await perform(harness, action)
          } catch (error) {
            // Refusing an action is fine; crashing on one is not.
            expect(error, JSON.stringify(action)).toBeInstanceOf(TRPCError)
            expect(error instanceof TRPCError ? error.code : '', JSON.stringify(action)).not.toBe(
              'INTERNAL_SERVER_ERROR',
            )
          }
          checkStep(action, before, await snapshot(harness.db))
        }
      }),
      { numRuns: 300 },
    )
  }, 120_000)
})
