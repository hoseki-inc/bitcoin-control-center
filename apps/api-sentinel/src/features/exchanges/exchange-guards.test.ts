import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Coinbase } from '@hoseki/packages/clients/coinbase'
import { Kraken } from '@hoseki/packages/clients/kraken'
import { RobinhoodApiError } from '@hoseki/packages/clients/robinhood'
import { SafeResponse } from '@hoseki/packages/safe-http'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ExchangeAccountMismatchError,
  ExchangeAccountUnverifiableError,
  type SupportedExchange,
  classifyProviderFailure,
} from './provider-errors'
import { verifyReconnectIdentity } from './reconnect-identity'
import { StrikeApiError } from './strike'

const EXCHANGES_DIR = import.meta.dirname
const SKIP = /\.(?:test|fixtures)\.ts$/

function exchangeSourceFiles(): string[] {
  return readdirSync(EXCHANGES_DIR, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts') && !SKIP.test(name))
    .sort()
}

function readExchangeFile(name: string): string {
  return readFileSync(join(EXCHANGES_DIR, name), 'utf8')
}

function makeCoinbaseApiError(name: 'Unauthorized' | 'UnexpectedFailure', status: number): Coinbase.ApiError {
  const response = new SafeResponse(new Response('', { status }))
  if (name === 'Unauthorized') {
    return new Coinbase.ApiError(Coinbase.ErrorKind.Unauthorized(response), `HTTP ${status}`)
  }
  return new Coinbase.ApiError(Coinbase.ErrorKind.UnexpectedFailure({ response }), `HTTP ${status}`)
}

function makeKrakenApiError(
  kind: 'Unauthorized' | 'ErrorResponse' | 'UnexpectedFailure',
  status: number,
  errors: string[] = [],
): Kraken.ApiError {
  const response = new SafeResponse(new Response('', { status }))
  if (kind === 'Unauthorized') {
    return new Kraken.ApiError(Kraken.ApiErrorKind.Unauthorized(response), `HTTP ${status}`)
  }
  if (kind === 'ErrorResponse') {
    return new Kraken.ApiError(Kraken.ApiErrorKind.ErrorResponse(errors, response), errors.join(', '))
  }
  return new Kraken.ApiError(Kraken.ApiErrorKind.UnexpectedFailure({ response }), `HTTP ${status}`)
}

describe('exchange structural guards', () => {
  it('routes every exchange connect and refresh mutation in router.ts through the sanitizing wrappers', () => {
    const routerSource = readExchangeFile('router.ts')
    for (const [provider, method] of [
      ['coinbase', 'connectCoinbase'],
      ['strike', 'connectStrike'],
      ['robinhood', 'connectRobinhood'],
      ['kraken', 'connectKraken'],
    ] as const) {
      expect(routerSource).toContain(
        `runSanitizedConnect('${provider}', ctx.app.logger, () => ctx.app.exchangeService.${method}(input))`,
      )
      const allCalls = routerSource.match(new RegExp(`exchangeService\\.${method}\\b`, 'g')) ?? []
      expect(allCalls).toHaveLength(1)
    }

    expect(routerSource).toContain(
      'runSanitizedRefresh(ctx.app.logger, () => ctx.app.exchangeService.refreshBalance(input.accountId))',
    )
    expect(routerSource).toContain(
      'runSanitizedRefresh(ctx.app.logger, () => ctx.app.exchangeService.refreshAllBalances())',
    )
    expect(routerSource.match(/exchangeService\.refreshBalance\b/g) ?? []).toHaveLength(1)
    expect(routerSource.match(/exchangeService\.refreshAllBalances\b/g) ?? []).toHaveLength(1)
  })

  it('requires every credential update to use the single branded writer', () => {
    const writers: string[] = []
    for (const file of exchangeSourceFiles()) {
      const source = readExchangeFile(file)
      expect(source).not.toMatch(/\ballowFirstKeyWins\b|\bfirstKeyWins\b|\bdefinitive_auth_rejection\b/i)
      expect(source).not.toMatch(/\bUPDATE\s+exchange_accounts\b[\s\S]*\bencrypted_credentials\b/i)
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
      const tableAliases = new Set<string>(['exchangeAccounts'])
      const schemaNamespaces = new Set<string>()
      let importsVerifiedReconnectFromIdentity = false
      let declaresVerifiedReconnectLocally = false

      for (const stmt of ast.statements) {
        if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
          const specifier = stmt.moduleSpecifier.text
          const clause = stmt.importClause
          if (clause?.namedBindings) {
            if (ts.isNamedImports(clause.namedBindings)) {
              for (const el of clause.namedBindings.elements) {
                const importedName = el.propertyName?.text ?? el.name.text
                if (importedName === 'exchangeAccounts') {
                  tableAliases.add(el.name.text)
                }
                if (specifier === './reconnect-identity' && importedName === 'VerifiedReconnect') {
                  importsVerifiedReconnectFromIdentity = true
                }
              }
            } else if (ts.isNamespaceImport(clause.namedBindings) && specifier.includes('schema')) {
              schemaNamespaces.add(clause.namedBindings.name.text)
            }
          }
        }
        if (
          (ts.isTypeAliasDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) &&
          stmt.name.text === 'VerifiedReconnect'
        ) {
          declaresVerifiedReconnectLocally = true
        }
      }

      if (file === 'service.ts') {
        expect(importsVerifiedReconnectFromIdentity).toBe(true)
        expect(declaresVerifiedReconnectLocally).toBe(false)
      }

      function isExchangeAccountsTarget(arg: ts.Expression | undefined): boolean {
        if (!arg) {
          return false
        }
        if (ts.isIdentifier(arg)) {
          return tableAliases.has(arg.text)
        }
        if (
          ts.isPropertyAccessExpression(arg) &&
          ts.isIdentifier(arg.expression) &&
          schemaNamespaces.has(arg.expression.text) &&
          arg.name.text === 'exchangeAccounts'
        ) {
          return true
        }
        return false
      }

      function visit(node: ts.Node): void {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'update' &&
          isExchangeAccountsTarget(node.arguments[0])
        ) {
          const set = node.parent.parent
          const fields =
            ts.isCallExpression(set) &&
            ts.isPropertyAccessExpression(set.expression) &&
            set.expression.name.text === 'set'
              ? set.arguments[0]
              : undefined
          const updatesCredentials =
            !fields ||
            !ts.isObjectLiteralExpression(fields) ||
            fields.properties.some(
              (prop) =>
                !prop.name ||
                ts.isComputedPropertyName(prop.name) ||
                ((ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
                  prop.name.text === 'encryptedCredentials'),
            )
          if (updatesCredentials) {
            const fn = ts.findAncestor(node, ts.isFunctionLike)
            const fnName = fn?.name?.getText() ?? '<anonymous>'
            const params = fn?.parameters.map((param) => param.type?.getText() ?? '<untyped>').join(', ') ?? ''
            writers.push(`${file}:${fnName}(${params})`)
          }
        }
        ts.forEachChild(node, visit)
      }
      visit(ast)
    }
    expect(writers).toEqual(['service.ts:writeCredentials(ExchangeTransaction, VerifiedReconnect)'])
  })

  it('keeps exchange-provider-errors lint rule enabled with no disable comments in features/exchanges', () => {
    for (const file of exchangeSourceFiles()) {
      const source = readExchangeFile(file)
      expect(source).not.toMatch(/(oxlint|eslint)-disable[^\n]*exchange-provider-errors/)
    }
  })
})

