import { z } from 'zod'
import { type Result, parse } from '../result'

export const SlugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9-]+$/, 'Slug must be all lowercase, contain no special characters or whitespace except dashes')
  .brand('Slug')

export type Slug = z.infer<typeof SlugSchema>

export function Slug(value: string): Result<Slug, Error> {
  return parse(SlugSchema, value)
}
