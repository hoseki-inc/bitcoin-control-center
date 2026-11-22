import {
  type CheckedAccountDescriptor,
  type CheckedMultisigAccountDescriptor,
  type CheckedSinglesigAccountDescriptor,
  MultiSigAccount,
  SingleSigAccount,
} from '@hoseki/packages/bitcoin/account'
import { DerivationPathString } from '@hoseki/packages/bitcoin/derivation-path'
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
} from '@hoseki/packages/schemas'
import type { SupportedHardwareWallet, SupportedHardwareWalletDisplayName } from '@hoseki/packages/wallet'
import { TRPCError } from '@trpc/server'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { SentinelDb, SentinelTx } from '../../db/drizzle'
import {
  accounts as accountTable,
  challenges,
  keystores as keystoreTable,
  signedMessages as signedMessagesTable,
} from '../../db/schema'
import { parseDbTimestamp } from '../../db/timestamp'

type AccountRow = typeof accountTable.$inferSelect
type KeystoreRow = typeof keystoreTable.$inferSelect
type ChallengeRow = typeof challenges.$inferSelect
type SignedMessageRow = typeof signedMessagesTable.$inferSelect

export interface KeystoreDto {
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

export interface ClaimDto {
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

export const supportedHardwareWalletSchema = z.enum(['trezor', 'coldcard', 'ledger', 'keystone', 'bitkey'])
const privateKeyMessage = 'Use extended public keys (xpub), not private keys'

function descriptorIssue(descriptor: string, invalidMessage: string) {
  return { message: containsExtendedPrivateKey(descriptor) ? privateKeyMessage : invalidMessage }
}

export const checkedSinglesigAccountDescriptorSchema = z.custom<CheckedSinglesigAccountDescriptor>(
  (value): value is CheckedSinglesigAccountDescriptor =>
    // The parser reads only the first key, so also reject private keys elsewhere in the descriptor.
    typeof value === 'string' && !containsExtendedPrivateKey(value) && SingleSigAccount.fromDescriptor(value).isOk(),
  { error: (issue) => descriptorIssue(String(issue.input), 'Invalid singlesig account descriptor') },
)
export const checkedMultisigAccountDescriptorSchema = z.custom<CheckedMultisigAccountDescriptor>(
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

export function keystoreRowToDto(row: KeystoreRow): KeystoreDto {
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

export async function getFullClaimDto(db: SentinelDb | SentinelTx, accountId: string): Promise<ClaimDto | null> {
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

export function validateMultisigKeystores(account: MultiSigAccount, publicKeys: string[]): void {
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
