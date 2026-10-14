import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { Signer } from 'bip322-js'
import pino from 'pino'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { type AppContextOptions, createAppContext } from '../../context'
import { accounts, challenges, keystores, signedMessages } from '../../db/schema'
import * as env from '../../env'
import { createSinglesigClaim, owner } from './ownership.fixtures'
import { appRouter } from './router'

async function setup(options: AppContextOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-router-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(env, 'loadEnv').mockReturnValue({ ...env.loadEnv(), DATA_DIR: directory })
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const app = (await createAppContext(pino({ level: 'silent' }), options)).unwrap()
  onTestFinished(() => {
    app.database.$client.close()
    app.electrumClient.disconnect()
  })
  const caller = appRouter.createCaller({ app }).portalProve.registry
  return { app, caller }
}

const singlesigInput = {
  network: 'bitcoin_mainnet',
  account: Wallets.singlesigLegacyAccount.toString(),
  displayName: 'Wallet',
  keystore: { label: 'Hardware wallet', wallet: 'coldcard' as const, model: 'Mk4', derivationPath: null },
}

it('preserves claim, keystore and signing-message DTOs through database round trips', async () => {
  const { app, caller } = await setup()
  const account = Wallets.singlesigLegacyAccount.toString()
  const created = await caller.claims.create.singlesig({
    network: 'bitcoin_mainnet',
    account,
    displayName: 'Wallet',
    keystore: { label: 'Hardware wallet', wallet: 'coldcard', model: 'Mk4', derivationPath: null },
  })
  const claim = await caller.claims.get.byId({ id: created.claim.id })
  expect(claim).toEqual(created.claim)
  expect(claim).toMatchObject({
    displayName: 'Wallet',
    account,
    isArchived: false,
    metadata: { walletInfo: { type: 'Coldcard', model: 'Mk4' } },
  })
  expect(claim.createdAt).toBeInstanceOf(Date)
  expect(claim.keystores).toEqual(created.keystores)
  expect(claim.keystores[0]?.xpub.toString()).toBe(Wallets.singlesigLegacyAccount.xpub.toString())

  const signing = await caller.getOrCreateSinglesigChallengeMessage({ network: 'bitcoin_mainnet', account })
  const message = signing.challengeMessage
  await expect(caller.challengeMessages.get({ signedMessageId: message.signedMessage.id })).resolves.toEqual(message)
  await expect(caller.challengeMessages.list({ challengeId: message.challengeId })).resolves.toEqual([message])
  expect(
    (await caller.getOrCreateSinglesigChallengeMessage({ network: 'bitcoin_mainnet', account })).challengeMessage,
  ).toEqual(message)
  expect((await caller.claims.get.byId({ id: claim.id })).latestChallenge).toEqual({
    id: message.challengeId,
    completed: false,
    messages: [{ signedMessageId: message.signedMessage.id, keystoreId: message.keystoreId, signed: false }],
  })

  const basic = await appRouter.createCaller({ app }).portalProve.accounts.add({
    descriptor: 'synthetic-descriptor',
    displayName: 'Basic account',
    network: 'mainnet',
  })
  await expect(caller.claims.get.byId({ id: basic.id })).resolves.toMatchObject({
    id: basic.id,
    account: basic.descriptor,
    displayName: basic.displayName,
  })
})

it.each(['singlesig', 'multisig'] as const)('creates only one %s claim under concurrent requests', async (kind) => {
  const { app, caller } = await setup()
  const create = async () =>
    kind === 'singlesig'
      ? caller.claims.create.singlesig(singlesigInput)
      : caller.claims.create.multisig({
          network: 'bitcoin_mainnet',
          account: Wallets.multisigNativeSegwitAccount.toString(),
          displayName: 'Multisig',
          keystores: Wallets.multisigNativeSegwitAccount.xpubs.map((xpub) => ({
            label: 'Key',
            wallet: null,
            model: null,
            derivationPath: null,
            publicKey: xpub.toString(),
          })),
        })
  const results = await Promise.allSettled([create(), create()])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'CONFLICT', message: 'Account already exists' },
  })
  const created = results.find((result) => result.status === 'fulfilled')
  assert(created?.status === 'fulfilled')
  expect(created.value.keystores).toEqual(created.value.claim.keystores)
  await expect(app.database.select().from(accounts)).resolves.toHaveLength(1)
  await expect(app.database.select().from(keystores)).resolves.toHaveLength(kind === 'singlesig' ? 1 : 3)
})

it('reuses one challenge and message under concurrent get-or-create requests', async () => {
  const { app, caller } = await setup()
  await caller.claims.create.singlesig(singlesigInput)
  const input = { network: singlesigInput.network, account: singlesigInput.account }
  const [first, second] = await Promise.all([
    caller.getOrCreateSinglesigChallengeMessage(input),
    caller.getOrCreateSinglesigChallengeMessage(input),
  ])
  expect(first).toEqual(second)
  await expect(app.database.select().from(challenges)).resolves.toHaveLength(1)
  await expect(app.database.select().from(signedMessages)).resolves.toHaveLength(1)
})

