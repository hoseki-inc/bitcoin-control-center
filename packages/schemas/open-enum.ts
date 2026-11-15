import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'

const string = z.string()
const never = z.never().optional()

// This type is too complicated to write by hand, so we rely on inference
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function openEnum<T extends string>(values: Readonly<[T, ...T[]]>) {
  const enumSchema = z.enum(values)
  return z.preprocess(
    (arg) => {
      const stringValue = parseUnknown(string, arg)
      if (stringValue.isOk()) {
        const enumValue = parseUnknown(enumSchema, arg)
        if (enumValue.isOk()) {
          return { enum: enumValue.unwrap() }
        } else {
          return { string: stringValue.unwrap() }
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
