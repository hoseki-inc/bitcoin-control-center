// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This inspects untrusted superjson metadata before any schema runs; a Zod schema would build an issue per malformed item, the cost this guards against.
import { Err, Ok, type Result } from '@hoseki/packages/result'

/**
 * The superjson types a request may carry. Sentinel deserializes request bodies before routing and before checking
 * the PIN, and several superjson types can be abused there: Set and Map entries are found by stepping from the
 * start, typed arrays allocate whatever length the client names, and our custom collections parse nested superjson
 * text. Only add a type whose deserialization is linear in the request size and can't nest more superjson.
 * Otherwise send an array, object or string and convert it in the route's Zod schema.
 */
const ALLOWED_TYPES = new Set(['undefined', 'bigint', 'Date', 'number'])
const ALLOWED_CUSTOM_TYPES = new Set(['Decimal'])

/** superjson copies the full path for every annotated value, so long paths cost quadratic time. */
const MAX_PATH_SEGMENTS = 64

/** Names of the types superjson knows, which are safe to repeat in an error message. */
const KNOWN_TYPES = new Set(['regexp', 'set', 'map', 'Error', 'URL', 'symbol', 'class', 'custom', 'typed-array'])

type PendingNode = { node: unknown; depth: number }

function segments(path: string): number {
  return path.split('.').length
}

function checkType(type: unknown): Result<void, string> {
  if (typeof type === 'string') {
    if (ALLOWED_TYPES.has(type)) {
      return Ok(undefined)
    }
    return Err(KNOWN_TYPES.has(type) ? `request type "${type}" isn't accepted` : 'unknown request type')
  }
  if (Array.isArray(type) && type[0] === 'custom' && typeof type[1] === 'string' && ALLOWED_CUSTOM_TYPES.has(type[1])) {
    return Ok(undefined)
  }
  const kind: unknown = Array.isArray(type) ? type[0] : undefined
  return Err(
    typeof kind === 'string' && KNOWN_TYPES.has(kind)
      ? `request type "${kind}" isn't accepted`
      : 'unknown request type',
  )
}

/** Walks the value annotations without recursion, so deep nesting can't overflow the stack. */
function checkValues(values: unknown): Result<void, string> {
  const pending: PendingNode[] = [{ node: values, depth: 0 }]
  for (let next = pending.pop(); next; next = pending.pop()) {
    const { node, depth } = next
    if (node == null) {
      continue
    }
    let children: unknown = node
    if (Array.isArray(node)) {
      const type = checkType(node[0])
      if (type.isErr()) {
        return type
      }
      children = node[1]
    }
    if (children == null) {
      continue
    }
    if (typeof children !== 'object' || Array.isArray(children)) {
      return Err('malformed request types')
    }
    for (const [key, child] of Object.entries(children)) {
      const childDepth = depth + segments(key)
      if (childDepth > MAX_PATH_SEGMENTS) {
        return Err('request path is too deep')
      }
      pending.push({ node: child, depth: childDepth })
    }
  }
  return Ok(undefined)
}

function checkReferences(references: unknown): Result<void, string> {
  const paths: unknown[] = []
  const [root, other] = Array.isArray(references) ? Array.from<unknown>(references) : []
  const groups: unknown[] = Array.isArray(references) ? [{ '': root }, other] : [references]
  for (const group of groups) {
    if (group == null) {
      continue
    }
    if (typeof group !== 'object' || Array.isArray(group)) {
      return Err('malformed request references')
    }
    for (const [path, identical] of Object.entries(group)) {
      paths.push(path)
      if (!Array.isArray(identical)) {
        return Err('malformed request references')
      }
      for (const identicalPath of identical) {
        paths.push(identicalPath)
      }
    }
  }
  for (const path of paths) {
    if (typeof path !== 'string') {
      return Err('malformed request references')
    }
    if (segments(path) > MAX_PATH_SEGMENTS) {
      return Err('request path is too deep')
    }
  }
  return Ok(undefined)
}

/** Refuses a request whose superjson metadata uses a type or path that could stall Sentinel. */
export function checkRequestTypes(meta: unknown): Result<void, string> {
  if (meta == null) {
    return Ok(undefined)
  }
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return Err('malformed request metadata')
  }
  const values = 'values' in meta ? meta.values : undefined
  const references = 'referentialEqualities' in meta ? meta.referentialEqualities : undefined
  return checkValues(values).andThen(() => checkReferences(references))
}
