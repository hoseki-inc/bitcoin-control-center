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

type LiteralValue = string | number | boolean | RegExp | bigint | null | undefined

const exchangeSourcePath = /apps\/api-sentinel\/src\/features\/exchanges\/(.+)\.ts$/
const exchangeTestPath = /\.(?:test|fixtures)\.ts$/
const providerStatuses = new Set<LiteralValue>([401, 403, 429])
const providerErrorClasses = new Set(['StrikeApiError', 'RobinhoodApiError'])
const providerErrorNamespaces = new Set(['Coinbase', 'Kraken'])
const krakenErrorCodes = new Set<LiteralValue>(['EAPI:Invalid key', 'EGeneral:Permission denied'])
const unsafeLogLevels = new Set(['info', 'warn', 'error', 'fatal'])
const rawErrorLogKeys = new Set(['err', 'error'])

function isProviderErrorTypeNode(node: {
  type: string
  name?: string
  object?: { type: string; name?: string }
  property?: { type: string; name?: string }
}): boolean {
  if (node.type === 'Identifier' && node.name !== undefined) {
    return providerErrorClasses.has(node.name)
  }
  return (
    node.type === 'MemberExpression' &&
    node.object?.type === 'Identifier' &&
    node.object.name !== undefined &&
    providerErrorNamespaces.has(node.object.name) &&
    node.property?.type === 'Identifier' &&
    node.property.name === 'ApiError'
  )
}

function isLoggerCallee(node: { type: string; name?: string; property?: { type: string; name?: string } }): boolean {
  if (node.type === 'Identifier') {
    return node.name === 'logger'
  }
  return node.type === 'MemberExpression' && node.property?.type === 'Identifier' && node.property.name === 'logger'
}

function isDescribeSafeProviderFailureCall(node: { type: string; callee?: { type: string; name?: string } }): boolean {
  return (
    node.type === 'CallExpression' &&
    node.callee?.type === 'Identifier' &&
    node.callee.name === 'describeSafeProviderFailure'
  )
}

function isStringLiteralNode(node: { type: string; raw?: string }): boolean {
  return node.type === 'Literal' && (node.raw?.startsWith("'") === true || node.raw?.startsWith('"') === true)
}

/**
 * Exchange provider failures must be classified in provider-errors.ts, never logged as raw Error objects above debug,
 * and never returned as UNAUTHORIZED (which locks the PIN tab in sentinelFetch).
 */
const exchangeProviderErrorsRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Enforce centralized provider error classification, safe warning logs, and non-401 tRPC errors in features/exchanges.',
    },
    messages: {
      classifyDirectly:
        'Classify exchange provider failures with classifyProviderFailure in apps/api-sentinel/src/features/exchanges/provider-errors.ts instead of inspecting status codes or provider error classes directly.',
      rawErrorLog:
        'Do not log raw Error objects above debug in features/exchanges; pass describeSafeProviderFailure(...) from apps/api-sentinel/src/features/exchanges/provider-errors.ts instead.',
      noUnauthorizedTrpc:
        'Do not return UNAUTHORIZED from features/exchanges (sentinelFetch treats 401 as PIN-needed and locks the tab). Use PRECONDITION_FAILED or ExchangeCredentialsRevokedError.',
    },
  },
  createOnce(context) {
    function fileStem(): string | undefined {
      const normalized = context.filename.replaceAll('\\', '/')
      if (exchangeTestPath.test(normalized)) {
        return undefined
      }
      return exchangeSourcePath.exec(normalized)?.[1]
    }
    return {
      BinaryExpression(node) {
        const stem = fileStem()
        if (stem === undefined || stem === 'provider-errors') {
          return
        }
        if (node.operator === 'instanceof' && isProviderErrorTypeNode(node.right)) {
          context.report({ node, messageId: 'classifyDirectly' })
        }
      },
      Literal(node) {
        const stem = fileStem()
        if (stem === undefined) {
          return
        }
        if (node.value === 'UNAUTHORIZED') {
          context.report({ node, messageId: 'noUnauthorizedTrpc' })
        }
        if (stem !== 'provider-errors' && (providerStatuses.has(node.value) || krakenErrorCodes.has(node.value))) {
          context.report({ node, messageId: 'classifyDirectly' })
        }
      },
      TemplateLiteral(node) {
        const stem = fileStem()
        if (stem === undefined || node.expressions.length > 0) {
          return
        }
        const cooked = node.quasis[0]?.value.cooked
        if (cooked === 'UNAUTHORIZED') {
          context.report({ node, messageId: 'noUnauthorizedTrpc' })
        }
        if (stem !== 'provider-errors' && krakenErrorCodes.has(cooked)) {
          context.report({ node, messageId: 'classifyDirectly' })
        }
      },
      CallExpression(node) {
        if (fileStem() === undefined) {
          return
        }
        const { callee } = node
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          !unsafeLogLevels.has(callee.property.name) ||
          !isLoggerCallee(callee.object)
        ) {
          return
        }
        const firstArg = node.arguments.at(0)
        if (firstArg === undefined) {
          return
        }
        if (
          isStringLiteralNode(firstArg) ||
          firstArg.type === 'TemplateLiteral' ||
          isDescribeSafeProviderFailureCall(firstArg)
        ) {
          return
        }
        if (firstArg.type !== 'ObjectExpression') {
          context.report({ node: firstArg, messageId: 'rawErrorLog' })
          return
        }
        for (const prop of firstArg.properties) {
          if (prop.type === 'SpreadElement') {
            if (!isDescribeSafeProviderFailureCall(prop.argument)) {
              context.report({ node: prop, messageId: 'rawErrorLog' })
            }
            continue
          }
          const keyName =
            prop.key.type === 'Identifier'
              ? prop.key.name
              : prop.key.type === 'Literal'
                ? String(prop.key.value)
                : undefined
          if (keyName !== undefined && rawErrorLogKeys.has(keyName)) {
            context.report({ node: prop, messageId: 'rawErrorLog' })
          }
        }
      },
    }
  },
})

const rawAmountFunctions = new Set(['Decimal', 'BigInt', 'Number', 'parseFloat', 'parseInt'])
const globalFetchOwners = new Set(['globalThis', 'window'])

interface AstParentNode {
  type: string
  block?: unknown
  parent?: AstParentNode | null
}

function isInsideTryBlockInSameFunction(node: AstParentNode): boolean {
  let current: AstParentNode = node
  let parent = node.parent
  while (parent != null && parent.type !== 'Program') {
    if (parent.type === 'TryStatement' && parent.block === current) {
      return true
    }
    if (
      parent.type === 'FunctionDeclaration' ||
      parent.type === 'FunctionExpression' ||
      parent.type === 'ArrowFunctionExpression'
    ) {
      return false
    }
    current = parent
    parent = parent.parent
  }
  return false
}

const exchangeProviderInputRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require apps/api-sentinel/src/features/exchanges/amounts.ts for amount parsing and try-guarded fetch/.json calls.',
    },
    messages: {
      useAmountsHelper:
        'Parse provider amounts with apps/api-sentinel/src/features/exchanges/amounts.ts instead of calling `{{name}}` directly.',
      unguardedFetchOrJson:
        'Wrap `{{name}}` inside a try/catch block in the same function so provider transport and body failures cannot throw uncaught.',
    },
  },
  createOnce(context) {
    function isTargetFile(): boolean {
      const normalized = context.filename.replaceAll('\\', '/')
      if (exchangeTestPath.test(normalized)) {
        return false
      }
      const stem = exchangeSourcePath.exec(normalized)?.[1]
      return stem !== undefined && stem !== 'amounts'
    }

    return {
      NewExpression(node) {
        if (!isTargetFile()) {
          return
        }
        if (node.callee.type === 'Identifier' && node.callee.name === 'Decimal') {
          context.report({ node, messageId: 'useAmountsHelper', data: { name: 'new Decimal' } })
        }
      },
      CallExpression(node) {
        if (!isTargetFile()) {
          return
        }
        const { callee } = node
        if (callee.type === 'Identifier') {
          if (rawAmountFunctions.has(callee.name)) {
            context.report({ node, messageId: 'useAmountsHelper', data: { name: callee.name } })
            return
          }
          if (callee.name === 'fetch' && !isInsideTryBlockInSameFunction(node)) {
            context.report({ node, messageId: 'unguardedFetchOrJson', data: { name: 'fetch' } })
          }
          return
        }
        if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
          if (
            callee.object.type === 'Identifier' &&
            callee.object.name === 'Math' &&
            callee.property.name === 'round'
          ) {
            context.report({ node, messageId: 'useAmountsHelper', data: { name: 'Math.round' } })
            return
          }
          if (
            callee.object.type === 'Identifier' &&
            globalFetchOwners.has(callee.object.name) &&
            callee.property.name === 'fetch' &&
            !isInsideTryBlockInSameFunction(node)
          ) {
            context.report({
              node,
              messageId: 'unguardedFetchOrJson',
              data: { name: `${callee.object.name}.fetch` },
            })
            return
          }
          if (callee.property.name === 'json' && !isInsideTryBlockInSameFunction(node)) {
            context.report({ node, messageId: 'unguardedFetchOrJson', data: { name: '.json()' } })
          }
        }
      },
    }
  },
})

const signingSourcePath =
  /(?:apps\/control-center\/src\/components\/claims\/(?:.*\/)?[^/]*signing[^/]*\.tsx|apps\/control-center\/src\/pages\/multisig\/\[id\]\/signing\.tsx)$/
const signingTestPath = /\.(?:test|spec|fixtures)\.tsx?$/
const signingSubmissionCalls = new Set(['mutateAsync', 'onSubmitSignature', 'onProveControl', 'completeChallenge'])

function isSigningSourceFile(filename: string): boolean {
  const normalized = filename.replaceAll('\\', '/')
  return !signingTestPath.test(normalized) && signingSourcePath.test(normalized)
}

function isFunctionNodeType(type: string): boolean {
  return type === 'FunctionDeclaration' || type === 'FunctionExpression' || type === 'ArrowFunctionExpression'
}

function isStaticStringNode(node: { type: string; raw?: string; expressions?: unknown[] }): boolean {
  if (isStringLiteralNode(node)) {
    return true
  }
  return node.type === 'TemplateLiteral' && node.expressions?.length === 0
}

function isSigningSubmissionCall(callee: {
  type: string
  name?: string
  property?: { type: string; name?: string }
}): boolean {
  if (callee.type === 'Identifier' && callee.name !== undefined) {
    return signingSubmissionCalls.has(callee.name)
  }
  return (
    callee.type === 'MemberExpression' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name !== undefined &&
    signingSubmissionCalls.has(callee.property.name)
  )
}

function isErrorDisplayCall(callee: {
  type: string
  name?: string
  object?: { type: string; name?: string }
  property?: { type: string; name?: string }
}): boolean {
  if (callee.type === 'Identifier') {
    return callee.name === 'setError'
  }
  return (
    callee.type === 'MemberExpression' &&
    callee.object?.type === 'Identifier' &&
    callee.object.name === 'toast' &&
    callee.property?.type === 'Identifier' &&
    callee.property.name === 'error'
  )
}

