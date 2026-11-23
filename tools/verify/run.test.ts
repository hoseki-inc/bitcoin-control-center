import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, vi } from 'vitest'
import { blockTime, currentPrice, indexChain, tipHeight } from './chain'
import { ChildEnv, runCommand } from './process'
import {
  buildStamp,
  isPathInside,
  ownsSentinel,
  processStartTime,
  quitProcessCleanly,
  resolveDataDir,
  resolveSeedFile,
  runPaths,
  verifyCapableBundleProblem,
} from './run'

function buildMinimalAsar(mainIndexSource: string): Buffer {
  const payload = Buffer.from(mainIndexSource, 'utf8')
  const headerJson = JSON.stringify({
    files: {
      app: {
        files: {
          main: {
            files: {
              'index.js': {
                offset: '0',
                size: payload.byteLength,
              },
            },
          },
        },
      },
    },
  })
  const jsonBuf = Buffer.from(headerJson, 'utf8')
  const paddedJsonLen = Math.ceil(jsonBuf.byteLength / 4) * 4
  const paddedJson = Buffer.alloc(paddedJsonLen)
  jsonBuf.copy(paddedJson)
  const headerSize = paddedJsonLen + 8
  const pre = Buffer.alloc(16)
  pre.writeUInt32LE(4, 0)
  pre.writeUInt32LE(headerSize, 4)
  pre.writeUInt32LE(headerSize - 4, 8)
  pre.writeUInt32LE(jsonBuf.byteLength, 12)
  return Buffer.concat([pre, paddedJson, payload])
}

