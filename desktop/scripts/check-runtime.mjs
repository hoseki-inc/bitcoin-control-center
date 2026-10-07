import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }

async function checkRuntime() {
  assert.equal(process.versions.electron, packageJson.devDependencies.electron, 'Run the locked Electron runtime')

  // Exercise the actual platform's certificate-store APIs in the locked runtime.
  const { configureDesktopTlsTrust } = await import('../src/tls-trust.ts')
  configureDesktopTlsTrust()

  // Exercise the native addon with Electron's Node ABI, using synthetic data.
  const { createClient } = await import('@libsql/client/sqlite3')
  const temporaryDirectory = process.argv[2]
  assert.ok(temporaryDirectory !== undefined, 'The launcher must provide the runtime-check directory')
  let database
  try {
    const databasePath = join(temporaryDirectory, 'smoke.sqlite')
    const config = { url: pathToFileURL(databasePath).href, concurrency: 1, timeout: 5000 }
    database = createClient(config)
    // Set WAL once; replacement connections must retain it without reconfiguration.
    await database.execute('PRAGMA journal_mode = WAL')
    await database.execute('CREATE TABLE smoke (value INTEGER PRIMARY KEY NOT NULL)')
    await database.execute(
      'CREATE TABLE smoke_child (value INTEGER NOT NULL REFERENCES smoke(value) ON DELETE CASCADE)',
    )
    await database.execute({ sql: 'INSERT INTO smoke (value) VALUES (?)', args: [42] })
    await database.execute('INSERT INTO smoke_child (value) VALUES (42)')
    for (const phase of ['startup', 'reopen', 'reconnect']) {
      if (phase === 'reopen') {
        database.close()
        database = createClient(config)
      } else if (phase === 'reconnect') {
        // A fresh connection must use the native default, not inherit the old setting.
        await database.execute('PRAGMA foreign_keys = OFF')
        assert.equal((await database.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys'], 0)
        database.reconnect()
      }
      assert.equal(
        (await database.execute('PRAGMA foreign_keys')).rows[0]?.['foreign_keys'],
        1,
        `${phase}: foreign keys`,
      )
      assert.equal((await database.execute('PRAGMA journal_mode')).rows[0]?.['journal_mode'], 'wal', `${phase}: WAL`)
      assert.equal((await database.execute('PRAGMA busy_timeout')).rows[0]?.['timeout'], 5000, `${phase}: busy timeout`)
      assert.equal(
        (await database.execute('SELECT value FROM smoke')).rows[0]?.['value'],
        42,
        `${phase}: parent persistence`,
      )
      assert.equal(
        (await database.execute('SELECT value FROM smoke_child')).rows[0]?.['value'],
        42,
        `${phase}: child persistence`,
      )
      await assert.rejects(
        database.execute('INSERT INTO smoke_child (value) VALUES (99)'),
        /FOREIGN KEY constraint failed/,
        `${phase}: orphan rejection`,
      )
      await database.execute('DELETE FROM smoke WHERE value = 42')
      assert.equal(
        (await database.execute('SELECT value FROM smoke_child')).rows.length,
        0,
        `${phase}: cascade deletion`,
      )
      assert.equal(
        (await database.execute('PRAGMA foreign_key_check')).rows.length,
        0,
        `${phase}: foreign-key integrity`,
      )
      // Leave a related pair to verify persistence and cascading on the next connection.
      await database.execute('INSERT INTO smoke (value) VALUES (42)')
      await database.execute('INSERT INTO smoke_child (value) VALUES (42)')
    }
  } finally {
    database?.close()
  }

  // These packages are external to Sentinel's bundle and loaded at runtime.
  const { default: React } = await import('react')
  const { Document, Page, Text, renderToBuffer } = await import('@react-pdf/renderer')
  const document = React.createElement(
    Document,
    null,
    React.createElement(Page, { size: 'A4' }, React.createElement(Text, null, 'Control Center runtime check')),
  )
  const pdf = await renderToBuffer(document)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 1000, 'The PDF renderer must produce a complete document')
  console.log(
    `Electron ${process.versions.electron}: system TLS trust, SQLite persistence, foreign keys/cascades, WAL, busy timeout across reconnects, and PDF rendering passed`,
  )
}

if (process.versions.electron) {
  checkRuntime().catch(
    /** @param {unknown} error */ (error) => {
      console.error(error)
      process.exitCode = 1
    },
  )
} else {
  // Loading the native addon in the host Node process misses Electron ABI issues.
  const { default: electronPath } = await import('electron')
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'control-center-runtime-'))
  try {
    const result = spawnSync(electronPath, [fileURLToPath(import.meta.url), temporaryDirectory], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      timeout: 60_000,
    })
    if (result.error) {
      console.error(result.error.message)
    }
    process.exitCode = result.status ?? 1
  } finally {
    // libSQL can retain native file handles after close(). Windows cleanup must
    // wait until the Electron process exits and releases those handles.
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}
