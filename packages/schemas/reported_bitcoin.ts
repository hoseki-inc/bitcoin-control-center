import { z } from 'zod'
import { decimal } from './decimal'
import { InstitutionIdSchema, ReportedBitcoinIdSchema, ReportedBitcoinLinkIdSchema } from './verified'

export const CreateReportedBitcoinLinkArgsSchema = z.object({
  id: z.never().optional(),
  url: z.string(),
  description: z.string().nullable(),
})
export type CreateReportedBitcoinLinkArgs = z.infer<typeof CreateReportedBitcoinLinkArgsSchema>

export const UpdateReportedBitcoinLinkArgsSchema = z.object({
  id: ReportedBitcoinLinkIdSchema,
  url: z.string().optional(),
  description: z.string().nullable().optional(),
})
export type UpdateReportedBitcoinLinkArgs = z.infer<typeof UpdateReportedBitcoinLinkArgsSchema>

export const CreateReportedBitcoinArgsSchema = z.object({
  institutionId: InstitutionIdSchema,
  asOf: z.date(),
  value: decimal.nonnegative(),
  notes: z.string().nullable(),
  links: z.array(CreateReportedBitcoinLinkArgsSchema),
})
export type CreateReportedBitcoinArgs = z.infer<typeof CreateReportedBitcoinArgsSchema>

export const UpdateReportedBitcoinLinksArgsSchema = z.object({
  create: z.array(CreateReportedBitcoinLinkArgsSchema),
  update: z.array(UpdateReportedBitcoinLinkArgsSchema),
  delete: z.array(ReportedBitcoinLinkIdSchema),
})
export type UpdateReportedBitcoinLinksArgs = z.infer<typeof UpdateReportedBitcoinLinksArgsSchema>

export const UpdateReportedBitcoinArgsSchema = z
  .object({
    id: ReportedBitcoinIdSchema,
  })
  .merge(
    z
      .object({
        asOf: z.date(),
        value: decimal.nonnegative(),
        notes: z.string().nullable(),
        links: UpdateReportedBitcoinLinksArgsSchema,
      })
      .partial(),
  )
export type UpdateReportedBitcoinArgs = z.infer<typeof UpdateReportedBitcoinArgsSchema>
