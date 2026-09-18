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
  type ClaimId,
  type ClaimStatus,
  type Hosid,
  type KeystoreId,
  type SignedMessageId,
  TimezoneSchema,
  hosid,
  removeHosidPrefix,
} from '@hoseki/packages/schemas'
import type { SupportedHardwareWallet, SupportedHardwareWalletDisplayName } from '@hoseki/packages/wallet'
import { TRPCError } from '@trpc/server'
import type Database from 'better-sqlite3'
import * as bip322 from 'bip322-js'
import { Decimal } from 'decimal.js'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { MAX_CONNECTION_PROFILES } from '../connection_profiles/store'
import { StatementMapper } from '../statements/mapper'
import { publicProcedure, t } from './init'

// ─── Helpers ────────────────────────────────────────────────────────────────

type AccountRow = {
  id: ClaimId
  network: string
  descriptor: CheckedAccountDescriptor
  display_name: string
  status: ClaimStatus
  created_at: string
  deleted_at: string | null
}

type KeystoreRow = {
  id: KeystoreId
  account_id: ClaimId
  label: string
  wallet: SupportedHardwareWallet | null
  model: string | null
  derivation_path: DerivationPathString | null
  xpub: string
  created_at: string
}

type ChallengeRow = {
  id: ChallengeId
  account_id: ClaimId
  is_satisfied: number
  completed_at: string | null
  created_at: string
}

type SignedMessageRow = {
  id: SignedMessageId
  challenge_id: ChallengeId
  keystore_id: KeystoreId
  address: CheckedAddressString
  message_text: string
  signature: string | null
  signed_at: string | null
  created_at: string
}

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
  (value) => typeof value === 'string' && SingleSigAccount.fromDescriptor(value).isOk(),
  'Invalid singlesig account descriptor',
)
const checkedMultisigAccountDescriptorSchema = z.custom<CheckedMultisigAccountDescriptor>(
  (value) => typeof value === 'string' && MultiSigAccount.fromDescriptor(value).isOk(),
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
  const now = new Date(row.created_at)
  const xpub = Xpub.fromString(row.xpub)
  if (xpub.isErr()) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stored keystore xpub is invalid' })
  }
  return {
    id: row.id,
    createdAt: now,
    updatedAt: now,
    wallet: row.wallet,
    derivationPath: row.derivation_path,
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
  const now = new Date(row.created_at)
  return {
    id: row.id,
    createdAt: now,
    updatedAt: now,
    isVerified: row.status === 'verified',
    officialName: '',
    displayName: row.display_name,
    network: networkToClaimNetwork(row.network),
    account: row.descriptor,
    status: row.status,
    isArchived: row.deleted_at !== null,
    keystores: keystores.map(keystoreRowToDto),
    latestChallenge: latestChallenge
      ? {
          id: latestChallenge.id,
          completed: latestChallenge.is_satisfied === 1,
          messages: signedMessages.map((sm) => ({
            signedMessageId: sm.id,
            keystoreId: sm.keystore_id,
            signed: sm.signature !== null,
          })),
        }
      : null,
    metadata: keystores[0]
      ? {
          walletInfo: {
            type: keystores[0].wallet ? hardwareWalletDisplayNames[keystores[0].wallet] : null,
            model: keystores[0].model,
          },
        }
      : null,
  }
}

function getFullClaimDto(db: Database.Database, accountId: string): ClaimDto | null {
  const row = db
    .prepare('SELECT id, network, descriptor, display_name, status, created_at, deleted_at FROM accounts WHERE id = ?')
    .get(accountId) as AccountRow | undefined
  if (!row) return null

  const keystores = db.prepare('SELECT * FROM keystores WHERE account_id = ?').all(row.id) as KeystoreRow[]
  const latestChallenge = db
    .prepare('SELECT * FROM challenges WHERE account_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(row.id) as ChallengeRow | undefined
  const signedMessages = latestChallenge
    ? (db.prepare('SELECT * FROM signed_messages WHERE challenge_id = ?').all(latestChallenge.id) as SignedMessageRow[])
    : []

  return buildClaimDto(row, keystores, latestChallenge ?? null, signedMessages)
}

function signedMessageRowToDto(row: SignedMessageRow): SignedMessageDto {
  return {
    version: 0,
    id: row.id,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.signed_at ?? row.created_at),
    address: row.address,
    messageTextToSign: getMessageTextToSign(row.id, row.message_text),
    signedAt: row.signed_at ? new Date(row.signed_at) : null,
    signature: row.signature,
  }
}

/** Generate the stable message format used by existing Control Center deployments. */
function getMessageTextToSign(id: string, text: string): string {
  const suffix = removeHosidPrefix(id as Hosid<'re_mesg'>)
  return text + ` ID=${suffix}`
}