describe('processStartTime', () => {
  it('reads the same start time whatever the caller’s time zone', () => {
    try {
      vi.stubEnv('TZ', 'Asia/Tokyo')
      const tokyo = processStartTime(process.pid)
      vi.stubEnv('TZ', 'America/New_York')
      const newYork = processStartTime(process.pid)
      assert.ok(tokyo !== null)
      assert.equal(tokyo, newYork)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('buildStamp', () => {
  it('marks uncommitted code dirty, but not edits to the skill’s own files', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-stamp-'))
    const git = (...args: string[]): void => {
      runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
        cwd: root,
        // The fixture ignores the developer's own git config, such as commit signing or hooks.
        env: ChildEnv.with({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }),
      })
    }
    // A git hook exports GIT_DIR; a child that inherited it would act on that repository instead of this one.
    const elsewhere = join(root, 'elsewhere.git')
    vi.stubEnv('GIT_DIR', elsewhere)
    // A developer who signs every commit: the fixture's commit must not try to sign.
    vi.stubEnv('HOME', join(root, 'home'))
    mkdirSync(join(root, 'home'))
    writeFileSync(join(root, 'home/.gitconfig'), '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n')
    try {
      git('init', '-q')
      writeFileSync(join(root, 'app.ts'), 'one\n')
      git('add', '.')
      git('commit', '-qm', 'start')
      mkdirSync(join(root, '.agents'))
      writeFileSync(join(root, '.agents/recipe.md'), 'notes\n')
      assert.equal(buildStamp(root).dirty, false)
      writeFileSync(join(root, 'app.ts'), 'two\n')
      assert.equal(buildStamp(root).dirty, true)
      assert.equal(existsSync(elsewhere), false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ownsSentinel', () => {
  it('refuses a run whose Sentinel process is gone', () => {
    const gone = { name: 'sentinel', pid: 999_999, startedAt: 'never', port: 1 }
    const fakes = { name: 'fakes', pid: 999_998, startedAt: 'never', electrumPort: 2, mempoolPort: 3 }
    const state = {
      runId: 'test',
      launchedAt: '',
      fresh: false,
      desktop: false,
      electron: false,
      setupPinInUi: false,
      pin: false,
      build: { commit: '', tree: '', dirty: false },
      url: 'http://127.0.0.1:1',
      sentinel: gone,
      fakes,
    }
    assert.equal(ownsSentinel(state), false)
  })
})

describe('Electron run paths and isolation', () => {
  it('resolves dataDir and seedFile from RunState when set', () => {
    const paths = runPaths('electron-path-test')
    assert.equal(resolveDataDir(paths, null), paths.dataDir)
    assert.equal(resolveSeedFile(paths, null), paths.seedFile)

    const electronData = join(paths.runDir, 'user-data', 'data')
    const state = {
      runId: 'electron-path-test',
      launchedAt: '',
      fresh: false,
      desktop: false,
      electron: true,
      setupPinInUi: false,
      pin: false,
      build: { commit: '', tree: '', dirty: false },
      url: 'http://127.0.0.1:1',
      dataDir: electronData,
      sentinel: { name: 'electron', pid: 1, startedAt: 'x', port: 1 },
      fakes: { name: 'fakes', pid: 2, startedAt: 'x', electrumPort: 2, mempoolPort: 3 },
    }
    assert.equal(resolveDataDir(paths, state), electronData)
    assert.equal(resolveSeedFile(paths, state), join(electronData, 'verify-seed.json'))
  })

  it('checks path containment accurately including case-variant darwin paths and ..foo children', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-inside-'))
    try {
      assert.equal(isPathInside(join(root, 'user-data'), root), true)
      assert.equal(isPathInside(join(root, '..foo'), root), true)
      assert.equal(isPathInside(join(root, '..'), root), false)
      assert.equal(isPathInside(join(root, '..', 'outside'), root), false)

      const appSupportDesktop = join(root, 'Library', 'Application Support', 'desktop')
      const appSupportCaseVariant = join(root, 'Library', 'Application Support', 'Desktop', 'data', 'sentinel.db')
      assert.equal(isPathInside(appSupportCaseVariant, appSupportDesktop, 'darwin'), true)
      assert.equal(isPathInside(appSupportCaseVariant, appSupportDesktop, 'win32'), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a macOS bundle without the BCC_VERIFY_CONFIG marker without launching it', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-bundle-'))
    try {
      const olderApp = join(root, 'Older.app')
      mkdirSync(join(olderApp, 'Contents', 'MacOS'), { recursive: true })
      mkdirSync(join(olderApp, 'Contents', 'Resources'), { recursive: true })
      const markerFile = join(root, 'was-launched')
      writeFileSync(
        join(olderApp, 'Contents', 'MacOS', 'Bitcoin Control Center'),
        `#!/bin/sh\necho launched > "${markerFile}"\n`,
        { mode: 0o755 },
      )
      writeFileSync(
        join(olderApp, 'Contents', 'Resources', 'app.asar'),
        buildMinimalAsar('const x = "production-only-main";'),
      )

      let launched = false
      const olderProblem = verifyCapableBundleProblem(olderApp)
      if (olderProblem === null) {
        launched = true
      }
      assert.ok(olderProblem?.includes('BCC_VERIFY_CONFIG') === true)
      assert.equal(launched, false)
      assert.equal(existsSync(markerFile), false)

      const missingAsarApp = join(root, 'NoAsar.app')
      mkdirSync(join(missingAsarApp, 'Contents', 'MacOS'), { recursive: true })
      writeFileSync(join(missingAsarApp, 'Contents', 'MacOS', 'Bitcoin Control Center'), '#!/bin/sh\n', {
        mode: 0o755,
      })
      const missingAsarProblem = verifyCapableBundleProblem(missingAsarApp)
      assert.ok(missingAsarProblem?.includes('app.asar') === true)

      const verifyApp = join(root, 'VerifyCapable.app')
      mkdirSync(join(verifyApp, 'Contents', 'MacOS'), { recursive: true })
      mkdirSync(join(verifyApp, 'Contents', 'Resources'), { recursive: true })
      writeFileSync(join(verifyApp, 'Contents', 'MacOS', 'Bitcoin Control Center'), '#!/bin/sh\n', { mode: 0o755 })
      writeFileSync(
        join(verifyApp, 'Contents', 'Resources', 'app.asar'),
        buildMinimalAsar('const env = process.env["BCC_VERIFY_CONFIG"];'),
      )
      assert.equal(verifyCapableBundleProblem(verifyApp), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports wasRunning=false when quitProcessCleanly is called on a process that is already gone', async () => {
    const gone = { name: 'electron', pid: 999_999, startedAt: 'never' }
    const result = await quitProcessCleanly(gone, 500)
    assert.deepEqual(result, { wasRunning: false, exited: false, survivors: [] })
  })
})

describe('the fake chain and prices', () => {
  it('puts every transaction at noon UTC, so its date matches from UTC-11 to UTC+11', () => {
    const heights = [...indexChain(tipHeight()).byTxid.values()].map((entry) => entry.height)
    assert.ok(heights.length > 0)
    for (const height of heights) {
      assert.equal(new Date(blockTime(height) * 1000).getUTCHours(), 12)
    }
  })

  it('serves a price far below any real Bitcoin price', () => {
    assert.ok(currentPrice().USD < 10_000)
  })
})
