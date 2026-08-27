import { z } from 'zod'

// Re-export statement status from pdf-statement (it's the canonical location)
export { type StatementStatus, StatementStatusSchema } from './pdf-statement'

// Access request types - defined here to avoid Prisma import in browser code
// These values must match the Prisma schema enums
export const AccessRequestTypeNameSchema = z.enum(['sharing', 'statement'])
export type AccessRequestTypeName = z.infer<typeof AccessRequestTypeNameSchema>

export const AccessRequestStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'expired'])
export type AccessRequestStatus = z.infer<typeof AccessRequestStatusSchema>

export const AccessRequestSharingPermissionSchema = z.enum(['balances', 'statements'])
export type AccessRequestSharingPermission = z.infer<typeof AccessRequestSharingPermissionSchema>

export const WebhookSubscriptionStatusSchema = z.enum(['active', 'inactive'])
export type WebhookSubscriptionStatus = z.infer<typeof WebhookSubscriptionStatusSchema>

export const EnvelopeCredentialNetworkSchema = z.enum(['BITCOIN', 'ETHEREUM', 'SOLANA', 'COINBASE', 'GEMINI', 'KRAKEN'])
export type EnvelopeCredentialNetwork = z.infer<typeof EnvelopeCredentialNetworkSchema>
