// Zod 3 only: walks schema definitions to build a valid-looking sample and edge-case variants.
// Runs only when recording on the Zod 3 baseline; replay never imports this file.

type Def = Record<string, any>
type Path = (string | number)[]
export type Variant = { label: string; input: unknown }

const UUID = '123e4567-e89b-42d3-a456-426614174000'
const MAX_DEPTH = 6

function def(schema: any): Def {
  return schema?._def ?? {}
}

function stringSample(d: Def): string {
  const checks: Def[] = d.checks ?? []
  const kinds = new Set(checks.map((c) => c.kind))
  let value = 'sample'
  if (kinds.has('uuid')) value = UUID
  else if (kinds.has('email')) value = 'user@example.com'
  else if (kinds.has('url')) value = 'https://example.com/path'
  else if (kinds.has('datetime')) value = '2024-01-02T03:04:05.000Z'
  else if (kinds.has('date')) value = '2024-01-02'
  else if (kinds.has('cuid')) value = 'cjld2cjxh0000qzrmn831i7rn'
  else if (kinds.has('ip')) value = '192.168.0.1'
  for (const c of checks) {
    if (c.kind === 'startsWith' && !value.startsWith(c.value)) value = c.value + value
    if (c.kind === 'endsWith' && !value.endsWith(c.value)) value = value + c.value
    if (c.kind === 'includes' && !value.includes(c.value)) value = value + c.value
  }
  for (const c of checks) {
    if ((c.kind === 'min' || c.kind === 'length') && value.length < c.value) value = value.padEnd(c.value, 'a')
    if ((c.kind === 'max' || c.kind === 'length') && value.length > c.value) value = value.slice(0, c.value)
  }
  if (kinds.has('toLowerCase')) value = value.toLowerCase()
  return value
}

function numberSample(d: Def): number {
  const checks: Def[] = d.checks ?? []
  let value = 1
  for (const c of checks) {
    if (c.kind === 'min') value = Math.max(value, c.inclusive ? c.value : c.value + 1)
    if (c.kind === 'max') value = Math.min(value, c.inclusive ? c.value : c.value - 1)
  }
  return value
}

let candidates: unknown[] = []
const seeded = new Map<any, unknown>()

/** Known-valid domain values, tried when the structural sample of a node is rejected. */
export function setCandidates(values: unknown[]): void {
  candidates = values
  seeded.clear()
}

function accepts(schema: any, value: unknown): boolean {
  try {
    return schema.safeParse(value).success
  } catch {
    return false
  }
}

export function sample(schema: any, depth = 0): unknown {
  if (seeded.has(schema)) return clone(seeded.get(schema))
  const raw = structuralSample(schema, depth)
  let chosen = raw
  if (!accepts(schema, raw)) {
    const hit = candidates.find((c) => accepts(schema, c))
    if (hit !== undefined) chosen = hit
  }
  if (schema && typeof schema === 'object') seeded.set(schema, chosen)
  return clone(chosen)
}

function structuralSample(schema: any, depth: number): unknown {
  const d = def(schema)
  if (depth > MAX_DEPTH) return undefined
  const next = (s: any) => sample(s, depth + 1)
  switch (d.typeName) {
    case 'ZodString':
      return stringSample(d)
    case 'ZodNumber':
      return numberSample(d)
    case 'ZodBigInt':
      return 1n
    case 'ZodBoolean':
      return true
    case 'ZodDate':
      return new Date('2024-01-02T03:04:05.000Z')
    case 'ZodLiteral':
      return d.value
    case 'ZodEnum':
      return d.values[0]
    case 'ZodNativeEnum':
      return Object.values(d.values).find((v) => typeof d.values[String(v)] !== 'number')
    case 'ZodUndefined':
    case 'ZodVoid':
      return undefined
    case 'ZodNull':
      return null
    case 'ZodAny':
    case 'ZodUnknown':
      return 'any'
    case 'ZodArray': {
      const length = Math.max(1, d.minLength?.value ?? 0, d.exactLength?.value ?? 0)
      return Array.from({ length }, () => next(d.type))
    }
    case 'ZodSet':
      return new Set([next(d.valueType)])
    case 'ZodMap':
      return new Map([[next(d.keyType), next(d.valueType)]])
    case 'ZodTuple':
      return d.items.map(next)
    case 'ZodObject': {
      const shape = d.shape()
      return Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, next(v)]))
    }
    case 'ZodRecord': {
      const keyDef = def(d.keyType)
      const keys: string[] = keyDef.typeName === 'ZodEnum' ? keyDef.values : [String(next(d.keyType))]
      return Object.fromEntries(keys.map((k) => [k, next(d.valueType)]))
    }
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return next(d.innerType)
    case 'ZodBranded':
      return next(d.type)
    case 'ZodEffects':
      return next(d.schema)
    case 'ZodPipeline':
      return next(d.in)
    case 'ZodLazy':
      return next(d.getter())
    case 'ZodUnion':
      return next(d.options[0])
    case 'ZodDiscriminatedUnion':
      return next(d.options[0] ?? [...d.optionsMap.values()][0])
    case 'ZodIntersection': {
      const left = next(d.left)
      const right = next(d.right)
      return typeof left === 'object' && typeof right === 'object' ? { ...left, ...right } : left
    }
    default:
      return undefined
  }
}

