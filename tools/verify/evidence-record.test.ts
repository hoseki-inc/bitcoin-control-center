import assert from 'node:assert/strict'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, it } from 'vitest'
import {
  type EvidenceRecord,
  RecordSchema,
  baselineOf,
  cdpVersions,
  describeBundle,
  newRecord,
  report,
  startProblem,
} from './evidence-record'
import type { BundleProvenance, RunState } from './run'

const CHECKOUT = '41939c22ece770653439f4673dfd36b85b968fe1'
const OTHER = '0123456789abcdef0123456789abcdef01234567'
const HELPER = 'helpers/verify'
const VERSIONS = { 'Control Center': '1.4.3:0', Node: 'v22.23.4' }

function runState(overrides: Partial<RunState> = {}): RunState {
  return {
    runId: 'r1',
    launchedAt: '2026-11-25T10:00:00.000Z',
    fresh: false,
    desktop: false,
    electron: false,
    setupPinInUi: false,
    pin: false,
    build: { commit: CHECKOUT, tree: 'abc123', dirty: false },
    url: 'http://127.0.0.1:61664',
    sentinel: { name: 'sentinel', pid: 10, startedAt: 'x', port: 61664 },
    fakes: { name: 'fakes', pid: 11, startedAt: 'x', electrumPort: 2, mempoolPort: 3 },
    ...overrides,
  }
}

const bundle = (overrides: Partial<BundleProvenance> = {}): BundleProvenance => ({
  origin: 'built',
  source: '/repo/desktop/release/mac-arm64/Bitcoin Control Center.app',
  release: '1.4.3:0',
  commit: CHECKOUT,
  dirty: false,
  ...overrides,
})

const electronState = (overrides: Partial<RunState> = {}): RunState =>
  runState({ electron: true, cdpPort: 9222, bundle: bundle(), ...overrides })

const recordFor = (state: RunState, seeded = true): EvidenceRecord =>
  newRecord(state, { seeded, startedAt: '2026-11-25T10:05:00.000Z', versions: VERSIONS })

describe('baselineOf', () => {
  it('calls a fresh run fresh and a plain run seeded', () => {
    assert.equal(baselineOf(runState({ fresh: true }), false), 'fresh')
    assert.equal(baselineOf(runState(), true), 'seeded')
  })

  it('calls a --setup-pin-in-ui run unseeded until its seed exists', () => {
    assert.equal(baselineOf(electronState({ setupPinInUi: true }), false), 'unseeded')
    assert.equal(baselineOf(electronState({ setupPinInUi: true }), true), 'seeded')
  })
})

describe('startProblem', () => {
  it('refuses an unseeded plain run and names the fix', () => {
    assert.equal(
      startProblem(runState(), { seeded: false, smokeReport: false }, HELPER),
      'Run r1 is not seeded. Run helpers/verify seed first, or launch with --fresh.',
    )
  })

  it('lets fresh, seeded and --setup-pin-in-ui runs start', () => {
    assert.equal(startProblem(runState({ fresh: true }), { seeded: false, smokeReport: false }, HELPER), null)
    assert.equal(startProblem(runState(), { seeded: true, smokeReport: false }, HELPER), null)
    assert.equal(
      startProblem(electronState({ setupPinInUi: true }), { seeded: false, smokeReport: false }, HELPER),
      null,
    )
  })

  it('refuses a run whose folder holds a smoke report, so smoke’s report.md is never overwritten', () => {
    const problem = startProblem(electronState({ setupPinInUi: true }), { seeded: true, smokeReport: true }, HELPER)
    assert.match(problem ?? '', /smoke report \(smoke\.json\)/)
    assert.match(
      startProblem(runState(), { seeded: false, smokeReport: true }, HELPER) ?? '',
      /smoke report/,
      'the smoke check comes before the seed check',
    )
  })
})

describe('newRecord', () => {
  it('records a standalone, a --pin and a --desktop run without Electron fields', () => {
    const standalone = recordFor(runState())
    assert.equal(standalone.app, 'standalone')
    assert.equal(standalone.pins, false)
    assert.equal(standalone.setupPinInUi, false)
    assert.equal(standalone.releaseTag, null)
    assert.equal(standalone.bundle, null)
    assert.equal(standalone.commit, CHECKOUT)
    assert.deepEqual(standalone.attempts, [])
    assert.equal(recordFor(runState({ pin: true })).pins, 'umbrel')
    assert.equal(recordFor(runState({ desktop: true })).app, 'desktop')
  })

  it('records an Electron run’s PIN setup, release tag and bundle', () => {
    const record = recordFor(electronState({ setupPinInUi: true, releaseTag: 'v99.0.0_0' }), false)
    assert.equal(record.app, 'electron-packaged')
    assert.equal(record.pins, 'desktop')
    assert.equal(record.baseline, 'unseeded')
    assert.equal(record.setupPinInUi, true)
    assert.equal(record.releaseTag, 'v99.0.0_0')
    assert.deepEqual(record.bundle, bundle())
  })

  it('writes a record that its own schema reads back unchanged', () => {
    const record = recordFor(electronState({ setupPinInUi: true, releaseTag: 'v99.0.0_0' }), false)
    const parsed = parseUnknown(RecordSchema, JSON.parse(JSON.stringify(record)))
    assert.ok(parsed.isOk())
    assert.deepEqual(parsed.unwrap(), record)
  })
})

