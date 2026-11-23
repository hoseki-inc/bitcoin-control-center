import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { TRPCClientError } from '@trpc/client'
import { toast } from 'sonner'
import { z } from 'zod'
import { queryErrorMessage } from './query-error-message'

const MAX_REASON_LENGTH = 200
const STACK_FRAME_PATTERN = /\bat\s+(?:async\s+|new\s+)?[\w.$<>]+\s*\(/
const MISSING_PROCEDURE_PATTERN = /^No "[^"]+"-procedure on path "[^"]*"$/
const INTERNAL_PREFIXES = [
  'SQLITE_',
  'ENOENT',
  'ECONN',
  'EPIPE',
  'TypeError:',
  'ReferenceError:',
  'SyntaxError:',
  'RangeError:',
  'Error:',
]

const trpcErrorDataSchema = z.object({
  code: z.string(),
  httpStatus: z.number().int().optional(),
})

function sanitizeReason(raw: string): string | undefined {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) {
    return undefined
  }
  if (/[\r\n]/.test(trimmed)) {
    return undefined
  }
  if (STACK_FRAME_PATTERN.test(trimmed)) {
    return undefined
  }
  if (MISSING_PROCEDURE_PATTERN.test(trimmed)) {
    return undefined
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) {
    return undefined
  }
  if (INTERNAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return undefined
  }
  return trimmed
}

export function signingErrorReason(cause: unknown): string | undefined {
  if (cause instanceof TRPCClientError) {
    const parsed = parseUnknown(trpcErrorDataSchema, cause.data)
    if (parsed.isOk()) {
      const { code, httpStatus } = parsed.unwrap()
      if (
        (code === 'BAD_REQUEST' || code === 'NOT_FOUND') &&
        (httpStatus === undefined || (httpStatus >= 400 && httpStatus <= 499))
      ) {
        return sanitizeReason(cause.message)
      }
      return undefined
    }
  }
  if (cause instanceof Error) {
    const networkMessage = queryErrorMessage(cause, '')
    if (networkMessage !== '') {
      return networkMessage
    }
  }
  return undefined
}

export function getSigningErrorMessage(cause: unknown, fallback: string): string {
  return signingErrorReason(cause) ?? fallback
}

export function toastSigningError(cause: unknown, fallbackTitle: string): void {
  const reason = signingErrorReason(cause)
  if (reason !== undefined && reason !== fallbackTitle) {
    toast.error(fallbackTitle, { description: reason })
    return
  }
  toast.error(fallbackTitle)
}
