import { z } from 'zod'

export const Error = z.unknown()
export type Error = z.infer<typeof Error>

export const User = z.unknown()
export type User = z.infer<typeof User>
