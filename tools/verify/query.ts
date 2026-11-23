import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { readArgs } from './args'
import { fail, readRunState, requireJsonFile, resolveDataDir, runPaths, selectRunId } from './run'

// Reads a run's Sentinel database, read-only, to prove what a journey stored. Prints rows as JSON.
// Usage: helpers/verify query [--run <id>] --sql "SELECT ..."

const { values } = readArgs({ run: { type: 'string' }, sql: { type: 'string' } })
const paths = runPaths(selectRunId(values.run))
const { sql } = values
if (sql === undefined || !/^\s*(select|with)\b/i.test(sql)) {
  fail('Pass one read-only statement: --sql "SELECT ..."')
}

const state = requireJsonFile(readRunState(paths))
const database = new DatabaseSync(join(resolveDataDir(paths, state), 'sentinel.db'), { readOnly: true })
try {
  console.log(JSON.stringify(database.prepare(sql).all(), null, 2))
} catch (error) {
  fail(`Query failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  database.close()
}
