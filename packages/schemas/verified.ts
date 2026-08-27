import { z } from 'zod'
import { Network } from '../bitcoin'
import { bitcoinAddressString, bitcoinNetwork } from './bitcoin'
import { decimal } from './decimal'
import { createHosidSchema } from './hosid'
import { PersistentReferenceIdSchema } from './persistent-reference-id'
import { SlugSchema } from './slug'

export const institutionIdPrefix = 'v_inst' as const
export const InstitutionIdSchema = createHosidSchema(institutionIdPrefix)
export type InstitutionId = z.infer<typeof InstitutionIdSchema>

export const custodianIdPrefix = 'v_cust' as const
export const CustodianIdSchema = createHosidSchema(custodianIdPrefix)
export type CustodianId = z.infer<typeof CustodianIdSchema>

export const verifiedAccountIdPrefix = 'v_acc' as const
export const VerifiedAccountIdSchema = createHosidSchema(verifiedAccountIdPrefix)
export type VerifiedAccountId = z.infer<typeof VerifiedAccountIdSchema>

export const ReportedBitcoinIdSchema = createHosidSchema('v_rep_btc')
export type ReportedBitcoinId = z.infer<typeof ReportedBitcoinIdSchema>

export const ReportedBitcoinLinkIdSchema = createHosidSchema('v_rep_btc_link')
export type ReportedBitcoinLinkId = z.infer<typeof ReportedBitcoinLinkIdSchema>

export const AddressTypeSchema = z.enum(['Legacy', 'Script', 'SegWit', 'Taproot'])
export type AddressType = z.infer<typeof AddressTypeSchema>

const InstitutionTypeSchema = z.enum(['etf', 'public_company', 'private_company', 'other'])
export type InstitutionType = z.infer<typeof InstitutionTypeSchema>

export const VerificationStatusSchema = z.enum(['unverified', 'under_review', 'bad_standing', 'good_standing'])
export const CreateInstitutionArgsSchema = z.object({
  logo: z.string().nullable(),
  name: z.string(),
  ticker: z.string().nullable(),
  website: z.string().nullable(),
  persistentReferenceId: PersistentReferenceIdSchema,
  slug: SlugSchema,
  type: InstitutionTypeSchema,
  bitcoinTreasuriesId: z.number().nullable(),
  hasPublicCustodians: z.boolean(),
  addressTypes: z.set(AddressTypeSchema),
  verificationStatus: VerificationStatusSchema,
})
export type CreateInstitutionArgs = z.infer<typeof CreateInstitutionArgsSchema>

// UpdateInstitution
export const UpdateInstitutionArgsSchema = z
  .object({
    id: InstitutionIdSchema,
  })
  .merge(
    z
      .object({
        logo: z.string().nullable(),
        name: z.string(),
        ticker: z.string().nullable(),
        website: z.string().nullable(),
        persistentReferenceId: PersistentReferenceIdSchema,
        slug: SlugSchema,
        bitcoinTreasuriesId: z.number().nullable(),
        hasPublicCustodians: z.boolean(),
        addressTypes: z.set(AddressTypeSchema),
        verificationStatus: VerificationStatusSchema,
        type: InstitutionTypeSchema,
      })
      .partial(),
  )
export type UpdateInstitutionArgs = z.infer<typeof UpdateInstitutionArgsSchema>

export const verifiedBitcoinIdPrefix = 'v_ver_btc' as const
export const VerifiedBitcoinIdSchema = createHosidSchema(verifiedBitcoinIdPrefix)
export type VerifiedBitcoinId = z.infer<typeof VerifiedBitcoinIdSchema>

export const verifiedAccountBalanceSnapshotIdPrefix = 'v_ver_snap' as const
export const VerifiedAccountBalanceSnapshotIdSchema = createHosidSchema(verifiedAccountBalanceSnapshotIdPrefix)
export type VerifiedAccountBalanceSnapshotId = z.infer<typeof VerifiedAccountBalanceSnapshotIdSchema>

export const GenerateVerifiedBitcoinForInstitutionArgsSchema = z.object({
  institutionId: InstitutionIdSchema,
})
export type GenerateVerifiedBitcoinForInstitutionArgs = z.infer<typeof GenerateVerifiedBitcoinForInstitutionArgsSchema>

export const TogglePublishArgsSchema = z
  .discriminatedUnion('variant', [
    z.object({ variant: z.literal('institution'), admin: z.string(), ids: z.array(InstitutionIdSchema) }),
    z.object({ variant: z.literal('custodian'), admin: z.string(), ids: z.array(CustodianIdSchema) }),
    z.object({ variant: z.literal('verifiedAccount'), admin: z.string(), ids: z.array(VerifiedAccountIdSchema) }),
    z.object({ variant: z.literal('reportedBitcoin'), admin: z.string(), ids: z.array(ReportedBitcoinIdSchema) }),
    z.object({ variant: z.literal('verifiedBitcoin'), admin: z.string(), ids: z.array(VerifiedBitcoinIdSchema) }),
  ])
  .brand('TogglePublishArgs')
export type TogglePublishArgs = z.infer<typeof TogglePublishArgsSchema>

// RetrieveInstitution
export const RetrieveInstitutionArgsSchema = z.object({
  id: InstitutionIdSchema,
})
export type RetrieveInstitutionArgs = z.infer<typeof RetrieveInstitutionArgsSchema>

// Custodian: Base
const CustodianBaseSchema = z.object({
  company: z.string().min(1),
  name: z.string().min(1),
  logo: z.string().nullable(),
  isPublic: z.boolean(),
  isVerified: z.boolean(),
  isOnChainVerified: z.boolean(),
  hasPublicAccounts: z.boolean(),
})

// CreateCustodian
export const CreateCustodianArgsSchema = CustodianBaseSchema.merge(
  z.object({
    institutionId: InstitutionIdSchema,
  }),
)
export type CreateCustodianArgs = z.infer<typeof CreateCustodianArgsSchema>

// UpdateCustodian
export const UpdateCustodianArgsSchema = z
  .object({
    id: CustodianIdSchema,
  })
  .merge(CustodianBaseSchema.partial())
export type UpdateCustodianArgs = z.infer<typeof UpdateCustodianArgsSchema>

export const CreateVerifiedAccountArgsSchema = z
  .object({
    name: z.string(),
    custodianId: CustodianIdSchema,
  })
  .and(
    z.discriminatedUnion('variant', [
      z.object({
        variant: z.literal('BitcoinAddress'),
        address: bitcoinNetwork(bitcoinAddressString, [Network.Mainnet]),
      }),
      z.object({
        variant: z.literal('Manual'),
        balance: decimal.nonnegative(),
      }),
    ]),
  )
  .brand('CreateVerifiedAccountArgs')
export type CreateVerifiedAccountArgs = z.infer<typeof CreateVerifiedAccountArgsSchema>
export type CreateVerifiedAccountInput = z.input<typeof CreateVerifiedAccountArgsSchema>

export const UpdateVerifiedAccountArgsSchema = z.object({
  id: VerifiedAccountIdSchema,
  name: z.string(),
  balance: decimal.nonnegative().optional(),
})
export type UpdateVerifiedAccountArgs = z.infer<typeof UpdateVerifiedAccountArgsSchema>
