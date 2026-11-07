// Temporary Zod 3 -> 4 differential harness. Not meant to merge.
//   record (on Zod 3):  ZOD_HARNESS_MODE=record pnpm exec vitest run --config zod-harness/vitest.config.mts
//   replay (on Zod 4):  pnpm exec vitest run --config zod-harness/vitest.config.mts
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { registerCustomSerializers } from '@hoseki/packages/custom-serializers'
import SuperJSON from 'superjson'
import { expect, test } from 'vitest'

registerCustomSerializers(SuperJSON)

const root = resolve(import.meta.dirname, '..')
const recordedFile = join(import.meta.dirname, 'recorded.json')
const reportFile = join(import.meta.dirname, 'report.md')
const mode = process.env['ZOD_HARNESS_MODE'] === 'record' ? 'record' : 'replay'

const SOURCE_DIRS = ['apps/api-sentinel/src', 'apps/control-center/src', 'packages']
const EXCLUDED = [
  /\.test\.tsx?$/,
  /\.stories\.tsx?$/,
  /fixtures/,
  /node_modules/,
  /\/dist\//,
  /\/scripts\//,
  /\/(main|cli|dev)\.ts$/,
]

type Issue = { path: (string | number)[]; code: string; message: string }
type Outcome = { ok: true; data: string } | { ok: false; issues: Issue[] } | { threw: string }
type Entry = { key: string; label: string; input: string; outcome: Outcome }

const registry = new Map<string, () => Record<string, unknown>>()
Reflect.set(globalThis, '__zodHarness', (file: string, getter: () => Record<string, unknown>) =>
  registry.set(file, getter),
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (EXCLUDED.some((r) => r.test(full))) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && /from 'zod'/.test(readFileSync(full, 'utf8'))) out.push(full)
  }
  return out
}

function isSchema(value: any): boolean {
  if (value == null || typeof value.safeParseAsync !== 'function') return false
  const internals = value._zod ?? value._def
  return internals != null && typeof internals === 'object' && typeof internals !== 'function'
}

const XPUB =
  'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j'
const SINGLESIG =
  'wpkh([3e6bae7c/84h/0h/0h]xpub6CgLXnBK8dLAT8icUHZsExdvy56yAqB9MS4aRwNyYvQjndS735FLj1nxYgTEXtHvfRroGEzWB5BULt7TjpyWnhRb72PkTtLpv9o2mgBhFtJ/<0;1>/*)#9gdugsd3'
const MULTISIG =
  'wsh(sortedmulti(2,[ac16c6a4/48h/0h/0h/2h]xpub6DppyoduRB3cRe68F7bsKSyZP7djEhPGESSqt3jwqcYsyCZEihVS1ykAqiVyGr8LC7PNfqZLaNRSgV9UiD7iXfmLi2EVrDSWaUmBdh5e6u4/<0;1>/*,[016e9edf/48h/0h/0h/2h]xpub6F6RVbNtaYq1ggd6mhXT35JVeGGs5CkxdUWxYRW9AQ52jGGn15R4mphVU8fovuKVcYMjqjPs4bdxYgcZsMbcU492JTq7KLQXSEosrfCnsr8/<0;1>/*))#4glz33xa'
const TXID = '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'

