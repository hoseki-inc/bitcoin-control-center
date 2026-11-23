import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'vitest'
import {
  type StepResult,
  computeSmokeVerdict,
  findMainProcessErrors,
  hasLogLine,
  isWithinPortfolioUsdTolerance,
  matchesAnyPortfolioUsdQuote,
  parseLsofOpenFiles,
  parseScopedUsdAmount,
  parseVerifyDownloadEvent,
  smokeRunProblem,
  snapshotDir,
  verifyCleanShutdownLog,
  verifyFolderUntouched,
  waitForCondition,
} from './smoke-helpers'

function makeAllEightPassingSteps(): StepResult[] {
  return [
    { name: 'launch', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '1. Launch, preload bridge & PIN setup', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '2. Home & seeded balances', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '3. Lock, wrong PIN, hide-on-close & second-instance', status: 'pass', detail: 'ok', durationMs: 10 },
    {
      name: '4. Settings (desktop, Electrum CRUD, Statement source, WAL)',
      status: 'pass',
      detail: 'ok',
      durationMs: 10,
    },
    { name: '5. Bundled Tor startup', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '6. Statement PDF preview & desktop download', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '7. Runtime hygiene & doctor', status: 'pass', detail: 'ok', durationMs: 10 },
    { name: '8. Clean shutdown & isolation', status: 'pass', detail: 'ok', durationMs: 10 },
  ]
}

describe('smokeRunProblem', () => {
  it('accepts a fresh run id and refuses an existing run or evidence directory', () => {
    assert.equal(smokeRunProblem({ runId: 'fresh-1', runDirExists: false, evidenceDirExists: false }), null)
    const existingRun = smokeRunProblem({ runId: 'existing-1', runDirExists: true, evidenceDirExists: false })
    assert.ok(existingRun?.includes('existing-1') === true)
    const existingEvidence = smokeRunProblem({ runId: 'existing-2', runDirExists: false, evidenceDirExists: true })
    assert.ok(existingEvidence?.includes('existing-2') === true)
  })
})

