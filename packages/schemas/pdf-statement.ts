import { z } from 'zod'
import { CurrencyCodeSchema } from '../currency'
import { decimal } from './decimal'
import { StatementIdSchema } from './prove'
import { StatementQuoteCurrencySchema } from './statement-quote'
import { TimezoneSchema } from './timezone'
import { StatementUserDataSchema } from './user-info'

// Statement status and timezone schemas
export const StatementStatusSchema = z.enum(['pending', 'completed', 'failed'])
export type StatementStatus = z.infer<typeof StatementStatusSchema>

export const StatementTimezoneSchema = TimezoneSchema.optional().default('UTC')

// Amount schema with all required fields
const CurrentAmountSchema = z.object({
  sats: z.coerce.bigint(),
  quoteValue: decimal(),
  rate: decimal(),
  timestamp: z.coerce.date(),
  provider: z.string(),
  providerUrl: z.string().optional(),
})
// Accept saved USD payloads while exposing a currency-neutral amount to renderers.
export const AmountSchema = z.union([
  CurrentAmountSchema,
  CurrentAmountSchema.omit({ quoteValue: true })
    .extend({ usdValue: decimal(), quoteValue: z.null().optional() })
    .transform(({ usdValue, ...amount }) => ({ ...amount, quoteValue: usdValue })),
])
export type Amount = z.infer<typeof AmountSchema>

// Statement transaction schema
export const StatementTransactionSchema = z.object({
  date: z.coerce.date(),
  confirmed: z.boolean(),
  blockHeight: z.number().nullable(),
  amount: AmountSchema,
  balance: AmountSchema,
})
export type StatementTransaction = z.infer<typeof StatementTransactionSchema>

// Balance entry schema (used for summary entries)
export const BalanceEntrySchema = z.object({
  displayName: z.string(),
  openingBalance: AmountSchema,
  closingBalance: AmountSchema,
  moneyIn: AmountSchema,
  moneyOut: AmountSchema,
})
export type BalanceEntry = z.infer<typeof BalanceEntrySchema>

// Summary entry is just the balance entry
export const SummaryEntrySchema = BalanceEntrySchema
export type SummaryEntry = z.infer<typeof SummaryEntrySchema>

// Statement entry extends balance entry with transactions
export const StatementEntrySchema = BalanceEntrySchema.extend({
  transactions: z.array(StatementTransactionSchema),
})
export type StatementEntry = z.infer<typeof StatementEntrySchema>

// Base PDF statement schema
const BasePdfStatementSchema = z.object({
  id: StatementIdSchema,
  createdAt: z.date(),
  status: StatementStatusSchema,
  counter: z.number().int().positive(),
  timezone: StatementTimezoneSchema,
  user: StatementUserDataSchema,
  currency: CurrencyCodeSchema.optional().default('BTC'),
  quoteCurrency: StatementQuoteCurrencySchema.default('USD'),
  quoteProviderUrl: z.string().optional(),
  quoteProviderUrls: z.array(z.string()).optional(),
})

// Summary schema
const SummarySchema = z.object({
  openingDate: z.coerce.date(),
  closingDate: z.coerce.date(),
  openingBalance: AmountSchema,
  closingBalance: AmountSchema,
  moneyIn: AmountSchema,
  moneyOut: AmountSchema,
  entries: z.array(SummaryEntrySchema),
})
export type Summary = z.infer<typeof SummarySchema>

// Statement period data schema
const StatementPeriodDataSchema = z.object({
  summary: SummarySchema,
  statementEntries: z.array(StatementEntrySchema),
})
export type StatementPeriodData = z.infer<typeof StatementPeriodDataSchema>

// Document format options
export const documentFormatOptionsMap = {
  custom: 'custom',
  monthly: 'monthly',
} as const

// Custom PDF statement schema
const CustomPdfStatementSchema = BasePdfStatementSchema.extend({
  format: z.literal(documentFormatOptionsMap.custom),
  ...StatementPeriodDataSchema.shape,
})
export type CustomPdfStatement = z.infer<typeof CustomPdfStatementSchema>

// Monthly PDF statement schema
const MonthlyPdfStatementSchema = BasePdfStatementSchema.extend({
  format: z.literal(documentFormatOptionsMap.monthly),
  months: z.array(StatementPeriodDataSchema),
})
export type MonthlyPdfStatement = z.infer<typeof MonthlyPdfStatementSchema>

// Main PDF statement schema
export const PdfStatementSchema = z.discriminatedUnion('format', [CustomPdfStatementSchema, MonthlyPdfStatementSchema])
export type PdfStatement = z.infer<typeof PdfStatementSchema>

// Statement document format schema
export const StatementDocumentFormatSchema = z
  .enum([documentFormatOptionsMap.custom, documentFormatOptionsMap.monthly])
  .default(documentFormatOptionsMap.custom)
export type StatementDocumentFormat = z.infer<typeof StatementDocumentFormatSchema>
