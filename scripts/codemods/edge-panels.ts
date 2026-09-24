/**
 * One-off codemod for the glass exploration: panels drawn as a 1px subtle border on the
 * page (border="1px solid" borderColor="border.subtle" borderRadius="panel") become the
 * raised glass `edge` material. Dashed "add" tiles and other borders are left alone.
 *
 *   pnpm tsx scripts/codemods/edge-panels.ts           # report only
 *   pnpm tsx scripts/codemods/edge-panels.ts --write   # apply
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const write = process.argv.includes('--write')
const files = execSync("git ls-files 'apps/control-center/src/**/*.tsx' 'packages/ui/**/*.tsx'", { encoding: 'utf8' })
  .split('\n')
  .filter((file) => file !== '' && !/\.(stories|test)\.tsx$/.test(file))

const BACKGROUNDS = new Set(['surface.raised', 'surface.base', 'transparent'])
let total = 0

function literal(attribute: ts.JsxAttribute): string | undefined {
  const init = attribute.initializer
  if (init === undefined) return undefined
  if (ts.isStringLiteral(init)) return init.text
  if (ts.isJsxExpression(init) && init.expression !== undefined && ts.isStringLiteral(init.expression))
    return init.expression.text
  return undefined
}

for (const file of files) {
  const source = readFileSync(file, 'utf8')
  if (!source.includes('borderRadius="panel"')) continue
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits: Array<{ start: number; end: number; text: string }> = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute)
      const byName = new Map(attributes.map((attribute) => [attribute.name.getText(), attribute]))
      const border = byName.get('border')
      const borderColor = byName.get('borderColor')
      const radius = byName.get('borderRadius')
      const background = byName.get('bg') ?? byName.get('bgColor')
      const backgroundValue = background === undefined ? undefined : literal(background)
      if (
        border !== undefined &&
        literal(border) === '1px solid' &&
        borderColor !== undefined &&
        literal(borderColor) === 'border.subtle' &&
        radius !== undefined &&
        literal(radius) === 'panel' &&
        !byName.has('layerStyle') &&
        (background === undefined || (backgroundValue !== undefined && BACKGROUNDS.has(backgroundValue)))
      ) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart())
        console.log(`  ${file}:${line + 1}`)
        total += 1
        // Replace the border attribute with the layer style and drop what it now provides.
        edits.push({ start: border.getStart(), end: border.getEnd(), text: 'layerStyle="edge"' })
        for (const attribute of [borderColor, background]) {
          if (attribute === undefined) continue
          const start = attribute.getFullStart()
          edits.push({ start, end: attribute.getEnd(), text: '' })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (write && edits.length > 0) {
    let out = source
    for (const edit of edits.sort((a, b) => b.start - a.start))
      out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
    writeFileSync(file, out)
  }
}

console.log(`${write ? 'Converted' : 'Would convert'} ${total} panels`)
