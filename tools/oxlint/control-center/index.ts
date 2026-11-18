import { defineRule, eslintCompatPlugin } from '@oxlint/plugins'

const fontProps = new Set(['fontSize', 'lineHeight'])

/** Chakra components only: lowercase elements such as SVG `<text>` take raw font attributes. */
function isComponent(name: { type: string; name?: string }): boolean {
  return name.type !== 'JSXIdentifier' || /^[A-Z]/.test(name.name ?? '')
}

/** AGENTS.md: use Chakra's textStyle tokens instead of separate fontSize and lineHeight props. */
const useTextStyleRule = defineRule({
  meta: {
    type: 'suggestion',
    docs: { description: 'Disallow fontSize and lineHeight props on components; use a textStyle token.' },
    messages: {
      useTextStyle:
        'Use a textStyle token from packages/ui/design-system/theme/foundation/typography.ts instead of `{{prop}}`.',
    },
  },
  createOnce(context) {
    return {
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !fontProps.has(node.name.name)) {
          return
        }
        if (node.parent.type === 'JSXOpeningElement' && isComponent(node.parent.name)) {
          context.report({ node, messageId: 'useTextStyle', data: { prop: node.name.name } })
        }
      },
    }
  },
})

/** `formatUsd` rounds to the nearest cent. `toFixed` first would round with the value's own setting, which truncates for currency amounts. */
const formatUsdRoundsRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: 'Disallow toFixed inside a formatUsd call; formatUsd does the rounding.' },
    messages: {
      passTheValue: 'Pass the value to formatUsd without `toFixed`. formatUsd rounds to the nearest cent.',
    },
  },
  createOnce(context) {
    return {
      CallExpression(node) {
        const { callee } = node
        if (callee.type !== 'MemberExpression' || callee.property.type !== 'Identifier') {
          return
        }
        if (callee.property.name !== 'toFixed') {
          return
        }
        for (let parent = node.parent; parent.type !== 'Program'; parent = parent.parent) {
          if (
            parent.type === 'CallExpression' &&
            parent.callee.type === 'Identifier' &&
            parent.callee.name === 'formatUsd'
          ) {
            context.report({ node, messageId: 'passTheValue' })
            return
          }
          if (parent.type.includes('Function')) {
            return
          }
        }
      },
    }
  },
})

/** `<app>/src/features/<name>`, then the path inside that feature, if any. */
const featurePath = /([^/]+)\/src\/features\/([^/]+)(?:\/(.+))?$/
const scriptExtension = /\.[cm]?[jt]sx?$/
const viModuleCalls = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock'])

type FeatureFile = { feature: string; name: string; inside: string | undefined }

function featureFile(path: string): FeatureFile | undefined {
  const match = featurePath.exec(path)
  if (match?.[1] === undefined) {
    return undefined
  }
  return { feature: `${match[1]}/${match[2]}`, name: match[2], inside: match[3]?.replace(scriptExtension, '') }
}

/** The path a specifier points to, or undefined for npm packages. Paths use forward slashes. */
function importedPath(specifier: string, importer: string): string | undefined {
  if (specifier.startsWith('@hoseki/')) {
    return specifier
  }
  if (!specifier.startsWith('.')) {
    return undefined
  }
  const parts = importer.replaceAll('\\', '/').split('/').slice(0, -1)
  for (const part of specifier.split('/')) {
    if (part === '..') {
      parts.pop()
    } else if (part !== '.' && part !== '') {
      parts.push(part)
    }
  }
  return parts.join('/')
}

/** A feature's index.ts is its only entry point for code outside the feature. */
const featureBoundaryRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: "Disallow imports of a feature's internal files from outside the feature." },
    messages: {
      useIndex:
        'Import the {{name}} feature through its index.ts, not `{{specifier}}`. Export what you need from its index.ts.',
    },
  },
  createOnce(context) {
    function check(node: { type: string; value?: unknown } | null | undefined): void {
      if (node?.type !== 'Literal') {
        return
      }
      // A non-string literal turns into text that can never name a feature file.
      const specifier = String(node.value)
      const path = importedPath(specifier, context.filename)
      const target = path === undefined ? undefined : featureFile(path)
      if (!target || target.inside === undefined || target.inside === 'index') {
        return
      }
      const importer = featureFile(context.filename.replaceAll('\\', '/'))
      if (importer?.inside !== undefined && importer.feature === target.feature) {
        return
      }
      context.report({ node, messageId: 'useIndex', data: { name: target.name, specifier } })
    }
    return {
      ImportDeclaration(node) {
        check(node.source)
      },
      ExportNamedDeclaration(node) {
        check(node.source)
      },
      ExportAllDeclaration(node) {
        check(node.source)
      },
      ImportExpression(node) {
        check(node.source)
      },
      TSImportType(node) {
        check(node.source)
      },
      CallExpression(node) {
        const { callee } = node
        if (
          callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          callee.object.name === 'vi' &&
          callee.property.type === 'Identifier' &&
          viModuleCalls.has(callee.property.name)
        ) {
          check(node.arguments[0])
        }
      },
    }
  },
})

/** Rules for Control Center's own conventions. */
export default eslintCompatPlugin({
  meta: { name: 'control-center' },
  rules: {
    'feature-boundary': featureBoundaryRule,
    'format-usd-rounds': formatUsdRoundsRule,
    'use-text-style': useTextStyleRule,
  },
})
