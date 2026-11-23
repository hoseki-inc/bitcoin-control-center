import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network, NetworkAccount } from '@hoseki/packages/bitcoin'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap } from '@hoseki/packages/collection'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import { AsyncResult, Err, Ok, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Wallets } from '@hoseki/packages/testing'
import { type FastifyTRPCPluginOptions, fastifyTRPCPlugin } from '@trpc/server/adapters/fastify'
import { Signer } from 'bip322-js'
import { eq } from 'drizzle-orm'
import Fastify from 'fastify'
import { nanoid } from 'nanoid'
import pino from 'pino'
import superjson from 'superjson'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { type AppContextOptions, createAppContext } from '../../context'
import { accounts, challenges, keystores, signedMessages } from '../../db/schema'
import * as env from '../../env'
import type { TRPCContext } from './init'
import { createSinglesigClaim, owner, ownershipRegistry } from './ownership.fixtures'
import { type AppRouter, appRouter } from './router'

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
  const caller = ownershipRegistry(appRouter.createCaller({ app }))
  return { app, caller }
}

/** Saves a watch-only wallet straight to the database, for tests that only need one to exist. */
async function addWallet(app: Awaited<ReturnType<typeof setup>>['app'], descriptor: string, displayName: string) {
  const id = nanoid()
  await app.database.insert(accounts).values({ id, network: 'mainnet', descriptor, displayName })
  return { id }
}

const singlesigInput = {
  network: 'bitcoin_mainnet',
  account: Wallets.singlesigLegacyAccount.toString(),
  displayName: 'Wallet',
  keystore: { label: 'Hardware wallet', wallet: 'coldcard' as const, model: 'Mk4', derivationPath: null },
}

it('preserves claim, keystore and signing-message DTOs through database round trips', async () => {
  const { caller } = await setup()
  const account = Wallets.singlesigLegacyAccount.toString()
  const created = await caller.accounts.create.singlesig({
    network: 'bitcoin_mainnet',
    account,
    displayName: 'Wallet',
    keystore: { label: 'Hardware wallet', wallet: 'coldcard', model: 'Mk4', derivationPath: null },
  })
  const claim = await caller.accounts.get.byId({ id: created.claim.id })
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
  expect((await caller.accounts.get.byId({ id: claim.id })).latestChallenge).toEqual({
    id: message.challengeId,
    completed: false,
    messages: [{ signedMessageId: message.signedMessage.id, keystoreId: message.keystoreId, signed: false }],
  })
})

it('reads an account saved by the retired accounts.add route as it was stored', async () => {
  const { app, caller } = await setup()
  // That route stored a nanoid, the descriptor text as typed, and no keystores.
  const legacy = await addWallet(app, 'synthetic-descriptor', 'Basic account')

  const claim = await caller.accounts.get.byId({ id: legacy.id })
  expect(claim).toMatchObject({
    id: legacy.id,
    account: 'synthetic-descriptor',
    displayName: 'Basic account',
    keystores: [],
    latestChallenge: null,
    metadata: null,
  })
  expect((await caller.accounts.list()).map((account) => account.id)).toContain(legacy.id)
})

