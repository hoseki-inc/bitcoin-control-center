import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { getTableName, is } from 'drizzle-orm'
import { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema'

type Table = keyof typeof schema

// One writer per table. Each table lists the one place, relative to src/, that may insert, update or
// delete its rows. Reads stay open. To change data a feature doesn't own, call that feature.
const OWNERS = {
  accounts: 'features/accounts',
  keystores: 'features/accounts',
  // Step 13 moves the ownership code into modules/ownership.
  challenges: 'modules/trpc/router.ts',
  signedMessages: 'modules/trpc/router.ts',
  discoveryCache: 'features/onchain',
  balanceSnapshots: 'modules/wallet_balances',
  exchangeAccounts: 'features/exchanges',
  exchangeBalanceSnapshots: 'features/exchanges',
  exchangeStatementTxs: 'features/exchanges',
  statements: 'features/statements',
  statementCounter: 'features/statements',
  btcQuoteCache: 'features/price',
  btcQuoteDownloads: 'features/price',
  profiles: 'modules/auth',
  desktopConnectionProfiles: 'features/settings',
  manualAccounts: 'features/manual',
  manualTransactions: 'features/manual',
  manualBalanceSnapshots: 'features/manual',
  etfAccounts: 'features/etf',
  etfHoldings: 'features/etf',
  etfBalanceSnapshots: 'features/etf',
  accountHistorySyncs: 'features/portfolio',
} satisfies Record<Exclude<Table, 'settings'>, string>

// Settings is one key-value table, so each writer owns its own keys instead.
const SETTINGS_OWNERS = {
  'context.ts': ['electrum_host', 'electrum_port', 'electrum_protocol', 'tor_enabled'],
  'features/price': ['price_source', 'price_fallbacks_enabled'],
  'features/settings': [
    'user_name',
    'onboarding_v1',
    'electrum_notice_v1',
    'owner_identifier',
    'desktop_active_connection',
  ],
  'features/statements': ['statement_tx_source'],
  'lib/encrypted.ts': ['encryption_key'],
} satisfies Record<string, string[]>

// Writes outside the owner. Remove a line when its write moves; the test fails while a line is unused.
const EXCEPTIONS: { file: string; table: Table; why: string }[] = [
  {
    file: 'db/private-keys.ts',
    table: 'accounts',
    why: 'startup cleanup of stored private keys, before any feature runs',
  },
  {
    file: 'db/private-keys.ts',
    table: 'keystores',
    why: 'startup cleanup of stored private keys, before any feature runs',
  },
  {
    file: 'modules/trpc/router.ts',
    table: 'accounts',
    why: 'ownership proof marks the account verified, until step 13',
  },
  { file: 'features/portfolio/service.ts', table: 'exchangeBalanceSnapshots', why: 'until portfolio calls exchanges' },
]

interface Write {
  file: string
  table: string
}

const SRC = join(import.meta.dirname, '..')
const SKIP = /(\.test\.tsx?|\.fixtures\.ts)$|(^|\/)(fixtures|migrations)\//

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return sourceFiles(path)
    }
    const file = relative(SRC, path)
    return file.endsWith('.ts') && !SKIP.test(file) ? [file] : []
  })
}

const tables = Object.entries(schema).flatMap(([name, value]) =>
  is(value, SQLiteTable) ? [{ name, sqlName: getTableName(value) }] : [],
)
const bySqlName = new Map(tables.map((table) => [table.sqlName, table.name]))

// Finds query-builder writes on tables imported from the schema, and raw INSERT, UPDATE and DELETE
// statements that name a table or interpolate one.
function writes(file: string): Write[] {
  const text = readFileSync(join(SRC, file), 'utf8')
  const local = new Map<string, string>()
  for (const [, names = ''] of text.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'[./]*(?:db\/)?schema'/g)) {
    for (const part of names.split(',')) {
      const [imported = '', alias] = part.trim().split(/\s+as\s+/)
      if (imported !== '') {
        local.set(alias ?? imported, imported)
      }
    }
  }
  const found = new Set<string>()
  const add = (table: string | undefined): void => {
    if (table !== undefined) {
      found.add(table)
    }
  }
  for (const [, name = ''] of text.matchAll(/\.(?:insert|update|delete)\(\s*(\w+)\s*\)/g)) {
    add(local.get(name))
  }
  for (const [, name = ''] of text.matchAll(/\b(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+\$\{(\w+)\}/g)) {
    add(local.get(name))
  }
  for (const [, sqlName = ''] of text.matchAll(/\b(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM)\s+([a-z_]+)\b/g)) {
    add(bySqlName.get(sqlName))
  }
  return [...found].map((table) => ({ file, table }))
}

function within(file: string, owner: string): boolean {
  return file === owner || file.startsWith(`${owner}/`)
}

function owners(table: string): string[] {
  if (table === 'settings') {
    return Object.keys(SETTINGS_OWNERS)
  }
  return Object.entries(OWNERS).flatMap(([name, owner]) => (name === table ? [owner] : []))
}

const label = ({ file, table }: Write): string => `${file} ${table}`
const files = sourceFiles(SRC)
const allWrites = files.flatMap(writes).map(label)
const excepted = new Set(EXCEPTIONS.map(label))

describe('table writers', () => {
  it('names an owner for every table', () => {
    expect(['settings', ...Object.keys(OWNERS)].sort()).toEqual(tables.map((table) => table.name).sort())
  })

  it('writes each table only from its owner', () => {
    const stray = files
      .flatMap(writes)
      .filter((write) => !excepted.has(label(write)) && !owners(write.table).some((owner) => within(write.file, owner)))
      .map(label)
    expect(stray).toEqual([])
  })

  it('keeps each settings key in its owner', () => {
    const missing = Object.entries(SETTINGS_OWNERS).flatMap(([owner, keys]) =>
      keys.filter(
        (key) =>
          !files.some((file) => within(file, owner) && readFileSync(join(SRC, file), 'utf8').includes(`'${key}'`)),
      ),
    )
    const owned = Object.values(SETTINGS_OWNERS).flat()
    expect(missing).toEqual([])
    expect(new Set(owned).size).toBe(owned.length)
  })

  it('lists only exceptions that are still in the code', () => {
    expect([...excepted].filter((write) => !allWrites.includes(write))).toEqual([])
  })
})
