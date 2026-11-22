import { MultiSigAccount, SingleSigAccount } from '@hoseki/packages/bitcoin/account'
import { DerivationPathString } from '@hoseki/packages/bitcoin/derivation-path'
import { hosid } from '@hoseki/packages/schemas'
import { bitkeyKeyLabels, parseBitkeyExport } from '@hoseki/packages/wallet'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppContext } from '../../context'
import { accounts as accountTable, keystores as keystoreTable } from '../../db/schema'
import { claimNetworkToNetwork } from '../../lib/claim-network'
import { protectedProcedure, router } from '../../modules/trpc/init'
import { type ArchiveDeps, archiveAccount, restoreAccount } from './archive'
import {
  type ClaimDto,
  checkedMultisigAccountDescriptorSchema,
  checkedSinglesigAccountDescriptorSchema,
  getFullClaimDto,
  keystoreRowToDto,
  supportedHardwareWalletSchema,
  validateMultisigKeystores,
} from './claims'

function archiveDeps(app: AppContext): ArchiveDeps {
  return { db: app.database, portfolio: app.controlCenterService, walletBalances: app.walletBalanceService }
}

export const accountsRouter = router({
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
    const result = await archiveAccount(archiveDeps(ctx.app), input.id)
    if (result.isErr()) {
      const error = result.unwrapErr()
      throw new TRPCError({
        code: error.message === 'Claim not found or already archived' ? 'NOT_FOUND' : 'INTERNAL_SERVER_ERROR',
        message: error.message,
      })
    }
  }),

  restore: protectedProcedure.input(z.object({ id: z.string() })).mutation(async ({ ctx, input }) => {
    const result = await restoreAccount(archiveDeps(ctx.app), input.id)
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
})