it('serializes separate challenge and message creation with the combined flow', async () => {
  const { app, caller } = await setup()
  const created = await caller.claims.create.singlesig(singlesigInput)
  const [key] = created.keystores
  assert(key)
  const [challenge, sameChallenge] = await Promise.all([
    caller.challenges.create({ claimId: created.claim.id }),
    caller.challenges.create({ claimId: created.claim.id }),
  ])
  expect(sameChallenge).toEqual(challenge)
  const [combined, message, sameMessage] = await Promise.all([
    caller.getOrCreateSinglesigChallengeMessage({ network: singlesigInput.network, account: singlesigInput.account }),
    caller.challengeMessages.create({ challengeId: challenge.id, keystoreId: key.id }),
    caller.challengeMessages.create({ challengeId: challenge.id, keystoreId: key.id }),
  ])
  expect(combined.challenge.id).toBe(challenge.id)
  expect(combined.challenge.createdAt).toEqual(challenge.createdAt)
  expect(message).toEqual(sameMessage)
  expect(combined.challengeMessage).toEqual(message)
  await expect(app.database.select().from(challenges)).resolves.toHaveLength(1)
  await expect(app.database.select().from(signedMessages)).resolves.toHaveLength(1)
})

it('accepts only one concurrent signature submission and preserves the winning signature and timestamp', async () => {
  const { caller } = await setup()
  const created = await createSinglesigClaim(caller, owner)
  const { challengeMessage } = await caller.getOrCreateSinglesigChallengeMessage({
    network: owner.xpub.network.toString(),
    account: created.claim.account,
  })
  const message = challengeMessage.signedMessage
  // Sign with the deterministic fixture key bound to this account's descriptor.
  const signature = Signer.sign(owner.wif, message.address, message.messageTextToSign)
  await expect(
    caller.challengeMessages.complete({ signedMessageId: message.id, signature: 'invalid' }),
  ).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Invalid signature',
  })
  await expect(caller.challengeMessages.get({ signedMessageId: message.id })).resolves.toMatchObject({
    signedMessage: { signature: null, signedAt: null },
  })

  const input = { signedMessageId: message.id, signature }
  const results = await Promise.allSettled([
    caller.challengeMessages.complete(input),
    caller.challengeMessages.complete(input),
  ])
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
  expect(results.find((result) => result.status === 'rejected')).toMatchObject({
    reason: { code: 'BAD_REQUEST', message: 'Signed message already completed' },
  })
  const winner = results.find((result) => result.status === 'fulfilled')
  assert(winner?.status === 'fulfilled')
  expect(winner.value.signedMessage.signature).toBe(signature)
  expect(winner.value.signedMessage.signedAt).toBeInstanceOf(Date)
  await expect(caller.challengeMessages.get({ signedMessageId: message.id })).resolves.toEqual(winner.value)
  await expect(caller.challengeMessages.complete(input)).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Signed message already completed',
  })
  await expect(caller.challengeMessages.get({ signedMessageId: message.id })).resolves.toEqual(winner.value)
})

it('returns the stored wallet balances of the requested wallets only', async () => {
  const { app } = await setup()
  const { accounts: accountRouter, controlCenter } = appRouter.createCaller({ app }).portalProve
  const requested = await accountRouter.add({
    descriptor: Wallets.singlesigNativeSegwitAccount.toString(),
    displayName: 'Requested wallet',
    network: 'mainnet',
  })
  const other = await accountRouter.add({
    descriptor: Wallets.singlesigLegacyAccount.toString(),
    displayName: 'Other wallet',
    network: 'mainnet',
  })
  await app.controlCenterService.recordAccountSnapshot(requested.id, '90', '2020-01-01T00:00:00.000Z')
  await app.controlCenterService.recordAccountSnapshot(requested.id, '150', '2020-01-03T09:00:00.000Z')
  await app.controlCenterService.recordAccountSnapshot(other.id, '50', '2020-01-02T00:00:00.000Z')

  await expect(controlCenter.storedWalletBalances({ claimIds: [requested.id] })).resolves.toEqual([
    { accountId: requested.id, balanceSats: '150', timestamp: '2020-01-03T09:00:00.000Z' },
  ])
})

it('reports a newer desktop release once the check finds one, and nothing from source', async () => {
  const fetch = vi.fn(async () => Response.json({ tag: 'v0.2.0_0' }))
  vi.stubGlobal('fetch', fetch)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const fromSource = (await setup()).app
  await fromSource.releaseCheckService.checkIfDue()
  await expect(appRouter.createCaller({ app: fromSource }).settings.releaseCheck()).resolves.toEqual({
    newVersion: null,
  })
  expect(fetch).not.toHaveBeenCalled()

  const desktop = (await setup({ releaseVersion: '0.1.0:0' })).app
  await desktop.releaseCheckService.checkIfDue()
  await expect(appRouter.createCaller({ app: desktop }).settings.releaseCheck()).resolves.toEqual({
    newVersion: '0.2.0',
  })
})
