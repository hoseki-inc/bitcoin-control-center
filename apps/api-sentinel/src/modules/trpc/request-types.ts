// oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof -- This inspects untrusted superjson metadata before any schema runs; a Zod schema would build an issue per malformed item, the cost this guards against.
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { TRPCError } from '@trpc/server'
import type { SuperJSON, SuperJSONResult, SuperJSONValue } from 'superjson'

/**
 * The superjson types a request may carry. Sentinel deserializes request bodies before routing and before checking
 * the PIN, and several superjson types can be abused there: Set and Map entries are found by stepping from the
 * start, typed arrays allocate whatever length the client names, and our custom collections parse nested superjson
 * text. Only add a type whose deserialization is linear in the request size and can't nest more superjson.
 * Otherwise send an array, object or string and convert it in the route's Zod schema. Besides these, a request may
 * carry our Decimal, annotated `['custom', 'Decimal']`.
 */
const ALLOWED_TYPES = new Set(['undefined', 'bigint', 'Date', 'number'])

/** superjson copies the path so far for every nested annotation, so deep nesting costs quadratic time. */
const MAX_PATH_SEGMENTS = 64

/** Names of the types superjson knows, which are safe to repeat in an error message. */
const KNOWN_TYPES = new Set(['regexp', 'set', 'map', 'Error', 'URL', 'symbol', 'class', 'custom', 'typed-array'])

const MALFORMED = 'malformed request metadata'
const TOO_DEEP = 'request path is too deep'

function segments(path: string): number {
  return path.split('.').length
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An annotation is a type name, or `[kind, name]` for composite types such as `['custom', 'Decimal']`. */
function checkType(annotation: unknown): Result<void, string> {
  const [kind, name]: unknown[] = Array.isArray(annotation) ? Array.from<unknown>(annotation) : [annotation]
  if (typeof kind !== 'string') {
    return Err(MALFORMED)
  }
  const allowed = Array.isArray(annotation)
    ? annotation.length === 2 && kind === 'custom' && name === 'Decimal'
    : ALLOWED_TYPES.has(kind)
  if (allowed) {
    return Ok(undefined)
  }
  return Err(KNOWN_TYPES.has(kind) ? `request type "${kind}" isn't accepted` : 'unknown request type')
}

/** Walks the value annotations without recursion, so deep nesting can't overflow the stack. */
function checkValues(values: unknown): Result<void, string> {
  const pending = [{ node: values, depth: 0 }]
  for (let next = pending.pop(); next; next = pending.pop()) {
    let children = next.node
    if (Array.isArray(children)) {
      const type = checkType(children[0])
      if (type.isErr()) {
        return type
      }
      children = children[1]
    }
    if (children == null) {
      continue
    }
    if (!isObject(children)) {
      return Err(MALFORMED)
    }
    for (const [key, child] of Object.entries(children)) {
      const depth = next.depth + segments(key)
      if (depth > MAX_PATH_SEGMENTS) {
        return Err(TOO_DEEP)
      }
      pending.push({ node: child, depth })
    }
  }
  return Ok(undefined)
}

function checkPaths(paths: unknown): Result<void, string> {
  if (!Array.isArray(paths)) {
    return Err(MALFORMED)
  }
  for (const path of paths) {
    if (typeof path !== 'string') {
      return Err(MALFORMED)
    }
    if (segments(path) > MAX_PATH_SEGMENTS) {
      return Err(TOO_DEEP)
    }
  }
  return Ok(undefined)
}

/** References are `{ path: identicalPaths }`, or `[rootPaths, { path: identicalPaths }]` when the root repeats. */
function checkReferences(references: unknown): Result<void, string> {
  let groups = references
  if (Array.isArray(references)) {
    const [root, rest]: unknown[] = Array.from<unknown>(references)
    const checked = checkPaths(root)
    if (checked.isErr()) {
      return checked
    }
    groups = rest
  }
  if (groups == null) {
    return Ok(undefined)
  }
  if (!isObject(groups)) {
    return Err(MALFORMED)
  }
  for (const [path, identical] of Object.entries(groups)) {
    const checked = checkPaths([path]).andThen(() => checkPaths(identical))
    if (checked.isErr()) {
      return checked
    }
  }
  return Ok(undefined)
}

/** Refuses a request body whose superjson metadata uses a type or path that could stall Sentinel. */
export function checkRequestTypes(body: unknown): Result<void, string> {
  if (!isObject(body)) {
    return Err(MALFORMED)
  }
  const meta = 'meta' in body ? body.meta : undefined
  if (meta == null) {
    return Ok(undefined)
  }
  if (!isObject(meta)) {
    return Err(MALFORMED)
  }
  const values = 'values' in meta ? meta.values : undefined
  const references = 'referentialEqualities' in meta ? meta.referentialEqualities : undefined
  return checkValues(values).andThen(() => checkReferences(references))
}

export interface RequestTransformer {
  serialize: (value: SuperJSONValue) => SuperJSONResult
  deserialize: (body: SuperJSONResult) => SuperJSONValue
}

/** tRPC's input transformer: checks a request body before superjson reads it, and answers 400 when either fails. */
export function requestTransformer(serializer: typeof SuperJSON): RequestTransformer {
  return {
    serialize: (value: SuperJSONValue): SuperJSONResult => serializer.serialize(value),
    deserialize: (body: SuperJSONResult): SuperJSONValue => {
      const checked = checkRequestTypes(body)
      if (checked.isErr()) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Invalid request body: ${checked.unwrapErr()}` })
      }
      try {
        return serializer.deserialize<SuperJSONValue>(body)
      } catch (cause) {
        // tRPC would report this as a server error; it is the client's.
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid request body', cause })
      }
    },
  }
}
