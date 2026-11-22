import { Account, MultiSigAccount, SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { Address, type CheckedAddressString } from '@hoseki/packages/bitcoin/address'
import { Network } from '@hoseki/packages/bitcoin/network'
import { Xpub } from '@hoseki/packages/bitcoin/xpub'
import { parseUnknown } from '@hoseki/packages/result'
import {
  type ChallengeId,
  ChallengeIdSchema,
  type KeystoreId,
  KeystoreIdSchema,
  type SignedMessageId,
  SignedMessageIdSchema,
  hosid,
} from '@hoseki/packages/schemas'
import { TRPCError } from '@trpc/server'
import * as bip322 from 'bip322-js'
import { and, desc, eq, isNull } from 'drizzle-orm'
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
import { authRouter } from '../auth/router'
import { protectedProcedure, router } from './init'

// ─── Helpers ────────────────────────────────────────────────────────────────

type SignedMessageRow = typeof signedMessagesTable.$inferSelect

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

// ─── portalProve.registry ───────────────────────────────────────────────────

const registryRouter = router({
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

const portalProveRouter = router({
  registry: registryRouter,
  ...featureRouters,
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