describe('RecordSchema', () => {
  it('still reads an evidence.json written before the Electron fields existed', () => {
    const legacy = {
      runId: 'old',
      startedAt: '2026-11-20T10:00:00.000Z',
      commit: CHECKOUT,
      tree: 'abc123',
      dirty: false,
      baseline: 'seeded',
      url: 'http://127.0.0.1:1',
      versions: VERSIONS,
      attempts: [],
    }
    const parsed = parseUnknown(RecordSchema, legacy)
    assert.ok(parsed.isOk())
    const record = parsed.unwrap()
    assert.equal(record.app, 'standalone')
    assert.equal(record.setupPinInUi, false)
    assert.equal(record.releaseTag, null)
    assert.equal(record.bundle, null)
    assert.match(report(record), /^- Baseline: seeded$/m)
  })
})

describe('cdpVersions', () => {
  it('reads Electron from the user agent and Chromium from Browser', () => {
    assert.deepEqual(
      cdpVersions({
        Browser: 'Chrome/142.0.7444.59',
        'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/142.0.7444.59 Electron/45.3.3 Safari/537.36',
      }),
      { Electron: '45.3.3', Chromium: '142.0.7444.59' },
    )
  })

  it('leaves out what is missing', () => {
    assert.deepEqual(cdpVersions({ Browser: 'Chrome/142.0.0.0' }), { Chromium: '142.0.0.0' })
    assert.deepEqual(cdpVersions({ 'User-Agent': 'Mozilla/5.0 Chrome/142.0.0.0' }), {})
  })
})

describe('describeBundle', () => {
  it('names a bundle built from the checkout with its release', () => {
    assert.equal(
      describeBundle(bundle(), CHECKOUT),
      `built from this checkout at launch, commit ${CHECKOUT}, release 1.4.3:0`,
    )
  })

  it('flags an --app bundle built from another commit, or with uncommitted changes', () => {
    const text = describeBundle(bundle({ origin: 'app', source: '/tmp/Old.app', commit: OTHER, dirty: true }), CHECKOUT)
    assert.equal(
      text,
      `--app /tmp/Old.app, commit ${OTHER} with uncommitted changes, release 1.4.3:0. Not the checkout's commit ${CHECKOUT}`,
    )
  })

  it('says when the bundle carries no build stamp', () => {
    assert.equal(
      describeBundle(
        bundle({ origin: 'app', source: '/tmp/X.app', release: null, commit: null, dirty: null }),
        CHECKOUT,
      ),
      '--app /tmp/X.app, no build stamp in the bundle',
    )
  })
})

describe('report', () => {
  it('shows no Electron lines for a web run', () => {
    const text = report(recordFor(runState()))
    assert.match(text, /^- App: standalone web app$/m)
    assert.match(text, /^- PINs: off$/m)
    assert.doesNotMatch(text, /App bundle|Release tag/)
    assert.match(text, /No recipes recorded yet\./)
  })

  it('shows the bundle, PIN setup, release tag, unseeded baseline and Electron versions', () => {
    const record = newRecord(electronState({ setupPinInUi: true, releaseTag: 'v99.0.0_0' }), {
      seeded: false,
      startedAt: '2026-11-25T10:05:00.000Z',
      versions: { ...VERSIONS, Electron: '45.3.3', Chromium: '142.0.7444.59' },
    })
    const text = report(record)
    assert.match(text, /^- Baseline: not seeded when evidence started \(launch --setup-pin-in-ui\)$/m)
    assert.match(text, /^- App: packaged macOS Electron app \(launch --electron\)$/m)
    assert.match(
      text,
      new RegExp(`^- App bundle: built from this checkout at launch, commit ${CHECKOUT}, release 1\\.4\\.3:0$`, 'm'),
    )
    assert.match(text, /^- PINs: on, desktop rules \(launch --electron --setup-pin-in-ui: PIN set in the UI\)$/m)
    assert.match(text, /^- Release tag served: v99\.0\.0_0$/m)
    assert.match(text, /Electron 45\.3\.3, Chromium 142\.0\.7444\.59/)
  })

  it('warns when an --app bundle was built from a different commit than the checkout', () => {
    const text = report(
      recordFor(electronState({ bundle: bundle({ origin: 'app', source: '/tmp/Old.app', commit: OTHER }) })),
    )
    assert.match(text, new RegExp(`Not the checkout's commit ${CHECKOUT}`))
  })

  it('lists each recipe’s latest outcome with its artifacts', () => {
    const record: EvidenceRecord = {
      ...recordFor(electronState()),
      attempts: [
        {
          recipe: 'desktop-shell',
          number: 1,
          feature: 'desktop-shell',
          proves: ['pin-first', 'close-to-hide'],
          begunAt: '2026-11-25T10:06:00.000Z',
          sentinelStartedAt: 'x',
          abandonedAt: null,
          outcome: {
            status: 'unreachable',
            reason: 'no macOS session',
            recordedAt: '2026-11-25T10:07:00.000Z',
            artifacts: ['desktop-shell/attempt-1/trace.md'],
          },
        },
      ],
    }
    const text = report(record)
    assert.match(text, /^## desktop-shell: Verified-unreachable$/m)
    assert.match(text, /^Would prove: pin-first, close-to-hide$/m)
    assert.match(text, /^Missing precondition: no macOS session$/m)
    assert.match(text, /^- \[desktop-shell\/attempt-1\/trace\.md\]\(desktop-shell\/attempt-1\/trace\.md\)$/m)
  })
})