function verifySignedMessageSignature(message: SignedMessageRow, signature: string): void {
  const address = Address.fromString(message.address)
  if (address.isErr()) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Stored signing address is invalid' })
  }

  const messageTextToSign = getMessageTextToSign(message.id, message.message_text)
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
  if (account instanceof MultiSigAccount) return account.threshold
  if (account instanceof SingleSigAccount) return 1
  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unsupported account type' })
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
    const rows = ctx.app.database.db
      .prepare('SELECT id, descriptor FROM accounts WHERE deleted_at IS NULL')
      .all() as Array<{
      id: string
      descriptor: string
    }>

    const accounts = new IndexSet<Account>()
    const idMap = new Map<string, string>() // descriptor → account id

    for (const row of rows) {
      const parsed = Account.fromDescriptor(row.descriptor)
      if (parsed.isOk()) {
        accounts.add(parsed.unwrap())
        idMap.set(row.descriptor, row.id)
      }
    }

    if (accounts.size === 0) return

    const balancesResult = await ctx.app.onchainProvider.getConfirmedAccountBalances(accounts)
    if (balancesResult.isErr()) return

    const now = new Date().toISOString()
    for (const [account, balance] of balancesResult.unwrap()) {
      const accountId = idMap.get(account.toString())
      if (accountId) {
        ctx.app.controlCenterService.recordAccountSnapshot(accountId, balance.toString(), now)
      }
    }
  }),
})

// ─── portalProve.registry ───────────────────────────────────────────────────

