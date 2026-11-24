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

test('supports --mac-dir ad-hoc bundle builds without requiring Windows Tor binaries', () => {
  const script = readFileSync(new URL('../build.sh', import.meta.url), 'utf8')
  assert.match(script, /--mac\|--mac-dir\|--win\|--all/)
  assert.match(script, /electron-builder --mac --arm64 --dir/)
  assert.match(script, /NEED_MAC_TOR=true/)
  assert.match(script, /NEED_WIN_TOR=true/)
})

test('scopes desktop/node_modules lock-hash caching strictly to --mac-dir', () => {
  const script = readFileSync(new URL('../build.sh', import.meta.url), 'utf8')
  const macDirInstallBlock =
    /if \[\[ "\$TARGET" == --mac-dir \]\]; then\n([\s\S]*?)\nelse\n([\s\S]*?)\nfi\ncorepack pnpm build:desktop:app/.exec(
      script,
    )
  assert.ok(macDirInstallBlock !== null, 'Expected a dedicated --mac-dir install branch before build:desktop:app')
  const macDirBranch = macDirInstallBlock[1] ?? ''
  const releaseBranch = macDirInstallBlock[2] ?? ''
  const outsideBlock = script.replace(macDirInstallBlock[0], '')

  assert.match(macDirBranch, /LOCK_HASH=/)
  assert.match(macDirBranch, /\.bcc-lock-sha256/)
  assert.doesNotMatch(releaseBranch, /shasum|LOCK_HASH|\.bcc-lock-sha256/)
  assert.doesNotMatch(outsideBlock, /shasum|LOCK_HASH|\.bcc-lock-sha256/)
})
