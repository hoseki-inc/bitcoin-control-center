import { z } from 'zod'
import { type Result, parse } from '../result'

export const PersistentReferenceIdSchema = z
  .string()
  .min(1)
  .regex(
    /^[a-z0-9-]+$/,
    'PersistentReferenceId must be all lowercase, contain no special characters or whitespace except dashes',
  )
  .brand('PersistentReferenceId')

export type PersistentReferenceId = z.infer<typeof PersistentReferenceIdSchema>

export function PersistentReferenceId(value: string): Result<PersistentReferenceId, Error> {
  return parse(PersistentReferenceIdSchema, value)
}