type Leaf = { path: Path; schema: any; optionalOrDefault: boolean }

// Collects object fields and leaves reachable through objects (and the first array item / union option).
function leaves(schema: any, path: Path = [], depth = 0, out: Leaf[] = []): Leaf[] {
  const d = def(schema)
  if (depth > MAX_DEPTH) return out
  switch (d.typeName) {
    case 'ZodObject':
      for (const [k, v] of Object.entries(d.shape())) {
        const vd = def(v)
        out.push({
          path: [...path, k],
          schema: v,
          optionalOrDefault: ['ZodOptional', 'ZodDefault'].includes(vd.typeName),
        })
        leaves(v, [...path, k], depth + 1, out)
      }
      return out
    case 'ZodOptional':
    case 'ZodNullable':
    case 'ZodDefault':
    case 'ZodCatch':
    case 'ZodReadonly':
      return leaves(d.innerType, path, depth + 1, out)
    case 'ZodBranded':
      return leaves(d.type, path, depth + 1, out)
    case 'ZodEffects':
      return leaves(d.schema, path, depth + 1, out)
    case 'ZodPipeline':
      return leaves(d.in, path, depth + 1, out)
    case 'ZodArray':
      return leaves(d.type, [...path, 0], depth + 1, out)
    case 'ZodUnion':
    case 'ZodDiscriminatedUnion':
      for (const option of d.options) leaves(option, path, depth + 1, out)
      return out
    default:
      out.push({ path, schema, optionalOrDefault: false })
      return out
  }
}

function core(schema: any): Def {
  let d = def(schema)
  for (let i = 0; i < 10; i++) {
    if (['ZodOptional', 'ZodNullable', 'ZodDefault', 'ZodCatch', 'ZodReadonly'].includes(d.typeName))
      d = def(d.innerType)
    else if (d.typeName === 'ZodBranded') d = def(d.type)
    else if (d.typeName === 'ZodEffects') d = def(d.schema)
    else if (d.typeName === 'ZodPipeline') d = def(d.in)
    else break
  }
  return d
}

// Deep-copies plain data but keeps class instances (Decimal, Buffer) by reference.
function clone(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clone)
  if (value instanceof Date) return new Date(value.getTime())
  if (value instanceof Map) return new Map([...value].map(([k, v]) => [clone(k), clone(v)]))
  if (value instanceof Set) return new Set([...value].map(clone))
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)]))
  return value
}

function setAt(root: unknown, path: Path, value: unknown, remove = false): unknown {
  if (path.length === 0) return value
  const copy: any = clone(root)
  let cursor = copy
  for (const key of path.slice(0, -1)) {
    if (cursor == null || typeof cursor !== 'object') return copy
    cursor = cursor[key]
  }
  if (cursor == null || typeof cursor !== 'object') return copy
  const last = path[path.length - 1]
  if (remove) delete cursor[last]
  else cursor[last] = value
  return copy
}

const pathLabel = (path: Path) => (path.length ? path.join('.') : '<root>')

