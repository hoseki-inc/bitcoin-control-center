import * as net from 'node:net'
import {
  Account,
  type CheckedAccountDescriptor,
  type CheckedMultisigAccountDescriptor,
  type CheckedSinglesigAccountDescriptor,
  MultiSigAccount,
  SingleSigAccount,
} from '@hoseki/packages/bitcoin/account'
import { Address, type CheckedAddressString } from '@hoseki/packages/bitcoin/address'
import { DerivationPathString } from '@hoseki/packages/bitcoin/derivation-path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { NetworkAccount } from '@hoseki/packages/bitcoin/network_account'
import { Xpub } from '@hoseki/packages/bitcoin/xpub'
import { IndexMap, IndexSet } from '@hoseki/packages/collection'
import { parseUnknown } from '@hoseki/packages/result'
import {
  type ChallengeId,
  ChallengeIdSchema,
  type ClaimId,
  type ClaimStatus,
  type KeystoreId,
  KeystoreIdSchema,
  type SignedMessageId,
  SignedMessageIdSchema,
  TimezoneSchema,
  hosid,
} from '@hoseki/packages/schemas'
import type { SupportedHardwareWallet, SupportedHardwareWalletDisplayName } from '@hoseki/packages/wallet'
import { TRPCError } from '@trpc/server'
import * as bip322 from 'bip322-js'
import { Decimal } from 'decimal.js'
import { and, desc, eq, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import {
  accounts as accountTable,
  balanceSnapshots,
  challenges,
  keystores as keystoreTable,
  settings,
  signedMessages as signedMessagesTable,
} from '../../db/schema'
import { type ConnectionDetails, MAX_CONNECTION_PROFILES } from '../connection_profiles/store'
import { PRICE_FALLBACKS_SETTING, PRICE_SOURCES, PRICE_SOURCE_SETTING } from '../price/service'
import { StatementMapper } from '../statements/mapper'
import { validateStatementInput } from '../statements/service'
import { publicProcedure, t } from './init'

// ─── Helpers ────────────────────────────────────────────────────────────────

type AccountRow = typeof accountTable.$inferSelect
type KeystoreRow = typeof keystoreTable.$inferSelect
type ChallengeRow = typeof challenges.$inferSelect
type SignedMessageRow = typeof signedMessagesTable.$inferSelect

interface KeystoreDto {
  id: KeystoreId
  createdAt: Date
  updatedAt: Date
  wallet: SupportedHardwareWallet | null
  derivationPath: DerivationPathString | null
  xpub: Xpub
  model: string | null
  label: string
  isIdentified: boolean
}

interface ClaimDto {
  id: ClaimId
  createdAt: Date
  updatedAt: Date
  isVerified: boolean
  officialName: string
  displayName: string
  network: 'bitcoin_mainnet' | 'bitcoin_testnet'
  account: CheckedAccountDescriptor
  status: ClaimStatus
  isArchived: boolean
  keystores: KeystoreDto[]
  latestChallenge: {
    id: ChallengeId
    completed: boolean
    messages: Array<{ signedMessageId: SignedMessageId; keystoreId: KeystoreId; signed: boolean }>
  } | null
  metadata: { walletInfo: { type: SupportedHardwareWalletDisplayName | null; model: string | null } } | null
}

interface ExchangeAccountResponseDto {
  id: string
  exchange: 'coinbase' | 'strike' | 'robinhood' | 'kraken'
  displayName: string
  currency: 'BTC'
  balance: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: 'connected' | 'needs_reconnect'
}

interface SignedMessageDto {
  version: 0
  id: SignedMessageId
  createdAt: Date
  updatedAt: Date
  address: CheckedAddressString
  messageTextToSign: string
  signedAt: Date | null
  signature: string | null
}

interface ChallengeMessageDto {
  signedMessage: SignedMessageDto
  challengeId: ChallengeId
  keystoreId: KeystoreId
}

const supportedHardwareWalletSchema = z.enum(['trezor', 'coldcard', 'ledger', 'keystone'])
const etfTickerSchema = z.enum(['IBIT', 'FBTC', 'GBTC', 'ARKB', 'BITB', 'HODL', 'BTC', 'MSBT'])
const checkedSinglesigAccountDescriptorSchema = z.custom<CheckedSinglesigAccountDescriptor>(
  (value): value is CheckedSinglesigAccountDescriptor =>
    typeof value === 'string' && SingleSigAccount.fromDescriptor(value).isOk(),
  'Invalid singlesig account descriptor',
)
const checkedMultisigAccountDescriptorSchema = z.custom<CheckedMultisigAccountDescriptor>(
  (value): value is CheckedMultisigAccountDescriptor =>
    typeof value === 'string' && MultiSigAccount.fromDescriptor(value).isOk(),
  'Invalid multisig account descriptor',
)
const hardwareWalletDisplayNames = {
  trezor: 'Trezor',
  coldcard: 'Coldcard',
  ledger: 'Ledger',
  keystone: 'Keystone',
} as const satisfies Record<SupportedHardwareWallet, SupportedHardwareWalletDisplayName>

function networkToClaimNetwork(network: string): 'bitcoin_mainnet' | 'bitcoin_testnet' {
  return network === 'testnet' ? 'bitcoin_testnet' : 'bitcoin_mainnet'
}

function claimNetworkToNetwork(claimNetwork: string): string {
  return claimNetwork === 'bitcoin_testnet' ? 'testnet' : 'mainnet'
}

function keystoreRowToDto(row: KeystoreRow): KeystoreDto {
  const now = new Date(row.createdAt)
  const xpub = Xpub.fromString(row.xpub)
  if (xpub.isErr()) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stored keystore xpub is invalid' })
  }
  return {
    id: parseUnknown(KeystoreIdSchema, row.id).expect('Stored keystore ID is invalid'),
    createdAt: now,
    updatedAt: now,
    wallet: parseUnknown(supportedHardwareWalletSchema.nullable(), row.wallet).expect('Stored wallet is invalid'),
    derivationPath: parseUnknown(DerivationPathString.nullable(), row.derivationPath).expect(
      'Stored derivation path is invalid',
    ),
    xpub: xpub.unwrap(),
    model: row.model,
    label: row.label,
    isIdentified: row.wallet !== null,
  }
}

function exchangeAccountToDto(account: {
  id: string
  exchange: 'coinbase' | 'strike' | 'robinhood' | 'kraken'
  displayName: string
  balanceSats: string | null
  balanceAsOf: string | null
  createdAt: string
  connectionStatus: 'connected' | 'needs_reconnect'
}): ExchangeAccountResponseDto {
  return {
    id: account.id,
    exchange: account.exchange,
    displayName: account.displayName,
    currency: 'BTC' as const,
    balance: account.balanceSats,
    balanceAsOf: account.balanceAsOf,
    createdAt: account.createdAt,
    connectionStatus: account.connectionStatus,
  }
}

function buildClaimDto(
  row: AccountRow,
  keystores: KeystoreRow[],
  latestChallenge: ChallengeRow | null,
  signedMessages: SignedMessageRow[],
): ClaimDto {
  const now = new Date(row.createdAt)
  const keystoreDtos = keystores.map(keystoreRowToDto)
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: Control Center accepts nanoids as well as prefixed claim IDs; preserve the existing DTO contract without rewriting IDs.
    id: row.id as ClaimId,
    createdAt: now,
    updatedAt: now,
    isVerified: row.status === 'verified',
    officialName: '',
    displayName: row.displayName,
    network: networkToClaimNetwork(row.network),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SAFETY: The basic account API stores descriptor text verbatim; this existing DTO brand must not normalize or newly reject that text.
    account: row.descriptor as CheckedAccountDescriptor,
    status: row.status,
    isArchived: row.deletedAt !== null,
    keystores: keystoreDtos,
    latestChallenge: latestChallenge
      ? {
          id: parseUnknown(ChallengeIdSchema, latestChallenge.id).expect('Stored challenge ID is invalid'),
          completed: latestChallenge.isSatisfied === 1,
          messages: signedMessages.map((sm) => ({
            signedMessageId: parseUnknown(SignedMessageIdSchema, sm.id).expect('Stored signed-message ID is invalid'),
            keystoreId: parseUnknown(KeystoreIdSchema, sm.keystoreId).expect('Stored keystore ID is invalid'),
            signed: sm.signature !== null,
          })),
        }
      : null,
    metadata: keystoreDtos[0]
      ? {
          walletInfo: {
            type: keystoreDtos[0].wallet ? hardwareWalletDisplayNames[keystoreDtos[0].wallet] : null,
            model: keystoreDtos[0].model,
          },
        }
      : null,
  }
}