const noSwallowedSigningErrorRule = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow swallowing signing submission errors in signing flows.',
    },
    messages: {
      swallowedCatch:
        'Capture the signing failure cause and surface safe reasons with toastSigningError or getSigningErrorMessage.',
      swallowedOnError:
        'Pass the onError parameter to toastSigningError or getSigningErrorMessage instead of displaying a hardcoded string.',
    },
  },
  createOnce(context) {
    const signingTryStarts = new Set<number>()
    const reportedCatchStarts = new Set<number>()
    const onErrorCallStack: Array<{ start: number; paramName: string | undefined; referenced: boolean }> = []

    return {
      Program() {
        signingTryStarts.clear()
        reportedCatchStarts.clear()
        onErrorCallStack.length = 0
      },
      CallExpression(node) {
        if (!isSigningSourceFile(context.filename)) {
          return
        }
        if (isSigningSubmissionCall(node.callee)) {
          let child = node.parent
          let current: { type: string; start?: number; block?: unknown } = node
          while (child.type !== 'Program') {
            if (child.type === 'TryStatement' && child.block === current) {
              signingTryStarts.add(child.start)
            }
            if (isFunctionNodeType(child.type)) {
              break
            }
            current = child
            child = child.parent
          }
        }
        if (!isErrorDisplayCall(node.callee)) {
          return
        }
        for (let parent = node.parent; parent.type !== 'Program'; parent = parent.parent) {
          if (parent.type === 'CatchClause') {
            if (
              parent.param === null &&
              parent.parent.type === 'TryStatement' &&
              signingTryStarts.has(parent.parent.start) &&
              !reportedCatchStarts.has(parent.start)
            ) {
              reportedCatchStarts.add(parent.start)
              context.report({ node: parent, messageId: 'swallowedCatch' })
            }
            return
          }
          if (parent.type === 'ArrowFunctionExpression' || parent.type === 'FunctionExpression') {
            if (
              parent.parent.type === 'Property' &&
              parent.parent.key.type === 'Identifier' &&
              parent.parent.key.name === 'onError'
            ) {
              const firstArg = node.arguments.at(0)
              if (firstArg !== undefined && isStaticStringNode(firstArg)) {
                const firstParam = parent.params.at(0)
                const paramName = firstParam?.type === 'Identifier' ? firstParam.name : undefined
                onErrorCallStack.push({ start: node.start, paramName, referenced: false })
              }
            }
            return
          }
          if (parent.type === 'FunctionDeclaration') {
            return
          }
        }
      },
      Identifier(node) {
        if (onErrorCallStack.length === 0) {
          return
        }
        if (node.parent.type === 'MemberExpression' && !node.parent.computed && node.parent.property === node) {
          return
        }
        if (
          node.parent.type === 'Property' &&
          !node.parent.computed &&
          !node.parent.shorthand &&
          node.parent.key === node
        ) {
          return
        }
        for (const entry of onErrorCallStack) {
          if (entry.paramName !== undefined && node.name === entry.paramName) {
            entry.referenced = true
          }
        }
      },
      'CallExpression:exit'(node) {
        const top = onErrorCallStack.at(-1)
        if (top !== undefined && top.start === node.start) {
          onErrorCallStack.pop()
          if (!top.referenced) {
            context.report({ node, messageId: 'swallowedOnError' })
          }
        }
      },
    }
  },
})

/** Electron and StartOS must draw the UI without Hoseki's asset CDN, so images ship in apps/control-center/public/images. */
// oxlint-disable-next-line control-center/no-remote-assets -- the host this rule looks for.
const remoteAssetHost = 'assets.hoseki.app'

const noRemoteAssetsRule = defineRule({
  meta: {
    type: 'problem',
    docs: { description: "Disallow URLs on Hoseki's asset CDN; bundle the file instead." },
    messages: {
      bundleIt:
        "Copy the file into apps/control-center/public/images and use its /images/... path instead of Hoseki's asset CDN.",
    },
  },
  createOnce(context) {
    return {
      Literal(node) {
        if (node.raw?.includes(remoteAssetHost) === true) {
          context.report({ node, messageId: 'bundleIt' })
        }
      },
      TemplateElement(node) {
        if (node.value.raw.includes(remoteAssetHost)) {
          context.report({ node, messageId: 'bundleIt' })
        }
      },
    }
  },
})

/** Rules for Control Center's own conventions. */
export default eslintCompatPlugin({
  meta: { name: 'control-center' },
  rules: {
    'exchange-provider-errors': exchangeProviderErrorsRule,
    'exchange-provider-input': exchangeProviderInputRule,
    'feature-boundary': featureBoundaryRule,
    'format-usd-rounds': formatUsdRoundsRule,
    'no-remote-assets': noRemoteAssetsRule,
    'no-swallowed-signing-error': noSwallowedSigningErrorRule,
    'use-text-style': useTextStyleRule,
  },
})
