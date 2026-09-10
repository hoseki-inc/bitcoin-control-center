const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')
const { devDependencies } = require('../package.json')

async function checkRuntime() {
  assert.equal(process.versions.electron, devDependencies.electron, 'Run the locked Electron runtime')

  // Exercise the actual platform's certificate-store APIs in the locked runtime.
  const { configureDesktopTlsTrust } = await import(pathToFileURL(join(__dirname, '../src/tls-trust.ts')).href)
  configureDesktopTlsTrust()

  // Exercise the native addon with Electron's Node ABI, using synthetic data.
  const Database = require('better-sqlite3')
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
    if (database?.open) database.close()
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }

  // These packages are external to Sentinel's bundle and loaded at runtime.
  const React = require('react')
  const { Document, Page, Text, renderToBuffer } = await import('@react-pdf/renderer')
  const document = React.createElement(
    Document,
    null,
    React.createElement(Page, { size: 'A4' }, React.createElement(Text, null, 'Control Center runtime check')),
  )
  const pdf = await renderToBuffer(document)
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 1000, 'The PDF renderer must produce a complete document')
  console.log(`Electron ${process.versions.electron}: system TLS trust, SQLite persistence, and PDF rendering passed`)
}

if (process.versions.electron) {
  checkRuntime().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  // Loading the native addon in the host Node process misses Electron ABI issues.
  const result = spawnSync(require('electron'), [__filename], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    timeout: 60_000,
  })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