describe('classifyProviderFailure matrix', () => {
  it.each<{ label: string; provider: SupportedExchange; err: Error; expected: string }>([
    {
      label: 'Coinbase 401 -> revoked',
      provider: 'coinbase',
      err: makeCoinbaseApiError('Unauthorized', 401),
      expected: 'revoked',
    },
    {
      label: 'Coinbase 403 -> permission_denied',
      provider: 'coinbase',
      err: makeCoinbaseApiError('Unauthorized', 403),
      expected: 'permission_denied',
    },
    {
      label: 'Coinbase 429 -> transient',
      provider: 'coinbase',
      err: makeCoinbaseApiError('UnexpectedFailure', 429),
      expected: 'transient',
    },
    {
      label: 'Coinbase 503 -> transient',
      provider: 'coinbase',
      err: makeCoinbaseApiError('UnexpectedFailure', 503),
      expected: 'transient',
    },
    {
      label: 'Kraken 401 -> revoked',
      provider: 'kraken',
      err: makeKrakenApiError('Unauthorized', 401),
      expected: 'revoked',
    },
    {
      label: 'Kraken 403 -> permission_denied',
      provider: 'kraken',
      err: makeKrakenApiError('Unauthorized', 403),
      expected: 'permission_denied',
    },
    {
      label: 'Kraken 200 EAPI:Invalid key -> revoked',
      provider: 'kraken',
      err: makeKrakenApiError('ErrorResponse', 200, ['EAPI:Invalid key']),
      expected: 'revoked',
    },
    {
      label: 'Kraken 429 EAPI:Invalid key -> transient',
      provider: 'kraken',
      err: makeKrakenApiError('ErrorResponse', 429, ['EAPI:Invalid key']),
      expected: 'transient',
    },
    {
      label: 'Kraken 503 EAPI:Invalid key -> transient',
      provider: 'kraken',
      err: makeKrakenApiError('ErrorResponse', 503, ['EAPI:Invalid key']),
      expected: 'transient',
    },
    {
      label: 'Kraken 200 EGeneral:Permission denied -> permission_denied',
      provider: 'kraken',
      err: makeKrakenApiError('ErrorResponse', 200, ['EGeneral:Permission denied']),
      expected: 'permission_denied',
    },
    {
      label: 'Robinhood 401 -> revoked',
      provider: 'robinhood',
      err: new RobinhoodApiError(401, 'Unauthorized'),
      expected: 'revoked',
    },
    {
      label: 'Robinhood 403 -> permission_denied',
      provider: 'robinhood',
      err: new RobinhoodApiError(403, 'Forbidden'),
      expected: 'permission_denied',
    },
    {
      label: 'Robinhood 429 -> transient',
      provider: 'robinhood',
      err: new RobinhoodApiError(429, 'Rate limited'),
      expected: 'transient',
    },
    {
      label: 'Robinhood 500 -> transient',
      provider: 'robinhood',
      err: new RobinhoodApiError(500, 'Server error'),
      expected: 'transient',
    },
    {
      label: 'Strike 401 -> revoked',
      provider: 'strike',
      err: new StrikeApiError(401, 'Strike API error: 401'),
      expected: 'revoked',
    },
    {
      label: 'Strike 403 -> permission_denied',
      provider: 'strike',
      err: new StrikeApiError(403, 'Strike API error: 403'),
      expected: 'permission_denied',
    },
    {
      label: 'Strike 429 -> transient',
      provider: 'strike',
      err: new StrikeApiError(429, 'Strike API error: 429'),
      expected: 'transient',
    },
    {
      label: 'Strike 503 -> transient',
      provider: 'strike',
      err: new StrikeApiError(503, 'Strike API error: 503'),
      expected: 'transient',
    },
    {
      label: 'Generic network error -> transient',
      provider: 'strike',
      err: new Error('ECONNRESET'),
      expected: 'transient',
    },
  ])('$label', ({ provider, err, expected }) => {
    expect(classifyProviderFailure(provider, err)).toBe(expected)
  })
})

