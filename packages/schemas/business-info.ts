import { z } from 'zod'

/** EIN in xx-xxxxxxx format */
export const einSchema = z
  .string()
  .regex(/^\d{2}-\d{7}$/)
  .brand('Ein')
export type Ein = z.infer<typeof einSchema>

/** Business legal structure */
export const businessLegalStructureSchema = z.enum([
  'corporation',
  'llc',
  'partnership',
  'sole_proprietorship',
  'non_profit',
])
export type BusinessLegalStructure = z.infer<typeof businessLegalStructureSchema>