async function getFullClaimDto(db: SentinelDb | SentinelTx, accountId: string): Promise<ClaimDto | null> {
  const [row] = await db.select().from(accountTable).where(eq(accountTable.id, accountId))
  if (!row) {
    return null
  }

  const keystoreRows = await db.select().from(keystoreTable).where(eq(keystoreTable.accountId, row.id))
  const [latestChallenge] = await db
    .select()
    .from(challenges)
    .where(eq(challenges.accountId, row.id))
    .orderBy(desc(challenges.createdAt))
    .limit(1)
  if (latestChallenge) {
    await discardUnverifiableMessages(db, latestChallenge)
  }
  const signedMessages = latestChallenge
    ? await db.select().from(signedMessagesTable).where(eq(signedMessagesTable.challengeId, latestChallenge.id))
    : []

  return buildClaimDto(row, keystoreRows, latestChallenge ?? null, signedMessages)
}

function signedMessageRowToDto(row: SignedMessageRow): SignedMessageDto {
  return {
    version: 0,
    id: parseUnknown(SignedMessageIdSchema, row.id).expect('Stored signed-message ID is invalid'),
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.signedAt ?? row.createdAt),
    address: Address.fromString(row.address).expect('Stored signing address is invalid').toString(),
    messageTextToSign: getMessageTextToSign(row.id, row.messageText),
    signedAt: row.signedAt != null && row.signedAt !== '' ? new Date(row.signedAt) : null,
    signature: row.signature,
  }
}

function challengeMessageRowToDto(row: SignedMessageRow): ChallengeMessageDto {
  return {
    signedMessage: signedMessageRowToDto(row),
    challengeId: parseUnknown(ChallengeIdSchema, row.challengeId).expect('Stored challenge ID is invalid'),
    keystoreId: parseUnknown(KeystoreIdSchema, row.keystoreId).expect('Stored keystore ID is invalid'),
  }
}

/** Generate the stable message format used by existing Control Center deployments. */
function getMessageTextToSign(id: string, text: string): string {
  const suffix = id.split('_').at(-1)
  if (suffix == null || suffix === '') {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Invalid signed-message ID' })
  }
  return text + ` ID=${suffix}`
}

function verifySignedMessageSignature(message: SignedMessageRow, signature: string): void {
  const address = Address.fromString(message.address)
  if (address.isErr()) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stored signing address is invalid' })
  }

  const messageTextToSign = getMessageTextToSign(message.id, message.messageText)
  let isVerified = false
  try {
    // Match api-armadillo: non-strict mode is required for Ledger-compatible message signatures.
    isVerified = bip322.Verifier.verifySignature(address.unwrap().toString(), messageTextToSign, signature, false)
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' })
  }

  if (!isVerified) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid signature' })
  }
}

function getRequiredSignatureCount(account: Account): number {
  if (account instanceof MultiSigAccount) {
    return account.threshold
  }
  if (account instanceof SingleSigAccount) {
    return 1
  }
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unsupported account type' })
}

function validateMultisigKeystores(account: MultiSigAccount, publicKeys: string[]): void {
  const descriptorKeys = new Set(account.xpubs.map((xpub) => xpub.toString()))
  const suppliedKeys = new Set<string>()
  const signingKeys = new Set<string>()
  for (const publicKey of publicKeys) {
    const parsed = Xpub.fromString(publicKey)
    if (parsed.isErr() || !descriptorKeys.has(parsed.unwrap().toString())) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keystore key is not in the account descriptor' })
    }
    const xpub = parsed.unwrap()
    suppliedKeys.add(xpub.toString())
    signingKeys.add(xpub.derive(0).derive(0).publicKey().toString('hex'))
  }
  if (
    publicKeys.length !== descriptorKeys.size ||
    suppliedKeys.size !== publicKeys.length ||
    signingKeys.size !== publicKeys.length
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keystores must match each descriptor key exactly once' })
  }
}

/** Bind a proof to the account descriptor, not just a database keystore ID. */
interface SigningIdentity {
  keystoreId: KeystoreId
  address: CheckedAddressString
  publicKey: string
}

async function getSigningIdentity(
  db: SentinelDb | SentinelTx,
  accountId: string,
  keystoreId: string,
): Promise<SigningIdentity> {
  const [row] = await db
    .select({ descriptor: accountTable.descriptor, network: accountTable.network })
    .from(accountTable)
    .where(eq(accountTable.id, accountId))
  const [keystore] = await db.select().from(keystoreTable).where(eq(keystoreTable.id, keystoreId))
  if (!row || !keystore) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Account or keystore not found' })
  }
  if (keystore.accountId !== accountId) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keystore does not belong to this account' })
  }
  const parsedAccount = Account.fromDescriptor(row.descriptor)
  const parsedKey = Xpub.fromString(keystore.xpub)
  if (parsedAccount.isErr() || parsedKey.isErr()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid account or keystore key' })
  }
  const account = parsedAccount.unwrap()
  const xpub = parsedKey.unwrap()
  const members = account instanceof MultiSigAccount ? account.xpubs : [account.xpub]
  if (!members.some((member) => member.equals(xpub))) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keystore key is not in the account descriptor' })
  }
  const network = row.network === 'testnet' ? Network.Testnet : Network.Mainnet
  if (xpub.network.kind !== network.kind) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Keystore network does not match the account' })
  }
  const signingKey = xpub.derive(0).derive(0)
  return {
    keystoreId: parseUnknown(KeystoreIdSchema, keystore.id).expect('Stored keystore ID is invalid'),
    // Every multisig cosigner proves its individual key using P2PKH, regardless of the multisig script type.
    address:
      account instanceof SingleSigAccount
        ? account.receiveAddress(0, network).toString()
        : signingKey.address('p2pkh', network).toString(),
    publicKey: signingKey.publicKey().toString('hex'),
  }
}

function validateSigningAddress(message: SignedMessageRow, identity: SigningIdentity): void {
  if (message.address !== identity.address) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Signing address does not match the account key' })
  }
}

async function hasCurrentSigningAddress(
  db: SentinelDb | SentinelTx,
  accountId: string,
  message: SignedMessageRow,
): Promise<boolean> {
  try {
    return (await getSigningIdentity(db, accountId, message.keystoreId)).address === message.address
  } catch (error) {
    if (error instanceof TRPCError) {
      return false
    }
    throw error
  }
}

/**
 * Remove an unfinished challenge's messages that can never verify, such as cosigner messages created with the
 * P2WPKH address used before cosigners signed with P2PKH. Their keys can then sign again instead of the
 * challenge failing at completion with no way forward.
 */
async function discardUnverifiableMessages(db: SentinelDb | SentinelTx, challenge: ChallengeRow): Promise<void> {
  if (challenge.isSatisfied === 1) {
    return
  }
  const messages = await db.select().from(signedMessagesTable).where(eq(signedMessagesTable.challengeId, challenge.id))
  const unverifiable: string[] = []
  for (const message of messages) {
    if (!(await hasCurrentSigningAddress(db, challenge.accountId, message))) {
      unverifiable.push(message.id)
    }
  }
  if (unverifiable.length === 0) {
    return
  }
  await db.delete(signedMessagesTable).where(inArray(signedMessagesTable.id, unverifiable))
}

// ─── portalProve.controlCenter ──────────────────────────────────────────────

