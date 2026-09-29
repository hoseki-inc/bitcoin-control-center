import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { createAppContext } from '../../context'
import { appRouter } from './router'

it('preserves claim, keystore and signing-message DTOs through database round trips', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-router-'))
  vi.stubEnv('DATA_DIR', directory)
  vi.stubEnv('ELECTRUM_HOST', 'localhost')
  vi.spyOn(ElectrumClient.prototype, 'connect').mockImplementation(asyncFn(async () => Ok(['test', '1.4'])))
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  })
  const app = (await createAppContext(pino({ level: 'silent' }))).unwrap()
  onTestFinished(() => {
    app.database.close()
    app.electrumClient.disconnect()
  })
  const caller = appRouter.createCaller({ app }).portalProve.registry
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
})
