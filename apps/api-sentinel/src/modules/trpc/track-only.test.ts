import { MultiSigAccount, SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { describe, expect, it } from 'vitest'
import { owner, secondOwner, setupOwnershipRegistry, signChallengeMessage, thirdOwner } from './ownership.fixtures'

const keystore = { label: 'Default Keystore', wallet: null, model: null, derivationPath: null }

describe('track-only accounts', () => {
  it('saves a single-sig account as unverified and leaves it out of proven accounts', async () => {
    const registry = await setupOwnershipRegistry()

    const { claim } = await registry.claims.create.singlesig({
      network: owner.xpub.network.toString(),
      account: new SingleSigAccount('p2wpkh', owner.xpub).descriptor(),
      displayName: 'Watched wallet',
      keystore,
      trackOnly: true,
    })

    expect(claim).toMatchObject({ status: 'unverified', isVerified: false })
    await expect(registry.claims.list({ excludePending: false })).resolves.toMatchObject([{ id: claim.id }])
    await expect(registry.claims.list({ excludePending: true })).resolves.toEqual([])
  })

  it('saves a multisig account as unverified', async () => {
    const registry = await setupOwnershipRegistry()
    const keys = [owner, secondOwner, thirdOwner]
    const account = MultiSigAccount.from({
      scriptType: 'p2wsh',
      threshold: 2,
      isSorted: true,
      xpubs: keys.map((key) => key.xpub),
    }).expect('Fixture descriptor must be valid')

    const { claim } = await registry.claims.create.multisig({
      network: account.network().toString(),
      account: account.descriptor(),
      displayName: 'Watched multisig',
      keystores: keys.map((key) => ({
        label: 'Key',
        wallet: null,
        model: null,
        derivationPath: null,
        publicKey: key.xpub.toString(),
      })),
      trackOnly: true,
    })

    expect(claim).toMatchObject({ status: 'unverified', isVerified: false })
  })

  it('becomes verified once its owner signs', async () => {
    const registry = await setupOwnershipRegistry()
    const { claim, keystores } = await registry.claims.create.singlesig({
      network: owner.xpub.network.toString(),
      account: new SingleSigAccount('p2wpkh', owner.xpub).descriptor(),
      displayName: 'Watched wallet',
      keystore,
      trackOnly: true,
    })
    const store = keystores[0]
    if (store === undefined) {
      expect.fail('Claim must contain its keystore')
    }

    const challenge = await registry.challenges.create({ claimId: claim.id })
    await signChallengeMessage(registry, challenge.id, store.id, owner)
    await registry.challenges.complete({ challengeId: challenge.id })

    await expect(registry.claims.get.byId({ id: claim.id })).resolves.toMatchObject({ status: 'verified' })
    await expect(registry.claims.list({ excludePending: true })).resolves.toMatchObject([{ id: claim.id }])
  })

  it('saves the device connected later onto a tracked account', async () => {
    const registry = await setupOwnershipRegistry()
    const { keystores } = await registry.claims.create.singlesig({
      network: owner.xpub.network.toString(),
      account: new SingleSigAccount('p2wpkh', owner.xpub).descriptor(),
      displayName: 'Watched wallet',
      keystore,
      trackOnly: true,
    })
    const store = keystores[0]
    if (store === undefined) {
      expect.fail('Claim must contain its keystore')
    }

    const updated = await registry.claims.updateKeystore({
      id: store.id,
      label: store.label,
      wallet: 'ledger',
      model: 'nanoX',
      derivationPath: "m/84'/0'/0'",
    })

    expect(updated).toMatchObject({
      wallet: 'ledger',
      model: 'nanoX',
      derivationPath: "m/84'/0'/0'",
      isIdentified: true,
    })
  })

  it('tracks a pending account instead of asking to prove it, and leaves proven accounts alone', async () => {
    const registry = await setupOwnershipRegistry()
    const { claim, keystores } = await registry.claims.create.singlesig({
      network: owner.xpub.network.toString(),
      account: new SingleSigAccount('p2wpkh', owner.xpub).descriptor(),
      displayName: 'Started signing',
      keystore,
    })

    await expect(registry.claims.track({ id: claim.id })).resolves.toEqual({ id: claim.id, status: 'unverified' })

    const store = keystores[0]
    if (store === undefined) {
      expect.fail('Claim must contain its keystore')
    }
    const challenge = await registry.challenges.create({ claimId: claim.id })
    await signChallengeMessage(registry, challenge.id, store.id, owner)
    await registry.challenges.complete({ challengeId: challenge.id })
    await expect(registry.claims.track({ id: claim.id })).resolves.toEqual({ id: claim.id, status: 'verified' })
  })
})