const registryRouter = t.router({
  claims: t.router({
    list: publicProcedure
      .input(z.object({ excludePending: z.boolean().optional() }).optional())
      .query(({ ctx, input }) => {
        const excludePending = input?.excludePending ?? false
        const sql = excludePending
          ? 'SELECT id, network, descriptor, display_name, status, created_at, deleted_at FROM accounts WHERE status != ? AND deleted_at IS NULL ORDER BY created_at DESC'
          : 'SELECT id, network, descriptor, display_name, status, created_at, deleted_at FROM accounts WHERE deleted_at IS NULL ORDER BY created_at DESC'
        const rows = (
          excludePending ? ctx.app.database.db.prepare(sql).all('pending') : ctx.app.database.db.prepare(sql).all()
        ) as AccountRow[]

        return rows.map((row) => {
          const keystores = ctx.app.database.db
            .prepare('SELECT * FROM keystores WHERE account_id = ?')
            .all(row.id) as KeystoreRow[]
          const latestChallenge = ctx.app.database.db
            .prepare('SELECT * FROM challenges WHERE account_id = ? ORDER BY created_at DESC LIMIT 1')
            .get(row.id) as ChallengeRow | undefined
          const signedMessages = latestChallenge
            ? (ctx.app.database.db
                .prepare('SELECT * FROM signed_messages WHERE challenge_id = ?')
                .all(latestChallenge.id) as SignedMessageRow[])
            : []
          return buildClaimDto(row, keystores, latestChallenge ?? null, signedMessages)
        })
      }),

    deletePending: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
      const db = ctx.app.database.db
      const row = db.prepare('SELECT status, deleted_at FROM accounts WHERE id = ?').get(input.id) as
        { status: string; deleted_at: string | null } | undefined
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
      if (row.status !== 'pending') throw new TRPCError({ code: 'BAD_REQUEST', message: 'Claim is not pending' })
      if (row.deleted_at !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Archived claims must be permanently deleted' })
      }
      db.prepare('DELETE FROM accounts WHERE id = ?').run(input.id)
    }),

    delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
      const db = ctx.app.database.db
      const row = db.prepare('SELECT deleted_at FROM accounts WHERE id = ?').get(input.id) as
        { deleted_at: string | null } | undefined
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
      if (row.deleted_at === null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only archived claims can be permanently deleted' })
      }
      db.prepare('DELETE FROM accounts WHERE id = ?').run(input.id)
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

    restore: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
      const result = ctx.app.controlCenterService.restoreAccount(input.id)
      if (result.isErr()) throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }),

    listArchived: publicProcedure.query(({ ctx }) => {
      const rows = ctx.app.database.db
        .prepare(
          'SELECT id, network, descriptor, display_name, status, created_at, deleted_at FROM accounts WHERE deleted_at IS NOT NULL ORDER BY created_at DESC',
        )
        .all() as AccountRow[]

      return rows.map((row) => {
        const keystores = ctx.app.database.db
          .prepare('SELECT * FROM keystores WHERE account_id = ?')
          .all(row.id) as KeystoreRow[]
        const latestChallenge = ctx.app.database.db
          .prepare('SELECT * FROM challenges WHERE account_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(row.id) as ChallengeRow | undefined
        const signedMessages = latestChallenge
          ? (ctx.app.database.db
              .prepare('SELECT * FROM signed_messages WHERE challenge_id = ?')
              .all(latestChallenge.id) as SignedMessageRow[])
          : []
        return buildClaimDto(row, keystores, latestChallenge ?? null, signedMessages)
      })
    }),

    getCountLimit: publicProcedure.query(() => {
      return null
    }),

    update: publicProcedure
      .input(z.object({ id: z.string(), displayName: z.string().min(1) }))
      .mutation(({ ctx, input }) => {
        const db = ctx.app.database.db
        const result = db.prepare('UPDATE accounts SET display_name = ? WHERE id = ?').run(input.displayName, input.id)
        if (result.changes === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
        }
        const row = db
          .prepare(
            'SELECT id, network, descriptor, display_name, status, created_at, deleted_at FROM accounts WHERE id = ?',
          )
          .get(input.id) as AccountRow
        return {
          id: row.id,
          displayName: row.display_name,
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
      .mutation(({ ctx, input }) => {
        const db = ctx.app.database.db
        const result = db.prepare('UPDATE keystores SET label = ? WHERE id = ?').run(input.label, input.id)
        if (result.changes === 0) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
        }
        if (input.wallet !== undefined) {
          db.prepare('UPDATE keystores SET wallet = ? WHERE id = ?').run(input.wallet, input.id)
        }
        if (input.model !== undefined) {
          db.prepare('UPDATE keystores SET model = ? WHERE id = ?').run(input.model, input.id)
        }
        const ks = db.prepare('SELECT * FROM keystores WHERE id = ?').get(input.id) as KeystoreRow
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
        .mutation(({ ctx, input }) => {
          const db = ctx.app.database.db
          const network = claimNetworkToNetwork(input.network)

          // Check if account already exists
          const existing = db
            .prepare('SELECT id FROM accounts WHERE descriptor = ? AND network = ?')
            .get(input.account, network) as { id: string } | undefined
          if (existing) {
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

          db.transaction(() => {
            db.prepare(
              'INSERT INTO accounts (id, network, descriptor, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(accountId, network, input.account, input.displayName, 'pending', now)

            db.prepare(
              'INSERT INTO keystores (id, account_id, label, wallet, model, derivation_path, xpub, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ).run(
              keystoreId,
              accountId,
              input.keystore.label,
              input.keystore.wallet,
              input.keystore.model,
              input.keystore.derivationPath,
              xpub,
              now,
            )
          })()

          const claim = getFullClaimDto(db, accountId)
          if (!claim) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Claim not found after creation' })
          }
          return {
            claim,
            keystores: [
              keystoreRowToDto({
                id: keystoreId,
                account_id: accountId,
                label: input.keystore.label,
                wallet: input.keystore.wallet,
                model: input.keystore.model,
                derivation_path: input.keystore.derivationPath,
                xpub,
                created_at: now,
              }),
            ],
          }
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
        .mutation(({ ctx, input }) => {
          const db = ctx.app.database.db
          const network = claimNetworkToNetwork(input.network)

          const existing = db
            .prepare('SELECT id FROM accounts WHERE descriptor = ? AND network = ?')
            .get(input.account, network) as { id: string } | undefined
          if (existing) {
            throw new TRPCError({ code: 'CONFLICT', message: 'Account already exists' })
          }

          const parsed = MultiSigAccount.fromDescriptor(input.account)
          if (parsed.isErr()) {
            throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid multisig account descriptor' })
          }

          const accountId = hosid('re_clmx')
          const now = new Date().toISOString()

          const keystoreRows: KeystoreRow[] = []

          db.transaction(() => {
            db.prepare(
              'INSERT INTO accounts (id, network, descriptor, display_name, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            ).run(accountId, network, input.account, input.displayName, 'pending', now)

            for (const ks of input.keystores) {
              const keystoreId = hosid('re_ks')
              db.prepare(
                'INSERT INTO keystores (id, account_id, label, wallet, model, derivation_path, xpub, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              ).run(keystoreId, accountId, ks.label, ks.wallet, ks.model, ks.derivationPath, ks.publicKey, now)
              keystoreRows.push({
                id: keystoreId,
                account_id: accountId,
                label: ks.label,
                wallet: ks.wallet,
                model: ks.model,
                derivation_path: ks.derivationPath,
                xpub: ks.publicKey,
                created_at: now,
              })
            }
          })()

          const claim = getFullClaimDto(db, accountId)
          if (!claim) {
            throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Claim not found after creation' })
          }
          return {
            claim,
            keystores: keystoreRows.map(keystoreRowToDto),
          }
        }),
    }),

    get: t.router({
      byId: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
        const claim = getFullClaimDto(ctx.app.database.db, input.id)
        if (!claim) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
        }
        return claim
      }),

      byAccount: publicProcedure
        .input(z.object({ network: z.string(), account: z.string() }))
        .query(({ ctx, input }) => {
          const network = claimNetworkToNetwork(input.network)
          const row = ctx.app.database.db
            .prepare('SELECT id FROM accounts WHERE descriptor = ? AND network = ?')
            .get(input.account, network) as { id: string } | undefined
          if (!row) {
            throw new TRPCError({ code: 'NOT_FOUND', message: 'Claim not found' })
          }
          const claim = getFullClaimDto(ctx.app.database.db, row.id)
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
      .mutation(({ ctx, input }) => {
        const db = ctx.app.database.db

        // Check the account exists
        const accountRow = db.prepare('SELECT id FROM accounts WHERE id = ?').get(input.claimId) as
          { id: string } | undefined
        if (!accountRow) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
        }

        // Return existing incomplete challenge if one exists
        const existing = db
          .prepare(
            'SELECT * FROM challenges WHERE account_id = ? AND is_satisfied = 0 ORDER BY created_at DESC LIMIT 1',
          )
          .get(input.claimId) as ChallengeRow | undefined
        if (existing) {
          return {
            id: existing.id,
            claimId: existing.account_id,
            variant: 'signed_message' as const,
            isSatisfied: false,
            createdAt: new Date(existing.created_at),
            updatedAt: new Date(existing.created_at),
            completedAt: null,
          }
        }

        const challengeId = hosid('re_chal')
        const now = new Date().toISOString()
        db.prepare('INSERT INTO challenges (id, account_id, created_at) VALUES (?, ?, ?)').run(
          challengeId,
          input.claimId,
          now,
        )

        return {
          id: challengeId,
          claimId: input.claimId,
          variant: 'signed_message' as const,
          isSatisfied: false,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          completedAt: null,
        }
      }),

    complete: publicProcedure.input(z.object({ challengeId: z.string() })).mutation(({ ctx, input }) => {
      const db = ctx.app.database.db
      const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(input.challengeId) as
        ChallengeRow | undefined
      if (!challenge) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Challenge not found' })
      }
      if (challenge.is_satisfied === 1 || challenge.completed_at !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge already completed' })
      }

      const accountRow = db.prepare('SELECT descriptor FROM accounts WHERE id = ?').get(challenge.account_id) as
        { descriptor: string } | undefined
      if (!accountRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
      }

      const account = Account.fromDescriptor(accountRow.descriptor)
      if (account.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse account descriptor' })
      }

      const signedMessages = db
        .prepare('SELECT * FROM signed_messages WHERE challenge_id = ?')
        .all(input.challengeId) as SignedMessageRow[]

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
      const signedKeystoreIds = new Set(completedMessages.map((message) => message.keystore_id))
      if (signedKeystoreIds.size < requiredSignatures) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge is not satisfied' })
      }

      for (const message of completedMessages) {
        verifySignedMessageSignature(message, message.signature)
      }

      const now = new Date().toISOString()
      db.transaction(() => {
        const accountResult = db
          .prepare('UPDATE accounts SET status = ? WHERE id = ? AND deleted_at IS NULL')
          .run('verified', challenge.account_id)
        if (accountResult.changes === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Archived claims cannot complete verification' })
        }

        const challengeResult = db
          .prepare('UPDATE challenges SET is_satisfied = 1, completed_at = ? WHERE id = ? AND is_satisfied = 0')
          .run(now, input.challengeId)
        if (challengeResult.changes === 0) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Challenge already completed' })
        }
      })()

      return {
        id: challenge.id,
        claimId: challenge.account_id,
        variant: 'signed_message' as const,
        isSatisfied: true,
        createdAt: new Date(challenge.created_at),
        updatedAt: new Date(now),
        completedAt: new Date(now),
      }
    }),
  }),

  challengeMessages: t.router({
    create: publicProcedure
      .input(z.object({ challengeId: z.string(), keystoreId: z.string() }))
      .mutation(({ ctx, input }): ChallengeMessageDto => {
        const db = ctx.app.database.db

        const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(input.challengeId) as
          ChallengeRow | undefined
        if (!challenge) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Challenge not found' })
        }

        // Check if a signed message already exists for this keystore+challenge
        const existingSm = db
          .prepare('SELECT * FROM signed_messages WHERE challenge_id = ? AND keystore_id = ? LIMIT 1')
          .get(input.challengeId, input.keystoreId) as SignedMessageRow | undefined
        if (existingSm) {
          return {
            signedMessage: signedMessageRowToDto(existingSm),
            challengeId: existingSm.challenge_id,
            keystoreId: existingSm.keystore_id,
          }
        }

        const keystore = db.prepare('SELECT * FROM keystores WHERE id = ?').get(input.keystoreId) as
          KeystoreRow | undefined
        if (!keystore) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
        }

        // Derive address from keystore xpub for signing (use p2wpkh like singlesig flow)
        const xpubResult = Xpub.fromString(keystore.xpub)
        if (xpubResult.isErr()) {
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse keystore xpub' })
        }
        const singleSig = new SingleSigAccount('p2wpkh', xpubResult.unwrap())
        const address = singleSig.receiveAddress(0, Network.Mainnet).toString()

        // Build message text
        const identifierRow = db.prepare("SELECT value FROM settings WHERE key = 'owner_identifier'").get() as
          { value: string } | undefined
        const identifier = identifierRow?.value ?? 'the owner'
        const messageText = `I, ${identifier}, affirm sole control of this account. No other third-party claims/access permitted. Ownership revocable solely by me.`

        const signedMessageId = hosid('re_mesg')
        const now = new Date().toISOString()

        db.prepare(
          'INSERT INTO signed_messages (id, challenge_id, keystore_id, address, message_text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(signedMessageId, input.challengeId, input.keystoreId, address, messageText, now)

        return {
          signedMessage: {
            version: 0 as const,
            id: signedMessageId,
            createdAt: new Date(now),
            updatedAt: new Date(now),
            address,
            messageTextToSign: getMessageTextToSign(signedMessageId, messageText),
            signedAt: null,
            signature: null,
          },
          challengeId: challenge.id,
          keystoreId: keystore.id,
        }
      }),

    get: publicProcedure
      .input(z.object({ signedMessageId: z.string() }))
      .query(({ ctx, input }): ChallengeMessageDto => {
        const sm = ctx.app.database.db
          .prepare('SELECT * FROM signed_messages WHERE id = ?')
          .get(input.signedMessageId) as SignedMessageRow | undefined
        if (!sm) throw new TRPCError({ code: 'NOT_FOUND', message: 'Signed message not found' })
        return {
          signedMessage: signedMessageRowToDto(sm),
          challengeId: sm.challenge_id,
          keystoreId: sm.keystore_id,
        }
      }),

    list: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(({ ctx, input }): ChallengeMessageDto[] => {
        const messages = ctx.app.database.db
          .prepare('SELECT * FROM signed_messages WHERE challenge_id = ?')
          .all(input.challengeId) as SignedMessageRow[]
        return messages.map((sm) => ({
          signedMessage: signedMessageRowToDto(sm),
          challengeId: sm.challenge_id,
          keystoreId: sm.keystore_id,
        }))
      }),

    complete: publicProcedure
      .input(z.object({ signedMessageId: z.string(), signature: z.string().trim().min(1).max(4096) }))
      .mutation(({ ctx, input }): ChallengeMessageDto => {
        const db = ctx.app.database.db
        const sm = db.prepare('SELECT * FROM signed_messages WHERE id = ?').get(input.signedMessageId) as
          SignedMessageRow | undefined
        if (!sm) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Signed message not found' })
        }
        if (sm.signature !== null) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Signed message already completed' })
        }

        verifySignedMessageSignature(sm, input.signature)

        const now = new Date().toISOString()
        db.prepare('UPDATE signed_messages SET signature = ?, signed_at = ? WHERE id = ?').run(
          input.signature,
          now,
          input.signedMessageId,
        )

        return {
          signedMessage: {
            version: 0 as const,
            id: sm.id,
            createdAt: new Date(sm.created_at),
            updatedAt: new Date(now),
            address: sm.address,
            messageTextToSign: getMessageTextToSign(sm.id, sm.message_text),
            signedAt: new Date(now),
            signature: input.signature,
          },
          challengeId: sm.challenge_id,
          keystoreId: sm.keystore_id,
        }
      }),
  }),

  getOrCreateSinglesigChallengeMessage: publicProcedure
    .input(z.object({ network: z.string(), account: z.string() }))
    .query(({ ctx, input }) => {
      const db = ctx.app.database.db
      const network = claimNetworkToNetwork(input.network)

      // Find the account
      const accountRow = db
        .prepare('SELECT id, descriptor FROM accounts WHERE descriptor = ? AND network = ?')
        .get(input.account, network) as { id: string; descriptor: string } | undefined
      if (!accountRow) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Account not found' })
      }

      // Find or create keystore
      const keystore = db.prepare('SELECT * FROM keystores WHERE account_id = ? LIMIT 1').get(accountRow.id) as
        KeystoreRow | undefined
      if (!keystore) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Keystore not found' })
      }

      // Check for existing unsigned challenge
      const existingChallenge = db
        .prepare('SELECT * FROM challenges WHERE account_id = ? AND is_satisfied = 0 ORDER BY created_at DESC LIMIT 1')
        .get(accountRow.id) as ChallengeRow | undefined

      if (existingChallenge) {
        const existingSm = db
          .prepare('SELECT * FROM signed_messages WHERE challenge_id = ? AND keystore_id = ? LIMIT 1')
          .get(existingChallenge.id, keystore.id) as SignedMessageRow | undefined

        if (existingSm) {
          return {
            challenge: {
              id: existingChallenge.id,
              claimId: existingChallenge.account_id,
              variant: 'signed_message' as const,
              isSatisfied: false,
              createdAt: new Date(existingChallenge.created_at),
              updatedAt: new Date(existingChallenge.created_at),
              completedAt: null,
            },
            challengeMessage: {
              signedMessage: {
                version: 0 as const,
                id: existingSm.id,
                createdAt: new Date(existingSm.created_at),
                updatedAt: new Date(existingSm.created_at),
                address: existingSm.address,
                messageTextToSign: getMessageTextToSign(existingSm.id, existingSm.message_text),
                signedAt: null,
                signature: null,
              },
              challengeId: existingChallenge.id,
              keystoreId: keystore.id,
            },
          }
        }
      }

      // Derive address from account for signing
      const parsed = SingleSigAccount.fromDescriptor(accountRow.descriptor)
      if (parsed.isErr()) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to parse account descriptor' })
      }
      const btcNetwork = network === 'testnet' ? Network.Testnet : Network.Mainnet
      const address = parsed.unwrap().receiveAddress(0, btcNetwork).toString()

      // Create challenge and signed message
      const challengeId = hosid('re_chal')
      const signedMessageId = hosid('re_mesg')
      // Keep the established message format, using the configured owner identifier when available.
      const identifierRow = db.prepare("SELECT value FROM settings WHERE key = 'owner_identifier'").get() as
        { value: string } | undefined
      const identifier = identifierRow?.value ?? 'the owner'
      const messageText = `I, ${identifier}, affirm sole control of this account. No other third-party claims/access permitted. Ownership revocable solely by me.`
      const now = new Date().toISOString()

      db.transaction(() => {
        db.prepare('INSERT INTO challenges (id, account_id, created_at) VALUES (?, ?, ?)').run(
          challengeId,
          accountRow.id,
          now,
        )
        db.prepare(
          'INSERT INTO signed_messages (id, challenge_id, keystore_id, address, message_text, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        ).run(signedMessageId, challengeId, keystore.id, address, messageText, now)
      })()

      return {
        challenge: {
          id: challengeId,
          claimId: accountRow.id,
          variant: 'signed_message' as const,
          isSatisfied: false,
          createdAt: new Date(now),
          updatedAt: new Date(now),
          completedAt: null,
        },
        challengeMessage: {
          signedMessage: {
            version: 0 as const,
            id: signedMessageId,
            createdAt: new Date(now),
            updatedAt: new Date(now),
            address,
            messageTextToSign: getMessageTextToSign(signedMessageId, messageText),
            signedAt: null,
            signature: null,
          },
          challengeId,
          keystoreId: keystore.id,
        },
      }
    }),
})

