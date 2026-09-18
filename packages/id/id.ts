import { Panic } from '@patina/core'
import { customAlphabet } from 'nanoid'
import { z } from 'zod'

const SIZE = 21 as const
const lowercase = 'abcdefghijklmnopqrstuvwxyz'
const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const numbers = '0123456789'
const ALPHABET = lowercase + uppercase + numbers
const generate = customAlphabet(ALPHABET, SIZE)

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
  export function schema<T extends string>(prefix: T): z.ZodType<Id<T>, z.ZodTypeDef, string> {
    return z
      .string()
      .refine((value): value is Id<T> => value.startsWith(`${prefix}_`), {
        message: `id must start with "${prefix}_"`,
      })
      .transform((v) => v as Id<T>)
  }

  /** Remove the prefix, returning just the random part */
  export function strip<T extends string>(prefixedId: Id<T>): string {
    const lastPart = prefixedId.split('_').at(-1)
    if (!lastPart) {
      throw new Panic('Invalid id')
    }
    return lastPart
  }
}