const controlCenterRouter = t.router({
  getData: publicProcedure
    .input(
      z
        .object({
          timeRange: z.enum(['7d', '30d', '90d', '1y', 'all']).default('30d'),
          claimIds: z.array(z.string()).optional(),
          exchangeAccountIds: z.array(z.string()).optional(),
          manualAccountIds: z.array(z.string()).optional(),
          etfAccountIds: z.array(z.string()).optional(),
          timezone: z.string().default('UTC'),
          customDateRange: z
            .object({
              startDate: z.string(),
              endDate: z.string(),
            })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const timezone = parseUnknown(TimezoneSchema, input?.timezone ?? 'UTC')
      if (timezone.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid timezone' })
      }

      const result = await ctx.app.controlCenterService.getData({
        timeRange: input?.timeRange,
        accountIds: input?.claimIds,
        exchangeAccountIds: input?.exchangeAccountIds,
        manualAccountIds: input?.manualAccountIds,
        etfAccountIds: input?.etfAccountIds,
        timezone: timezone.unwrap(),
        customDateRange: input?.customDateRange,
      })
      if (result.isErr()) {
        throw new TRPCError({
          code: input?.customDateRange ? 'BAD_REQUEST' : 'INTERNAL_SERVER_ERROR',
          message: result.unwrapErr().message,
        })
      }
      return result.unwrap()
    }),

  recordSnapshot: publicProcedure.mutation(async ({ ctx }) => {
    const rows = await ctx.app.database
      .select({ id: accountTable.id, descriptor: accountTable.descriptor })
      .from(accountTable)
      .where(isNull(accountTable.deletedAt))

    const accountSet = new IndexSet<Account>()
    const idMap = new Map<string, string>() // descriptor → account id

    for (const row of rows) {
      const parsed = Account.fromDescriptor(row.descriptor)
      if (parsed.isOk()) {
        accountSet.add(parsed.unwrap())
        idMap.set(row.descriptor, row.id)
      }
    }

    if (accountSet.size === 0) {
      return
    }

    const balancesResult = await ctx.app.onchainProvider.getConfirmedAccountBalances(accountSet)
    if (balancesResult.isErr()) {
      return
    }

    const now = new Date().toISOString()
    for (const [account, balance] of balancesResult.unwrap()) {
      const accountId = idMap.get(account.toString())
      if (accountId != null && accountId !== '') {
        await ctx.app.controlCenterService.recordAccountSnapshot(accountId, balance.toString(), now)
      }
    }
  }),
})

// ─── portalProve.registry ───────────────────────────────────────────────────

const registryRouter = t.router({
  claims: t.router({
    list: publicProcedure
      .input(z.object({ excludePending: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const excludePending = input?.excludePending ?? false
        const rows = await ctx.app.database
          .select({ id: accountTable.id })
          .from(accountTable)
          .where(and(isNull(accountTable.deletedAt), excludePending ? ne(accountTable.status, 'pending') : undefined))
          .orderBy(desc(accountTable.createdAt))
        const claims = await Promise.all(rows.map(async (row) => getFullClaimDto(ctx.app.database, row.id)))
        return claims.filter((claim): claim is ClaimDto => claim !== null)
      }),

    deletePending: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const db = ctx.app.database
      const [row] = await db
        .select({ status: accountTable.status, deletedAt: accountTable.deletedAt })
        .from(accountTable)
        .where(eq(accountTable.id, input.id))
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
      }
      if (row.status !== 'pending') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Claim is not pending' })
      }
      if (row.deletedAt !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Archived claims must be permanently deleted' })
      }
      await db.delete(accountTable).where(eq(accountTable.id, input.id))
    }),

    delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const db = ctx.app.database
      const [row] = await db
        .select({ deletedAt: accountTable.deletedAt })
        .from(accountTable)
        .where(eq(accountTable.id, input.id))
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
      }
      if (row.deletedAt === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only archived claims can be permanently deleted' })
      }
      await db.delete(accountTable).where(eq(accountTable.id, input.id))
    }),

    archive: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.controlCenterService.archiveAccount(input.id)
      if (result.isErr()) {
        const error = result.unwrapErr()
        throw new TRPCError({
          code: error.message === 'Claim not found or already archived' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }
    }),

    restore: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.controlCenterService.restoreAccount(input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

    listArchived: publicProcedure.query(async ({ ctx }) => {
      const rows = await ctx.app.database
        .select({ id: accountTable.id })
        .from(accountTable)
        .where(isNotNull(accountTable.deletedAt))
        .orderBy(desc(accountTable.createdAt))
      const claims = await Promise.all(rows.map(async (row) => getFullClaimDto(ctx.app.database, row.id)))
      return claims.filter((claim): claim is ClaimDto => claim !== null)
    }),

    getCountLimit: publicProcedure.query(() => {
      return null
    }),

    update: publicProcedure
      .input(z.object({ id: z.string(), displayName: z.string().min(1) }))
      .mutation(async ({ ctx, input }) => {
        const db = ctx.app.database
        const updated = await db
          .update(accountTable)
          .set({ displayName: input.displayName })
          .where(eq(accountTable.id, input.id))
          .returning({ id: accountTable.id, status: accountTable.status })
        const row = updated[0]
        if (!row) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
        }
        return {
          id: row.id,
          displayName: input.displayName,
          status: row.status,
        }
      }),

    updateKeystore: publicProcedure
      .input(
        z.object({
          id: z.string(),
          label: z.string().min(1),
          wallet: supportedHardwareWalletSchema.nullable().optional(),
          model: z.string().nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = ctx.app.database
        const updated = await db
          .update(keystoreTable)
          .set({ label: input.label, wallet: input.wallet, model: input.model })
          .where(eq(keystoreTable.id, input.id))
          .returning()
        const ks = updated[0]
        if (!ks) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
        }
        return keystoreRowToDto(ks)
      }),

    create: t.router({
      singlesig: publicProcedure
        .input(
          z.object({
            network: z.string(),
            account: checkedSinglesigAccountDescriptorSchema,
            displayName: z.string().min(1),
            keystore: z.object({
              label: z.string().min(1),
              wallet: supportedHardwareWalletSchema.nullable(),
              model: z.string().nullable(),
              derivationPath: DerivationPathString.nullable(),
            }),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          return ctx.app.database.transaction(async (db) => {
            const network = claimNetworkToNetwork(input.network)

            // Check if account already exists
            const existing = await db
              .select({ id: accountTable.id })
              .from(accountTable)
              .where(and(eq(accountTable.descriptor, input.account), eq(accountTable.network, network)))
              .limit(1)
            if (existing.length > 0) {
              throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists' })
            }

            // Extract xpub from descriptor
            const parsed = SingleSigAccount.fromDescriptor(input.account)
            if (parsed.isErr()) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid account descriptor' })
            }
            const xpub = parsed.unwrap().xpub.toString()

            const accountId = hosid('re_clmx')
            const keystoreId = hosid('re_ks')
            const now = new Date().toISOString()

            await db.insert(accountTable).values({
              id: accountId,
              network,
              descriptor: input.account,
              displayName: input.displayName,
              status: 'pending',
              createdAt: now,
            })
            await db.insert(keystoreTable).values({
              id: keystoreId,
              accountId,
              label: input.keystore.label,
              wallet: input.keystore.wallet,
              model: input.keystore.model,
              derivationPath: input.keystore.derivationPath,
              xpub,
              createdAt: now,
            })

            const claim = await getFullClaimDto(db, accountId)
            if (!claim) {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Claim not found after creation' })
            }
            return {
              claim,
              keystores: claim.keystores,
            }
          })
        }),

      multisig: publicProcedure
        .input(
          z.object({
            network: z.string(),
            account: checkedMultisigAccountDescriptorSchema,
            displayName: z.string().min(1),
            keystores: z.array(
              z.object({
                label: z.string().min(1),
                wallet: supportedHardwareWalletSchema.nullable(),
                model: z.string().nullable(),
                derivationPath: DerivationPathString.nullable(),
                publicKey: z.string(),
              }),
            ),
          }),
        )
        .mutation(async ({ ctx, input }) => {
          return ctx.app.database.transaction(async (db) => {
            const network = claimNetworkToNetwork(input.network)

            const existing = await db
              .select({ id: accountTable.id })
              .from(accountTable)
              .where(and(eq(accountTable.descriptor, input.account), eq(accountTable.network, network)))
              .limit(1)
            if (existing.length > 0) {
              throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists' })
            }

            const parsed = MultiSigAccount.fromDescriptor(input.account)
            if (parsed.isErr()) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid multisig account descriptor' })
            }

            validateMultisigKeystores(
              parsed.unwrap(),
              input.keystores.map((keystore) => keystore.publicKey),
            )
            const accountId = hosid('re_clmx')
            const now = new Date().toISOString()

            await db.insert(accountTable).values({
              id: accountId,
              network,
              descriptor: input.account,
              displayName: input.displayName,
              status: 'pending',
              createdAt: now,
            })
            for (const ks of input.keystores) {
              const keystoreId = hosid('re_ks')
              await db.insert(keystoreTable).values({
                id: keystoreId,
                accountId,
                label: ks.label,
                wallet: ks.wallet,
                model: ks.model,
                derivationPath: ks.derivationPath,
                xpub: ks.publicKey,
                createdAt: now,
              })
            }

            const claim = await getFullClaimDto(db, accountId)
            if (!claim) {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Claim not found after creation' })
            }
            return {
              claim,
              keystores: claim.keystores,
            }
          })
        }),
    }),

    get: t.router({
      byId: publicProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        const claim = await getFullClaimDto(ctx.app.database, input.id)
        if (!claim) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
        }
        return claim
      }),

      byAccount: publicProcedure
        .input(z.object({ network: z.string(), account: z.string() }))
        .query(async ({ ctx, input }) => {
          const network = claimNetworkToNetwork(input.network)
          const [row] = await ctx.app.database
            .select({ id: accountTable.id })
            .from(accountTable)
            .where(and(eq(accountTable.descriptor, input.account), eq(accountTable.network, network)))
          if (!row) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
          }
          const claim = await getFullClaimDto(ctx.app.database, row.id)
          if (!claim) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
          }
          return claim
        }),
    }),
  }),

  challenges: t.router({
    create: publicProcedure
      .input(z.object({ claimId: z.string(), keystoreId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.app.database.transaction(async (db) => {
          // Check the account exists
          const [accountRow] = await db
            .select({ id: accountTable.id })
            .from(accountTable)
            .where(eq(accountTable.id, input.claimId))
          if (!accountRow) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
          }

          // Return existing incomplete challenge if one exists
          const [existing] = await db
            .select()
            .from(challenges)
            .where(and(eq(challenges.accountId, input.claimId), eq(challenges.isSatisfied, 0)))
            .orderBy(desc(challenges.createdAt))
            .limit(1)
          if (existing) {
            await discardUnverifiableMessages(db, existing)
            return {
              id: existing.id,
              claimId: existing.accountId,
              variant: 'signed_message' as const,
              isSatisfied: false,
              createdAt: new Date(existing.createdAt),
              updatedAt: new Date(existing.createdAt),
              completedAt: null,
            }
          }

          const challengeId = hosid('re_chal')
          const now = new Date().toISOString()
          await db.insert(challenges).values({ id: challengeId, accountId: input.claimId, createdAt: now })

          return {
            id: challengeId,
            claimId: input.claimId,
            variant: 'signed_message' as const,
            isSatisfied: false,
            createdAt: new Date(now),
            updatedAt: new Date(now),
            completedAt: null,
          }
        })
      }),

    complete: publicProcedure.input(z.object({ challengeId: z.string() })).mutation(async ({ ctx, input }) => {
      const db = ctx.app.database
      const [challenge] = await db.select().from(challenges).where(eq(challenges.id, input.challengeId))
      if (!challenge) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Challenge not found' })
      }
      if (challenge.isSatisfied === 1 || challenge.completedAt !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge already completed' })
      }

      const [accountRow] = await db
        .select({ descriptor: accountTable.descriptor })
        .from(accountTable)
        .where(eq(accountTable.id, challenge.accountId))
      if (!accountRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
      }

      const account = Account.fromDescriptor(accountRow.descriptor)
      if (account.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse account descriptor' })
      }

      const signedMessages = await db
        .select()
        .from(signedMessagesTable)
        .where(eq(signedMessagesTable.challengeId, input.challengeId))

      if (signedMessages.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No signed messages found' })
      }

      const unsigned = signedMessages.find((message) => message.signature === null)
      if (unsigned) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not all messages have been signed' })
      }

      const completedMessages = signedMessages.filter(
        (message): message is SignedMessageRow & { signature: string } => message.signature !== null,
      )
      const requiredSignatures = getRequiredSignatureCount(account.unwrap())
      const signingKeys = new Set<string>()
      for (const message of completedMessages) {
        const identity = await getSigningIdentity(db, challenge.accountId, message.keystoreId)
        validateSigningAddress(message, identity)
        verifySignedMessageSignature(message, message.signature)
        signingKeys.add(identity.publicKey)
      }
      if (signingKeys.size < requiredSignatures) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge is not satisfied' })
      }

      const now = new Date().toISOString()
      await db.transaction(async (tx) => {
        const updatedAccount = await tx
          .update(accountTable)
          .set({ status: 'verified' })
          .where(and(eq(accountTable.id, challenge.accountId), isNull(accountTable.deletedAt)))
        if (updatedAccount.rowsAffected === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Archived claims cannot complete verification' })
        }
        const completed = await tx
          .update(challenges)
          .set({ isSatisfied: 1, completedAt: now })
          .where(and(eq(challenges.id, input.challengeId), eq(challenges.isSatisfied, 0)))
        if (completed.rowsAffected === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge already completed' })
        }
      })

      return {
        id: challenge.id,
        claimId: challenge.accountId,
        variant: 'signed_message' as const,
        isSatisfied: true,
        createdAt: new Date(challenge.createdAt),
        updatedAt: new Date(now),
        completedAt: new Date(now),
      }
    }),
  }),

  challengeMessages: t.router({
    create: publicProcedure
      .input(z.object({ challengeId: z.string(), keystoreId: z.string() }))
      .mutation(async ({ ctx, input }): Promise<ChallengeMessageDto> => {
        return ctx.app.database.transaction(async (db) => {
          const [challenge] = await db.select().from(challenges).where(eq(challenges.id, input.challengeId))
          if (!challenge) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Challenge not found' })
          }

          const identity = await getSigningIdentity(db, challenge.accountId, input.keystoreId)
          // Check if a signed message already exists for this keystore+challenge
          const [existingSm] = await db
            .select()
            .from(signedMessagesTable)
            .where(
              and(
                eq(signedMessagesTable.challengeId, input.challengeId),
                eq(signedMessagesTable.keystoreId, input.keystoreId),
              ),
            )
            .limit(1)
          if (existingSm) {
            validateSigningAddress(existingSm, identity)
            return challengeMessageRowToDto(existingSm)
          }

          const address = identity.address

          // Build message text
          const [identifierRow] = await db
            .select({ value: settings.value })
            .from(settings)
            .where(eq(settings.key, 'owner_identifier'))
          const identifier = identifierRow?.value ?? 'the owner'
          const messageText = `I, ${identifier}, affirm sole control of this account. No other third-party claims/access permitted. Ownership revocable solely by me.`

          const signedMessageId = hosid('re_mesg')
          const now = new Date().toISOString()

          await db.insert(signedMessagesTable).values({
            id: signedMessageId,
            challengeId: input.challengeId,
            keystoreId: input.keystoreId,
            address,
            messageText,
            createdAt: now,
          })

          return challengeMessageRowToDto({
            id: signedMessageId,
            createdAt: now,
            address,
            messageText,
            signedAt: null,
            signature: null,
            challengeId: challenge.id,
            keystoreId: identity.keystoreId,
          })
        })
      }),

    get: publicProcedure
      .input(z.object({ signedMessageId: z.string() }))
      .query(async ({ ctx, input }): Promise<ChallengeMessageDto> => {
        const [sm] = await ctx.app.database
          .select()
          .from(signedMessagesTable)
          .where(eq(signedMessagesTable.id, input.signedMessageId))
        if (!sm) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Signed message not found' })
        }
        return challengeMessageRowToDto(sm)
      }),

    list: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ ctx, input }): Promise<ChallengeMessageDto[]> => {
        const messages = await ctx.app.database
          .select()
          .from(signedMessagesTable)
          .where(eq(signedMessagesTable.challengeId, input.challengeId))
        return messages.map(challengeMessageRowToDto)
      }),

    complete: publicProcedure
      .input(z.object({ signedMessageId: z.string(), signature: z.string().trim().min(1).max(4096) }))
      .mutation(async ({ ctx, input }): Promise<ChallengeMessageDto> => {
        const db = ctx.app.database
        const [sm] = await db
          .select()
          .from(signedMessagesTable)
          .where(eq(signedMessagesTable.id, input.signedMessageId))
        if (!sm) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Signed message not found' })
        }
        if (sm.signature !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Signed message already completed' })
        }

        const [challenge] = await db.select().from(challenges).where(eq(challenges.id, sm.challengeId))
        if (!challenge) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Challenge not found' })
        }
        validateSigningAddress(sm, await getSigningIdentity(db, challenge.accountId, sm.keystoreId))
        verifySignedMessageSignature(sm, input.signature)

        const now = new Date().toISOString()
        const completed = await db
          .update(signedMessagesTable)
          .set({ signature: input.signature, signedAt: now })
          .where(and(eq(signedMessagesTable.id, input.signedMessageId), isNull(signedMessagesTable.signature)))
        if (completed.rowsAffected === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Signed message already completed' })
        }

        return challengeMessageRowToDto({ ...sm, signedAt: now, signature: input.signature })
      }),
  }),

  getOrCreateSinglesigChallengeMessage: publicProcedure
    .input(z.object({ network: z.string(), account: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.app.database.transaction(async (db) => {
        const network = claimNetworkToNetwork(input.network)

        // Find the account
        const [accountRow] = await db
          .select({ id: accountTable.id, descriptor: accountTable.descriptor })
          .from(accountTable)
          .where(and(eq(accountTable.descriptor, input.account), eq(accountTable.network, network)))
        if (!accountRow) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
        }

        // Find or create keystore
        const [keystore] = await db
          .select()
          .from(keystoreTable)
          .where(eq(keystoreTable.accountId, accountRow.id))
          .limit(1)
        if (!keystore) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
        }

        const identity = await getSigningIdentity(db, accountRow.id, keystore.id)
        // Check for existing unsigned challenge
        const [existingChallenge] = await db
          .select()
          .from(challenges)
          .where(and(eq(challenges.accountId, accountRow.id), eq(challenges.isSatisfied, 0)))
          .orderBy(desc(challenges.createdAt))
          .limit(1)

        if (existingChallenge) {
          const [existingSm] = await db
            .select()
            .from(signedMessagesTable)
            .where(
              and(
                eq(signedMessagesTable.challengeId, existingChallenge.id),
                eq(signedMessagesTable.keystoreId, keystore.id),
              ),
            )
            .limit(1)

          if (existingSm) {
            validateSigningAddress(existingSm, identity)
            return {
              challenge: {
                id: existingChallenge.id,
                claimId: existingChallenge.accountId,
                variant: 'signed_message' as const,
                isSatisfied: false,
                createdAt: new Date(existingChallenge.createdAt),
                updatedAt: new Date(existingChallenge.createdAt),
                completedAt: null,
              },
              challengeMessage: challengeMessageRowToDto({ ...existingSm, signedAt: null, signature: null }),
            }
          }
        }

        // Derive address from account for signing
        const parsed = SingleSigAccount.fromDescriptor(accountRow.descriptor)
        if (parsed.isErr()) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse account descriptor' })
        }
        const address = identity.address

        // Create challenge and signed message
        const challengeId = existingChallenge?.id ?? hosid('re_chal')
        const signedMessageId = hosid('re_mesg')
        // Keep the established message format, using the configured owner identifier when available.
        const [identifierRow] = await db
          .select({ value: settings.value })
          .from(settings)
          .where(eq(settings.key, 'owner_identifier'))
        const identifier = identifierRow?.value ?? 'the owner'
        const messageText = `I, ${identifier}, affirm sole control of this account. No other third-party claims/access permitted. Ownership revocable solely by me.`
        const now = new Date().toISOString()

        if (!existingChallenge) {
          await db.insert(challenges).values({ id: challengeId, accountId: accountRow.id, createdAt: now })
        }
        await db
          .insert(signedMessagesTable)
          .values({ id: signedMessageId, challengeId, keystoreId: keystore.id, address, messageText, createdAt: now })

        return {
          challenge: {
            id: challengeId,
            claimId: accountRow.id,
            variant: 'signed_message' as const,
            isSatisfied: false,
            createdAt: new Date(existingChallenge?.createdAt ?? now),
            updatedAt: new Date(existingChallenge?.createdAt ?? now),
            completedAt: null,
          },
          challengeMessage: challengeMessageRowToDto({
            id: signedMessageId,
            createdAt: now,
            address,
            messageText,
            signedAt: null,
            signature: null,
            challengeId,
            keystoreId: keystore.id,
          }),
        }
      })
    }),
})

