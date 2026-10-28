// Prints the structurally expanded tRPC input/output type of every procedure, so Zod 3 and Zod 4 can be diffed.
//   node zod-harness/router-types.mjs > types.txt   (needs zod-harness/procedures.json from a harness run)
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '..')
const paths = JSON.parse(readFileSync(join(import.meta.dirname, 'procedures.json'), 'utf8'))
const probe = join(root, 'apps/api-sentinel/src/__router_types_probe.ts')
const access = (p) => p.split('.').map((k) => `[${JSON.stringify(k)}]`).join('')
writeFileSync(
  probe,
  [
    `import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'`,
    `import type { AppRouter } from './modules/trpc/router'`,
    `type I = inferRouterInputs<AppRouter>`,
    `type O = inferRouterOutputs<AppRouter>`,
    ...paths.flatMap((p, i) => [`export declare const in${i}: I${access(p)}`, `export declare const out${i}: O${access(p)}`]),
  ].join('\n'),
)
try {
  const config = ts.getParsedCommandLineOfConfigFile(join(root, 'apps/api-sentinel/tsconfig.json'), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  })
  const program = ts.createProgram({ rootNames: [...config.fileNames, probe], options: { ...config.options, noEmit: true } })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(probe)
  const show = (type, depth, seen) => {
    if (type.flags & ts.TypeFlags.Any) return 'any'
    if (type.flags & ts.TypeFlags.Unknown) return 'unknown'
    if (type.isUnion()) return type.types.map((t) => show(t, depth, seen)).sort().join(' | ')
    if (type.isIntersection()) return type.types.map((t) => show(t, depth, seen)).sort().join(' & ')
    if (!(type.flags & ts.TypeFlags.Object)) return checker.typeToString(type)
    if (depth > 7 || seen.has(type)) return checker.typeToString(type)
    const named = checker.typeToString(type)
    if (/^(Date|Decimal|Uint8Array|Buffer|Map<|Set<|Promise<)/.test(named)) return named
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const args = checker.getTypeArguments(type)
      return `${checker.isTupleType(type) ? 'tuple' : 'array'}<${args.map((a) => show(a, depth + 1, seen)).join(', ')}>`
    }
    if (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length) return named
    const next = new Set(seen).add(type)
    const props = checker.getPropertiesOfType(type).map((p) => {
      const optional = p.flags & ts.SymbolFlags.Optional ? '?' : ''
      const readonly = p.declarations?.some((d) => ts.getCombinedModifierFlags(d) & ts.ModifierFlags.Readonly) ? 'readonly ' : ''
      return `${readonly}${p.name}${optional}: ${show(checker.getTypeOfSymbol(p), depth + 1, next)}`
    })
    return `{ ${props.sort().join('; ')} }`
  }
  const lines = []
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const d of statement.declarationList.declarations) {
      const name = d.name.getText(source)
      const index = Number(name.replace(/\D/g, ''))
      lines.push(`${paths[index]} ${name.startsWith('in') ? 'input' : 'output'} :: ${show(checker.getTypeAtLocation(d.name), 0, new Set())}`)
    }
  }
  process.stdout.write(lines.sort().join('\n') + '\n')
} finally {
  rmSync(probe, { force: true })
}
