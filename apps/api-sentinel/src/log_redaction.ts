import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import pino, { type LoggerOptions } from 'pino'
import { z } from 'zod'

/** What a log shows in place of a wallet detail or server host above Debug. */
export const HIDDEN_DETAIL = '[hidden]'

/**
 * Fields that hold wallet details or hosts, hidden up to two levels deep. Logs must put these
 * values only under these names, never in a message, so support logs at Info and above leave them out.
 */
const WALLET_DETAIL_FIELDS = [
  'address',
  'addresses',
  'txHash',
  'txHashes',
  'txid',
  'txids',
  'scripthash',
  'scripthashes',
  'descriptor',
  'descriptors',
  'xpub',
  'xpubs',
  'host',
  'hostname',
  'server',
  'servername',
  'electrumHost',
  'remoteAddress',
]

// The host of a failed connection, then its port when there is one.
const NETWORK_TARGET =
  /\b((?:getaddrinfo|connect|read|write|bind|listen|lookup|query[A-Za-z]*) E[A-Z0-9_]+[ \t]+)([^\s,)]+?)(:\d{1,5})?(?=[\s,)]|$)/g
const TLS_ALTNAME = /\b(Host: |IP: |DNS:|IP Address:)[^\s,]+/g
const ONION = /\b[a-z2-7]{16,56}\.onion\b/gi
const IPV4 = /\b((?:\d{1,3}\.){3}\d{1,3})(:\d{1,5})?\b/g
// Loopback hosts and ports identify nothing, and tell support whether Tor or Electrum refused.
const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|localhost)$/
const DESCRIPTOR =
  /\b(?:sh|wsh|wpkh|pkh|tr|combo|addr|raw|rawtr|multi|sortedmulti|multi_a|sortedmulti_a)\([^\s'"]*\)(?:#[a-z0-9]{8})?/g
const EXTENDED_KEY = /\b[xyzXYZtuvUV]p(?:ub|rv)[1-9A-HJ-NP-Za-km-z]{20,}\b/g
const HEX_HASH = /\b[0-9a-fA-F]{64}\b/g
const BECH32_ADDRESS = /\b(?:bc|tb|bcrt)1[02-9ac-hj-np-z]{8,87}\b/gi
const BASE58_ADDRESS = /\b[123mn](?=[1-9A-HJ-NP-Za-km-z]*\d)[1-9A-HJ-NP-Za-km-z]{25,34}\b/g

const DEBUG_LEVEL = pino.levels.values['debug'] ?? 20

/** Whether logs at this level hide wallet details; Debug and Trace show them in full. */
export function hidesWalletDetails(level: string): boolean {
  const value = pino.levels.values[level]
  return value === undefined || value > DEBUG_LEVEL
}

/** Replaces addresses, txids, descriptors, keys, IPs, onion addresses and network error targets. */
export function hideWalletDetailsInText(text: string): string {
  return text
    .replace(NETWORK_TARGET, (_match, prefix: string, target: string, port = '') =>
      LOOPBACK.test(target) ? `${prefix}${target}${port}` : `${prefix}${HIDDEN_DETAIL}${port}`,
    )
    .replace(TLS_ALTNAME, `$1${HIDDEN_DETAIL}`)
    .replace(ONION, HIDDEN_DETAIL)
    .replace(DESCRIPTOR, HIDDEN_DETAIL)
    .replace(EXTENDED_KEY, HIDDEN_DETAIL)
    .replace(HEX_HASH, HIDDEN_DETAIL)
    .replace(BECH32_ADDRESS, HIDDEN_DETAIL)
    .replace(BASE58_ADDRESS, HIDDEN_DETAIL)
    .replace(IPV4, (match, ip: string, port = '') => (LOOPBACK.test(ip) ? match : `${HIDDEN_DETAIL}${port}`))
}

// Each field is optional on its own, so one of an unexpected type doesn't drop the others.
const ErrorDiagnosticsSchema = z.object({
  code: z.union([z.string(), z.number()]).optional().catch(undefined),
  errno: z.number().optional().catch(undefined),
  syscall: z.string().optional().catch(undefined),
  kind: z.string().optional().catch(undefined),
  statusCode: z.number().optional().catch(undefined),
})

/** What a log keeps of an error above Debug. */
export interface HiddenError extends z.infer<typeof ErrorDiagnosticsSchema> {
  type: string
  message: string
  stack?: string
  errors?: HiddenError[]
}

/**
 * An error's type, code and kind, with wallet details and hosts taken out of its message and stack.
 * Other properties are left out: Node network errors also carry the host and IP as fields.
 */
export function hideWalletDetailsInError(error: Error): HiddenError {
  return hideDetailsInError(error, 0)
}

function hideDetailsInError(error: Error, depth: number): HiddenError {
  const serialized = pino.stdSerializers.err(error)
  const hidden: HiddenError = {
    type: serialized.type,
    message: hideWalletDetailsInText(serialized.message),
    stack: serialized.stack ? hideWalletDetailsInText(serialized.stack) : undefined,
    ...parseUnknown(ErrorDiagnosticsSchema, error).unwrapOr({}),
  }
  // Node reports a failed connection to every resolved IP as one AggregateError.
  if (error instanceof AggregateError && depth < 2) {
    hidden.errors = error.errors
      .filter((inner) => inner instanceof Error)
      .map((inner: Error) => hideDetailsInError(inner, depth + 1))
  }
  return hidden
}

function hideWalletDetailsInField(value: Error | string): HiddenError | string {
  if (value instanceof Error) {
    return hideWalletDetailsInError(value)
  }
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- pino passes any logged value; only text is scrubbed, and a schema per log line is too slow.
  return typeof value === 'string' ? hideWalletDetailsInText(value) : value
}

/**
 * Logger options that hide wallet details and hosts at Info and above, and add nothing at Debug
 * and Trace, so full detail is one setting away while diagnosing.
 */
export function walletDetailLogOptions(level: string): LoggerOptions {
  if (!hidesWalletDetails(level)) {
    return {}
  }
  return {
    redact: {
      paths: WALLET_DETAIL_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
      censor: HIDDEN_DETAIL,
    },
    serializers: {
      err: hideWalletDetailsInField,
      error: hideWalletDetailsInField,
      reason: hideWalletDetailsInField,
    },
    hooks: {
      // A safety net for details in a message; pino uses a logged error's message as its own.
      logMethod(args, method) {
        const values: unknown[] = args
        for (const [index, value] of values.entries()) {
          // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Log arguments are any values; a schema per argument made every log line about 25 times slower.
          if (typeof value === 'string') {
            values[index] = hideWalletDetailsInText(value)
          }
        }
        const [first] = values
        if (first instanceof Error && values.length === 1) {
          values.push(hideWalletDetailsInText(first.message))
        }
        method.apply(this, args)
      },
    },
  }
}
