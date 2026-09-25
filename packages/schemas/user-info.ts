import { z } from 'zod'

export const emailSchema = z.string().email().brand('Email')
export type Email = z.infer<typeof emailSchema>

export const personNameSchema = z.string().min(1).max(255)
export type PersonName = z.infer<typeof personNameSchema>

export const StatementUserDataSchema = z.object({
  email: z.string().nullable(),
  name: personNameSchema.nullable(),
  address: z.string().nullable(),
})
export type StatementUserData = z.infer<typeof StatementUserDataSchema>

/** SSN in xxx-xx-xxxx format */
export const ssnSchema = z
  .string()
  .regex(/^\d{3}-\d{2}-\d{4}$/)
  .brand('Ssn')
export type Ssn = z.infer<typeof ssnSchema>

/** Phone number in E.164 format */
export const e164PhoneSchema = z
  .string()
  .regex(/^\+\d{7,15}$/)
  .brand('E164Phone')
export type E164Phone = z.infer<typeof e164PhoneSchema>
