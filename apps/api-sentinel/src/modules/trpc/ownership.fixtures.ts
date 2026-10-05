import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MultiSigAccount, SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import type { MultiSigAccountScriptType, SingleSigAccountScriptType } from '@hoseki/packages/bitcoin/account_props'
import { ecc } from '@hoseki/packages/bitcoin/lib/ecc'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { Xpub } from '@hoseki/packages/bitcoin/xpub'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Ok } from '@hoseki/packages/result'
import { hosid } from '@hoseki/packages/schemas'
import type Database from 'better-sqlite3'
import { BIP32Factory } from 'bip32'
import { Signer, Verifier } from 'bip322-js'
import pino from 'pino'
import { expect, onTestFinished } from 'vitest'
import type { AppContext } from '../../context'
import { initDatabase } from '../../db'
import type { Env } from '../../env'
import { ControlCenterService } from '../control_center/service'
import { EtfService } from '../etf/service'
import { ExchangeService } from '../exchange/service'
import { ManualService } from '../manual/service'
import { DailyRatesService } from '../price/daily_rates'
import { PriceService } from '../price/service'
import { StatementService } from '../statements/service'
import { appRouter } from './router'

// Public, deterministic test seeds only. Signatures and verification are real BIP-322.
function createSigningKey(seedByte: number, network: Network.Mainnet | Network.Testnet = Network.Mainnet) {
  const node = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, seedByte), network).derivePath("m/84'/0'/0'")
  const xpub = Xpub.fromString(node.neutered().toBase58()).expect('Synthetic key must be a valid xpub')

  return { xpub, account: new SingleSigAccount('p2wpkh', xpub), wif: node.derive(0).derive(0).toWIF() }
}

type SigningKey = ReturnType<typeof createSigningKey>
export type OwnershipRegistry = ReturnType<typeof appRouter.createCaller>['portalProve']['registry']
type Challenge = Awaited<ReturnType<OwnershipRegistry['challenges']['complete']>>
type SinglesigClaim = Awaited<ReturnType<OwnershipRegistry['claims']['create']['singlesig']>>

export const owner = createSigningKey(1)
export const secondOwner = createSigningKey(2)
export const thirdOwner = createSigningKey(3)
export const outsider = createSigningKey(4)
export const secondOutsider = createSigningKey(5)
export const thirdOutsider = createSigningKey(6)
export const testnetOwner = createSigningKey(1, Network.Testnet)
export const testnetSecondOwner = createSigningKey(2, Network.Testnet)
export const testnetThirdOwner = createSigningKey(3, Network.Testnet)

// Different BIP32 metadata, but the same public key and chain code derive the same signing key.
const ownerNode = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1)).derivePath("m/84'/0'/0'")
const aliasNode = BIP32Factory(ecc).fromPublicKey(ownerNode.publicKey, ownerNode.chainCode)
export const ownerAlias: SigningKey = {
  ...owner,
  xpub: Xpub.fromString(aliasNode.toBase58()).expect('Alias must be a valid xpub'),
}

const multisig = MultiSigAccount.from({
  scriptType: 'p2wsh',
  threshold: 2,
  isSorted: true,
  xpubs: [owner.xpub, secondOwner.xpub, thirdOwner.xpub],
}).expect('Synthetic 2-of-3 descriptor must be valid')
const keystore = { label: 'Test key', wallet: null, model: null, derivationPath: null }

function createOwnershipDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-ownership-'))
  const logger = pino({ level: 'silent' })
  const database = initDatabase(directory, logger)

  onTestFinished(() => {
    database.close()
    rmSync(directory, { recursive: true, force: true })
  })

  return { directory, logger, database }
}

function createTestEnvironment(directory: string): Env {
  return {
    HOST: 'localhost',
    PORT: 3400,
    ELECTRUM_HOST: 'example.invalid',
    ELECTRUM_PORT: 50001,
    ELECTRUM_PROTOCOL: 'tcp',
    BITCOIN_NETWORK: 'mainnet',
    DATA_DIR: directory,
    APP_DIR: directory,
    MEMPOOL_API_URL: 'https://example.invalid',
    LOG_LEVEL: 'error',
  }
}

export function setupOwnershipRegistry(): OwnershipRegistry {
  return setupOwnershipHarness().registry
}

interface OwnershipHarness {
  registry: OwnershipRegistry
  db: Database.Database
}

export function setupOwnershipHarness(): OwnershipHarness {
  const { caller, db } = setupAppCaller()
  return { registry: caller.portalProve.registry, db }
}

