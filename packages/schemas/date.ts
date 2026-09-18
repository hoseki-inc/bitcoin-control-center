import { Err, Ok, Result } from '@hoseki/packages/result'
import { parse } from 'date-fns'
import { z } from 'zod'

export const isoStringDateSchema = z.string().date().brand('IsoDate')
export type IsoDate = z.infer<typeof isoStringDateSchema>

/**
 * Parses the date in YYYY-MM-DD format.
 */
export function dateString(): z.ZodEffects<z.ZodString, Date, string> {
  return z
    .string()
    .date()
    .transform((input, ctx) => {
      const result = Result.fromThrowable(() => parse(input, 'yyyy-MM-dd', new Date())).andThen((parsedDate: Date) => {
        if (isNaN(parsedDate.getTime())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid date',
          })
          return Err(new Error('Invalid date'))
        }
        return Ok(parsedDate)
      })

      return result.isErr() ? z.NEVER : result.unwrap()
    })
}

/**
 * Truncate a JS Date to 00:00 *UTC* of the same calendar day.
 * Safe to store or stringify (ISO) with no daylight-shift surprises.
 */
export function toUtcMidnight(inputDate: Date): Date {
  return new Date(Date.UTC(inputDate.getUTCFullYear(), inputDate.getUTCMonth(), inputDate.getUTCDate())) // 00:00:00.000Z
}

/**
 * Parses the date as a UTC date.
 */
export function utcDatetimeString(format: string): z.ZodEffects<z.ZodString, Date, string> {
  return z.string().transform((input, ctx) => {
    const result = Result.fromThrowable(() => parse(input, format, new Date())).andThen((parsedDate: Date) => {
      if (isNaN(parsedDate.getTime())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid date',
        })
        return Err(new Error('Invalid date'))
      }
      return Ok(
        new Date(
          Date.UTC(
            parsedDate.getFullYear(),
            parsedDate.getMonth(),
            parsedDate.getDate(),
            parsedDate.getHours(),
            parsedDate.getMinutes(),
            parsedDate.getSeconds(),
            parsedDate.getMilliseconds(),
          ),
        ),
      )
    })

    return result.isErr() ? z.NEVER : result.unwrap()
  })
}

export function date(): z.ZodDate {
  return z.date()
}

export function dateLike(): z.ZodPipeline<z.ZodUnion<[z.ZodNumber, z.ZodString, z.ZodDate]>, z.ZodDate> {
  return z.union([z.number(), z.string(), z.date()]).pipe(z.coerce.date())
}

function pastOrNow<T extends z.ZodDate | ReturnType<typeof dateLike>>(schema: T) {
  return schema.refine(
    (v) => v <= new Date(),
    (v) => ({
      message: `Date must be in the past, got "${v.toISOString()}, now is ${new Date().toISOString()}"`,
    }),
  )
}

date.pastOrNow = () => pastOrNow(date())
dateLike.pastOrNow = () => pastOrNow(dateLike())

/**
 * Creates a Zod schema that validates and parses a Unix timestamp (seconds since epoch)
 * into a JavaScript Date object. The timestamp must be a non-negative integer.
 *
 * @example
 * ```ts
 * const schema = unixTimestamp()
 * schema.parse(1615766400) // Returns Date object for "2021-03-14T16:00:00.000Z"
 * schema.parse(-1) // Error: negative timestamp
 * schema.parse(1.5) // Error: expected integer, received float
 * schema.parse(8640000000001) // Error: because the max a Date constructor can handle is 8640000000000000.5
 * ```
 */
export function unixTimestamp(): z.ZodPipeline<z.ZodEffects<z.ZodNumber, Date, number>, z.ZodDate> {
  return z
    .number()
    .int()
    .min(0)
    .transform((seconds) => new Date(seconds * 1000))
    .pipe(z.date())
}