async function candidatePool(): Promise<unknown[]> {
  const { default: Decimal } = await import('decimal.js')
  const prefixes = new Set<string>()
  for (const getter of registry.values()) {
    for (const [name, value] of Object.entries(getter())) {
      if (typeof value === 'string' && /prefix/i.test(name)) prefixes.add(value)
      if (Array.isArray(value) && value.every((v) => typeof v === 'string') && /prefix/i.test(name))
        value.forEach((v) => prefixes.add(v))
    }
  }
  for (const source of readFileSync(join(root, 'packages/schemas/hosid.ts'), 'utf8').matchAll(/'([a-z_]+)'/g))
    prefixes.add(source[1])
  for (const file of SOURCE_DIRS.flatMap((d) => walk(join(root, d)))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:createHosidSchema|Id\.schema)\('([a-z_]+)'\)/g))
      prefixes.add(m[1])
  }
  return [
    '123456',
    '123-45-6789',
    '+15555550123',
    'UTC',
    'America/New_York',
    '1.5',
    new Decimal('1.5'),
    XPUB,
    'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj',
    'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
    SINGLESIG,
    MULTISIG,
    `bitcoin_mainnet::${SINGLESIG}`,
    `bitcoin_mainnet::${XPUB}`,
    'bitcoin_mainnet::bc1pl4hkmfadn7lqkvwqfn8ghpaguvvenya86fr5nkhszw9lmynq4jgq6ng7qu',
    'bc1pl4hkmfadn7lqkvwqfn8ghpaguvvenya86fr5nkhszw9lmynq4jgq6ng7qu',
    TXID,
    Buffer.from(TXID, 'hex'),
    "m/48'/0'/0'/2'",
    'm/84h/0h/0h',
    '3e6bae7c',
    `${'ab'.repeat(16)}_${'cd'.repeat(16)}`,
    'SQLITE_BUSY',
    { code: 'SQLITE_BUSY' },
    ...[...prefixes].map((p) => `${p}_${'a1B2c3D4e5F6g7H8i9J0k'}`),
  ]
}

async function collectSchemas(): Promise<{ schemas: Map<string, any>; importErrors: string[]; files: number }> {
  const files = SOURCE_DIRS.flatMap((d) => walk(join(root, d)))
  const importErrors: string[] = []
  for (const file of files) {
    try {
      await import(file)
    } catch (error) {
      importErrors.push(`${relative(root, file)}: ${String(error).split('\n')[0]}`)
    }
  }
  const schemas = new Map<string, any>()
  for (const [file, getter] of registry) {
    for (const [name, value] of Object.entries(getter())) {
      if (isSchema(value)) schemas.set(`${file}#${name}`, value)
      else if (value != null && (typeof value === 'object' || typeof value === 'function')) {
        for (const prop of Object.getOwnPropertyNames(value)) {
          let nested: unknown
          try {
            nested = Reflect.get(value, prop)
          } catch {
            continue
          }
          if (isSchema(nested)) schemas.set(`${file}#${name}.${prop}`, nested)
        }
      }
    }
  }
  const { appRouter } = await import('../apps/api-sentinel/src/modules/trpc/router')
  writeFileSync(join(import.meta.dirname, 'procedures.json'), JSON.stringify(Object.keys(appRouter._def.procedures).sort()))
  for (const [path, procedure] of Object.entries<any>(appRouter._def.procedures)) {
    const inputs: unknown[] = procedure._def.inputs ?? []
    inputs.forEach((input, index) => isSchema(input) && schemas.set(`router:${path}#${index}`, input))
  }
  return { schemas, importErrors, files: files.length }
}

function serialize(value: unknown): string | undefined {
  try {
    return SuperJSON.stringify(value)
  } catch {
    return undefined
  }
}

async function run(schema: any, input: unknown): Promise<Outcome> {
  try {
    const result = await schema.safeParseAsync(input)
    if (result.success) return { ok: true, data: serialize(result.data) ?? '<unserializable output>' }
    return {
      ok: false,
      issues: result.error.issues.map((i: any) => ({ path: i.path, code: i.code, message: i.message })),
    }
  } catch (error) {
    return { threw: String(error).split('\n')[0] }
  }
}

