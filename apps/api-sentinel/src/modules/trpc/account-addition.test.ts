import { Wallets } from '@hoseki/packages/testing'
import { eq } from 'drizzle-orm'
import { assert, expect, it } from 'vitest'
import { accounts, keystores } from '../../db/schema'
import { setupAppCaller } from './ownership.fixtures'

const input = { descriptor: 'synthetic-descriptor', displayName: 'Wallet', network: 'mainnet' as const }

it('creates only one account under concurrent identical add requests', async () => {
  const { caller, db } = await setupAppCaller()
  const add = caller.portalProve.accounts.add

  const results = await Promise.allSettled([add(input), add(input)])

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'CONFLICT', message: 'An account with this descriptor already exists' },
  })
  const winner = results.find((result) => result.status === 'fulfilled')
  assert(winner?.status === 'fulfilled')
  expect(winner.value.id).not.toBe('')
  expect(winner.value).toEqual({ id: winner.value.id, ...input })
  await expect(db.select().from(accounts)).resolves.toMatchObject([{ ...winner.value, status: 'pending' }])
  await expect(db.select().from(keystores)).resolves.toEqual([])
})

it.each([
  { descriptor: 'another-descriptor', displayName: 'Other wallet', network: 'mainnet' },
  { descriptor: input.descriptor, displayName: 'Testnet wallet', network: 'testnet' },
] as const)('allows concurrent adds with a distinct descriptor/network pair: $displayName', async (other) => {
  const { caller, db } = await setupAppCaller()

  const added = await Promise.all([caller.portalProve.accounts.add(input), caller.portalProve.accounts.add(other)])

  expect(added[0]).toMatchObject(input)
  expect(added[1]).toMatchObject(other)
  expect(added[0].id).not.toBe(added[1].id)
  await expect(db.select().from(accounts)).resolves.toHaveLength(2)
})

it('preserves descriptor text and defaults the network to mainnet', async () => {
  const { caller, db } = await setupAppCaller()
  const original = { descriptor: ' unnormalized-synthetic-descriptor ', displayName: 'Wallet' }

  const added = await caller.portalProve.accounts.add(original)

  expect(added).toEqual({ id: added.id, network: 'mainnet', ...original })
  await expect(db.select().from(accounts)).resolves.toMatchObject([{ ...added, status: 'pending' }])
})

it.each([
  { status: 'pending', deletedAt: null },
  { status: 'verified', deletedAt: null },
  { status: 'expired', deletedAt: null },
  { status: 'verified', deletedAt: '2026-01-01' },
] as const)('rejects existing duplicates regardless of status=$status, archived=$deletedAt', async (state) => {
  const { caller, db } = await setupAppCaller()
  const existing = await caller.portalProve.accounts.add(input)
  await db.update(accounts).set(state).where(eq(accounts.id, existing.id))
  const before = await db.select().from(accounts)

  await expect(caller.portalProve.accounts.add({ ...input, displayName: 'Renamed duplicate' })).rejects.toMatchObject({
    code: 'CONFLICT',
    message: 'An account with this descriptor already exists',
  })
  await expect(db.select().from(accounts)).resolves.toEqual(before)
})

it.each([
  ['singlesig', 'basic'],
  ['singlesig', 'claim'],
  ['multisig', 'basic'],
  ['multisig', 'claim'],
] as const)('serializes basic adds with %s claim creation when %s starts first', async (kind, first) => {
  const { caller, db } = await setupAppCaller()
  const descriptor =
    kind === 'singlesig' ? Wallets.singlesigLegacyAccount.toString() : Wallets.multisigNativeSegwitAccount.toString()
  const add = async () => caller.portalProve.accounts.add({ ...input, descriptor })
  const create = async () =>
    kind === 'singlesig'
      ? caller.portalProve.registry.claims.create.singlesig({
          network: 'bitcoin_mainnet',
          account: Wallets.singlesigLegacyAccount.toString(),
          displayName: 'Claim',
          keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
        })
      : caller.portalProve.registry.claims.create.multisig({
          network: 'bitcoin_mainnet',
          account: Wallets.multisigNativeSegwitAccount.toString(),
          displayName: 'Claim',
          keystores: Wallets.multisigNativeSegwitAccount.xpubs.map((xpub) => ({
            label: 'Key',
            wallet: null,
            model: null,
            derivationPath: null,
            publicKey: xpub.toString(),
          })),
        })

  const results = await Promise.allSettled(first === 'basic' ? [add(), create()] : [create(), add()])

  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({ reason: { code: 'CONFLICT' } })
  const rows = await db.select().from(accounts)
  expect(rows).toHaveLength(1)
  const row = rows[0]
  assert(row)
  expect(row).toMatchObject({ descriptor, network: 'mainnet', status: 'pending' })
  const expectedKeys = row.displayName === 'Claim' ? (kind === 'singlesig' ? 1 : 3) : 0
  await expect(db.select().from(keystores)).resolves.toHaveLength(expectedKeys)
})

it('rejects claims whose descriptor holds an extended private key', async () => {
  const { caller, db } = await setupAppCaller()
  // BIP32 test vectors 1 (m, m/0H) and 2 (m/0): published vectors, not real wallets.
  const xprv =
    'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
  const cosignerXprv =
    'xprv9uHRZZhk6KAJC1avXpDAp4MDc3sQKNxDiPvvkX8Br5ngLNv1TxvUxt4cV1rGL5hj6KCesnDYUhd7oWgT11eZG7XnxHrnYeSvkzY7d2bhkJ7'
  const cosignerXpub =
    'xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH'
  const claims = caller.portalProve.registry.claims.create

  await expect(
    claims.singlesig({
      network: 'bitcoin_mainnet',
      account: `wpkh([3442193e/84h/0h/0h]${xprv}/0/*)`,
      displayName: 'Private',
      keystore: { label: 'Key', wallet: null, model: null, derivationPath: null },
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(
    claims.multisig({
      network: 'bitcoin_mainnet',
      account: `wsh(sortedmulti(2,[3442193e/0h]${cosignerXprv}/<0;1>/*,[bd16bee5/0]${cosignerXpub}/<0;1>/*))`,
      displayName: 'Private',
      keystores: [cosignerXprv, cosignerXpub].map((publicKey) => ({
        label: 'Key',
        wallet: null,
        model: null,
        derivationPath: null,
        publicKey,
      })),
    }),
  ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  await expect(db.select().from(accounts)).resolves.toEqual([])
  await expect(db.select().from(keystores)).resolves.toEqual([])
})
