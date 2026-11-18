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
import { Xpub, containsExtendedPrivateKey } from '@hoseki/packages/bitcoin/xpub'
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
  StatementQuoteCurrencySchema,
  TimezoneSchema,
  hosid,
} from '@hoseki/packages/schemas'
import {
  type SupportedHardwareWallet,
  type SupportedHardwareWalletDisplayName,
  bitkeyKeyLabels,
  parseBitkeyExport,
} from '@hoseki/packages/wallet'
import { TRPCError } from '@trpc/server'
import * as bip322 from 'bip322-js'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import {
  accounts as accountTable,
  challenges,
  keystores as keystoreTable,
  settings,
  signedMessages as signedMessagesTable,
} from '../../db/schema'
import { parseDbTimestamp } from '../../db/timestamp'
import { featureRouters } from '../../features'
import { claimNetworkToNetwork } from '../../lib/claim-network'
import { loggableError } from '../../lib/loggable-error'
import { authRouter } from '../auth/router'
import { StatementMapper } from '../statements/mapper'
import { loggableFailure, statementFailureMessage } from '../statements/service'
import { protectedProcedure, router } from './init'

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

const supportedHardwareWalletSchema = z.enum(['trezor', 'coldcard', 'ledger', 'keystone', 'bitkey'])
const privateKeyMessage = 'Use extended public keys (xpub), not private keys'

function descriptorIssue(descriptor: string, invalidMessage: string) {
  return { message: containsExtendedPrivateKey(descriptor) ? privateKeyMessage : invalidMessage }
}

const checkedSinglesigAccountDescriptorSchema = z.custom<CheckedSinglesigAccountDescriptor>(
  (value): value is CheckedSinglesigAccountDescriptor =>
    // The parser reads only the first key, so also reject private keys elsewhere in the descriptor.
    typeof value === 'string' && !containsExtendedPrivateKey(value) && SingleSigAccount.fromDescriptor(value).isOk(),
  { error: (issue) => descriptorIssue(String(issue.input), 'Invalid singlesig account descriptor') },
)
const checkedMultisigAccountDescriptorSchema = z.custom<CheckedMultisigAccountDescriptor>(
  (value): value is CheckedMultisigAccountDescriptor =>
    typeof value === 'string' && !containsExtendedPrivateKey(value) && MultiSigAccount.fromDescriptor(value).isOk(),
  { error: (issue) => descriptorIssue(String(issue.input), 'Invalid multisig account descriptor') },
)
const hardwareWalletDisplayNames = {
  trezor: 'Trezor',
  coldcard: 'Coldcard',
  ledger: 'Ledger',
  keystone: 'Keystone',
  bitkey: 'Bitkey',
} as const satisfies Record<SupportedHardwareWallet, SupportedHardwareWalletDisplayName>

function networkToClaimNetwork(network: string): 'bitcoin_mainnet' | 'bitcoin_testnet' {
  return network === 'testnet' ? 'bitcoin_testnet' : 'bitcoin_mainnet'
}

function keystoreRowToDto(row: KeystoreRow): KeystoreDto {
  const now = parseDbTimestamp(row.createdAt)
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
  const now = parseDbTimestamp(row.createdAt)
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
  const signedMessages = latestChallenge
    ? await db.select().from(signedMessagesTable).where(eq(signedMessagesTable.challengeId, latestChallenge.id))
    : []

  return buildClaimDto(row, keystoreRows, latestChallenge ?? null, signedMessages)
}