test(`zod harness (${mode})`, async () => {
  const { schemas, importErrors, files } = await collectSchemas()

  if (mode === 'record') {
    const { setCandidates, variants } = await import('./generate')
    setCandidates(await candidatePool())
    const entries: Entry[] = []
    let samplesOk = 0
    for (const [key, schema] of schemas) {
      for (const variant of variants(schema)) {
        const input = serialize(variant.input)
        if (input === undefined) continue
        // Record against the round-tripped value so replay parses exactly the same input.
        let replayed: unknown
        try {
          replayed = SuperJSON.parse(input)
        } catch {
          continue
        }
        const outcome = await run(schema, replayed)
        if (variant.label === 'sample' && 'ok' in outcome && outcome.ok) samplesOk++
        entries.push({ key, label: variant.label, input, outcome })
      }
    }
    writeFileSync(recordedFile, JSON.stringify({ importErrors, entries }, null, 0))
    writeFileSync(
      reportFile,
      [
        `# Recorded on Zod 3`,
        `- source files with zod: ${files}`,
        `- schemas: ${schemas.size} (valid generated sample: ${samplesOk})`,
        `- cases: ${entries.length}`,
        `- import errors: ${importErrors.length}`,
        ...importErrors.map((e) => `  - ${e}`),
        '',
        '## Schemas whose generated sample is rejected (only invalid paths are compared for these)',
        ...[...schemas.keys()]
          .filter((k) => {
            const e = entries.find((x) => x.key === k && x.label === 'sample')
            return !(e && 'ok' in e.outcome && e.outcome.ok)
          })
          .map((k) => `- ${k}`),
      ].join('\n'),
    )
    expect(entries.length).toBeGreaterThan(0)
    return
  }

  const recorded: { importErrors: string[]; entries: Entry[] } = JSON.parse(readFileSync(recordedFile, 'utf8'))
  const buckets: Record<string, string[]> = {
    'missing schema': [],
    'success changed': [],
    'output changed': [],
    'threw changed': [],
    'issue paths changed': [],
    'issue codes changed': [],
    'issue messages changed': [],
  }
  const missing = new Set<string>()
  let skipped = 0
  for (const entry of recorded.entries) {
    const schema = schemas.get(entry.key)
    if (!schema) {
      missing.add(entry.key)
      continue
    }
    let input: unknown
    try {
      input = SuperJSON.parse(entry.input)
    } catch {
      skipped++
      continue
    }
    const now = await run(schema, input)
    const before = entry.outcome
    const line = (extra: string) => `\`${entry.key}\` [${entry.label}] ${extra}`
    if ('threw' in before || 'threw' in now) {
      if (JSON.stringify(before) !== JSON.stringify(now))
        buckets['threw changed'].push(line(`${JSON.stringify(before)} -> ${JSON.stringify(now)}`))
      continue
    }
    if (before.ok !== now.ok) {
      buckets['success changed'].push(
        line(
          `input=${entry.input} ${before.ok ? 'accepted' : 'rejected'} -> ${now.ok ? 'accepted' : `rejected ${JSON.stringify(now.ok ? [] : now.issues)}`}`,
        ),
      )
      continue
    }
    if (before.ok && now.ok) {
      if (before.data !== now.data)
        buckets['output changed'].push(line(`input=${entry.input} ${before.data} -> ${now.data}`))
      continue
    }
    if (!before.ok && !now.ok) {
      const paths = (o: Issue[]) => JSON.stringify(o.map((i) => i.path).sort())
      const codes = (o: Issue[]) => JSON.stringify(o.map((i) => `${i.path.join('.')}:${i.code}`).sort())
      const messages = (o: Issue[]) => JSON.stringify(o.map((i) => `${i.path.join('.')}:${i.message}`).sort())
      if (paths(before.issues) !== paths(now.issues))
        buckets['issue paths changed'].push(line(`${paths(before.issues)} -> ${paths(now.issues)}`))
      else if (codes(before.issues) !== codes(now.issues))
        buckets['issue codes changed'].push(line(`${codes(before.issues)} -> ${codes(now.issues)}`))
      else if (messages(before.issues) !== messages(now.issues))
        buckets['issue messages changed'].push(line(`${messages(before.issues)} -> ${messages(now.issues)}`))
    }
  }
  buckets['missing schema'] = [...missing].map((k) => `\`${k}\``)

  writeFileSync(
    reportFile,
    [
      `# Replay on current Zod`,
      `- schemas now: ${schemas.size}, recorded cases: ${recorded.entries.length}`,
      `- import errors now: ${importErrors.length}`,
      `- cases skipped (input does not round-trip through superjson): ${skipped}`,
      ...importErrors.map((e) => `  - ${e}`),
      '',
      ...Object.entries(buckets).flatMap(([name, lines]) => [
        `## ${name} (${lines.length})`,
        ...lines.map((l) => `- ${l}`),
        '',
      ]),
    ].join('\n'),
  )
})
