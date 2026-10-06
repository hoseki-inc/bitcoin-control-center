import { z } from 'zod'

export const StatementQuoteCurrencySchema = z.enum(['USD', 'CAD', 'GBP', 'EUR'])
export type StatementQuoteCurrency = z.infer<typeof StatementQuoteCurrencySchema>