describe('verifyReconnectIdentity invariants', () => {
  it.each<SupportedExchange>(['coinbase', 'kraken', 'robinhood'])(
    'fails closed with ExchangeAccountUnverifiableError when %s has no saved identity',
    (provider) => {
      const result = verifyReconnectIdentity({
        accountId: 'acc-1',
        provider,
        existingExternalAccountId: null,
        existingPortfolioUuid: undefined,
        incomingExternalAccountId: 'incoming-account-b',
        incomingPortfolioUuid: 'incoming-portfolio-b',
      })
      expect(result.isErr()).toBe(true)
      expect(result.unwrapErr()).toBeInstanceOf(ExchangeAccountUnverifiableError)
    },
  )

  it.each<SupportedExchange>(['coinbase', 'kraken', 'robinhood'])(
    'rejects mismatched %s account IDs with ExchangeAccountMismatchError',
    (provider) => {
      const result = verifyReconnectIdentity({
        accountId: 'acc-1',
        provider,
        existingExternalAccountId: 'acct-a',
        existingPortfolioUuid: undefined,
        incomingExternalAccountId: 'acct-b',
        incomingPortfolioUuid: undefined,
      })
      expect(result.isErr()).toBe(true)
      expect(result.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
    },
  )

  it('normalizes Kraken IBAN whitespace and casing before matching', () => {
    const result = verifyReconnectIdentity({
      accountId: 'kr-1',
      provider: 'kraken',
      existingExternalAccountId: 'AA11 N84G 1234 5678',
      existingPortfolioUuid: undefined,
      incomingExternalAccountId: 'aa11n84g12345678',
      incomingPortfolioUuid: undefined,
    })
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().nextExternalAccountId).toBe('AA11 N84G 1234 5678')
  })

  it('matches Coinbase by portfolioUuid when externalAccountId is absent, and rejects mismatched portfolioUuid', () => {
    const matched = verifyReconnectIdentity({
      accountId: 'cb-1',
      provider: 'coinbase',
      existingExternalAccountId: null,
      existingPortfolioUuid: 'portfolio-a',
      incomingExternalAccountId: 'btc-uuid-a',
      incomingPortfolioUuid: 'portfolio-a',
    })
    expect(matched.isOk()).toBe(true)
    expect(matched.unwrap().nextExternalAccountId).toBe('btc-uuid-a')
    expect(matched.unwrap().nextPortfolioUuid).toBe('portfolio-a')

    const mismatched = verifyReconnectIdentity({
      accountId: 'cb-1',
      provider: 'coinbase',
      existingExternalAccountId: null,
      existingPortfolioUuid: 'portfolio-a',
      incomingExternalAccountId: 'btc-uuid-b',
      incomingPortfolioUuid: 'portfolio-b',
    })
    expect(mismatched.isErr()).toBe(true)
    expect(mismatched.unwrapErr()).toBeInstanceOf(ExchangeAccountMismatchError)
  })

  it('allows Strike reconnect while keeping externalAccountId null', () => {
    const result = verifyReconnectIdentity({
      accountId: 'st-1',
      provider: 'strike',
      existingExternalAccountId: null,
      existingPortfolioUuid: undefined,
      incomingExternalAccountId: undefined,
      incomingPortfolioUuid: undefined,
    })
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().nextExternalAccountId).toBeNull()
  })
})
