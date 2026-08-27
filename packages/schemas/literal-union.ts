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
): z.ZodType<LiteralUnion<T, InferPrimitiveValue<T>>, z.ZodTypeDef, LiteralUnion<T, InferPrimitiveValue<T>>> {
  const primitiveType = typeof values[0]
  return z.custom<LiteralUnion<T, InferPrimitiveValue<T>>>((value) => typeof value === primitiveType)
}
