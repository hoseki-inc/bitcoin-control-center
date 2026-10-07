import { dirname } from 'node:path'
import { SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { Signer } from 'bip322-js'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { initDatabase } from '../../db'
import {
  createMultisigClaim,
  createSinglesigClaim,
  outsider,
  owner,
  ownerAlias,
  secondOutsider,
  secondOwner,
  setupOwnershipHarness,
  setupOwnershipRegistry,
  setupSinglesigProof,
  setupStoredProof,
  signChallengeMessage,
  testnetOwner,
  testnetSecondOwner,
  testnetThirdOwner,
  thirdOutsider,
  thirdOwner,
  verifyTwoOfThreeAccount,
} from './ownership.fixtures'

describe('ownership verification account binding', () => {
  it('allows a matching singlesig key to verify its account', async () => {
    const { registry, claimId, verifyOwnership } = await setupSinglesigProof(owner, owner)

    const result = await verifyOwnership()

    expect(result.isSatisfied).toBe(true)
    await expect(registry.claims.get.byId({ id: claimId })).resolves.toMatchObject({ status: 'verified' })
  })

  it('rejects verification of a singlesig account using another account’s keystore', async () => {
    const { registry, claimId, verifyOwnership } = await setupSinglesigProof(owner, outsider)

    const attempt = verifyOwnership()

    await expect.soft(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(registry.claims.get.byId({ id: claimId })).resolves.toMatchObject({ status: 'pending' })
  })

  it('allows two distinct descriptor members to verify a 2-of-3 account', async () => {
    const registry = setupOwnershipRegistry()

    const result = await verifyTwoOfThreeAccount(registry, [owner, secondOwner, thirdOwner])

    expect(result.isSatisfied).toBe(true)
  })

  it.each([
    { scenario: 'one descriptor key repeated under three keystore IDs', keys: [owner, owner, owner] },
    { scenario: 'three distinct keys absent from the descriptor', keys: [outsider, secondOutsider, thirdOutsider] },
    { scenario: 'one unrelated key repeated under three keystore IDs', keys: [outsider, outsider, outsider] },
  ])('rejects a 2-of-3 proof using $scenario', async ({ keys }) => {
    const registry = setupOwnershipRegistry()

    const attempt = verifyTwoOfThreeAccount(registry, keys)

    await expect.soft(attempt).rejects.toMatchObject({ code: 'BAD_REQUEST' })

    const claims = await registry.claims.list({ excludePending: false })
    expect(claims).toEqual([])
  })

  it.each([
    { scenario: 'missing a descriptor key', keys: [owner, secondOwner] },
    { scenario: 'an extra key', keys: [owner, secondOwner, thirdOwner, outsider] },
    { scenario: 'no keys', keys: [] },
  ])('rejects multisig creation with $scenario without saving the claim', async ({ keys }) => {
    const registry = setupOwnershipRegistry()
    await expect(createMultisigClaim(registry, keys)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(registry.claims.list({ excludePending: false })).resolves.toEqual([])
  })

  it('rejects duplicate signing keys hidden behind different xpub metadata', async () => {
    const registry = setupOwnershipRegistry()
    const keys = [owner, ownerAlias, thirdOwner]
    await expect(createMultisigClaim(registry, keys, keys)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(registry.claims.list({ excludePending: false })).resolves.toEqual([])
  })

  describe.each([
    { network: 'mainnet', keys: [thirdOwner, owner, secondOwner] },
    { network: 'testnet', keys: [testnetThirdOwner, testnetOwner, testnetSecondOwner] },
  ])('$network multisig', ({ keys }) => {
    const scriptTypes = ['p2sh', 'p2wsh', 'p2sh-p2wsh'] as const

    it.each(scriptTypes)('verifies %s with P2PKH cosigner addresses', async (accountType) => {
      const registry = setupOwnershipRegistry()
      const created = await createMultisigClaim(registry, keys, [...keys].reverse(), accountType)
      const challenge = await registry.challenges.create({ claimId: created.claim.id })
      for (const [index, store] of created.keystores.slice(0, 2).entries()) {
        const key = keys[index]
        if (key === undefined) {
          expect.fail('Fixture key must exist')
        }
        const { signedMessage } = await registry.challengeMessages.create({
          challengeId: challenge.id,
          keystoreId: store.id,
        })
        expect(signedMessage.address).toBe(new SingleSigAccount('p2pkh', key.xpub).receiveAddress(0).toString())
        await signChallengeMessage(registry, challenge.id, store.id, key)
        if (index === 0) {
          await expect(registry.challenges.complete({ challengeId: challenge.id })).rejects.toMatchObject({
            code: 'BAD_REQUEST',
          })
          await expect(registry.claims.get.byId({ id: created.claim.id })).resolves.toMatchObject({
            status: 'pending',
          })
        }
      }
      await expect(registry.challenges.complete({ challengeId: challenge.id })).resolves.toMatchObject({
        isSatisfied: true,
      })
    })

    it.each(scriptTypes)('rejects a non-P2PKH cosigner address for %s', async (accountType) => {
      const { registry, db } = setupOwnershipHarness()
      const created = await createMultisigClaim(registry, keys, keys, accountType)
      const challenge = await registry.challenges.create({ claimId: created.claim.id })
      const [store, secondStore] = created.keystores
      const [key, secondKey] = keys
      if (!store || !secondStore || !key || !secondKey) {
        expect.fail('Fixture must contain two cosigners')
      }
      await signChallengeMessage(registry, challenge.id, secondStore.id, secondKey)
      const { signedMessage } = await registry.challengeMessages.create({
        challengeId: challenge.id,
        keystoreId: store.id,
      })
      const wrongAddress = new SingleSigAccount('p2wpkh', key.xpub).receiveAddress(0).toString()
      const signature = Signer.sign(key.wif, wrongAddress, signedMessage.messageTextToSign)
      db.prepare('UPDATE signed_messages SET address = ? WHERE id = ?').run(wrongAddress, signedMessage.id)
      await expect(
        registry.challengeMessages.create({ challengeId: challenge.id, keystoreId: store.id }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(
        registry.challengeMessages.complete({ signedMessageId: signedMessage.id, signature }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      expect(db.prepare('SELECT signature FROM signed_messages WHERE id = ?').get(signedMessage.id)).toEqual({
        signature: null,
      })
      db.prepare('UPDATE signed_messages SET signature = ?, signed_at = ? WHERE id = ?').run(
        signature,
        new Date().toISOString(),
        signedMessage.id,
      )
      await expect(registry.challenges.complete({ challengeId: challenge.id })).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      await expect(registry.claims.get.byId({ id: created.claim.id })).resolves.toMatchObject({ status: 'pending' })
    })
  })

  describe.each([
    { network: 'mainnet', key: owner },
    { network: 'testnet', key: testnetOwner },
  ])('$network singlesig', ({ key }) => {
    it.each(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const)(
      'verifies the descriptor address for %s',
      async (scriptType) => {
        const registry = setupOwnershipRegistry()
        const created = await createSinglesigClaim(registry, key, scriptType)
        const messageInput = { network: key.xpub.network.toString(), account: created.claim.account }
        const { challenge, challengeMessage } = await registry.getOrCreateSinglesigChallengeMessage(messageInput)
        const message = challengeMessage.signedMessage
        expect(message.address).toBe(new SingleSigAccount(scriptType, key.xpub).receiveAddress(0).toString())
        await expect(registry.getOrCreateSinglesigChallengeMessage(messageInput)).resolves.toMatchObject({
          challengeMessage: { signedMessage: { id: message.id } },
        })
        await registry.challengeMessages.complete({
          signedMessageId: message.id,
          signature: Signer.sign(key.wif, message.address, message.messageTextToSign),
        })
        await expect(registry.challenges.complete({ challengeId: challenge.id })).resolves.toMatchObject({
          isSatisfied: true,
        })
      },
    )

    it.each(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const)(
      'rejects a correct key with the wrong address script type for %s',
      async (scriptType) => {
        const { registry, db } = setupOwnershipHarness()
        const created = await createSinglesigClaim(registry, key, scriptType)
        const messageInput = { network: key.xpub.network.toString(), account: created.claim.account }
        const { challenge, challengeMessage } = await registry.getOrCreateSinglesigChallengeMessage(messageInput)
        const message = challengeMessage.signedMessage
        const wrongScriptType = scriptType === 'p2wpkh' ? 'p2pkh' : 'p2wpkh'
        const wrongAddress = new SingleSigAccount(wrongScriptType, key.xpub).receiveAddress(0).toString()
        const signature = Signer.sign(key.wif, wrongAddress, message.messageTextToSign)
        db.prepare('UPDATE signed_messages SET address = ? WHERE id = ?').run(wrongAddress, message.id)

        await expect(registry.getOrCreateSinglesigChallengeMessage(messageInput)).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        })
        await expect(
          registry.challengeMessages.create({
            challengeId: challenge.id,
            keystoreId: challengeMessage.keystoreId,
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
        await expect(
          registry.challengeMessages.complete({
            signedMessageId: message.id,
            signature,
          }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
        expect(db.prepare('SELECT signature FROM signed_messages WHERE id = ?').get(message.id)).toEqual({
          signature: null,
        })

        // A proof saved before the fix must also fail the final completion check.
        db.prepare('UPDATE signed_messages SET signature = ?, signed_at = ? WHERE id = ?').run(
          signature,
          new Date().toISOString(),
          message.id,
        )
        await expect(registry.challenges.complete({ challengeId: challenge.id })).rejects.toMatchObject({
          code: 'BAD_REQUEST',
        })
        await expect(registry.claims.get.byId({ id: created.claim.id })).resolves.toMatchObject({ status: 'pending' })
      },
    )
  })

  it.each([
    'cross-account',
    'cross-account matching key',
    'unrelated key',
    'duplicate key',
    'aliased key',
    'wrong address',
    'invalid signature',
  ] as const)('rejects a stored %s proof at final completion', async (scenario) => {
    const { registry, db, claimId, challengeId } = setupStoredProof(scenario)
    await expect(registry.challenges.complete({ challengeId })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(registry.claims.get.byId({ id: claimId })).resolves.toMatchObject({ status: 'pending' })
    expect(db.prepare('SELECT is_satisfied, completed_at FROM challenges WHERE id = ?').get(challengeId)).toEqual({
      is_satisfied: 0,
      completed_at: null,
    })
  })

  it.each(['cross-account', 'cross-account matching key', 'unrelated key', 'wrong address'] as const)(
    'rejects an existing %s message when reusing it or submitting a signature',
    async (scenario) => {
      const { registry, db, claimId, challengeId, messages } = setupStoredProof(scenario)
      const message = messages[0]
      if (message === undefined) {
        expect.fail('Fixture must contain a stored message')
      }
      db.prepare('UPDATE signed_messages SET signature = NULL, signed_at = NULL WHERE id = ?').run(message.id)
      await expect(
        registry.challengeMessages.create({ challengeId, keystoreId: message.keystoreId }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      await expect(
        registry.challengeMessages.complete({ signedMessageId: message.id, signature: message.signature }),
      ).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
      expect(db.prepare('SELECT signature, signed_at FROM signed_messages WHERE id = ?').get(message.id)).toEqual({
        signature: null,
        signed_at: null,
      })
      await expect(registry.claims.get.byId({ id: claimId })).resolves.toMatchObject({ status: 'pending' })
    },
  )

  it('migrates legacy P2WPKH messages and finishes the same challenge with fresh P2PKH proofs', async () => {
    const { registry, db } = setupOwnershipHarness()
    const created = await createMultisigClaim(registry, [owner, secondOwner, thirdOwner])
    const challenge = await registry.challenges.create({ claimId: created.claim.id })
    const [store, secondStore] = created.keystores
    if (!store || !secondStore) {
      expect.fail('Fixture must contain two cosigners')
    }
    // Earlier releases stored each cosigner's P2WPKH address; one cosigner had already signed.
    for (const [keystoreId, key, signed] of [
      [store.id, owner, true],
      [secondStore.id, secondOwner, false],
    ] as const) {
      const { signedMessage } = await registry.challengeMessages.create({ challengeId: challenge.id, keystoreId })
      const legacyAddress = new SingleSigAccount('p2wpkh', key.xpub).receiveAddress(0).toString()
      const signature = signed ? Signer.sign(key.wif, legacyAddress, signedMessage.messageTextToSign) : null
      db.prepare('UPDATE signed_messages SET address = ?, signature = ?, signed_at = ? WHERE id = ?').run(
        legacyAddress,
        signature,
        signed ? new Date().toISOString() : null,
        signedMessage.id,
      )
    }

    // Simulate the last pre-reset database version, then run the real startup migration.
    db.prepare('DELETE FROM _migrations WHERE name = ?').run('017_reset_unfinished_challenge_messages')
    initDatabase(dirname(db.name), pino({ level: 'silent' })).close()

    await expect(registry.claims.get.byId({ id: created.claim.id })).resolves.toMatchObject({
      latestChallenge: { id: challenge.id, messages: [] },
    })
    await expect(registry.challenges.create({ claimId: created.claim.id })).resolves.toMatchObject({ id: challenge.id })
    await signChallengeMessage(registry, challenge.id, store.id, owner)
    await signChallengeMessage(registry, challenge.id, secondStore.id, secondOwner)
    await expect(registry.challenges.complete({ challengeId: challenge.id })).resolves.toMatchObject({
      isSatisfied: true,
    })
  })

  it.each(['wrong address', 'cross-account', 'unrelated key'] as const)(
    'keeps stored %s messages intact through repeated claim reads and challenge reuse',
    async (scenario) => {
      const { registry, db, claimId, challengeId } = setupStoredProof(scenario)
      const messages = db.prepare('SELECT * FROM signed_messages ORDER BY id').all()
      const challenges = db.prepare('SELECT * FROM challenges ORDER BY id').all()
      for (const archived of [false, true]) {
        db.prepare('UPDATE accounts SET deleted_at = ? WHERE id = ?').run(
          archived ? new Date().toISOString() : null,
          claimId,
        )
        const changes = db.prepare('SELECT total_changes() AS changes').get()
        for (let attempt = 0; attempt < 2; attempt++) {
          const claim = await registry.claims.get.byId({ id: claimId })
          await registry.claims.get.byAccount({ network: claim.network, account: claim.account })
          const claims = archived ? await registry.claims.listArchived() : await registry.claims.list()
          expect(claims.some((item) => item.id === claimId)).toBe(true)
          await expect(registry.challenges.create({ claimId })).resolves.toMatchObject({ id: challengeId })
        }
        expect(db.prepare('SELECT total_changes() AS changes').get()).toEqual(changes)
        expect(db.prepare('SELECT * FROM signed_messages ORDER BY id').all()).toEqual(messages)
        expect(db.prepare('SELECT * FROM challenges ORDER BY id').all()).toEqual(challenges)
      }
    },
  )

  it('rejects a substituted signing address through the singlesig get-or-create endpoint', async () => {
    const { registry } = setupStoredProof('wrong address')
    await expect(
      registry.getOrCreateSinglesigChallengeMessage({
        network: 'bitcoin_mainnet',
        account: owner.account.descriptor(),
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
})
