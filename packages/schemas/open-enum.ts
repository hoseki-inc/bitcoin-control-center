import { z } from 'zod'

const string = z.string()
const never = z.never().optional()

// This type is too complicated to write by hand, so we rely on inference
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function openEnum<T extends string>(values: Readonly<[T, ...T[]]>) {
  const enumSchema = z.enum(values)
  return z.preprocess(
    (arg) => {
      const stringValue = string.safeParse(arg)
      if (stringValue.success) {
        const enumValue = enumSchema.safeParse(arg)
        if (enumValue.success) {
          return { enum: enumValue.data }
        } else {
          return { string: stringValue.data }
        }
      }
      return arg
    },
    z
      .object({
        enum: enumSchema,
        string: never,
      })
      .or(
        z.object({
          enum: never,
          string,
        }),
      ),
  )
}
