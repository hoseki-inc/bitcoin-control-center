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
    database = createClient({ url: pathToFileURL(databasePath).href })
    await database.execute('CREATE TABLE smoke (value INTEGER NOT NULL)')
    await database.execute({ sql: 'INSERT INTO smoke (value) VALUES (?)', args: [42] })
    database.close()
    database = createClient({ url: pathToFileURL(databasePath).href })
    assert.equal((await database.execute('SELECT value FROM smoke')).rows[0]?.['value'], 42)
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
  console.log(`Electron ${process.versions.electron}: system TLS trust, SQLite persistence, and PDF rendering passed`)
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
