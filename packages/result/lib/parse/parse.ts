import type { z } from 'zod'
import { ErrorWithCause } from '../core/error'
import { Err, Ok, type Result } from '../core/result'

export class ParseError<E extends Error = Error> extends ErrorWithCause<E> {
  public readonly tag = 'ParseError'
}

export function parse<S extends z.ZodTypeAny, O extends z.infer<S>>(
  schema: S,
  input: z.input<S> | z.infer<S>,
): Result<O, ParseError<z.ZodError>> {
  const parsed = schema.safeParse(input)
  if (parsed.success) {
    return Ok(parsed.data)
  } else {
    const msg = parsed.error.issues.map((issue) => issue.message).join('; ')
    return Err(new ParseError(msg, { cause: parsed.error }))
  }
}

export function parseInput<S extends z.ZodTypeAny>(
  schema: S,
  input: z.input<S>,
): Result<z.infer<S>, ParseError<z.ZodError>> {
  const parsed = schema.safeParse(input)
  if (parsed.success) {
    return Ok(parsed.data)
  } else {
    const msg = parsed.error.issues.map((issue) => issue.message).join('; ')
    return Err(new ParseError(msg, { cause: parsed.error }))
  }
}

export function parseUnknown<S extends z.ZodTypeAny, O extends z.infer<S>>(
  schema: S,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- This parser validates unknown input at the I/O boundary.
  input: unknown,
): Result<O, ParseError> {
  return parse(schema, input)
}