// ─── portalProve.exchange ───────────────────────────────────────────────────

const proveExchangeRouter = t.router({
  list: publicProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.app.exchangeService.listAccounts()
    return accounts.map(exchangeAccountToDto)
  }),

  refreshBalance: publicProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.exchangeService.refreshBalance(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    return result.unwrap()
  }),

  refreshAllBalances: publicProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.app.exchangeService.refreshAllBalances()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
  }),

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.exchangeService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  coinbase: t.router({
    connect: publicProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          secretKey: z.string().min(1),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.connectCoinbase(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    list: publicProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('coinbase')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  strike: t.router({
    connect: publicProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          displayName: z.string().optional(),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.connectStrike(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    list: publicProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('strike')
      return accounts.map(exchangeAccountToDto)
    }),

    importStatement: publicProcedure
      .input(
        z.object({
          accountId: z.string(),
          transactions: z.array(
            z.object({
              externalId: z.string(),
              transactedAt: z.string(),
              type: z.string(),
              amountBtc: z.string(),
              amountUsd: z.string().optional(),
              feeUsd: z.string().optional(),
              feeBtc: z.string().optional(),
              exchangeRate: z.string().optional(),
              description: z.string().optional(),
              txHash: z.string().optional(),
              statementMonth: z.string(),
            }),
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.importStatementTransactions(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    listStatementTransactions: publicProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        return ctx.app.exchangeService.listStatementTransactions(input.accountId, input.statementMonth)
      }),

    listStatementMonths: publicProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.exchangeService.listStatementMonths(input.accountId)
    }),

    deleteStatementMonth: publicProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.app.exchangeService.deleteStatementMonth(input.accountId, input.statementMonth)
        return { deleted }
      }),
  }),

  robinhood: t.router({
    connect: publicProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          privateKeyBase64: z.string().min(1),
          displayName: z.string().optional(),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.connectRobinhood(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    list: publicProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('robinhood')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  kraken: t.router({
    connect: publicProcedure
      .input(
        z.object({
          apiKey: z.string().min(1),
          secretKey: z.string().min(1),
          replaceAccountId: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.exchangeService.connectKraken(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    list: publicProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('kraken')
      return accounts.map(exchangeAccountToDto)
    }),
  }),
})

// ─── portalProve.onchain ────────────────────────────────────────────────────

const onchainRouter = t.router({
  bitcoinAccountBalances: publicProcedure
    .input(z.object({ accounts: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const resultMap = new Map<string, { current: Decimal; usd: Decimal | null }>()
      const archivedAccounts = new Set<string>()
      const archivedBalances = new Map<string, bigint>()
      const accountSet = new IndexSet<Account>()
      const keyToAccount = new Map<string, Account>()

      for (const raw of input.accounts) {
        const parsed = NetworkAccount.fromString(raw)
        if (parsed.isOk()) {
          const na = parsed.unwrap()
          const key = na.toString()
          const [row] = await ctx.app.database
            .select({ id: accountTable.id, deletedAt: accountTable.deletedAt })
            .from(accountTable)
            .where(
              and(
                eq(accountTable.descriptor, na.account.toString()),
                eq(accountTable.network, claimNetworkToNetwork(na.network.toString())),
              ),
            )
            .orderBy(desc(sql`${accountTable.deletedAt} IS NULL`), desc(accountTable.createdAt))
            .limit(1)

          if (row?.deletedAt != null && row.deletedAt !== '') {
            const [snapshot] = await ctx.app.database
              .select({ balanceSats: balanceSnapshots.balanceSats })
              .from(balanceSnapshots)
              .where(and(eq(balanceSnapshots.accountId, row.id), lte(balanceSnapshots.timestamp, row.deletedAt)))
              .orderBy(desc(balanceSnapshots.timestamp))
              .limit(1)
            archivedAccounts.add(key)
            archivedBalances.set(key, BigInt(snapshot?.balanceSats ?? '0'))
            continue
          }

          accountSet.add(na.account)
          keyToAccount.set(key, na.account)
        }
      }

      if (accountSet.size === 0 && archivedBalances.size === 0) {
        return { accounts: resultMap, archivedAccounts }
      }

      let balances = new IndexMap<Account, bigint>()
      if (accountSet.size > 0) {
        const balancesResult = await ctx.app.onchainProvider.getConfirmedAccountBalances(accountSet)
        if (balancesResult.isErr()) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: balancesResult.unwrapErr().message })
        }
        balances = balancesResult.unwrap()
      }

      // Get BTC price for USD conversion
      const priceResult = await ctx.app.priceService.getCurrentBtcPrice()
      const price = priceResult.isOk() ? priceResult.unwrap().value : null

      for (const [key, sats] of archivedBalances) {
        const current = new Decimal(sats.toString())
        resultMap.set(key, {
          current,
          usd: price ? current.div(100_000_000).mul(price) : null,
        })
      }

      for (const [raw, account] of keyToAccount) {
        const sats = balances.get(account) ?? 0n
        const current = new Decimal(sats.toString())
        const btcAmount = current.div(100_000_000)
        const usd = price ? btcAmount.mul(price) : null
        resultMap.set(raw, { current, usd })
      }

      return { accounts: resultMap, archivedAccounts }
    }),

  claimBalances: publicProcedure.input(z.object({ claimIds: z.array(z.string()) })).query(async ({ ctx, input }) => {
    const balanceMap = new Map<string, Decimal>()

    const accountSet = new IndexSet<Account>()
    const idToAccount = new Map<string, Account>()

    // Resolve account IDs to Account objects
    for (const claimId of input.claimIds) {
      const [row] = await ctx.app.database
        .select({ descriptor: accountTable.descriptor })
        .from(accountTable)
        .where(and(eq(accountTable.id, claimId), isNull(accountTable.deletedAt)))
      if (!row) {
        continue
      }

      const parsed = Account.fromDescriptor(row.descriptor)
      if (parsed.isOk()) {
        const account = parsed.unwrap()
        accountSet.add(account)
        idToAccount.set(claimId, account)
      }
    }

    if (accountSet.size === 0) {
      return balanceMap
    }

    const result = await ctx.app.onchainProvider.getConfirmedAccountBalances(accountSet)
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }

    const accountBalances = result.unwrap()
    for (const [claimId, account] of idToAccount) {
      const [activeClaim] = await ctx.app.database
        .select({ id: accountTable.id })
        .from(accountTable)
        .where(and(eq(accountTable.id, claimId), isNull(accountTable.deletedAt)))
      if (activeClaim === undefined) {
        continue
      }

      const balance = accountBalances.get(account) ?? 0n
      balanceMap.set(claimId, new Decimal(balance.toString()))
    }

    return balanceMap
  }),
})

// ─── portalProve.statement ───────────────────────────────────────────────────

const statementRouter = t.router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.app.statementService.list()
  }),

  initiateGeneration: publicProcedure
    .input(
      z.object({
        claimIds: z.array(z.string()),
        exchangeAccountIds: z.array(z.string()).optional(),
        quoteCurrency: z.literal('USD').default('USD'),
        openingDate: z.date(),
        closingDate: z.date(),
        timezone: z.string(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const logger = ctx.app.logger.child({ module: 'statement-generation' })
      logger.info(
        { claimIds: input.claimIds, openingDate: input.openingDate, closingDate: input.closingDate },
        'Starting statement generation',
      )

      // Reject invalid dates before saving a statement that could only fail.
      const created = await ctx.app.statementService.create(input)
      if (created.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: created.unwrapErr().message })
      }
      const statementId = created.unwrap()
      logger.info({ statementId }, 'Created pending statement')

      // Fire-and-forget: generate data in background so the client gets the pending DTO immediately
      void (async () => {
        try {
          const dataResult = await ctx.app.statementService.generateStatementData(input)
          if (dataResult.isErr()) {
            const errMsg = dataResult.unwrapErr().message
            logger.error({ statementId, error: errMsg }, 'Statement data generation failed')
            await ctx.app.statementService.fail(statementId, errMsg)
            return
          }

          const { transactionMap, dailyRates } = dataResult.unwrap()
          const txCount = Object.values(transactionMap).reduce((sum, account) => sum + account.transactions.length, 0)
          logger.info(
            {
              statementId,
              accounts: Object.keys(transactionMap).length,
              transactions: txCount,
              ratesDays: Object.keys(dailyRates.rates).length,
            },
            'Statement data generated, completing',
          )

          const completed = await ctx.app.statementService.complete(statementId, transactionMap, dailyRates)
          if (completed.isErr()) {
            await ctx.app.statementService.fail(statementId, completed.unwrapErr().message)
            return
          }
          logger.info({ statementId }, 'Statement generation completed')
        } catch (err) {
          await ctx.app.statementService.fail(statementId)
          const message = err instanceof Error ? err.message : 'Statement generation failed'
          logger.error(
            { statementId, error: message, stack: err instanceof Error ? err.stack : undefined },
            'Unhandled error in statement generation',
          )
        }
      })()

      // Return the pending statement immediately
      const dto = await ctx.app.statementService.findById(statementId)
      if (!dto) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Statement not found after creation' })
      }
      return dto
    }),

  retrieve: publicProcedure.input(z.string()).query(async ({ ctx, input: statementId }) => {
    const dto = await ctx.app.statementService.findById(statementId)
    if (!dto) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
    }
    return dto
  }),

  retrieveDocumentData: publicProcedure
    .input(z.object({ statementId: z.string(), format: z.enum(['custom', 'monthly']) }))
    .query(async ({ ctx, input }) => {
      const loaded = await ctx.app.statementService.loadCompleted(input.statementId)
      if (!loaded) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Completed statement not found' })
      }

      const mapper = new StatementMapper()
      const pdfResult = mapper.toPdfStatement(
        {
          id: loaded.row.id,
          createdAt: new Date(loaded.row.createdAt),
          status: 'completed',
          counter: loaded.row.counter,
          timezone: loaded.row.timezone,
          openingDate: new Date(loaded.row.openingDate),
          closingDate: new Date(loaded.row.closingDate),
          user: { email: null, name: loaded.row.userName, address: loaded.row.userAddress },
          transactionMap: loaded.transactionMap,
          dailyRates: loaded.dailyRates,
        },
        input.format,
      )

      if (pdfResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: pdfResult.unwrapErr().message })
      }
      return pdfResult.unwrap()
    }),

  generatePreview: publicProcedure
    .input(
      z.object({
        claimIds: z.array(z.string()),
        exchangeAccountIds: z.array(z.string()).optional(),
        quoteCurrency: z.literal('USD').default('USD'),
        openingDate: z.date(),
        closingDate: z.date(),
        timezone: z.string(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        format: z.enum(['custom', 'monthly']).default('custom'),
        context: z.enum(['self_generated', 'access_request']).default('self_generated'),
      }),
    )
    .query(async ({ ctx, input }) => {
      const statementInput = {
        claimIds: input.claimIds,
        exchangeAccountIds: input.exchangeAccountIds,
        quoteCurrency: input.quoteCurrency,
        openingDate: input.openingDate,
        closingDate: input.closingDate,
        timezone: input.timezone,
        name: input.name,
        address: input.address,
      }
      // A date outside the allowed range is the caller's mistake, not a server failure.
      const validation = validateStatementInput(statementInput)
      if (validation.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: validation.unwrapErr().message })
      }

      const dataResult = await ctx.app.statementService.generateStatementData(statementInput)

      if (dataResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: dataResult.unwrapErr().message })
      }

      const { transactionMap, dailyRates } = dataResult.unwrap()

      const mapper = new StatementMapper()
      const pdfResult = mapper.toPdfStatement(
        {
          id: `preview_${nanoid()}`,
          createdAt: new Date(),
          status: 'completed',
          counter: 0,
          timezone: input.timezone,
          openingDate: input.openingDate,
          closingDate: input.closingDate,
          user: { email: null, name: input.name ?? null, address: input.address ?? null },
          transactionMap,
          dailyRates,
        },
        input.format,
      )

      if (pdfResult.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: pdfResult.unwrapErr().message })
      }
      return pdfResult.unwrap()
    }),
})