function signedMessageRowToDto(row: SignedMessageRow): SignedMessageDto {
  return {
    version: 0,
    id: parseUnknown(SignedMessageIdSchema, row.id).expect('Stored signed-message ID is invalid'),
    createdAt: parseDbTimestamp(row.createdAt),
    updatedAt: parseDbTimestamp(row.signedAt ?? row.createdAt),
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

// ─── portalProve.controlCenter ──────────────────────────────────────────────

const controlCenterRouter = router({
  getData: protectedProcedure
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

  /**
   * Each wallet's newest known balance and whether a newer one is being fetched. Never waits on
   * Electrum: out-of-date wallets start a scan, and pages poll while any wallet is syncing.
   */
  walletBalances: protectedProcedure.input(z.object({ claimIds: z.array(z.string()) })).query(async ({ ctx, input }) =>
    (await ctx.app.walletBalanceService.readBalances(input.claimIds)).map(
      ({ accountId, balanceSats, asOf, syncing, failed }) => ({
        accountId,
        balanceSats: balanceSats?.toString() ?? null,
        asOf: asOf?.toISOString() ?? null,
        syncing,
        failed,
      }),
    ),
  ),
})

// ─── portalProve.registry ───────────────────────────────────────────────────

const registryRouter = router({
  claims: router({
    list: protectedProcedure
      // `excludePending` keeps only verified accounts, so it also leaves out accounts that can't be verified.
      .input(z.object({ excludePending: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        // Leaves out every account whose ownership is unproven: pending and unverified ones.
        const excludePending = input?.excludePending ?? false
        const rows = await ctx.app.database
          .select({ id: accountTable.id })
          .from(accountTable)
          .where(
            and(
              isNull(accountTable.deletedAt),
              excludePending ? inArray(accountTable.status, ['verified', 'expired']) : undefined,
            ),
          )
          .orderBy(desc(accountTable.createdAt))
        const claims = await Promise.all(rows.map(async (row) => getFullClaimDto(ctx.app.database, row.id)))
        return claims.filter((claim): claim is ClaimDto => claim !== null)
      }),

    deletePending: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
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
      const deleted = await db
        .delete(accountTable)
        .where(and(eq(accountTable.id, input.id), eq(accountTable.status, 'pending'), isNull(accountTable.deletedAt)))
      if (deleted.rowsAffected === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Claim changed before it could be deleted' })
      }
      ctx.app.walletBalanceService.invalidate(input.id)
    }),

    delete: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
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
      const deleted = await db
        .delete(accountTable)
        .where(and(eq(accountTable.id, input.id), isNotNull(accountTable.deletedAt)))
      if (deleted.rowsAffected === 0) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Claim changed before it could be deleted' })
      }
      ctx.app.walletBalanceService.invalidate(input.id)
    }),

    archive: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.controlCenterService.archiveAccount(input.id)
      if (result.isErr()) {
        const error = result.unwrapErr()
        throw new TRPCError({
          code: error.message === 'Claim not found or already archived' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
          message: error.message,
        })
      }
    }),

    restore: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const result = await ctx.app.controlCenterService.restoreAccount(input.id)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

    listArchived: protectedProcedure.query(async ({ ctx }) => {
      const rows = await ctx.app.database
        .select({ id: accountTable.id })
        .from(accountTable)
        .where(isNotNull(accountTable.deletedAt))
        .orderBy(desc(accountTable.createdAt))
      const claims = await Promise.all(rows.map(async (row) => getFullClaimDto(ctx.app.database, row.id)))
      return claims.filter((claim): claim is ClaimDto => claim !== null)
    }),

    getCountLimit: protectedProcedure.query(() => {
      return null
    }),

    update: protectedProcedure
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

    /** Track an account someone started proving but chose to track instead. Other accounts keep their status. */
    track: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const db = ctx.app.database
      await db
        .update(accountTable)
        .set({ status: 'unverified' })
        .where(and(eq(accountTable.id, input.id), eq(accountTable.status, 'pending')))
      const [row] = await db
        .select({ id: accountTable.id, status: accountTable.status })
        .from(accountTable)
        .where(eq(accountTable.id, input.id))
      if (!row) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
      }
      return row
    }),

    updateKeystore: protectedProcedure
      .input(
        z.object({
          id: z.string(),
          label: z.string().min(1),
          wallet: supportedHardwareWalletSchema.nullable().optional(),
          model: z.string().nullable().optional(),
          derivationPath: DerivationPathString.nullable().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) =>
        ctx.app.database.transaction(async (db) => {
          const updated = await db
            .update(keystoreTable)
            .set({ label: input.label, wallet: input.wallet, model: input.model, derivationPath: input.derivationPath })
            .where(eq(keystoreTable.id, input.id))
            .returning()
          const ks = updated[0]
          if (!ks) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
          }
          // A Bitkey can't sign the ownership proof, so a pending account would wait for it forever.
          if (ks.wallet === 'bitkey') {
            await db
              .update(accountTable)
              .set({ status: 'unverified' })
              .where(and(eq(accountTable.id, ks.accountId), eq(accountTable.status, 'pending')))
          }
          return keystoreRowToDto(ks)
        }),
      ),

    create: router({
      singlesig: protectedProcedure
        .input(
          z.object({
            network: z.string(),
            account: checkedSinglesigAccountDescriptorSchema,
            displayName: z.string().min(1),
            /** Track the balance without proving ownership. */
            trackOnly: z.boolean().optional(),
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
              status: input.trackOnly === true ? 'unverified' : 'pending',
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

      multisig: protectedProcedure
        .input(
          z.object({
            network: z.string(),
            account: checkedMultisigAccountDescriptorSchema,
            displayName: z.string().min(1),
            /** Track the balance without proving ownership. */
            trackOnly: z.boolean().optional(),
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
              status: input.trackOnly === true ? 'unverified' : 'pending',
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

      /** Bitkey's keys can't sign messages, so a Bitkey account starts unverified and stays that way. */
      bitkey: protectedProcedure
        .input(z.object({ descriptorExport: z.string().max(10_000), displayName: z.string().min(1) }))
        .mutation(async ({ ctx, input }) => {
          const parsed = parseBitkeyExport(input.descriptorExport)
          if (parsed.isErr()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.unwrapErr().message })
          }
          const { account, keys } = parsed.unwrap()
          const descriptor = account.descriptor()
          validateMultisigKeystores(
            account,
            keys.map((key) => key.keyExpression.xpub.toString()),
          )

          return ctx.app.database.transaction(async (db) => {
            const [existing] = await db
              .select({ id: accountTable.id, deletedAt: accountTable.deletedAt })
              .from(accountTable)
              .where(and(eq(accountTable.descriptor, descriptor), eq(accountTable.network, 'mainnet')))
              .limit(1)
            if (existing?.deletedAt != null) {
              throw new TRPCError({
                code: 'CONFLICT',
                message: 'This Bitkey is archived. Restore it from Archived accounts.',
              })
            }

            let accountId = existing?.id
            if (accountId === undefined) {
              accountId = hosid('re_clmx')
              const now = new Date().toISOString()
              await db.insert(accountTable).values({
                id: accountId,
                network: 'mainnet',
                descriptor,
                displayName: input.displayName,
                status: 'unverified',
                createdAt: now,
              })
              for (const key of keys) {
                await db.insert(keystoreTable).values({
                  id: hosid('re_ks'),
                  accountId,
                  label: bitkeyKeyLabels[key.role],
                  wallet: 'bitkey',
                  model: key.role,
                  derivationPath: key.keyExpression.keyOrigin?.derivationPath?.toString() ?? null,
                  xpub: key.keyExpression.xpub.toString(),
                  createdAt: now,
                })
              }
            }

            const claim = await getFullClaimDto(db, accountId)
            if (!claim) {
              throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Claim not found after creation' })
            }
            return { claim, alreadyConnected: existing !== undefined }
          })
        }),
    }),

    get: router({
      byId: protectedProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
        const claim = await getFullClaimDto(ctx.app.database, input.id)
        if (!claim) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
        }
        return claim
      }),

      byAccount: protectedProcedure
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

  challenges: router({
    create: protectedProcedure
      .input(z.object({ claimId: z.string(), keystoreId: z.string().optional() }))
      .mutation(async ({ ctx, input }) => {
        return ctx.app.database.transaction(async (db) => {
          // Check the account exists
          const [accountRow] = await db
            .select({ id: accountTable.id, status: accountTable.status })
            .from(accountTable)
            .where(eq(accountTable.id, input.claimId))
          if (!accountRow) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
          }
          // A Bitkey's keys can't sign messages. A tracked wallet that is also unverified can still be proven.
          const [bitkeyKeystore] = await db
            .select({ id: keystoreTable.id })
            .from(keystoreTable)
            .where(and(eq(keystoreTable.accountId, input.claimId), eq(keystoreTable.wallet, 'bitkey')))
            .limit(1)
          if (bitkeyKeystore) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'This account can’t be verified' })
          }

          // Return existing incomplete challenge if one exists
          const [existing] = await db
            .select()
            .from(challenges)
            .where(and(eq(challenges.accountId, input.claimId), eq(challenges.isSatisfied, 0)))
            .orderBy(desc(challenges.createdAt))
            .limit(1)
          if (existing) {
            return {
              id: existing.id,
              claimId: existing.accountId,
              variant: 'signed_message' as const,
              isSatisfied: false,
              createdAt: parseDbTimestamp(existing.createdAt),
              updatedAt: parseDbTimestamp(existing.createdAt),
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

    complete: protectedProcedure.input(z.object({ challengeId: z.string() })).mutation(async ({ ctx, input }) => {
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
        createdAt: parseDbTimestamp(challenge.createdAt),
        updatedAt: new Date(now),
        completedAt: new Date(now),
      }
    }),
  }),

  challengeMessages: router({
    create: protectedProcedure
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

    get: protectedProcedure
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

    list: protectedProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ ctx, input }): Promise<ChallengeMessageDto[]> => {
        const messages = await ctx.app.database
          .select()
          .from(signedMessagesTable)
          .where(eq(signedMessagesTable.challengeId, input.challengeId))
        return messages.map(challengeMessageRowToDto)
      }),

    complete: protectedProcedure
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

  getOrCreateSinglesigChallengeMessage: protectedProcedure
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
                createdAt: parseDbTimestamp(existingChallenge.createdAt),
                updatedAt: parseDbTimestamp(existingChallenge.createdAt),
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
            createdAt: parseDbTimestamp(existingChallenge?.createdAt ?? now),
            updatedAt: parseDbTimestamp(existingChallenge?.createdAt ?? now),
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

const proveExchangeRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const accounts = await ctx.app.exchangeService.listAccounts()
    return accounts.map(exchangeAccountToDto)
  }),

  refreshBalance: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.exchangeService.refreshBalance(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    return result.unwrap()
  }),

  refreshAllBalances: protectedProcedure.mutation(async ({ ctx }) => {
    const result = await ctx.app.exchangeService.refreshAllBalances()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
  }),

  delete: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.exchangeService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  coinbase: router({
    connect: protectedProcedure
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

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('coinbase')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  strike: router({
    connect: protectedProcedure
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

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('strike')
      return accounts.map(exchangeAccountToDto)
    }),

    importStatement: protectedProcedure
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

    listStatementTransactions: protectedProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string().optional() }))
      .query(async ({ ctx, input }) => {
        return ctx.app.exchangeService.listStatementTransactions(input.accountId, input.statementMonth)
      }),

    listStatementMonths: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.exchangeService.listStatementMonths(input.accountId)
    }),

    deleteStatementMonth: protectedProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const deleted = await ctx.app.exchangeService.deleteStatementMonth(input.accountId, input.statementMonth)
        return { deleted }
      }),
  }),

  robinhood: router({
    connect: protectedProcedure
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

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('robinhood')
      return accounts.map(exchangeAccountToDto)
    }),
  }),

  kraken: router({
    connect: protectedProcedure
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

    list: protectedProcedure.query(async ({ ctx }) => {
      const accounts = await ctx.app.exchangeService.listAccounts('kraken')
      return accounts.map(exchangeAccountToDto)
    }),
  }),
})

