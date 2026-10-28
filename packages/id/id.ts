import { Panic } from '@hoseki/packages/result'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'

const ID_SIZE = 21 as const
const lowercase = 'abcdefghijklmnopqrstuvwxyz'
const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const numbers = '0123456789'
const ID_ALPHABET = lowercase + uppercase + numbers
const generate = customAlphabet(ID_ALPHABET, ID_SIZE)

/** Generic prefixed ID type */
export type Id<T extends string> = `${T}_${string}`

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Id {
  export const SIZE = 21
  export const ALPHABET = lowercase + uppercase + numbers

  /** Generate a new ID with the given prefix */
  export function gen<T extends string>(prefix: T): Id<T> {
    return `${prefix}_${generate()}`
  }

  /** Create a factory function for generating IDs with a fixed prefix */
  export function factory<T extends string>(prefix: T): () => Id<T> {
    return () => Id.gen(prefix)
  }

  /** Create a Zod schema for validating IDs with a specific prefix */
  export function schema<T extends string>(prefix: T): z.ZodType<Id<T>, string> {
    const hasPrefix = (value: string): value is Id<T> => value.startsWith(`${prefix}_`)
    return z.string().transform((value, ctx) => {
      if (hasPrefix(value)) {
        return value
      }
      ctx.addIssue({ code: 'custom', message: `id must start with "${prefix}_"` })
      return z.NEVER
    })
  }

  /** Remove the prefix, returning just the random part */
  export function strip(prefixedId: Id<string>): string {
    const lastPart = prefixedId.split('_').at(-1)
    if (lastPart == null || lastPart === '') {
      throw new Panic('Invalid id')
    }
    return lastPart
  }
}
