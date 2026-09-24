import type { z } from 'zod'
import { createHosidSchema } from './hosid'

export const signedMessageIdPrefix = 're_mesg'
export const SignedMessageIdSchema = createHosidSchema(signedMessageIdPrefix)
export type SignedMessageId = z.infer<typeof SignedMessageIdSchema>
