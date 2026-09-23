/**
 * One-off codemod for the dual-theme exploration: rewrites palette colour
 * literals (`neutral.*`, `shades.*`) into semantic role tokens, using the
 * nearest enclosing prop name to decide whether a literal is text, border or
 * background colour.
 *
 *   pnpm tsx scripts/codemods/semantic-colors.ts           # report only
 *   pnpm tsx scripts/codemods/semantic-colors.ts --write   # apply
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

type Category = 'text' | 'border' | 'bg'

const TOKEN =
  /^(neutral\.(50|100|200|300|400|500|600|700|800|900)|shades\.(0|100)|(success|warning|error|green|red)\.(50|100|200|300|400|500|600|700|800|900))$/

const STATUS_ALIAS: Record<string, string> = { green: 'success', red: 'error' }

/** Status palettes map by role rather than by step: light steps are fills, mid steps solids, dark steps text. */
function statusReplacement(category: Category, token: string): string | undefined {
  const [palette, stepText] = token.split('.')
  const status = STATUS_ALIAS[palette] ?? palette
  if (!['success', 'warning', 'error'].includes(status)) return undefined
  const step = Number(stepText)
  if (category === 'text') return `status.${status}.fg`
  if (category === 'bg') return step <= 200 ? `status.${status}.bg` : `status.${status}.solid`
  return step <= 300 ? `status.${status}.border` : `status.${status}.solid`
}

const MAP: Record<Category, Record<string, string>> = {
  text: {
    'neutral.900': 'text.primary',
    'neutral.800': 'text.primary',
    'neutral.700': 'text.secondary',
    'neutral.600': 'text.secondary',
    'neutral.500': 'text.tertiary',
    'neutral.400': 'text.tertiary',
    'neutral.300': 'text.disabled',
    'shades.0': 'text.inverse',
    'shades.100': 'text.primary',
  },
  border: {
    'neutral.50': 'border.subtle',
    'neutral.100': 'border.subtle',
    'neutral.200': 'border.subtle',
    'neutral.300': 'border.strong',
    'neutral.400': 'border.strong',
    'neutral.500': 'border.strong',
    'neutral.900': 'border.inverse',
    'shades.0': 'border.subtle',
  },
  bg: {
    'shades.0': 'surface.raised',
    'neutral.50': 'surface.subtle',
    'neutral.100': 'surface.muted',
    'neutral.200': 'surface.emphasis',
    'neutral.300': 'surface.emphasis',
    'neutral.800': 'surface.inverse',
    'neutral.900': 'surface.inverse',
  },
}

function categoryFor(name: string): Category | null {
  if (/^(bg|bgColor|background|backgroundColor)$/.test(name)) return 'bg'
  if (/^border.*Color$|^outlineColor$|^divideColor$|^borderColor$/.test(name)) return 'border'
  if (/^(color|textColor|fill|stroke|iconColor|caretColor|placeholderColor|textDecorationColor)$/.test(name))
    return 'text'
  return null
}

function propName(node: ts.Node): string | null {
  if (ts.isJsxAttribute(node)) return node.name.getText()
  if (ts.isPropertyAssignment(node)) {
    const n = node.name
    if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text
  }
  return null
}

/** Walk up to the nearest prop name, looking through ternaries, logical ops, parens and responsive objects. */
function enclosingProp(node: ts.Node): string | null {
  let cur: ts.Node | undefined = node.parent
  while (cur) {
    const name = propName(cur)
    if (name !== null) {
      // Responsive / condition objects: `color={{ base: 'neutral.600', md: ... }}` → keep climbing.
      if (/^(base|sm|md|lg|xl|2xl|_[a-zA-Z]+)$/.test(name)) {
        cur = cur.parent
        continue
      }
      return name
    }
    if (
      ts.isConditionalExpression(cur) ||
      ts.isBinaryExpression(cur) ||
      ts.isParenthesizedExpression(cur) ||
      ts.isJsxExpression(cur) ||
      ts.isObjectLiteralExpression(cur) ||
      ts.isArrayLiteralExpression(cur) ||
      ts.isAsExpression(cur)
    ) {
      cur = cur.parent
      continue
    }
    return null
  }
  return null
}

const write = process.argv.includes('--write')
const files = execSync(
  "git ls-files 'apps/control-center/src/**/*.tsx' 'apps/control-center/src/**/*.ts' 'packages/ui/**/*.tsx' 'packages/ui/**/*.ts'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((f) => f && !/\.(stories|test)\.tsx?$/.test(f) && !f.endsWith('foundation/colors.ts'))

const counts = new Map<string, number>()
const unresolved: string[] = []
let changedFiles = 0

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!/neutral\.|shades\.|success\.|warning\.|error\.|green\.|red\./.test(src)) continue
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  const edits: Array<{ start: number; end: number; text: string }> = []

  const visit = (node: ts.Node): void => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && TOKEN.test(node.text)) {
      const name = enclosingProp(node)
      const category = name === null ? null : categoryFor(name)
      const replacement =
        category === null ? undefined : (MAP[category][node.text] ?? statusReplacement(category, node.text))
      if (replacement === undefined) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        unresolved.push(`${file}:${line + 1}  ${name ?? '?'} = ${node.text}`)
      } else {
        const key = `${category} ${node.text} → ${replacement}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
        // Preserve the original quote style: replace only the text between the quotes.
        edits.push({ start: node.getStart() + 1, end: node.getEnd() - 1, text: replacement })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (write && edits.length > 0) {
    let out = src
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end)
    writeFileSync(file, out)
    changedFiles += 1
  }
}

const total = [...counts.values()].reduce((a, b) => a + b, 0)
console.log(`Rewritable: ${total}${write ? ` (applied in ${changedFiles} files)` : ''}`)
for (const [k, v] of [...counts.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
console.log(`\nUnresolved (${unresolved.length}) — handle by hand:`)
for (const u of unresolved) console.log(`  ${u}`)