interface AppCallerHarness {
  caller: ReturnType<typeof appRouter.createCaller>
  db: Database.Database
}

/** Build the tRPC router against a fresh database with external services stubbed. */
export function setupAppCaller(): AppCallerHarness {
  const { directory, logger, database } = createOwnershipDatabase()
  const env = createTestEnvironment(directory)

  const electrumConfig = { host: 'example.invalid', port: 50001, protocol: 'tcp' as const }
  const electrumClient = new ElectrumClient(electrumConfig)
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum: electrumClient })

  const deps = { db: database.db, logger }
  const exchangeService = new ExchangeService(deps)
  const manualService = new ManualService(deps)
  const etfService = new EtfService(deps)
  const mempoolApiUrl = env.MEMPOOL_API_URL
  const priceService = new PriceService({
    logger,
    mempoolApiUrl,
    settings: () => ({ source: undefined, fallbacks: false }),
  })

  const app: AppContext = {
    env,
    logger,
    database,
    electrumClient,
    electrumConfig,
    onchainProvider,
    exchangeService,
    manualService,
    etfService,
    priceService,
    network: Network.Mainnet,
    controlCenterService: new ControlCenterService({
      ...deps,
      onchainProvider,
      exchangeService,
      manualService,
      etfService,
      priceService,
    }),
    statementService: new StatementService({
      ...deps,
      onchainProvider,
      exchangeService,
      mempoolApiUrl,
      dailyRatesService: new DailyRatesService({ logger, mempoolApiUrl }),
    }),
    reconnectElectrum: async () => Ok(undefined),
    stopElectrum: () => {
      electrumClient.disconnect()
    },
    prepareElectrumConfig: (config) => Ok(config),
    getTorStatus: () => ({ state: 'unavailable' }),
    startTor: () => ({ state: 'unavailable' }),
    connectionProfiles: undefined,
    connectProfile: async () => Ok(undefined),
  }

  return { caller: appRouter.createCaller({ app }), db: database.db }
}

export async function createSinglesigClaim(
  registry: OwnershipRegistry,
  signingKey: SigningKey,
  scriptType: SingleSigAccountScriptType = 'p2wpkh',
): Promise<SinglesigClaim> {
  return registry.claims.create.singlesig({
    network: signingKey.xpub.network.toString(),
    account: new SingleSigAccount(scriptType, signingKey.xpub).descriptor(),
    displayName: 'Test wallet',
    keystore,
  })
}

export async function signChallengeMessage(
  registry: OwnershipRegistry,
  challengeId: string,
  keystoreId: string,
  signingKey: SigningKey,
): Promise<void> {
  const { signedMessage } = await registry.challengeMessages.create({ challengeId, keystoreId })

  const signature = Signer.sign(signingKey.wif, signedMessage.address, signedMessage.messageTextToSign)
  expect(Verifier.verifySignature(signedMessage.address, signedMessage.messageTextToSign, signature)).toBe(true)

  await registry.challengeMessages.complete({ signedMessageId: signedMessage.id, signature })
}

interface SinglesigProof {
  registry: OwnershipRegistry
  claimId: string
  verifyOwnership: () => Promise<Challenge>
}

export async function setupSinglesigProof(accountOwner: SigningKey, signer: SigningKey): Promise<SinglesigProof> {
  const registry = setupOwnershipRegistry()
  const target = await createSinglesigClaim(registry, accountOwner)
  const signingClaim = signer === accountOwner ? target : await createSinglesigClaim(registry, signer)
  const store = signingClaim.keystores[0]
  if (store === undefined) {
    expect.fail('Claim must contain its keystore')
  }

  const challenge = await registry.challenges.create({ claimId: target.claim.id })

  return {
    registry,
    claimId: target.claim.id,
    verifyOwnership: async () => {
      await signChallengeMessage(registry, challenge.id, store.id, signer)

      return registry.challenges.complete({ challengeId: challenge.id })
    },
  }
}

export async function verifyTwoOfThreeAccount(registry: OwnershipRegistry, keys: SigningKey[]): Promise<Challenge> {
  // Creation is part of the attempted proof: invalid keys may be rejected at this boundary.
  const created = await createMultisigClaim(registry, keys)

  const challenge = await registry.challenges.create({ claimId: created.claim.id })

  for (const [index, store] of created.keystores.slice(0, 2).entries()) {
    const signingKey = keys[index]
    if (signingKey === undefined) {
      expect.fail('Each keystore must have a signing key')
    }

    await signChallengeMessage(registry, challenge.id, store.id, signingKey)
  }

  return registry.challenges.complete({ challengeId: challenge.id })
}