it.each(['singlesig', 'multisig'] as const)('creates only one %s claim under concurrent requests', async (kind) => {
  const { app, caller } = await setup()
  const create = async () =>
    kind === 'singlesig'
      ? caller.accounts.create.singlesig(singlesigInput)
      : caller.accounts.create.multisig({
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
  await caller.accounts.create.singlesig(singlesigInput)
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
  const created = await caller.accounts.create.singlesig(singlesigInput)
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
  const { onchain } = appRouter.createCaller({ app }).portalProve
  const wallet = await addWallet(app, Wallets.singlesigNativeSegwitAccount.toString(), 'Wallet')
  const archived = await addWallet(app, Wallets.singlesigLegacyAccount.toString(), 'Archived wallet')
  await app.controlCenterService.recordAccountSnapshot(wallet.id, '150', '2020-01-03T09:00:00.000Z')
  await app.database.update(accounts).set({ deletedAt: '2020-01-04T00:00:00.000Z' }).where(eq(accounts.id, archived.id))
  // Electrum never answers.
  vi.spyOn(app.onchainProvider, 'getBlocksTip').mockReturnValue(new AsyncResult(new Promise(() => undefined)))

  await expect(onchain.walletBalances({ claimIds: [wallet.id, archived.id] })).resolves.toEqual([
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
  const { onchain } = appRouter.createCaller({ app }).portalProve
  const good = await addWallet(app, Wallets.singlesigNativeSegwitAccount.toString(), 'Good wallet')
  const bad = await addWallet(app, Wallets.singlesigLegacyAccount.toString(), 'Bad wallet')
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

const trpcTransformer = registerCustomSerializers(superjson)
const trpcErrorResponseSchema = z.object({
  error: z.object({
    json: z.object({
      message: z.string(),
      code: z.number(),
      data: z.object({
        code: z.string(),
        httpStatus: z.number(),
      }),
    }),
  }),
})

it.each(['returned', 'thrown'] as const)(
  'returns a fixed safe HTTP error from bitcoinAccountBalances when Electrum fails (%s error), hiding raw provider text',
  async (failureMode) => {
    const { app } = await setup()
    const server = Fastify({ logger: false })
    await server.register(fastifyTRPCPlugin, {
      prefix: '/trpc',
      trpcOptions: {
        router: appRouter,
        batching: { enabled: false },
        createContext: async (): Promise<TRPCContext> => ({ app }),
      } satisfies FastifyTRPCPluginOptions<AppRouter>['trpcOptions'],
    })
    onTestFinished(async () => {
      await server.close()
    })

    const logError = vi.spyOn(app.logger, 'error')
    vi.spyOn(app.onchainProvider, 'getConfirmedAccountBalances').mockImplementation(
      asyncFn(async () => {
        if (failureMode === 'thrown') {
          throw new RangeError('synthetic-sensitive-error')
        }
        return Err(new Error('synthetic-sensitive-error'))
      }),
    )

    const account = new NetworkAccount(Network.Mainnet, Wallets.singlesigNativeSegwitAccount).toString()
    const encodedInput = encodeURIComponent(JSON.stringify(trpcTransformer.serialize({ accounts: [account] })))
    const response = await server.inject({
      method: 'GET',
      url: `/trpc/portalProve.onchain.bitcoinAccountBalances?input=${encodedInput}`,
    })

    expect(response.statusCode).toBe(500)
    const parsed = parseUnknown(trpcErrorResponseSchema, JSON.parse(response.body)).expect(
      'tRPC error response must match schema',
    )
    expect(parsed.error.json.data).toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
      httpStatus: 500,
    })
    expect(parsed.error.json.message).toBe(
      "Couldn't check balances with Electrum. Your wallet wasn't scanned. Check your Electrum connection and try again.",
    )
    expect(response.body).not.toContain('synthetic-sensitive-error')
    if (failureMode === 'thrown') {
      expect(logError).toHaveBeenCalled()
    }
  },
)

it('reports a newer desktop release once the check finds one, and nothing from source', async () => {
  const fetch = vi.fn(async () => Response.json({ tag: 'v0.2.0_0' }))
  vi.stubGlobal('fetch', fetch)
  onTestFinished(() => {
    vi.unstubAllGlobals()
  })
  const fromSource = (await setup()).app
  await fromSource.releaseCheckService.checkIfDue()
  await expect(appRouter.createCaller({ app: fromSource }).portalProve.settings.releaseCheck()).resolves.toEqual({
    newVersion: null,
    pending: false,
  })
  expect(fetch).not.toHaveBeenCalled()

  const desktop = (await setup({ releaseVersion: '0.1.0:0' })).app
  const api = appRouter.createCaller({ app: desktop }).portalProve.settings
  await expect(api.releaseCheck()).resolves.toEqual({ newVersion: null, pending: true })
  await desktop.releaseCheckService.checkIfDue()
  await expect(api.releaseCheck()).resolves.toEqual({ newVersion: '0.2.0', pending: false })
})

it('loads portfolio data in a timezone Intl.supportedValuesOf omits', async () => {
  const { app } = await setup()
  vi.spyOn(app.priceService, 'getCurrentBtcPrice').mockImplementation(asyncFn(async () => Err(new Error('offline'))))
  const getData = vi.spyOn(app.controlCenterService, 'getData')
  const { portfolio } = appRouter.createCaller({ app }).portalProve

  await portfolio.getData({ timeRange: '30d', timezone: 'Asia/Kolkata' })

  expect(getData).toHaveBeenCalledWith(expect.objectContaining({ timezone: 'Asia/Kolkata' }))
})

it('rejects an unknown portfolio timezone', async () => {
  const { app } = await setup()
  const { portfolio } = appRouter.createCaller({ app }).portalProve

  await expect(portfolio.getData({ timeRange: '30d', timezone: 'Not/AZone' })).rejects.toMatchObject({
    code: 'BAD_REQUEST',
    message: 'Invalid timezone',
  })
})

it('connects a Bitkey as one unverified 2-of-3 account that statements leave out', async () => {
  const { caller } = await setup()

  const { claim, alreadyConnected } = await caller.accounts.create.bitkey({
    descriptorExport: Wallets.bitkeyExport,
    displayName: 'Bitkey',
  })

  expect(alreadyConnected).toBe(false)
  expect(claim).toMatchObject({ status: 'unverified', isVerified: false, metadata: { walletInfo: { type: 'Bitkey' } } })
  expect(
    Object.fromEntries(claim.keystores.map((keystore) => [keystore.model, [keystore.label, keystore.wallet]])),
  ).toEqual({
    app: ['Phone key', 'bitkey'],
    hardware: ['Hardware key', 'bitkey'],
    server: ['Block key', 'bitkey'],
  })
  expect((await caller.accounts.list()).map((listed) => listed.id)).toEqual([claim.id])
  await expect(caller.accounts.list({ excludePending: true })).resolves.toEqual([])
  await expect(caller.challenges.create({ claimId: claim.id })).rejects.toThrow('can’t be verified')

  await expect(
    caller.accounts.create.bitkey({ descriptorExport: Wallets.bitkeyExport, displayName: 'Another name' }),
  ).resolves.toMatchObject({ alreadyConnected: true, claim: { id: claim.id, displayName: 'Bitkey' } })
})

it('explains why it cannot read a Bitkey export', async () => {
  const { caller } = await setup()

  await expect(caller.accounts.create.bitkey({ descriptorExport: 'hello', displayName: 'Bitkey' })).rejects.toThrow(
    'Bitkey wallet descriptor',
  )
})

it('stores only ETF holdings with shares above zero and a purchase date that has passed', async () => {
  const { app } = await setup()
  const etf = appRouter.createCaller({ app }).portalProve.etf
  const tomorrow = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()

  for (const shares of ['0', '-5', 'abc', '1e5', '']) {
    await expect(etf.create({ displayName: 'Brokerage', holdings: [{ ticker: 'IBIT', shares }] })).rejects.toThrow(
      'Shares must be a number above zero',
    )
  }
  await expect(
    etf.create({ displayName: 'Brokerage', holdings: [{ ticker: 'IBIT', shares: '10', datePurchased: tomorrow }] }),
  ).rejects.toThrow('Purchase date cannot be in the future')
  await expect(etf.list()).resolves.toEqual([])

  const account = await etf.create({
    displayName: 'Brokerage',
    holdings: [{ ticker: 'IBIT', shares: '12.5', datePurchased: '2026-01-05T17:00:00.000Z' }],
  })
  await expect(etf.holdings.add({ accountId: account.id, ticker: 'BITB', shares: '-5' })).rejects.toThrow(
    'Shares must be a number above zero',
  )
  await expect(
    etf.holdings.add({ accountId: account.id, ticker: 'BITB', shares: '5', datePurchased: tomorrow }),
  ).rejects.toThrow('Purchase date cannot be in the future')
  await etf.holdings.add({ accountId: account.id, ticker: 'BITB', shares: '0.5' })

  expect((await etf.holdings.list({ accountId: account.id })).map(({ ticker, shares }) => [ticker, shares])).toEqual([
    ['IBIT', '12.5'],
    ['BITB', '0.5'],
  ])
})
