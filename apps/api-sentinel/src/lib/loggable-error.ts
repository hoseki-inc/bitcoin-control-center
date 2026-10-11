import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'

/** What can be logged about an error without its message. */
export interface LoggableError {
  error: string
  /** A SQLite result code, such as SQLITE_FULL, when a database error caused it. */
  code?: string
  stack?: string
}

const SqliteCodeSchema = z.object({ code: z.string().regex(/^SQLITE_[A-Z_]+$/) })

function sqliteCode(err: Error): string | undefined {
  for (const candidate of [err, err.cause]) {
    const parsed = parseUnknown(SqliteCodeSchema, candidate)
    if (parsed.isOk()) {
      return parsed.unwrap().code
    }
  }
  return undefined
}

/**
 * An error's type, database code and stack frames, never its message. Database errors put the
 * values they were saving, such as txids and addresses, in their message, over several lines.
 */
export function loggableError(err: Error): LoggableError {
  // The stack starts with the message. Drop it only by its exact text, since a line of it can look
  // like a frame; if the stack doesn't start that way, leave the stack out.
  const header = `${String(err)}\n`
  const stack =
    err.stack?.startsWith(header) === true
      ? err.stack
          .slice(header.length)
          .split('\n')
          .filter((line) => line.startsWith('    at '))
          .join('\n')
      : undefined
  return { error: err.name, code: sqliteCode(err), stack }
}
