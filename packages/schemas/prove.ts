import type { z } from 'zod'
import { createHosidSchema } from './hosid'

export const metadataIdPrefix = 're_mtdt'
export const MetadataIdSchema = createHosidSchema(metadataIdPrefix)
export type MetadataId = z.infer<typeof MetadataIdSchema>

export const challengeIdPrefix = 're_chal'
export const ChallengeIdSchema = createHosidSchema(challengeIdPrefix)
export type ChallengeId = z.infer<typeof ChallengeIdSchema>

export const assetIdPrefix = 're_asst'
export const AssetIdSchema = createHosidSchema(assetIdPrefix)
export type AssetId = z.infer<typeof AssetIdSchema>

export const userIdPrefix = 'pt_user'
export const UserIdSchema = createHosidSchema(userIdPrefix)
export type UserId = z.infer<typeof UserIdSchema>

export const claimIdPrefix = 're_clmx'
export const ClaimIdSchema = createHosidSchema(claimIdPrefix)
export type ClaimId = z.infer<typeof ClaimIdSchema>

export const statementIdPrefix = 'st_stmt'
export const StatementIdSchema = createHosidSchema(statementIdPrefix)
export type StatementId = z.infer<typeof StatementIdSchema>

export type ClaimStatus = 'pending' | 'unverified' | 'verified' | 'expired'
export type UnprovenClaimStatus = Extract<ClaimStatus, 'pending' | 'unverified'>

/** Whether the owner has yet to sign: a wallet waiting to be proven, or one only tracked. */
export function isUnproven(status: ClaimStatus): status is UnprovenClaimStatus {
  return status === 'pending' || status === 'unverified'
}
export type ClaimAccessStatus = 'active' | 'inactive' | 'disconnected'