// ─── portalProve (combined) ─────────────────────────────────────────────────

// ─── portalProve.manual ─────────────────────────────────────────────────────

const manualRouter = t.router({
  list: publicProcedure.query(async ({ ctx }) => {
    return (await ctx.app.manualService.listAccounts()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      balanceAsOf: a.balanceAsOf,
      createdAt: a.createdAt,
    }))
  }),

  get: publicProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
    const account = await ctx.app.manualService.getAccount(input.accountId)
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual account not found' })
    }
    return {
      id: account.id,
      displayName: account.displayName,
      currency: 'BTC' as const,
      balance: account.balanceSats,
      balanceAsOf: account.balanceAsOf,
      createdAt: account.createdAt,
    }
  }),

  create: publicProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        balanceSats: z.string(),
        balanceAsOf: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.createAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        balanceAsOf: a.balanceAsOf,
        createdAt: a.createdAt,
      }
    }),

  updateBalance: publicProcedure
    .input(
      z.object({
        accountId: z.string(),
        balanceSats: z.string(),
        balanceAsOf: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.updateBalance(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        balanceAsOf: a.balanceAsOf,
        createdAt: a.createdAt,
      }
    }),

  rename: publicProcedure
    .input(z.object({ accountId: z.string(), displayName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.manualService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  transactions: t.router({
    list: publicProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.manualService.listTransactions(input.accountId)
    }),

    add: publicProcedure
      .input(
        z.object({
          accountId: z.string(),
          type: z.enum(['buy', 'sell', 'transfer_in', 'transfer_out']),
          amountSats: z.string(),
          transactedAt: z.string(),
          note: z.string().optional(),
          addToBalance: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.manualService.addTransaction(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    delete: publicProcedure.input(z.object({ transactionId: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.deleteTransaction(input.transactionId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),
  }),
})

// ─── portalProve.etf ────────────────────────────────────────────────────────

const etfRouter = t.router({
  list: publicProcedure.query(async ({ ctx }) => {
    return (await ctx.app.etfService.listAccounts()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      createdAt: a.createdAt,
    }))
  }),

  get: publicProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
    const account = await ctx.app.etfService.getAccount(input.accountId)
    if (!account) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'ETF account not found' })
    }
    return {
      id: account.id,
      displayName: account.displayName,
      currency: 'BTC' as const,
      balance: account.balanceSats,
      createdAt: account.createdAt,
    }
  }),

  create: publicProcedure
    .input(
      z.object({
        displayName: z.string().min(1),
        holdings: z.array(
          z.object({
            ticker: etfTickerSchema,
            shares: z.string(),
            datePurchased: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.createAccount({
        displayName: input.displayName,
        holdings: input.holdings,
      })
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const a = result.unwrap()
      return {
        id: a.id,
        displayName: a.displayName,
        currency: 'BTC' as const,
        balance: a.balanceSats,
        createdAt: a.createdAt,
      }
    }),

  rename: publicProcedure
    .input(z.object({ accountId: z.string(), displayName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.etfService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  holdings: t.router({
    list: publicProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.etfService.listHoldings(input.accountId)
    }),

    add: publicProcedure
      .input(
        z.object({
          accountId: z.string(),
          ticker: etfTickerSchema,
          shares: z.string(),
          datePurchased: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.etfService.addHolding(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    remove: publicProcedure.input(z.object({ holdingId: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.etfService.removeHolding(input.holdingId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),
  }),
})

const portalProveRouter = t.router({
  controlCenter: controlCenterRouter,
  registry: registryRouter,
  exchange: proveExchangeRouter,
  manual: manualRouter,
  etf: etfRouter,
  onchain: onchainRouter,
  statement: statementRouter,
  retrieveBitcoinPrice: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.app.priceService.getCurrentBtcPrice()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    return result.unwrap()
  }),

  // ─── Account management (used by local UI) ─────────────────────────────

  accounts: t.router({
    add: publicProcedure
      .input(
        z.object({
          descriptor: z.string().min(1),
          displayName: z.string().min(1),
          network: z.enum(['mainnet', 'testnet']).default('mainnet'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = ctx.app.database
        const [duplicate] = await db
          .select({ id: accountTable.id })
          .from(accountTable)
          .where(and(eq(accountTable.descriptor, input.descriptor), eq(accountTable.network, input.network)))
          .limit(1)
        if (duplicate) {
          throw new TRPCError({ code: 'CONFLICT', message: 'An account with this descriptor already exists' })
        }

        const id = nanoid()
        await db
          .insert(accountTable)
          .values({ id, network: input.network, descriptor: input.descriptor, displayName: input.displayName })

        return { id, network: input.network, descriptor: input.descriptor, displayName: input.displayName }
      }),

    remove: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const deleted = await ctx.app.database.delete(accountTable).where(eq(accountTable.id, input.id))
      if (deleted.rowsAffected === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
      }
    }),
  }),
})

// ─── Blocks ─────────────────────────────────────────────────────────────────

const blocksRouter = t.router({
  tip: publicProcedure.query(async ({ ctx }) => {
    const result = await ctx.app.onchainProvider.getBlocksTip()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    const tip = result.unwrap()
    return { height: tip.height, hash: tip.hash, timestamp: tip.timestamp.toISOString() }
  }),
})

// ─── Settings ───────────────────────────────────────────────────────────────

const READABLE_SETTINGS = new Set([
  'user_name',
  'owner_identifier',
  'electrum_host',
  'electrum_port',
  'electrum_protocol',
  'tor_enabled',
])

// Connection settings must be validated, connected and saved together through
// reconnectElectrum; individual writes could make the next launch unusable.
const WRITABLE_SETTINGS = new Set(['user_name', 'owner_identifier'])

function isReadableSetting(key: string): boolean {
  return READABLE_SETTINGS.has(key)
}

type ElectrumProtocol = 'tcp' | 'ssl'

interface ValidatedElectrumConnection {
  host: string
  port: number
  protocol: ElectrumProtocol
  proxy?: {
    host: string
    port: number
  }
}

function normalizeBracketedIpv6Host(host: string): string {
  if (!host.startsWith('[') && !host.endsWith(']')) {
    return host
  }
  if (!host.startsWith('[') || !host.endsWith(']')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  const unbracketed = host.slice(1, -1)
  if (net.isIP(unbracketed) !== 6) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  return unbracketed
}

function isValidElectrumDnsHost(host: string): boolean {
  if (!/^[a-z0-9.-]+$/.test(host)) {
    return false
  }

  const labels = host.split('.')
  return labels.every((label) => {
    return label.length > 0 && label.length <= 63 && !label.startsWith('-') && !label.endsWith('-')
  })
}

function validateElectrumHost(value: string): string {
  const host = normalizeBracketedIpv6Host(value.trim().toLowerCase().replace(/\.$/, ''))
  if (host.length === 0 || host.length > 253 || /[\s/@?#\\]/.test(host)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  if (host.includes(':') && net.isIP(host) !== 6) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  if (net.isIP(host) === 0 && !isValidElectrumDnsHost(host)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum host' })
  }

  return host
}

function validateElectrumPort(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum port' })
  }

  return value
}

function validateElectrumProtocol(value: string): ElectrumProtocol {
  if (value !== 'tcp' && value !== 'ssl') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid Electrum protocol' })
  }

  return value
}

function validateElectrumConnection(input: {
  host: string
  port: number
  protocol: ElectrumProtocol
}): ValidatedElectrumConnection {
  return {
    host: validateElectrumHost(input.host),
    port: validateElectrumPort(input.port),
    protocol: validateElectrumProtocol(input.protocol),
  }
}

function validateWritableSetting(key: string, value: string): string {
  if (!WRITABLE_SETTINGS.has(key)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not writable' })
  }

  switch (key) {
    case 'user_name':
    case 'owner_identifier': {
      if (value.length > 200) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Setting value is too long' })
      }
      return value
    }
  }

  throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not writable' })
}

// ─── Desktop saved connections ──────────────────────────────────────────────

const connectionDetailsInput = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(['tcp', 'ssl']),
  // Required: a missing Tor setting must never default to direct for a saved connection.
  torEnabled: z.boolean(),
})
const profileReferenceInput = z.object({ id: z.string().uuid(), revision: z.number().int().positive() })
const nicknameInput = z
  .string()
  .trim()
  .min(1, 'Enter a nickname')
  .max(80, 'Use 80 characters or fewer for the nickname')

function profileDetails(input: z.infer<typeof connectionDetailsInput>): ConnectionDetails {
  const connection = validateElectrumConnection(input)
  if (connection.host.endsWith('.onion') && !input.torEnabled) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Onion addresses require Tor' })
  }
  return { ...connection, torEnabled: input.torEnabled }
}

const desktopConnectionProcedure = publicProcedure.use(async ({ ctx, next }) => {
  if (!ctx.app.connectionProfiles) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Saved connections are only available in the desktop app' })
  }
  return next({ ctx: { ...ctx, profiles: ctx.app.connectionProfiles } })
})

const connectionProfilesRouter = t.router({
  list: desktopConnectionProcedure.query(async ({ ctx }) => ({
    profiles: await ctx.profiles.list(),
    activeId: (await ctx.profiles.getActiveId()) ?? null,
    limit: MAX_CONNECTION_PROFILES,
  })),

  // Saving, renaming, and deleting never connect; only connect changes the active server.
  create: desktopConnectionProcedure
    .input(connectionDetailsInput.extend({ nickname: nicknameInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.profiles.create({ ...profileDetails(input), nickname: input.nickname })
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      return result.unwrap()
    }),

  rename: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ nickname: nicknameInput }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.profiles.rename(input, input.nickname)
      if (result.isErr()) {
        throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
      }
      return result.unwrap()
    }),

  delete: desktopConnectionProcedure.input(profileReferenceInput).mutation(async ({ ctx, input }) => {
    const result = await ctx.profiles.delete(input)
    if (result.isErr()) {
      throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
    }
    return { id: input.id }
  }),

  connect: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ connection: connectionDetailsInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.connectProfile(
        input,
        input.connection ? profileDetails(input.connection) : undefined,
      )
      if (result.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      }
      const connected = (await ctx.profiles.list()).find((profile) => profile.id === input.id)
      if (!connected) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'This saved connection no longer exists' })
      }
      return connected
    }),
})

