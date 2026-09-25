import { Decimal } from 'decimal.js'
import { z } from 'zod'
import { Result } from '../result/index.ts'

const decimalInstance = z.custom<Decimal>((value) => value instanceof Decimal, {
  message: 'Expected Decimal',
})

// Prisma returns custom Decimal objects, that we can't import directly,
// because frontend doesn't have access to the Prisma client
const decimalObject = z.object({
  d: z.number().array(),
  e: z.number(),
  s: z.number(),
})

function decimalObjectToDecimalInstance(pd: z.infer<typeof decimalObject>) {
  const d = new Decimal(0)
  // @ts-expect-error Giga hack to get around the fact that Decimal doesn't have a public constructor that takes d, e, s
  d.d = pd.d
  // @ts-expect-error see above
  d.e = pd.e
  // @ts-expect-error see above
  d.s = pd.s
  return d
}

type DecimalSchemaUnion = z.ZodUnion<
  [
    z.ZodString,
    z.ZodNumber,
    z.ZodBigInt,
    z.ZodType<Decimal>,
    z.ZodObject<{ d: z.ZodArray<z.ZodNumber>; e: z.ZodNumber; s: z.ZodNumber }>,
  ]
>

type DecimalLike = string | number | bigint | Decimal | { d: number[]; e: number; s: number }

function isDecimalObject(value: DecimalLike): value is z.infer<typeof decimalObject> {
  return typeof value === 'object' && !Decimal.isDecimal(value)
}

function isDecimalConstructorValue(value: DecimalLike): value is string | number | Decimal {
  return typeof value === 'string' || typeof value === 'number' || Decimal.isDecimal(value)
}

function formatDecimalInput(value: DecimalLike): string {
  if (isDecimalObject(value)) {
    return JSON.stringify(value)
  }
  return value.toString()
}

export function decimal(config?: Decimal.Config): z.ZodEffects<DecimalSchemaUnion, Decimal, DecimalLike> {
  return z.union([z.string(), z.number(), z.bigint(), decimalInstance, decimalObject]).transform((value, ctx) => {
    const constructor = config ? Decimal.clone(config) : Decimal

    const from = isDecimalConstructorValue(value)
      ? value
      : isDecimalObject(value)
        ? decimalObjectToDecimalInstance(value)
        : value.toString()
    const result = Result.from(() => new constructor(from))

    if (result.isErr()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `cannot parse ${formatDecimalInput(value)} as decimal number`,
      })
      return z.NEVER
    }

    if (result.value().isNaN()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${formatDecimalInput(value)} is not a valid decimal number`,
      })
      return z.NEVER
    }

    return result.value()
  })
}

decimal.positive = () =>
  decimal().refine((v) => v.gt(0), {
    message: 'Must be greater than 0',
  })

decimal.nonnegative = () =>
  decimal().refine((v) => v.gte(0), {
    message: 'Must be greater than or equal to 0',
  })