export function variants(schema: any): Variant[] {
  const base = sample(schema)
  const out: Variant[] = [
    { label: 'sample', input: base },
    { label: 'probe:undefined', input: undefined },
    { label: 'probe:null', input: null },
    { label: 'probe:{}', input: {} },
    { label: 'probe:[]', input: [] },
    { label: 'probe:""', input: '' },
    { label: 'probe:0', input: 0 },
    { label: 'probe:Infinity', input: Infinity },
    { label: 'probe:-Infinity', input: -Infinity },
    { label: 'probe:NaN', input: NaN },
    { label: 'probe:2^53', input: 2 ** 53 },
    { label: 'probe:1.5', input: 1.5 },
    { label: 'probe:"1"', input: '1' },
  ]
  const seen = new Set<string>()
  for (const leaf of leaves(schema)) {
    const id = `${pathLabel(leaf.path)}|${core(leaf.schema).typeName}`
    if (seen.has(id)) continue
    seen.add(id)
    const p = pathLabel(leaf.path)
    const d = core(leaf.schema)
    if (leaf.path.length && typeof leaf.path[leaf.path.length - 1] === 'string') {
      out.push({ label: `omit:${p}`, input: setAt(base, leaf.path, undefined, true) })
      out.push({ label: `undefined:${p}`, input: setAt(base, leaf.path, undefined) })
      out.push({ label: `null:${p}`, input: setAt(base, leaf.path, null) })
    }
    switch (d.typeName) {
      case 'ZodNumber':
        out.push({ label: `infinity:${p}`, input: setAt(base, leaf.path, Infinity) })
        out.push({ label: `-infinity:${p}`, input: setAt(base, leaf.path, -Infinity) })
        out.push({ label: `unsafe-int:${p}`, input: setAt(base, leaf.path, 2 ** 53) })
        out.push({ label: `float:${p}`, input: setAt(base, leaf.path, 1.5) })
        out.push({ label: `nan:${p}`, input: setAt(base, leaf.path, NaN) })
        out.push({ label: `string-number:${p}`, input: setAt(base, leaf.path, '1') })
        break
      case 'ZodString': {
        const kinds = new Set((d.checks ?? []).map((c: Def) => c.kind))
        out.push({ label: `empty:${p}`, input: setAt(base, leaf.path, '') })
        out.push({ label: `padded:${p}`, input: setAt(base, leaf.path, ` ${stringSample(d)} `) })
        out.push({ label: `number:${p}`, input: setAt(base, leaf.path, 1) })
        if (kinds.has('uuid')) {
          for (const u of [
            '00000000-0000-0000-0000-000000000000',
            'ffffffff-ffff-ffff-ffff-ffffffffffff',
            '123e4567-e89b-02d3-a456-426614174000',
            '123e4567-e89b-42d3-0456-426614174000',
            '123E4567-E89B-42D3-A456-426614174000',
          ])
            out.push({ label: `uuid(${u}):${p}`, input: setAt(base, leaf.path, u) })
        }
        if (kinds.has('email')) {
          for (const e of [
            'User+tag@Example.COM',
            'a@b',
            'first.last@sub.example.co.uk',
            "o'brien@example.com",
            'a..b@example.com',
          ])
            out.push({ label: `email(${e}):${p}`, input: setAt(base, leaf.path, e) })
        }
        if (kinds.has('url')) {
          for (const u of ['example.com', 'http://localhost:8080', 'mailto:a@b.com', 'ftp://x', 'https://ex ample.com'])
            out.push({ label: `url(${u}):${p}`, input: setAt(base, leaf.path, u) })
        }
        break
      }
      case 'ZodRecord': {
        const keyDef = def(d.keyType)
        if (keyDef.typeName === 'ZodEnum') {
          out.push({
            label: `record-partial:${p}`,
            input: setAt(base, leaf.path, { [keyDef.values[0]]: sample(d.valueType) }),
          })
          out.push({ label: `record-empty:${p}`, input: setAt(base, leaf.path, {}) })
          out.push({
            label: `record-extra-key:${p}`,
            input: setAt(base, leaf.path, { ...(sample(leaf.schema) as object), extra: sample(d.valueType) }),
          })
        }
        break
      }
      case 'ZodEnum':
        out.push({ label: `enum-unknown:${p}`, input: setAt(base, leaf.path, '__unknown__') })
        break
      case 'ZodDate':
        out.push({ label: `date-invalid:${p}`, input: setAt(base, leaf.path, new Date('invalid')) })
        out.push({ label: `date-string:${p}`, input: setAt(base, leaf.path, '2024-01-02') })
        break
    }
  }
  if (base && typeof base === 'object' && !Array.isArray(base)) {
    out.push({ label: 'extra-key', input: { ...(base as object), __extra__: 'x' } })
  }
  return out
}