const settingsRouter = t.router({
  connectionProfiles: connectionProfilesRouter,
  get: publicProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
    if (!isReadableSetting(input.key)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not readable' })
    }

    const [row] = await ctx.app.database
      .select({ value: settings.value })
      .from(settings)
      .where(eq(settings.key, input.key))
    return row?.value ?? null
  }),

  update: publicProcedure.input(z.object({ key: z.string(), value: z.string() })).mutation(async ({ ctx, input }) => {
    const value = validateWritableSetting(input.key, input.value)
    await ctx.app.database
      .insert(settings)
      .values({ key: input.key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
  }),

  // Answers at once, so Settings can change the source even while every source is down.
  priceSource: publicProcedure.query(async ({ ctx }) => ctx.app.priceService.options()),

  // Price settings change how Sentinel fetches prices, so they are saved together here and the
  // price service is told, rather than written through the generic `update`.
  setPriceSettings: publicProcedure
    .input(z.object({ source: z.enum(PRICE_SOURCES).optional(), fallbacks: z.boolean().optional() }))
    .mutation(async ({ ctx, input }) => {
      if (input.source !== undefined && !ctx.app.priceService.isAvailable(input.source)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That price source is not available' })
      }
      await ctx.app.database.transaction(async (tx) => {
        if (input.source !== undefined) {
          await tx
            .insert(settings)
            .values({ key: PRICE_SOURCE_SETTING, value: input.source })
            .onConflictDoUpdate({ target: settings.key, set: { value: input.source } })
        }
        if (input.fallbacks !== undefined) {
          const value = String(input.fallbacks)
          await tx
            .insert(settings)
            .values({ key: PRICE_FALLBACKS_SETTING, value })
            .onConflictDoUpdate({ target: settings.key, set: { value } })
        }
      })
      ctx.app.priceService.settingsUpdated()
      return ctx.app.priceService.options()
    }),

  priceStatus: publicProcedure.query(async ({ ctx }) => {
    // Look the price up under the current settings, so a status never describes an earlier choice.
    const result = await ctx.app.priceService.getCurrentBtcPrice({ verifyPrimary: true })
    const price = result.isOk() ? result.unwrap() : null
    const { selected, fallbacks } = await ctx.app.priceService.options()
    return {
      selected,
      fallbacks,
      price: price ? { source: price.source, asOf: price.asOf.toISOString(), lastKnown: price.lastKnown } : null,
    }
  }),

  electrumStatus: publicProcedure.query(({ ctx }) => {
    const { host, port, protocol } = ctx.app.electrumConfig
    // Checks run only while a page shows the status; the result appears on its next poll.
    ctx.app.electrumClient.checkReachable(30_000)
    return {
      // Reachability, not an open socket: servers close idle sockets between requests.
      connected: ctx.app.electrumClient.isReachable(),
      // Lets the page say "Connecting…" rather than "Disconnected" while the first attempt runs;
      // background retries during an outage don't count.
      connecting: ctx.app.electrumClient.isConnecting(),
      host,
      port,
      protocol,
      tor: ctx.app.getTorStatus(),
    }
  }),

  startTor: publicProcedure.mutation(({ ctx }) => ctx.app.startTor()),

  testElectrum: publicProcedure
    .input(
      z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65_535),
        protocol: z.enum(['tcp', 'ssl']),
        // Required, so a test never runs direct just because the Tor setting was left out.
        torEnabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prepared = ctx.app.prepareElectrumConfig(validateElectrumConnection(input), input.torEnabled)
      if (prepared.isErr()) {
        throw new Error(prepared.unwrapErr().message)
      }
      const config = prepared.unwrap()
      const { ElectrumClient } = await import('@hoseki/packages/clients/electrum')
      // Tor connections bring their own longer limit.
      const testClient = new ElectrumClient({
        requestTimeout: 15_000,
        ...config,
      })
      const result = await testClient.connect()
      testClient.disconnect()
      if (result.isErr()) {
        throw new Error(result.unwrapErr().message)
      }
      return { success: true, version: result.unwrap() }
    }),

  reconnectElectrum: publicProcedure
    .input(
      z.object({
        host: z.string(),
        port: z.number().int().min(1).max(65_535),
        protocol: z.enum(['tcp', 'ssl']),
        torEnabled: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prepared = ctx.app.prepareElectrumConfig(validateElectrumConnection(input), input.torEnabled)
      if (prepared.isErr()) {
        throw new Error(prepared.unwrapErr().message)
      }
      const result = await ctx.app.reconnectElectrum(prepared.unwrap())
      if (result.isErr()) {
        throw new Error(result.unwrapErr().message)
      }
    }),
})

// ─── Root Router ────────────────────────────────────────────────────────────

export const appRouter = t.router({
  portalProve: portalProveRouter,
  blocks: blocksRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter
