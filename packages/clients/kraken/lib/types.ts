import { z } from 'zod'

// Ledger entry
export const LedgerEntrySchema = z.object({
  refid: z.string(),
  time: z.number(),
  type: z.string(),
  aclass: z.string(),
  asset: z.string(),
  amount: z.string(),
  fee: z.string(),
  balance: z.string(),
})
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>

// Balance endpoint - result only
export const BalanceResultSchema = z.record(z.string(), z.string())
export type BalanceResult = z.infer<typeof BalanceResultSchema>

// Balance endpoint - full response
export const BalanceResponseSchema = z.object({
  error: z.array(z.string()),
  result: BalanceResultSchema,
})
export type BalanceResponse = z.infer<typeof BalanceResponseSchema>

// Ledgers endpoint - result only
export const LedgersResultSchema = z.object({
  ledger: z.record(z.string(), LedgerEntrySchema).optional(),
  count: z.number().optional(),
})
export type LedgersResult = z.infer<typeof LedgersResultSchema>

// Ledgers endpoint - full response
export const LedgersResponseSchema = z.object({
  error: z.array(z.string()),
  result: LedgersResultSchema,
})
export type LedgersResponse = z.infer<typeof LedgersResponseSchema>

// Error response
export const ErrorResponseSchema = z.object({
  error: z.array(z.string()),
})
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>

// Request payload schemas
export const BalancePayloadSchema = z.object({
  // Empty payload for Balance endpoint - no additional parameters needed
})
export type BalancePayload = z.infer<typeof BalancePayloadSchema>

export const LedgersPayloadSchema = z.object({
  start: z.number().optional(), // Starting unix timestamp or ledger ID
  end: z.number().optional(), // Ending unix timestamp or ledger ID
  ofs: z.number().optional(), // Result offset
  type: z.string().optional(), // Type of ledger to retrieve
  asset: z.string().optional(), // Comma delimited list of assets
  aclass: z.string().optional(), // Asset class (default: 'currency')
})
export type LedgersPayload = z.infer<typeof LedgersPayloadSchema>

// Credentials
export interface KrakenCredentials {
  apiKey: string
  secretKey: string
}
