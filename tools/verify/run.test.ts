import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, vi } from 'vitest'
import { blockTime, currentPrice, indexChain, tipHeight } from './chain'
import { ChildEnv, runCommand } from './process'
import { buildStamp, ownsSentinel, processStartTime } from './run'

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
      build: { commit: '', tree: '', dirty: false },
      url: 'http://127.0.0.1:1',
      sentinel: gone,
      fakes,
    }
    assert.equal(ownsSentinel(state), false)
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