// ─── portalProve.exchange ───────────────────────────────────────────────────

const proveExchangeRouter = t.router({
  list: publicProcedure.query(({ ctx }) => {
    const accounts = ctx.app.exchangeService.listAccounts()
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

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(({ ctx, input }) => {
    const result = ctx.app.exchangeService.removeAccount(input.accountId)
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

    list: publicProcedure.query(({ ctx }) => {
      const accounts = ctx.app.exchangeService.listAccounts('coinbase')
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

    list: publicProcedure.query(({ ctx }) => {
      const accounts = ctx.app.exchangeService.listAccounts('strike')
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
      .mutation(({ ctx, input }) => {
        const result = ctx.app.exchangeService.importStatementTransactions(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    listStatementTransactions: publicProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string().optional() }))
      .query(({ ctx, input }) => {
        return ctx.app.exchangeService.listStatementTransactions(input.accountId, input.statementMonth)
      }),

    listStatementMonths: publicProcedure.input(z.object({ accountId: z.string() })).query(({ ctx, input }) => {
      return ctx.app.exchangeService.listStatementMonths(input.accountId)
    }),

    deleteStatementMonth: publicProcedure
      .input(z.object({ accountId: z.string(), statementMonth: z.string() }))
      .mutation(({ ctx, input }) => {
        const deleted = ctx.app.exchangeService.deleteStatementMonth(input.accountId, input.statementMonth)
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

    list: publicProcedure.query(({ ctx }) => {
      const accounts = ctx.app.exchangeService.listAccounts('robinhood')
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

    list: publicProcedure.query(({ ctx }) => {
      const accounts = ctx.app.exchangeService.listAccounts('kraken')
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
          const row = ctx.app.database.db
            .prepare(
              `SELECT id, deleted_at
               FROM accounts
               WHERE descriptor = ? AND network = ?
               ORDER BY deleted_at IS NULL DESC, created_at DESC
               LIMIT 1`,
            )
            .get(na.account.toString(), claimNetworkToNetwork(na.network.toString())) as
            { id: string; deleted_at: string | null } | undefined

          if (row?.deleted_at) {
            const snapshot = ctx.app.database.db
              .prepare(
                `SELECT balance_sats
                 FROM balance_snapshots
                 WHERE account_id = ? AND timestamp <= ?
                 ORDER BY timestamp DESC
                 LIMIT 1`,
              )
              .get(row.id, row.deleted_at) as { balance_sats: string } | undefined
            archivedAccounts.add(key)
            archivedBalances.set(key, BigInt(snapshot?.balance_sats ?? '0'))
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

    const accounts = new IndexSet<Account>()
    const idToAccount = new Map<string, Account>()

    // Resolve account IDs to Account objects
    for (const claimId of input.claimIds) {
      const row = ctx.app.database.db
        .prepare('SELECT descriptor FROM accounts WHERE id = ? AND deleted_at IS NULL')
        .get(claimId) as { descriptor: string } | undefined
      if (!row) continue

      const parsed = Account.fromDescriptor(row.descriptor)
      if (parsed.isOk()) {
        const account = parsed.unwrap()
        accounts.add(account)
        idToAccount.set(claimId, account)
      }
    }

    if (accounts.size === 0) return balanceMap

    const result = await ctx.app.onchainProvider.getConfirmedAccountBalances(accounts)
    if (result.isErr()) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: result.unwrapErr().message })
    }

    const accountBalances = result.unwrap()
    for (const [claimId, account] of idToAccount) {
      const activeClaim = ctx.app.database.db
        .prepare('SELECT 1 AS one FROM accounts WHERE id = ? AND deleted_at IS NULL')
        .get(claimId)
      if (!activeClaim) continue

      const balance = accountBalances.get(account) ?? 0n
      balanceMap.set(claimId, new Decimal(balance.toString()))
    }

    return balanceMap
  }),
})

// ─── portalProve.statement ───────────────────────────────────────────────────

const statementRouter = t.router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.app.statementService.list()
  }),

  initiateGeneration: publicProcedure
    .input(
      z.object({
        claimIds: z.array(z.string()),
        exchangeAccountIds: z.array(z.string()).optional(),
        openingDate: z.date(),
        closingDate: z.date(),
        timezone: z.string(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const logger = ctx.app.logger.child({ module: 'statement-generation' })
      logger.info(
        { claimIds: input.claimIds, openingDate: input.openingDate, closingDate: input.closingDate },
        'Starting statement generation',
      )

      const statementId = ctx.app.statementService.create(input)
      logger.info({ statementId }, 'Created pending statement')

      // Fire-and-forget: generate data in background so the client gets the pending DTO immediately
      void (async () => {
        try {
          const dataResult = await ctx.app.statementService.generateStatementData(input)
          if (dataResult.isErr()) {
            const errMsg = dataResult.unwrapErr().message
            logger.error({ statementId, error: errMsg }, 'Statement data generation failed')
            ctx.app.statementService.fail(statementId)
            return
          }

          const { transactionMap, dailyRates } = dataResult.unwrap()
          const txCount = Object.values(transactionMap).reduce((sum, txs) => sum + txs.length, 0)
          logger.info(
            {
              statementId,
              accounts: Object.keys(transactionMap).length,
              transactions: txCount,
              ratesDays: Object.keys(dailyRates.rates).length,
            },
            'Statement data generated, completing',
          )

          ctx.app.statementService.complete(statementId, transactionMap, dailyRates)
          logger.info({ statementId }, 'Statement generation completed')
        } catch (err) {
          ctx.app.statementService.fail(statementId)
          const message = err instanceof Error ? err.message : 'Statement generation failed'
          logger.error(
            { statementId, error: message, stack: err instanceof Error ? err.stack : undefined },
            'Unhandled error in statement generation',
          )
        }
      })()

      // Return the pending statement immediately
      const dto = ctx.app.statementService.findById(statementId)
      if (!dto) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Statement not found after creation' })
      }
      return dto
    }),

  retrieve: publicProcedure.input(z.string()).query(({ ctx, input: statementId }) => {
    const dto = ctx.app.statementService.findById(statementId)
    if (!dto) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Statement not found' })
    }
    return dto
  }),

  retrieveDocumentData: publicProcedure
    .input(z.object({ statementId: z.string(), format: z.enum(['custom', 'monthly']) }))
    .query(({ ctx, input }) => {
      const loaded = ctx.app.statementService.loadCompleted(input.statementId)
      if (!loaded) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Completed statement not found' })
      }

      const mapper = new StatementMapper()
      const pdfResult = mapper.toPdfStatement(
        {
          id: loaded.row.id,
          createdAt: new Date(loaded.row.created_at),
          status: 'completed',
          counter: loaded.row.counter,
          timezone: loaded.row.timezone,
          openingDate: new Date(loaded.row.opening_date),
          closingDate: new Date(loaded.row.closing_date),
          user: { email: null, name: loaded.row.user_name, address: loaded.row.user_address },
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
      const dataResult = await ctx.app.statementService.generateStatementData({
        claimIds: input.claimIds,
        exchangeAccountIds: input.exchangeAccountIds,
        openingDate: input.openingDate,
        closingDate: input.closingDate,
        timezone: input.timezone,
        name: input.name,
        address: input.address,
      })

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
  list: publicProcedure.query(({ ctx }) => {
    return ctx.app.manualService.listAccounts().map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      balanceAsOf: a.balanceAsOf,
      createdAt: a.createdAt,
    }))
  }),

  get: publicProcedure.input(z.object({ accountId: z.string() })).query(({ ctx, input }) => {
    const account = ctx.app.manualService.getAccount(input.accountId)
    if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'Manual account not found' })
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
    .mutation(({ ctx, input }) => {
      const result = ctx.app.manualService.createAccount(input)
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
    .mutation(({ ctx, input }) => {
      const result = ctx.app.manualService.updateBalance(input)
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
    .mutation(({ ctx, input }) => {
      const result = ctx.app.manualService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(({ ctx, input }) => {
    const result = ctx.app.manualService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  transactions: t.router({
    list: publicProcedure.input(z.object({ accountId: z.string() })).query(({ ctx, input }) => {
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
      .mutation(({ ctx, input }) => {
        const result = ctx.app.manualService.addTransaction(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    delete: publicProcedure.input(z.object({ transactionId: z.string() })).mutation(({ ctx, input }) => {
      const result = ctx.app.manualService.deleteTransaction(input.transactionId)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),
  }),
})

// ─── portalProve.etf ────────────────────────────────────────────────────────

const etfRouter = t.router({
  list: publicProcedure.query(({ ctx }) => {
    return ctx.app.etfService.listAccounts().map((a) => ({
      id: a.id,
      displayName: a.displayName,
      currency: 'BTC' as const,
      balance: a.balanceSats,
      createdAt: a.createdAt,
    }))
  }),

  get: publicProcedure.input(z.object({ accountId: z.string() })).query(({ ctx, input }) => {
    const account = ctx.app.etfService.getAccount(input.accountId)
    if (!account) throw new TRPCError({ code: 'NOT_FOUND', message: 'ETF account not found' })
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
    .mutation(({ ctx, input }) => {
      const result = ctx.app.etfService.createAccount({
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
    .mutation(({ ctx, input }) => {
      const result = ctx.app.etfService.renameAccount(input)
      if (result.isErr()) {
        throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
      }
    }),

  delete: publicProcedure.input(z.object({ accountId: z.string() })).mutation(({ ctx, input }) => {
    const result = ctx.app.etfService.removeAccount(input.accountId)
    if (result.isErr()) {
      throw new TRPCError({ code: 'NOT_FOUND', message: result.unwrapErr().message })
    }
  }),

  holdings: t.router({
    list: publicProcedure.input(z.object({ accountId: z.string() })).query(({ ctx, input }) => {
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
      .mutation(({ ctx, input }) => {
        const result = ctx.app.etfService.addHolding(input)
        if (result.isErr()) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
        }
        return result.unwrap()
      }),

    remove: publicProcedure.input(z.object({ holdingId: z.string() })).mutation(({ ctx, input }) => {
      const result = ctx.app.etfService.removeHolding(input.holdingId)
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
      .mutation(({ ctx, input }) => {
        const duplicate = ctx.app.database.db
          .prepare('SELECT 1 AS one FROM accounts WHERE descriptor = ? AND network = ? LIMIT 1')
          .get(input.descriptor, input.network)
        if (duplicate) {
          throw new TRPCError({ code: 'CONFLICT', message: 'An account with this descriptor already exists' })
        }

        const id = nanoid()
        ctx.app.database.db
          .prepare('INSERT INTO accounts (id, network, descriptor, display_name) VALUES (?, ?, ?, ?)')
          .run(id, input.network, input.descriptor, input.displayName)

        return { id, network: input.network, descriptor: input.descriptor, displayName: input.displayName }
      }),

    remove: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
      const result = ctx.app.database.db.prepare('DELETE FROM accounts WHERE id = ?').run(input.id)
      if (result.changes === 0) {
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
  'sidebar_compact',
  'statements_banner_dismissed',
])

// Connection settings must be validated, connected and saved together through
// reconnectElectrum; individual writes could make the next launch unusable.
const WRITABLE_SETTINGS = new Set(['user_name', 'owner_identifier', 'sidebar_compact', 'statements_banner_dismissed'])

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
  if (!host.startsWith('[') && !host.endsWith(']')) return host
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
  if (!/^[a-z0-9.-]+$/.test(host)) return false

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
    case 'sidebar_compact':
    case 'statements_banner_dismissed': {
      if (value !== 'true' && value !== 'false') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Setting value must be true or false' })
      }
      return value
    }
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

const connectionDetailsInput = z.object({
  host: z.string(),
  port: z.number().int().min(1).max(65_535),
  protocol: z.enum(['tcp', 'ssl']),
  torEnabled: z.boolean().default(false),
})
const profileReferenceInput = z.object({ id: z.string().uuid(), revision: z.number().int().positive() })
const nicknameInput = z
  .string()
  .trim()
  .min(1, 'Enter a nickname')
  .max(80, 'Use 80 characters or fewer for the nickname')

function profileDetails(input: z.infer<typeof connectionDetailsInput>): z.infer<typeof connectionDetailsInput> {
  const connection = validateElectrumConnection(input)
  if (connection.host.endsWith('.onion') && !input.torEnabled)
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Onion addresses require Tor' })
  return { ...connection, torEnabled: input.torEnabled }
}

const desktopConnectionProcedure = publicProcedure.use(({ ctx, next }) => {
  if (!ctx.app.connectionProfiles)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Saved connections are only available in desktop mode' })
  return next({ ctx: { ...ctx, profiles: ctx.app.connectionProfiles } })
})

const connectionProfilesRouter = t.router({
  list: desktopConnectionProcedure.query(({ ctx }) => ({
    profiles: ctx.profiles.list(),
    activeId: ctx.profiles.getActiveId(),
    limit: MAX_CONNECTION_PROFILES,
    status: {
      ...ctx.app.electrumConfig,
      connected: ctx.app.electrumClient.isConnected(),
      tor: ctx.app.getTorStatus(),
    },
  })),
  create: desktopConnectionProcedure
    .input(connectionDetailsInput.extend({ nickname: nicknameInput }))
    .mutation(({ ctx, input }) => {
      const result = ctx.profiles.create({ ...profileDetails(input), nickname: input.nickname })
      if (result.isErr()) throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      return result.unwrap()
    }),
  rename: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ nickname: nicknameInput }))
    .mutation(({ ctx, input }) => {
      const result = ctx.profiles.rename(input, input.nickname)
      if (result.isErr()) throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
      return result.unwrap()
    }),
  delete: desktopConnectionProcedure.input(profileReferenceInput).mutation(({ ctx, input }) => {
    const result = ctx.profiles.delete(input)
    if (result.isErr()) throw new TRPCError({ code: 'CONFLICT', message: result.unwrapErr().message })
    return { id: input.id }
  }),
  connect: desktopConnectionProcedure
    .input(profileReferenceInput.extend({ connection: connectionDetailsInput.optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.app.connectProfile(
        input,
        input.connection ? profileDetails(input.connection) : undefined,
      )
      if (result.isErr()) throw new TRPCError({ code: 'BAD_REQUEST', message: result.unwrapErr().message })
      const connected = ctx.profiles.list().find((profile) => profile.id === input.id)
      if (!connected) throw new TRPCError({ code: 'NOT_FOUND', message: 'Saved connection not found' })
      return connected
    }),
})

const settingsRouter = t.router({
  connectionProfiles: connectionProfilesRouter,
  get: publicProcedure.input(z.object({ key: z.string() })).query(({ ctx, input }) => {
    if (!isReadableSetting(input.key)) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Setting is not readable' })
    }

    const row = ctx.app.database.db.prepare('SELECT value FROM settings WHERE key = ?').get(input.key) as
      { value: string } | undefined
    return row?.value ?? null
  }),

  update: publicProcedure.input(z.object({ key: z.string(), value: z.string() })).mutation(({ ctx, input }) => {
    const value = validateWritableSetting(input.key, input.value)
    ctx.app.database.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(input.key, value)
  }),

  electrumStatus: publicProcedure.query(({ ctx }) => {
    const { host, port, protocol } = ctx.app.electrumConfig
    return {
      connected: ctx.app.electrumClient.isConnected(),
      host,
      port,
      protocol,
      tor: ctx.app.getTorStatus(),
    }
  }),

  testElectrum: publicProcedure
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
      if (prepared.isErr()) throw new Error(prepared.unwrapErr().message)
      const config = prepared.unwrap()
      const { ElectrumClient } = await import('@hoseki/packages/clients/electrum')
      const testClient = new ElectrumClient({
        ...config,
        requestTimeout: 15_000,
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
      if (prepared.isErr()) throw new Error(prepared.unwrapErr().message)
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