// ─── portalProve.statement ───────────────────────────────────────────────────

const statementRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.app.statementService.list()
  }),

  initiateGeneration: protectedProcedure
    .input(
      z.object({
        claimIds: z.array(z.string()),
        exchangeAccountIds: z.array(z.string()).optional(),
        quoteCurrency: StatementQuoteCurrencySchema.default('USD'),
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
          const dataResult = await ctx.app.statementService.generateStatementData(input, statementId)
          if (dataResult.isErr()) {
            const error = dataResult.unwrapErr()
            logger.error({ statementId, ...loggableFailure(error) }, 'Statement data generation failed')
            await ctx.app.statementService.fail(statementId, statementFailureMessage(error))
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
            logger.error({ statementId, ...loggableFailure(completed.unwrapErr()) }, 'Statement could not be completed')
            await ctx.app.statementService.fail(statementId, completed.unwrapErr().message)
            return
          }
          logger.info({ statementId }, 'Statement generation completed')
        } catch (err) {
          // Database errors put the values they were saving, such as txids, in their message.
          logger.error(
            { statementId, ...(err instanceof Error ? loggableError(err) : { error: 'unknown' }) },
            'Unhandled error in statement generation',
          )
          // The same fault can stop this write too; a restart then marks the statement interrupted.
          try {
            await ctx.app.statementService.fail(statementId)
          } catch (failure) {
            logger.error(
              { statementId, ...(failure instanceof Error ? loggableError(failure) : { error: 'unknown' }) },
              'Could not mark the statement as failed',
            )
          }
        }
      })()

      // Return the pending statement immediately
      const dto = await ctx.app.statementService.findById(statementId)
      if (!dto) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Statement not found after creation' })
      }
      return dto
    }),

  retrieve: protectedProcedure.input(z.string()).query(async ({ ctx, input: statementId }) => {
    const dto = await ctx.app.statementService.findById(statementId)
    if (!dto) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
    }
    return dto
  }),

  delete: protectedProcedure.input(z.string()).mutation(async ({ ctx, input: statementId }) => {
    const deleted = await ctx.app.statementService.delete(statementId)
    if (deleted.isErr()) {
      switch (deleted.unwrapErr()) {
        case 'not_found':
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
        case 'pending':
          throw new TRPCError({ code: 'CONFLICT', message: 'Statement is still generating' })
      }
    }
  }),

  retrieveDocumentData: protectedProcedure
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
          createdAt: parseDbTimestamp(loaded.row.createdAt),
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
})

