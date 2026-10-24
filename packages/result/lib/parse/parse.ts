import { Err, ErrorWithCause, Ok, type Result } from '@hoseki/packages/result'
import type { z } from 'zod'

export class ParseError<E extends Error = Error> extends ErrorWithCause<E> {
  public readonly tag = 'ParseError'
}

function safeParse<S extends z.ZodType>(
  schema: S,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The public wrappers decide which input types they accept.
  input: unknown,
): Result<z.infer<S>, ParseError<z.ZodError>> {
  const parsed = schema.safeParse(input)
  if (parsed.success) {
    return Ok(parsed.data)
  } else {
    const msg = parsed.error.issues.map((issue) => issue.message).join('; ')
    return Err(new ParseError(msg, { cause: parsed.error }))
  }
}

export function parse<S extends z.ZodType>(
  schema: S,
  input: z.input<S> | z.infer<S>,
): Result<z.infer<S>, ParseError<z.ZodError>> {
  return safeParse(schema, input)
}

export function parseInput<S extends z.ZodType>(
  schema: S,
  input: z.input<S>,
): Result<z.infer<S>, ParseError<z.ZodError>> {
  return safeParse(schema, input)
}

export function parseUnknown<S extends z.ZodType>(
  schema: S,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Accept arbitrary runtime values so the supplied schema can validate them.
  input: unknown,
): Result<z.infer<S>, ParseError> {
  return safeParse(schema, input)
}