export async function createMultisigClaim(
  registry: OwnershipRegistry,
  keys: SigningKey[],
  descriptorKeys: SigningKey[] = [owner, secondOwner, thirdOwner],
  scriptType: MultiSigAccountScriptType = 'p2wsh',
): Promise<Awaited<ReturnType<OwnershipRegistry['claims']['create']['multisig']>>> {
  const account = MultiSigAccount.from({
    scriptType,
    threshold: 2,
    isSorted: true,
    xpubs: descriptorKeys.map((key) => key.xpub),
  }).expect('Fixture descriptor must be valid')
  return registry.claims.create.multisig({
    network: account.network().toString(),
    account: account.descriptor(),
    displayName: '2-of-3 wallet',
    keystores: keys.map((key) => ({ ...keystore, publicKey: key.xpub.toString() })),
  })
}

type StoredProof =
  | 'cross-account'
  | 'cross-account matching key'
  | 'unrelated key'
  | 'duplicate key'
  | 'aliased key'
  | 'wrong address'
  | 'invalid signature'

interface StoredOwnershipProof extends OwnershipHarness {
  claimId: string
  challengeId: string
  messages: Array<{ id: string; keystoreId: string; signature: string }>
}

export function setupStoredProof(scenario: StoredProof): StoredOwnershipProof {
  const { registry, db } = setupOwnershipHarness()
  const claimId = hosid('re_clmx')
  const challengeId = hosid('re_chal')
  const aliasedAccount = MultiSigAccount.from({
    scriptType: 'p2wsh',
    threshold: 2,
    isSorted: true,
    xpubs: [owner.xpub, ownerAlias.xpub, thirdOwner.xpub],
  }).expect('Aliased descriptor must parse')
  const descriptor =
    scenario === 'duplicate key'
      ? multisig.descriptor()
      : scenario === 'aliased key'
        ? aliasedAccount.descriptor()
        : owner.account.descriptor()
  db.prepare('INSERT INTO accounts (id, descriptor, display_name, status) VALUES (?, ?, ?, ?)').run(
    claimId,
    descriptor,
    'Stored wallet',
    'pending',
  )
  db.prepare('INSERT INTO challenges (id, account_id) VALUES (?, ?)').run(challengeId, claimId)

  let keystoreAccountId = claimId
  if (scenario === 'cross-account' || scenario === 'cross-account matching key') {
    keystoreAccountId = hosid('re_clmx')
    db.prepare('INSERT INTO accounts (id, descriptor, display_name) VALUES (?, ?, ?)').run(
      keystoreAccountId,
      scenario === 'cross-account matching key'
        ? new SingleSigAccount('p2pkh', owner.xpub).descriptor()
        : outsider.account.descriptor(),
      'Other wallet',
    )
  }
  const key = scenario === 'cross-account' || scenario === 'unrelated key' ? outsider : owner
  const signer = scenario === 'wrong address' ? outsider : key
  const messages = []
  for (let index = 0; index < (scenario === 'duplicate key' || scenario === 'aliased key' ? 2 : 1); index++) {
    const id = hosid('re_mesg')
    const keystoreId = hosid('re_ks')
    const messageText = 'Synthetic ownership proof'
    const signingAccount =
      scenario === 'duplicate key' || scenario === 'aliased key'
        ? new SingleSigAccount('p2pkh', signer.xpub)
        : signer.account
    const address = signingAccount.receiveAddress(0).toString()
    const signature = Signer.sign(signer.wif, address, messageText + ` ID=${id.split('_').at(-1)}`)
    const storedSignature = scenario === 'invalid signature' ? 'invalid' : signature
    db.prepare('INSERT INTO keystores (id, account_id, label, xpub) VALUES (?, ?, ?, ?)').run(
      keystoreId,
      keystoreAccountId,
      'Stored key',
      scenario === 'aliased key' && index === 1 ? ownerAlias.xpub.toString() : key.xpub.toString(),
    )
    db.prepare(`INSERT INTO signed_messages
      (id, challenge_id, keystore_id, address, message_text, signature, signed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id,
      challengeId,
      keystoreId,
      address,
      messageText,
      storedSignature,
      new Date().toISOString(),
    )
    messages.push({ id, keystoreId, signature: storedSignature })
  }
  return { registry, db, claimId, challengeId, messages }
}
