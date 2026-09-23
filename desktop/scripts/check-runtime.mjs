import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import packageJson from '../package.json' with { type: 'json' }

async function checkRuntime() {
  assert.equal(process.versions.electron, packageJson.devDependencies.electron, 'Run the locked Electron runtime')

  // Exercise the native addon with Electron's Node ABI, using synthetic data.
  const { default: Database } = await import('better-sqlite3')
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'control-center-runtime-'))
  let database
  try {
    const databasePath = join(temporaryDirectory, 'smoke.sqlite')
    database = new Database(databasePath)
    database.exec('CREATE TABLE smoke (value INTEGER NOT NULL)')
    database.prepare('INSERT INTO smoke (value) VALUES (?)').run(42)
    database.close()
    database = new Database(databasePath)
    assert.deepEqual(database.prepare('SELECT value FROM smoke').get(), { value: 42 })
  } finally {
    if (database?.open === true) {
      database.close()
    }
    rmSync(temporaryDirectory, { recursive: true, force: true })
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
  console.log(`Electron ${process.versions.electron}: SQLite persistence and PDF rendering passed`)
}

if (process.versions.electron) {
  checkRuntime().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  // Loading the native addon in the host Node process misses Electron ABI issues.
  const { default: electronPath } = await import('electron')
  const result = spawnSync(electronPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 60_000,
  })
  if (result.error) {
    console.error(result.error.message)
  }
  process.exitCode = result.status ?? 1
}
