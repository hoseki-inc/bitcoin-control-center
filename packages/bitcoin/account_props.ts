import type { Result } from '@hoseki/packages/result'
import { z } from 'zod'
import { parse } from '../result'
import { Xpub } from './xpub'

export const singleSigAccountScriptTypeSchema = z.enum(['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'])
export type SingleSigAccountScriptType = z.infer<typeof singleSigAccountScriptTypeSchema>

export const multisigAccountScriptTypeSchema = z.enum(['p2sh', 'p2sh-p2wsh', 'p2wsh'])
export type MultiSigAccountScriptType = z.infer<typeof multisigAccountScriptTypeSchema>

export const multisigAccountPropsSchema = z
  .object({
    scriptType: multisigAccountScriptTypeSchema,
    threshold: z.number(),
    isSorted: z.boolean(),
    xpubs: z.array(z.instanceof(Xpub)),
  })
  .superRefine(({ threshold, xpubs }, ctx) => {
    const networkKinds = xpubs.map((xpub) => xpub.network.kind)
    const networkSet = new Set(networkKinds)
    if (networkSet.size !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'all xpubs must be from the same network, got: ' + networkKinds.join(', '),
      })
    }

    const MAX_THRESHOLD = 15
    const MIN_THRESHOLD = 1

    if (threshold > MAX_THRESHOLD) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: MAX_THRESHOLD,
        type: 'number',
        inclusive: true,
        message: `Threshold must be less than ${MAX_THRESHOLD}`,
      })
    }

    if (threshold < MIN_THRESHOLD) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_small,
        minimum: MIN_THRESHOLD,
        type: 'number',
        inclusive: true,
        message: `Threshold must be greater than ${MIN_THRESHOLD}`,
      })
    }

    if (threshold > xpubs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.too_big,
        maximum: xpubs.length,
        type: 'number',
        inclusive: true,
        message: 'Threshold must be less than or equal to xpubs.length',
      })
    }

    const set = new Set(xpubs.map((xpub) => xpub.toString()))
    if (set.size !== xpubs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Xpubs must be unique',
      })
    }
  })
type MultisigAccountProps = z.infer<typeof multisigAccountPropsSchema>

export function checkMultisigAccountProps(props: MultisigAccountProps): Result<MultisigAccountProps, Error> {
  return parse(multisigAccountPropsSchema, props)
}
