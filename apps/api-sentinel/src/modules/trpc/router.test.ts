import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap } from '@hoseki/packages/collection'
import { AsyncResult, Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { Signer } from 'bip322-js'
import { eq } from 'drizzle-orm'
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

it('reads wallet balances without waiting for Electrum, and reports the scans it starts', async () => {
  const { app } = await setup()
  const { accounts: accountRouter, controlCenter } = appRouter.createCaller({ app }).portalProve
  const wallet = await accountRouter.add({
    descriptor: Wallets.singlesigNativeSegwitAccount.toString(),
    displayName: 'Wallet',
    network: 'mainnet',
  })
  const archived = await accountRouter.add({
    descriptor: Wallets.singlesigLegacyAccount.toString(),
    displayName: 'Archived wallet',
    network: 'mainnet',
  })
  await app.controlCenterService.recordAccountSnapshot(wallet.id, '150', '2020-01-03T09:00:00.000Z')
  await app.database.update(accounts).set({ deletedAt: '2020-01-04T00:00:00.000Z' }).where(eq(accounts.id, archived.id))
  // Electrum never answers.
  vi.spyOn(app.onchainProvider, 'getBlocksTip').mockReturnValue(new AsyncResult(new Promise(() => undefined)))

  await expect(controlCenter.walletBalances({ claimIds: [wallet.id, archived.id] })).resolves.toEqual([
    {
      accountId: wallet.id,
      balanceSats: '150',
      asOf: '2020-01-03T09:00:00.000Z',
      syncing: true,
      failed: false,
    },
  ])
})

it('returns the balances of wallets it could scan, leaving out one that failed, without its error', async () => {
  const { app } = await setup()
  const { accounts: accountRouter, onchain } = appRouter.createCaller({ app }).portalProve
  const good = await accountRouter.add({
    descriptor: Wallets.singlesigNativeSegwitAccount.toString(),
    displayName: 'Good wallet',
    network: 'mainnet',
  })
  const bad = await accountRouter.add({
    descriptor: Wallets.singlesigLegacyAccount.toString(),
    displayName: 'Bad wallet',
    network: 'mainnet',
  })
  vi.spyOn(app.onchainProvider, 'getBlocksTip').mockReturnValue(
    new AsyncResult(Promise.resolve(Ok({ height: 1, hash: 'a'.repeat(64), timestamp: new Date() }))),
  )
  vi.spyOn(app.onchainProvider, 'getConfirmedAccountBalances').mockImplementation(
    asyncFn(async (requested) => {
      const [account] = [...requested]
      return account?.toString() === Wallets.singlesigLegacyAccount.toString()
        ? Err(new Error('synthetic-sensitive-error'))
        : Ok(new IndexMap([[Wallets.singlesigNativeSegwitAccount, 5_000n]]))
    }),
  )

  const balances = await onchain.claimBalances({ claimIds: [good.id, bad.id] })
  expect([...balances.entries()].map(([id, sats]) => [id, sats.toString()])).toEqual([[good.id, '5000']])
  await expect(onchain.claimBalances({ claimIds: [bad.id] })).rejects.toMatchObject({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Could not fetch wallet balances',
  })
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
    pending: false,
  })
  expect(fetch).not.toHaveBeenCalled()

  const desktop = (await setup({ releaseVersion: '0.1.0:0' })).app
  const api = appRouter.createCaller({ app: desktop }).settings
  await expect(api.releaseCheck()).resolves.toEqual({ newVersion: null, pending: true })
  await desktop.releaseCheckService.checkIfDue()
  await expect(api.releaseCheck()).resolves.toEqual({ newVersion: '0.2.0', pending: false })
})

it('loads portfolio data in a timezone Intl.supportedValuesOf omits', async () => {
  const { app } = await setup()
  vi.spyOn(app.priceService, 'getCurrentBtcPrice').mockImplementation(asyncFn(async () => Err(new Error('offline'))))
  const getData = vi.spyOn(app.controlCenterService, 'getData')
  const { controlCenter } = appRouter.createCaller({ app }).portalProve

  await controlCenter.getData({ timeRange: '30d', timezone: 'Asia/Kolkata' })

  expect(getData).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Kolkata' }))
})

it('rejects an unknown portfolio timezone', async () => {
  const { app } = await setup()
  const { controlCenter } = appRouter.createCaller({ app }).portalProve

  await expect(controlCenter.getData({ timeRange: '30d', timezone: 'Not/AZone' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Invalid timezone',
  })
})

it('connects a Bitkey as one unverified 2-of-3 account that statements leave out', async () => {
  const { caller } = await setup()

  const { claim, alreadyConnected } = await caller.claims.create.bitkey({
    descriptorExport: Wallets.bitkeyExport,
    displayName: 'Bitkey',
  })

  expect(alreadyConnected).toBe(false)
  expect(claim).toMatchObject({ status: 'unverified', isVerified: false, metadata: { walletInfo: { type: 'Bitkey' } } })
  expect(
    Object.fromEntries(claim.keystores.map((keystore) => [keystore.model, [keystore.label, keystore.wallet]])),
  ).toEqual({
    app: ['Phone app key', 'bitkey'],
    hardware: ['Bitkey hardware', 'bitkey'],
    server: ['Block server key', 'bitkey'],
  })
  expect((await caller.claims.list()).map((listed) => listed.id)).toEqual([claim.id])
  await expect(caller.claims.list({ excludePending: true })).resolves.toEqual([])
  await expect(caller.challenges.create({ claimId: claim.id })).rejects.toThrow('can’t be verified')

  await expect(
    caller.claims.create.bitkey({ descriptorExport: Wallets.bitkeyExport, displayName: 'Another name' }),
  ).resolves.toMatchObject({ alreadyConnected: true, claim: { id: claim.id, displayName: 'Bitkey' } })
})

it('explains why it cannot read a Bitkey export', async () => {
  const { caller } = await setup()

  await expect(caller.claims.create.bitkey({ descriptorExport: 'hello', displayName: 'Bitkey' })).rejects.toThrow(
    'Bitkey wallet descriptor',
  )
})
