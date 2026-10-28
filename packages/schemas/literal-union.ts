import type { LiteralUnion } from 'type-fest'
import { z } from 'zod'

type PrimitiveValue = string | number | boolean | bigint

type InferPrimitiveValue<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends bigint
        ? bigint
        : never

export function literalUnion<T extends PrimitiveValue>(
  values: Readonly<[T, ...T[]]>,
): z.ZodType<LiteralUnion<T, InferPrimitiveValue<T>>, LiteralUnion<T, InferPrimitiveValue<T>>> {
  const reference = values[0]
  return z.custom<LiteralUnion<T, InferPrimitiveValue<T>>>(
    (value): value is LiteralUnion<T, InferPrimitiveValue<T>> => typeof value === typeof reference,
  )
}