describe('snapshotDir and verifyFolderUntouched', () => {
  it('detects nested file modifications under data/ and tolerates stale symlinks', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-snap-'))
    try {
      const dataDir = join(root, 'data')
      mkdirSync(dataDir, { recursive: true })
      const dbPath = join(dataDir, 'sentinel.db')
      writeFileSync(dbPath, 'before')
      symlinkSync('host-999999', join(root, 'SingletonLock'))

      const before = snapshotDir(root)
      assert.equal(before.exists, true)
      assert.equal(before.liveLockTarget, null)
      assert.equal(verifyFolderUntouched(before, snapshotDir(root)), null)

      writeFileSync(dbPath, 'after-mutated-database-bytes')
      const future = new Date(Date.now() + 5_000)
      utimesSync(dbPath, future, future)

      const diff = verifyFolderUntouched(before, snapshotDir(root))
      assert.ok(diff?.includes('data/sentinel.db') === true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('throws on directory inspection errors instead of swallowing them', () => {
    if (process.getuid?.() === 0) {
      return
    }
    const root = mkdtempSync(join(tmpdir(), 'verify-snap-err-'))
    const blocked = join(root, 'blocked')
    mkdirSync(blocked)
    chmodSync(blocked, 0o000)
    try {
      assert.throws(() => snapshotDir(root))
    } finally {
      chmodSync(blocked, 0o700)
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('parseLsofOpenFiles', () => {
  it('parses hits on exit 0 and exit 1 with empty stderr, and throws on lsof errors or timeouts', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-lsof-'))
    try {
      const appSupportDesktop = join(root, 'Library', 'Application Support', 'desktop')
      const leakedFile = join(root, 'Library', 'Application Support', 'Desktop', 'data', 'sentinel.db')

      assert.deepEqual(
        parseLsofOpenFiles(
          { code: 0, signal: null, stdout: `p123\nn${leakedFile}\n`, stderr: '', timedOut: false },
          [appSupportDesktop],
          'darwin',
        ),
        [leakedFile],
      )

      assert.deepEqual(
        parseLsofOpenFiles(
          { code: 1, signal: null, stdout: '', stderr: '', timedOut: false },
          [appSupportDesktop],
          'darwin',
        ),
        [],
      )

      assert.deepEqual(
        parseLsofOpenFiles(
          { code: 1, signal: null, stdout: `p123\nn${leakedFile}\n`, stderr: '', timedOut: false },
          [appSupportDesktop],
          'darwin',
        ),
        [leakedFile],
      )

      assert.throws(
        () =>
          parseLsofOpenFiles(
            { code: 1, signal: null, stdout: '', stderr: 'lsof: illegal process ID: bad\n', timedOut: false },
            [appSupportDesktop],
            'darwin',
          ),
        /lsof failed/,
      )

      assert.throws(
        () =>
          parseLsofOpenFiles(
            { code: null, signal: 'SIGKILL', stdout: '', stderr: '', timedOut: true },
            [appSupportDesktop],
            'darwin',
          ),
        /lsof timed out/,
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('computeSmokeVerdict', () => {
  it('passes only when all 8 checks pass, no orchestration error occurred, and required cleanup succeeded', () => {
    assert.deepEqual(
      computeSmokeVerdict({
        steps: makeAllEightPassingSteps(),
        orchestrationError: null,
        cleanupRequired: true,
        cleanedUp: true,
      }),
      { status: 'pass', reasons: [] },
    )

    assert.deepEqual(
      computeSmokeVerdict({
        steps: makeAllEightPassingSteps(),
        orchestrationError: null,
        cleanupRequired: false,
        cleanedUp: false,
      }),
      { status: 'pass', reasons: [] },
    )
  })

  it('returns offline-unverified when check 5 is offline-unverified and everything else passes', () => {
    const steps = makeAllEightPassingSteps()
    for (const step of steps) {
      if (step.name.startsWith('5. ')) {
        step.status = 'offline-unverified'
      }
    }
    assert.deepEqual(
      computeSmokeVerdict({
        steps,
        orchestrationError: null,
        cleanupRequired: true,
        cleanedUp: true,
      }),
      { status: 'offline-unverified', reasons: [] },
    )
  })

  it('fails on missing checks, orchestration errors, or failed cleanup', () => {
    const missingChecks = computeSmokeVerdict({
      steps: [{ name: 'launch', status: 'pass', detail: 'ok', durationMs: 10 }],
      orchestrationError: null,
      cleanupRequired: true,
      cleanedUp: true,
    })
    assert.equal(missingChecks.status, 'fail')
    assert.ok(missingChecks.reasons.includes('missing required check 1'))
    assert.ok(missingChecks.reasons.includes('missing required check 8'))

    const orchestrationFailure = computeSmokeVerdict({
      steps: makeAllEightPassingSteps(),
      orchestrationError: 'connectOverCDP failed',
      cleanupRequired: true,
      cleanedUp: true,
    })
    assert.equal(orchestrationFailure.status, 'fail')
    assert.ok(orchestrationFailure.reasons.some((reason) => reason.includes('connectOverCDP failed')))

    const cleanupFailure = computeSmokeVerdict({
      steps: makeAllEightPassingSteps(),
      orchestrationError: null,
      cleanupRequired: true,
      cleanedUp: false,
    })
    assert.equal(cleanupFailure.status, 'fail')
    assert.ok(cleanupFailure.reasons.includes('cleanup did not succeed'))
  })
})

describe('electron.log parsers for main-process errors, clean shutdown, and downloads', () => {
  it('detects verify-mode main-process error lines', () => {
    const log = [
      'normal startup line',
      'Desktop verify uncaughtException: Error: boom',
      'Desktop verify unhandledRejection: nope',
      'Desktop verify startup failed: bad port',
    ].join('\n')
    assert.equal(findMainProcessErrors(log).length, 3)
    assert.deepEqual(findMainProcessErrors('verify-shutdown:clean\n'), [])
  })

  it('requires verify-shutdown:clean and rejects failed or forced shutdown logs', () => {
    assert.equal(verifyCleanShutdownLog('started\nverify-shutdown:clean\n'), null)
    assert.ok(verifyCleanShutdownLog('started\n') !== null)
    assert.ok(verifyCleanShutdownLog('Desktop verify shutdown failed\nverify-shutdown:clean\n') !== null)
    assert.ok(verifyCleanShutdownLog('Desktop verify shutdown forced\n') !== null)
  })

  it('matches exact log lines and parses verify-download events', () => {
    assert.equal(hasLogLine('foo\nverify-shutdown:clean\nbar', 'verify-shutdown:clean'), true)
    assert.equal(hasLogLine('foo\nverify-shutdown:clean-extra\n', 'verify-shutdown:clean'), false)
    assert.deepEqual(parseVerifyDownloadEvent('log\nverify-download:completed:statement-2026.pdf\n'), {
      state: 'completed',
      fileName: 'statement-2026.pdf',
    })
    assert.equal(parseVerifyDownloadEvent('no download yet\n'), null)
  })
})

describe('portfolio USD parsing and tolerance', () => {
  it('parses scoped USD strings and enforces 1 cent per account tolerance', () => {
    assert.equal(parseScopedUsdAmount('$1,800.00'), 1800)
    assert.equal(parseScopedUsdAmount('  $12,345.67  '), 12345.67)
    assert.equal(parseScopedUsdAmount('—'), null)
    assert.equal(parseScopedUsdAmount('$0.00'), null)
    assert.equal(isWithinPortfolioUsdTolerance(1799.99, 1799.99, 3), true)
    assert.equal(isWithinPortfolioUsdTolerance(1800.02, 1799.99, 3), true)
    assert.equal(isWithinPortfolioUsdTolerance(1800.04, 1799.99, 3), false)
  })

  it('accepts a rendered portfolio total matching either of two quotes $1 apart across midnight UTC', () => {
    const btc = 1.79999
    const quoteBefore = btc * 100_000
    const quoteAfter = btc * 100_001
    const renderedFromFirstQuote = Math.round(quoteBefore * 100) / 100
    assert.equal(isWithinPortfolioUsdTolerance(renderedFromFirstQuote, quoteAfter, 3), false)
    assert.equal(matchesAnyPortfolioUsdQuote(renderedFromFirstQuote, [quoteBefore, quoteAfter], 3), true)
    assert.equal(matchesAnyPortfolioUsdQuote(Math.round(quoteAfter * 100) / 100, [quoteBefore, quoteAfter], 3), true)
    assert.equal(matchesAnyPortfolioUsdQuote(renderedFromFirstQuote + 5, [quoteBefore, quoteAfter], 3), false)
  })
})

describe('waitForCondition', () => {
  it('resolves once predicate turns true and throws on timeout for an always-false predicate', async () => {
    let attempts = 0
    await waitForCondition(
      'eventual truth',
      () => {
        attempts += 1
        return attempts >= 2
      },
      500,
      10,
    )
    assert.equal(attempts, 2)

    await assert.rejects(async () => {
      await waitForCondition('impossible state', () => false, 40, 10)
    }, /Timed out after 40ms waiting for impossible state/)
  })
})
