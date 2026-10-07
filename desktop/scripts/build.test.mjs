import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import packageLock from '../package-lock.json' with { type: 'json' }

test('reads the Windows libSQL prebuild version without relying on package exports', () => {
  const script = readFileSync(new URL('../build.sh', import.meta.url), 'utf8')
  const expression = /^\s*LIBSQL_VERSION="\$\(node -p "([^"]+)"\)"$/m.exec(script)?.[1]
  assert.ok(
    expression !== undefined && expression !== '',
    'The build script must resolve the Windows libSQL prebuild version',
  )

  const version = execFileSync(process.execPath, ['-p', expression], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
  }).trim()

  assert.equal(version, packageLock.packages['node_modules/libsql'].optionalDependencies['@libsql/win32-x64-msvc'])
})
