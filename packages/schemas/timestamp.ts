import { Err, Ok, type Result } from '@patina/core'
import { z } from 'zod'

export const TimestampSchema = z
  .number()
  .int()
  .positive()
  .superRefine((arg, ctx) => {
    const date = new Date(arg * 1000)
    if (isNaN(date.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid timestamp' })
      return z.NEVER
    }
    return arg
  })
  .brand('Timestamp')
export type Timestamp = z.infer<typeof TimestampSchema>

export function toTimestamp(date: Date): Timestamp {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Preserve Date conversion, including epoch/pre-epoch values; the stricter schema validates external timestamps.
  return Math.floor(date.getTime() / 1000) as Timestamp
}

export function fromTimestamp(timestamp: number): Result<Date, Error> {
  const result = TimestampSchema.safeParse(timestamp)
  if (!result.success) {
    return Err(new Error(`Invalid timestamp: ${result.error.message}`))
  }
  return Ok(new Date(result.data * 1000))
}
