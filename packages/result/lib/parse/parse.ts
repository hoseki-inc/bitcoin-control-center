import { Err, ErrorWithCause, Ok, type Result } from '@patina/core'
import { type z } from 'zod'

export class ParseError<E extends Error = Error> extends ErrorWithCause<E> {
  readonly tag = 'ParseError'
}

export function parse<S extends z.ZodTypeAny, I extends z.input<S> | z.infer<S>, O extends z.infer<S>>(
  schema: S,
  input: I,
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
  input: unknown,
): Result<O, ParseError> {
  return parse(schema, input)
}
