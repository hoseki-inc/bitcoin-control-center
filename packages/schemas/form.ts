import { z } from 'zod'

export const nullableInputSchema = z
  .string()
  .transform((value) => (value === '' ? null : value))
  .nullable()

export const nullableEmailSchema = z
  .union([z.literal(''), z.string().email('Please enter a valid email address')])
  .transform((value) => (value === '' ? null : value))
  .nullable()