// ─── portalProve (combined) ─────────────────────────────────────────────────

// ─── portalProve.manual ─────────────────────────────────────────────────────

const manualRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return (await ctx.app.manualService.listAccounts()).map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      balanceAsOf: a.balanceAsOf,
      createdAt: a.createdAt,
    }))
  }),

  get: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
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

  create: protectedProcedure
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

  updateBalance: protectedProcedure
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

  rename: protectedProcedure
    .input(z.object({ accountId: z.string(), displayName: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.manualService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: protectedProcedure.input(z.object({ accountId: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await ctx.app.manualService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  transactions: router({
    list: protectedProcedure.input(z.object({ accountId: z.string() })).query(async ({ ctx, input }) => {
      return ctx.app.manualService.listTransactions(input.accountId)
    }),

    add: protectedProcedure
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

    delete: protectedProcedure
      .input(z.object({ transactionId: z.string(), removeFromBalance: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const result = await ctx.app.manualService.deleteTransaction(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
      }),
  }),
})

const portalProveRouter = router({
  controlCenter: controlCenterRouter,
  registry: registryRouter,
  exchange: proveExchangeRouter,
  manual: manualRouter,
  ...featureRouters,
  statement: statementRouter,

  // ─── Account management (used by local UI) ─────────────────────────────

  accounts: router({
    add: protectedProcedure
      .input(
        z.object({
          descriptor: z.string().min(1),
          displayName: z.string().min(1),
          network: z.enum(['mainnet', 'testnet']).default('mainnet'),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        if (containsExtendedPrivateKey(input.descriptor)) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: privateKeyMessage,
          })
        }
        return ctx.app.database.transaction(async (db) => {
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
        })
      }),

    remove: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
      const deleted = await ctx.app.database.delete(accountTable).where(eq(accountTable.id, input.id))
      if (deleted.rowsAffected === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
      }
      ctx.app.walletBalanceService.invalidate(input.id)
    }),
  }),
})

// ─── Blocks ─────────────────────────────────────────────────────────────────

const blocksRouter = router({
  tip: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.app.onchainProvider.getBlocksTip()
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }
    const tip = result.unwrap()
    return { height: tip.height, hash: tip.hash, timestamp: tip.timestamp.toISOString() }
  }),
})

// ─── Root Router ────────────────────────────────────────────────────────────

export const appRouter = router({
  auth: authRouter,
  portalProve: portalProveRouter,
  blocks: blocksRouter,
})

export type AppRouter = typeof appRouter
