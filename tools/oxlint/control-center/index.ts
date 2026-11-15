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

/** Rules for Control Center's own conventions. */
export default eslintCompatPlugin({
  meta: { name: 'control-center' },
  rules: { 'use-text-style': useTextStyleRule },
})
