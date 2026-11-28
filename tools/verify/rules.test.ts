import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { loadEnv } from 'vite'
import { describe, it, vi } from 'vitest'
import { z } from 'zod'
import {
  type Attempt,
  type EmulatorProbe,
  type LiveLedger,
  LiveRun,
  MAP_FILE,
  type Outcome,
  type Recipe,
  SLOW_FAULT_MS,
  activeFaults,
  beginProblem,
  checkEmulatorsRule,
  classifyTorOutcome,
  faultedAnswer,
  freeAttemptNumber,
  freshSeedCheck,
  latestRecorded,
  launchDecision,
  newAttempt,
  nextShotName,
  openAttempt,
  parseEmulatorCommand,
  readRecipes,
  recordProblem,
  screenshotFolder,
  sortEvidence,
  webBuildEnv,
  withAbandoned,
  withFault,
  withOutcome,
} from './rules'
import { type EmulatorState, REPO_ROOT, type RunState } from './run'

const recipe: Recipe = { id: 'statements', feature: 'statements', proves: ['generate', 'listed'], problem: null }
const proof = ['01-list.jpg', 'trace.md']
const build = { commit: 'abc', tree: 'tree-1', dirty: false }
function runState(startedAt: string): RunState {
  return {
    runId: 'test',
    launchedAt: '',
    fresh: false,
    desktop: false,
    electron: false,
    setupPinInUi: false,
    pin: false,
    build,
    url: 'http://127.0.0.1:1',
    sentinel: { name: 'sentinel', pid: 1, startedAt, port: 1 },
    fakes: { name: 'fakes', pid: 2, startedAt, electrumPort: 2, mempoolPort: 3 },
  }
}
function live(startedAt: string): LiveRun {
  const result = LiveRun.of(runState(startedAt), true, build)
  assert.ok(result instanceof LiveRun)
  return result
}
const liveA = live('sentinel-A')
const whyNot = (result: LiveRun | string): string => (result instanceof LiveRun ? 'live' : result)
const begun = newAttempt([], recipe, '2026-11-17T00:00:00Z', liveA)

describe('beginProblem', () => {
  it('opens a first attempt on a live run', () => {
    assert.equal(beginProblem([], 'statements', recipe, liveA), null)
  })

  it('refuses a run that is no longer live', () => {
    assert.match(
      beginProblem([], 'statements', recipe, LiveRun.of(runState('sentinel-A'), false, build)) ?? '',
      /not running/,
    )
  })

  it('refuses a recipe that is not in the map, including a different case', () => {
    for (const id of ['statement', 'Statements']) {
      assert.match(beginProblem([], id, undefined, liveA) ?? '', /not a recipe/)
    }
  })

  it('refuses a recipe whose map entry or file is wrong', () => {
    const broken = { ...recipe, problem: 'statements.md claims pdf-preview' }
    assert.match(beginProblem([], 'statements', broken, liveA) ?? '', /can't be driven yet/)
  })

  it('refuses a third recorded attempt: one retry classifies a flake', () => {
    const outcome = { status: 'failed' as const, reason: 'x', recordedAt: '2026-11-17T00:01:00Z', artifacts: [] }
    const first = { ...begun, outcome }
    const second = { ...begun, number: 2, outcome }
    assert.equal(beginProblem([first], 'statements', recipe, liveA), null)
    assert.match(beginProblem([first, second], 'statements', recipe, liveA) ?? '', /one retry/)
    const abandoned = { ...begun, number: 2, abandonedAt: '2026-11-17T00:02:00Z' }
    assert.equal(beginProblem([first, abandoned], 'statements', recipe, liveA), null)
  })

  it('refuses to begin a recipe while another recipe is open on the same run', () => {
    const other = newAttempt([], { ...recipe, id: 'home-summary', feature: 'home' }, '2026-11-17T00:00:00Z', liveA)
    assert.match(beginProblem([other], 'statements', recipe, liveA) ?? '', /home-summary is still open on this run/)
    assert.equal(beginProblem([{ ...other, abandonedAt: '2026-11-17T00:01:00Z' }], 'statements', recipe, liveA), null)
  })

  it('refuses a second attempt while one is open', () => {
    const refusal = beginProblem([begun], 'statements', recipe, liveA) ?? ''
    assert.match(refusal, /still open/)
    assert.match(refusal, /evidence abandon statements/)
    assert.doesNotMatch(refusal, /as failed/)
  })
})

describe('readRecipes', () => {
  it('flags every recipe begin must refuse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-recipes-'))
    try {
      const recipes = [
        { file: 'good.md', proves: ['generate'] },
        { file: 'empty.md', proves: [] },
        { file: 'foreign.md', proves: ['pdf-preview'] },
        { file: 'missing.md', proves: ['generate'] },
        { file: 'mismatch.md', proves: ['generate', 'listed'] },
        { file: 'statements.eur.md', proves: ['generate'] },
        { file: 'Cased.md', proves: ['generate'] },
      ]
      for (const name of ['good.md', 'empty.md', 'foreign.md', 'statements.eur.md']) {
        writeFileSync(join(dir, name), '## Sub-features\n\nProves: `generate`\n')
      }
      writeFileSync(join(dir, 'mismatch.md'), 'Proves: `generate`\n')
      writeFileSync(join(dir, 'cased.md'), 'Proves: `generate`\n')
      const feature = { id: 'statements', subFeatures: [{ id: 'generate' }, { id: 'listed' }], recipes }
      const twice = {
        id: 'statement-details',
        subFeatures: [{ id: 'generate' }],
        recipes: [{ file: 'Twice.md', proves: ['generate'] }],
      }
      recipes.push({ file: 'twice.md', proves: ['generate'] })
      writeFileSync(join(dir, 'twice.md'), 'Proves: `generate`\n')
      writeFileSync(join(dir, 'map.json'), JSON.stringify({ areas: [{ features: [feature, twice] }] }))
      const problems = Object.fromEntries(
        [...(readRecipes(join(dir, 'map.json'), dir)?.values() ?? [])].map((item) => [item.id, item.problem]),
      )
      assert.equal(problems['good'], null)
      assert.match(problems['empty'] ?? '', /proves nothing/)
      assert.match(problems['foreign'] ?? '', /not a sub-feature/)
      assert.match(problems['missing'] ?? '', /does not exist/)
      assert.match(problems['mismatch'] ?? '', /does not match/)
      assert.match(problems['statements.eur'] ?? '', /letters, digits/)
      assert.match(problems['Cased'] ?? '', /does not exist/)
      assert.match(problems['twice'] ?? '', /listed 2 times/)
      assert.match(problems['Twice'] ?? '', /listed 2 times/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('LiveRun', () => {
  it('exists only for a run that owns its port and still runs the code it launched with', () => {
    assert.ok(LiveRun.of(runState('sentinel-A'), true, build) instanceof LiveRun)
    assert.match(whyNot(LiveRun.of(null, false, build)), /not running/)
    assert.match(whyNot(LiveRun.of(runState('sentinel-A'), false, build)), /not running/)
    assert.match(whyNot(LiveRun.of(runState('sentinel-A'), true, { ...build, tree: 'tree-2' })), /code changed/)
    assert.match(whyNot(LiveRun.of(runState('sentinel-A'), true, { ...build, commit: 'def' })), /code changed/)
  })

  it('stops a verified record after the code changed, but still takes a failure', () => {
    const changed = LiveRun.of(runState('sentinel-A'), true, { ...build, tree: 'tree-2' })
    const request = { status: 'verified' as const, reason: null, files: proof, live: changed }
    assert.match(recordProblem(begun, 'statements', request) ?? '', /code changed/)
    assert.equal(recordProblem(begun, 'statements', { ...request, status: 'failed', reason: 'edited mid-run' }), null)
  })
})

describe('freeAttemptNumber', () => {
  it('skips folders an interrupted begin left behind', () => {
    const leftovers = new Set([2, 3])
    assert.equal(
      freeAttemptNumber(2, (n) => leftovers.has(n)),
      4,
    )
    assert.equal(
      freeAttemptNumber(1, (n) => leftovers.has(n)),
      1,
    )
  })
})

describe('newAttempt', () => {
  it('numbers attempts after every earlier one and snapshots what the recipe proves', () => {
    const second = newAttempt([begun], recipe, 'later', liveA)
    assert.equal(second.number, 2)
    recipe.proves.push('other-currency')
    try {
      assert.deepEqual(second.proves, ['generate', 'listed'])
    } finally {
      recipe.proves.pop()
    }
  })
})

describe('recordProblem', () => {
  const verified = { status: 'verified' as const, reason: null, files: proof, live: liveA }

  it('accepts a verified open attempt with its trace and screenshot', () => {
    assert.equal(recordProblem(begun, 'statements', verified), null)
  })

  it('refuses when no attempt is open', () => {
    assert.match(recordProblem(undefined, 'statements', verified) ?? '', /no open attempt/)
  })

  it('refuses a verified outcome without a trace and a screenshot in its attempt', () => {
    for (const files of [[], ['trace.md'], ['01-list.jpg']]) {
      assert.match(
        recordProblem(begun, 'statements', { ...verified, files }) ?? '',
        /trace.md and at least one screenshot/,
      )
    }
  })

  it('refuses a verified outcome once the Sentinel the attempt began on is gone, but still takes a failure', () => {
    for (const now of [LiveRun.of(runState('sentinel-A'), false, build), live('sentinel-B')]) {
      assert.match(
        recordProblem(begun, 'statements', { ...verified, live: now }) ?? '',
        /can't be verified|no longer running/,
      )
    }
    const failure = { status: 'failed' as const, reason: 'Sentinel died', files: [], live: 'not running' }
    assert.equal(recordProblem(begun, 'statements', failure), null)
  })

  it('requires a reason for a failed outcome but no proof files', () => {
    const failed = { status: 'failed' as const, reason: null, files: [], live: 'not running' }
    assert.match(recordProblem(begun, 'statements', failed) ?? '', /needs --reason/)
    assert.equal(recordProblem(begun, 'statements', { ...failed, reason: 'Generate did nothing' }), null)
  })
})

describe('withOutcome and latestRecorded', () => {
  const outcome = (status: 'verified' | 'failed'): Outcome => ({
    status,
    reason: null,
    recordedAt: 'now',
    artifacts: [],
  })

  it('closes only the open attempt and keeps its snapshot', () => {
    const attempts = withOutcome([begun], begun, outcome('failed'))
    assert.equal(openAttempt(attempts, 'statements'), undefined)
    assert.deepEqual(attempts[0]?.proves, ['generate', 'listed'])
  })

  it('keeps an earlier pass when a later attempt is abandoned', () => {
    const passed = withOutcome([begun], begun, outcome('verified'))
    const retry = newAttempt(passed, recipe, 'later', liveA)
    const attempts = withAbandoned([...passed, retry], retry, 'later')
    assert.equal(openAttempt(attempts, 'statements'), undefined)
    assert.deepEqual(
      latestRecorded(attempts).map((item) => [item.number, item.outcome.status]),
      [[1, 'verified']],
    )
  })

  it('shows each recipe’s latest recorded attempt', () => {
    const first = withOutcome([begun], begun, outcome('failed'))
    const second = newAttempt(first, recipe, 'later', liveA)
    const both = withOutcome([...first, second], second, outcome('verified'))
    const other = newAttempt([], { ...recipe, id: 'statements-eur' }, 'later', liveA)
    const shown = latestRecorded(withOutcome([...both, other], other, outcome('verified')))
    assert.deepEqual(
      shown.map((item) => [item.recipe, item.number, item.outcome.status]),
      [
        ['statements', 2, 'verified'],
        ['statements-eur', 1, 'verified'],
      ],
    )
  })
})

/** The live-run part of launchDecision's input. */
type AliveInput = Pick<Parameters<typeof launchDecision>[0], 'alive'>

describe('launchDecision', () => {
  describe('with --emulator ledger', () => {
    const base = { folderExists: true, evidenceExists: true, fresh: false, desktop: false, pin: false }
    const running = (ledger: LiveLedger): AliveInput => ({
      alive: { fresh: false, desktop: false, pin: false, ledger },
    })
    const flexPrimary: LiveLedger = { model: 'flex', seed: 'primary', mode: 'manual' }
    const ask = { model: 'flex', seed: 'primary', autoApprove: false }

    it('refuses a run with no Ledger, or another model or seed, naming what runs and what was asked', () => {
      assert.deepEqual(launchDecision({ ...base, ...running(null), ledger: ask }), {
        action: 'refuse',
        reason:
          'is already running with no Ledger, not the requested Ledger flex with seed primary. Launch a new run ID.',
      })
      assert.deepEqual(
        launchDecision({ ...base, ...running(flexPrimary), ledger: { ...ask, model: 'nanosp', seed: 'empty' } }),
        {
          action: 'refuse',
          reason:
            'is already running a Ledger flex with seed primary, not the requested Ledger nanosp with seed empty. Launch a new run ID.',
        },
      )
      const otherSeed = launchDecision({ ...base, ...running(flexPrimary), ledger: { ...ask, seed: 'secondary' } })
      assert.match(
        otherSeed.action === 'refuse' ? otherSeed.reason : '',
        /Ledger flex with seed primary, not .* seed secondary/,
      )
      const noBridge = launchDecision({ ...base, ...running({ ...flexPrimary, mode: null }), ledger: ask })
      assert.match(noBridge.action === 'refuse' ? noBridge.reason : '', /but no bridge/)
    })

    it('refuses --auto-approve unless the live bridge is in auto mode now', () => {
      for (const mode of ['manual'] as const) {
        const decision = launchDecision({
          ...base,
          ...running({ ...flexPrimary, mode }),
          ledger: { ...ask, autoApprove: true },
        })
        assert.equal(
          decision.action === 'refuse' ? decision.reason : '',
          `is already running its Ledger bridge in ${mode} mode, not the requested Ledger flex with seed primary and --auto-approve. Launch a new run ID.`,
        )
      }
      assert.deepEqual(
        launchDecision({
          ...base,
          ...running({ ...flexPrimary, mode: 'auto' }),
          ledger: { ...ask, autoApprove: true },
        }),
        { action: 'running' },
      )
    })

    it('refuses an explicit request when the bridge is missing or does not answer, but not a plain reopen', () => {
      const dead: LiveLedger = {
        ...flexPrimary,
        mode: 'unknown',
        problem: 'control port 61118 is not held by the bridge',
      }
      assert.deepEqual(launchDecision({ ...base, ...running(dead), ledger: ask }), {
        action: 'refuse',
        reason:
          'is already running a Ledger flex with seed primary whose bridge does not answer (control port 61118 is not held by the bridge). Stop the Ledger and start it again with emulator start --device ledger --bridge, or launch a new run ID.',
      })
      const noBridge = launchDecision({ ...base, ...running({ ...flexPrimary, mode: null }), ledger: ask })
      assert.match(
        noBridge.action === 'refuse' ? noBridge.reason : '',
        /but no bridge, so the app can't reach it\. Stop the Ledger and start it again/,
      )
      // Without emulator flags, launch only reopens the run; the bridge's health is doctor's business.
      assert.deepEqual(launchDecision({ ...base, ...running(dead) }), { action: 'running' })
      assert.deepEqual(launchDecision({ ...base, ...running(flexPrimary), ledger: ask }), { action: 'running' })
    })

    it('accepts the same Ledger again, and any Ledger when no emulator flag is given', () => {
      assert.deepEqual(launchDecision({ ...base, ...running(flexPrimary), ledger: ask }), { action: 'running' })
      // A manual-mode request is satisfied by an auto bridge too: --auto-approve was not asked for.
      assert.deepEqual(launchDecision({ ...base, ...running({ ...flexPrimary, mode: 'auto' }), ledger: ask }), {
        action: 'running',
      })
      assert.deepEqual(launchDecision({ ...base, ...running(flexPrimary) }), { action: 'running' })
      assert.deepEqual(launchDecision({ ...base, ...running(null) }), { action: 'running' })
    })
  })

  it('starts a new run', () => {
    assert.deepEqual(
      launchDecision({
        alive: null,
        folderExists: false,
        evidenceExists: false,
        fresh: false,
        desktop: false,
        pin: false,
      }),
      {
        action: 'start',
      },
    )
  })

  it('leaves a live run of the same kind running', () => {
    assert.deepEqual(
      launchDecision({
        alive: { fresh: true, desktop: false, pin: false },
        folderExists: true,
        evidenceExists: true,
        fresh: true,
        desktop: false,
        pin: false,
      }),
      {
        action: 'running',
      },
    )
  })

  it('refuses --fresh for a live seeded run', () => {
    const decision = launchDecision({
      alive: { fresh: false, desktop: false, pin: false },
      folderExists: true,
      evidenceExists: false,
      fresh: true,
      desktop: false,
      pin: false,
    })
    assert.equal(decision.action, 'refuse')
  })

  it('refuses a run ID that already has evidence from an earlier run', () => {
    const decision = launchDecision({
      alive: null,
      folderExists: false,
      evidenceExists: true,
      fresh: false,
      desktop: false,
      pin: false,
    })
    assert.equal(decision.action, 'refuse')
  })

  it('refuses to switch a live run between PINs on and off', () => {
    for (const pin of [true, false]) {
      const decision = launchDecision({
        alive: { fresh: false, desktop: false, pin: !pin },
        folderExists: true,
        evidenceExists: false,
        fresh: false,
        desktop: false,
        pin,
      })
      assert.equal(decision.action, 'refuse')
    }
  })

  it('refuses to switch a live run between the desktop and standalone apps', () => {
    for (const desktop of [true, false]) {
      const decision = launchDecision({
        alive: { fresh: false, desktop: !desktop, pin: false },
        folderExists: true,
        evidenceExists: false,
        fresh: false,
        desktop,
        pin: false,
      })
      assert.equal(decision.action, 'refuse')
    }
  })

  it('refuses to switch a live run across electron, setupPinInUi, or releaseTag flags', () => {
    assert.equal(
      launchDecision({
        alive: { fresh: false, desktop: false, pin: false, electron: true },
        folderExists: true,
        evidenceExists: false,
        fresh: false,
        desktop: false,
        pin: false,
        electron: false,
      }).action,
      'refuse',
    )
    assert.equal(
      launchDecision({
        alive: { fresh: false, desktop: false, pin: false, electron: true, setupPinInUi: true },
        folderExists: true,
        evidenceExists: false,
        fresh: false,
        desktop: false,
        pin: false,
        electron: true,
        setupPinInUi: false,
      }).action,
      'refuse',
    )
    assert.equal(
      launchDecision({
        alive: { fresh: false, desktop: false, pin: false, electron: true, releaseTag: 'v9.9.9_0' },
        folderExists: true,
        evidenceExists: false,
        fresh: false,
        desktop: false,
        pin: false,
        electron: true,
        releaseTag: 'v1.0.0_0',
      }).action,
      'refuse',
    )
  })
})

describe('classifyTorOutcome', () => {
  it('returns connected when Tor is ready, SOCKS is bound, and tor-data exists', () => {
    assert.equal(
      classifyTorOutcome('online', { state: 'ready', socksReady: true, progress: 100 }, true).status,
      'connected',
    )
  })

  it('fails in allow-offline when binary fails before binding SOCKS or tor-data is missing', () => {
    assert.equal(
      classifyTorOutcome('allow-offline', { state: 'failed', socksReady: false, message: 'spawn ENOENT' }, true).status,
      'failed',
    )
    assert.equal(
      classifyTorOutcome('allow-offline', { state: 'ready', socksReady: true, progress: 100 }, false).status,
      'failed',
    )
    assert.equal(classifyTorOutcome('allow-offline', { state: 'unavailable' }, true).status, 'failed')
  })

  it('classifies post-SOCKS bootstrap timeout as failed online and offline-unverified in allow-offline', () => {
    const partial = { state: 'starting' as const, socksReady: true, progress: 15 }
    assert.equal(classifyTorOutcome('online', partial, true).status, 'failed')
    assert.equal(classifyTorOutcome('allow-offline', partial, true).status, 'offline-unverified')
  })
})

describe('webBuildEnv', () => {
  it("beats a developer's local .env file that points the browser elsewhere", () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-vite-'))
    const pinned = Object.entries(webBuildEnv().vars).filter(([name]) => name.startsWith('VITE_'))
    try {
      writeFileSync(join(dir, '.env.production.sentinel'), 'VITE_BACKEND_API_URL=/trpc\n')
      writeFileSync(
        join(dir, '.env.production.sentinel.local'),
        'VITE_BACKEND_API_URL=http://127.0.0.1:3400/trpc\nVITE_PLATFORM=desktop\n',
      )
      for (const [name, value] of pinned) {
        vi.stubEnv(name, value)
      }
      const env = loadEnv('production.sentinel', dir, 'VITE_')
      assert.equal(env['VITE_BACKEND_API_URL'], '/trpc')
      assert.notEqual(env['VITE_PLATFORM'], 'desktop')
    } finally {
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

const FEATURES = join(REPO_ROOT, '.agents/skills/verify-control-center/features')
const FeatureMapFileSchema = z.object({
  needs: z.record(z.string(), z.string()),
  areas: z.array(
    z.object({
      features: z.array(
        z.object({
          id: z.string(),
          needs: z.string(),
          recipes: z.array(z.object({ file: z.string(), proves: z.array(z.string()) })).optional(),
          subFeatures: z.array(z.object({ id: z.string(), needs: z.string().optional() })),
        }),
      ),
    }),
  ),
})

describe('map.json', () => {
  const raw = parseUnknown(FeatureMapFileSchema, JSON.parse(readFileSync(MAP_FILE, 'utf8')))
  assert.ok(raw.isOk(), 'map.json has the expected shape')
  const { needs, areas } = raw.unwrap()
  const features = areas.flatMap((area) => area.features)
  const recipes = features.flatMap((feature) =>
    (feature.recipes ?? []).map((item) => ({ file: item.file, proves: item.proves, feature })),
  )

  it('uses each feature ID once, and each sub-feature ID once within its feature', () => {
    const ids = features.map((feature) => feature.id)
    assert.deepEqual(
      ids.filter((id, index) => ids.indexOf(id) !== index),
      [],
    )
    for (const feature of features) {
      const subs = feature.subFeatures.map((sub) => sub.id)
      assert.deepEqual(
        subs.filter((id, index) => subs.indexOf(id) !== index),
        [],
        feature.id,
      )
    }
  })

  it('only uses needs keys it defines', () => {
    const used = features.flatMap((feature) =>
      [feature.needs].concat(feature.subFeatures.flatMap((sub) => sub.needs ?? [])),
    )
    assert.deepEqual(
      used.filter((key) => !(key in needs)),
      [],
    )
  })

  it('has no recipe begin would refuse: proves within its feature, a matching Proves line, a valid file name', () => {
    assert.deepEqual(
      [...(readRecipes()?.values() ?? [])].flatMap((item) => item.problem ?? []),
      [],
    )
  })

  it('lists every recipe file exactly once, and gives each a unique ID', () => {
    const listed = recipes.map((item) => item.file)
    const files = readdirSync(FEATURES).filter((file) => file.endsWith('.md') && file !== 'README.md')
    assert.deepEqual([...listed].sort(), [...files].sort())
    assert.equal(readRecipes()?.size, listed.length)
    assert.equal(readRecipes()?.has('statements'), true)
    assert.equal(readRecipes()?.has('Statements'), false)
  })

  it('gives every recipe the four sections of the recipe contract, in order', () => {
    const offContract = recipes.flatMap(({ file }) => {
      const headings = Array.from(readFileSync(join(FEATURES, file), 'utf8').matchAll(/^## (.+)$/gm), (m) => m[1])
      const [sub, how, drive, gotchas, ...extra] = headings
      const ok =
        sub === 'Sub-features' &&
        how === 'How to get to it (user POV)' &&
        (drive === 'Driving it with the browser' || /^Driving it with CDP \(.+\)$/.test(drive ?? '')) &&
        gotchas === 'Gotchas' &&
        extra.length === 0
      return ok ? [] : [`${file}: ${headings.join(' | ')}`]
    })
    assert.deepEqual(offContract, [])
  })
})

describe('freshSeedCheck', () => {
  it('passes a fresh run with no seed marker, with or without accounts a journey added', () => {
    assert.deepEqual(freshSeedCheck('missing', 0), [true, 'fresh run: not seeded, 0 accounts added by journeys'])
    assert.deepEqual(freshSeedCheck('missing', 1), [true, 'fresh run: not seeded, 1 account added by journeys'])
    assert.equal(freshSeedCheck('missing', 3)[0], true)
  })

  it('fails a fresh run that has a seed marker, readable or not', () => {
    assert.equal(freshSeedCheck('ok', 0)[0], false)
    assert.equal(freshSeedCheck('invalid', 0)[0], false)
    assert.match(freshSeedCheck('ok', 3)[1], /seed marker/)
  })
})

describe('faults', () => {
  it('holds every answer under slow, and fails none', () => {
    assert.deepEqual(faultedAnswer('electrum', 'slow', 'blockchain.scripthash.get_history'), {
      delayMs: SLOW_FAULT_MS,
      fail: false,
    })
    assert.deepEqual(faultedAnswer('mempool', 'ok', '/api/v1/prices'), { delayMs: 0, fail: false })
  })

  it("fails every request under error except Electrum's keepalives", () => {
    assert.equal(faultedAnswer('electrum', 'error', 'server.ping').fail, false)
    assert.equal(faultedAnswer('electrum', 'error', 'blockchain.headers.subscribe').fail, false)
    assert.equal(faultedAnswer('electrum', 'error', 'blockchain.transaction.get').fail, true)
    assert.equal(faultedAnswer('mempool', 'error', 'server.ping').fail, true)
  })

  it('changes one target at a time and counts each change', () => {
    const down = withFault({ seq: 0, electrum: 'ok', mempool: 'ok' }, 'electrum', 'down')
    assert.deepEqual(down, { seq: 1, electrum: 'down', mempool: 'ok' })
    const both = withFault(down, 'mempool', 'slow')
    assert.deepEqual(activeFaults(both), ['electrum down', 'mempool slow'])
    assert.deepEqual(activeFaults(withFault(withFault(both, 'electrum', 'ok'), 'mempool', 'ok')), [])
  })
})

describe('checkEmulatorsRule', () => {
  const CID_LEDGER = 'a'.repeat(64)
  const CID_EXTRA = 'b'.repeat(64)

  const ledgerEmulator: EmulatorState = {
    device: 'ledger',
    model: 'flex',
    seed: 'primary',
    containerId: CID_LEDGER,
    apiPort: 15000,
    healthUrl: 'http://127.0.0.1:15000/events',
    bridge: {
      name: 'emulator:ledger-bridge',
      pid: 4242,
      startedAt: 't1',
      port: 15001,
      url: 'http://127.0.0.1:15001',
      controlPort: 15101,
      mode: 'manual',
    },
  }

  const healthyProbe: EmulatorProbe = {
    emulator: ledgerEmulator,
    containerState: { state: 'running' },
    healthOk: true,
    healthDetail: 'HTTP 200',
    bridgeAlive: true,
    bridgePortOwned: true,
    bridgePortHolders: [4242],
  }

  it('fails a bridge whose control port, shim or queue is wrong, listing each problem', () => {
    const [ok, detail] = checkEmulatorsRule(
      [
        {
          ...healthyProbe,
          bridgeProblems: [
            "bridge control port 15101 is not the bridge's",
            'an APDU has waited 42 s on the device; finish its prompt with helpers/verify emulator press|reject --device ledger',
          ],
        },
      ],
      [],
    )
    assert.equal(ok, false)
    assert.match(detail, /bridge control port 15101 is not the bridge's, an APDU has waited 42 s on the device/)
  })

  it('passes with none when no emulators or containers exist', () => {
    assert.deepEqual(checkEmulatorsRule([], []), [true, 'none'])
  })

  it('fails when containers.json does not parse', () => {
    const [ok, detail] = checkEmulatorsRule([], [], '/tmp/containers.json')
    assert.equal(ok, false)
    assert.match(detail, /containers\.json does not parse/)
  })

  it('passes when container is running, health answers 2xx, and bridge owns its port (or has no bridge)', () => {
    const [ok, detail] = checkEmulatorsRule([healthyProbe], [])
    assert.equal(ok, true)
    assert.match(
      detail,
      new RegExp(`ledger \\(flex\\).*${CID_LEDGER.slice(0, 12)}.*bridge http://127\\.0\\.0\\.1:15001 control 15101`),
    )

    const noBridgeEmulator: EmulatorState = {
      device: 'coldcard',
      seed: 'primary',
      containerId: CID_EXTRA,
      apiPort: 16000,
      healthUrl: 'http://127.0.0.1:16000/health',
    }
    const [okNoBridge, detailNoBridge] = checkEmulatorsRule(
      [
        {
          emulator: noBridgeEmulator,
          containerState: { state: 'running' },
          healthOk: true,
          healthDetail: 'HTTP 200',
          bridgeAlive: null,
          bridgePortOwned: null,
          bridgePortHolders: [],
        },
      ],
      [],
    )
    assert.equal(okNoBridge, true)
    assert.doesNotMatch(detailNoBridge, /bridge/)
  })

  it('flags a stopped container without emitting a health probe failure, and distinguishes Docker-unavailable', () => {
    const [okStopped, detailStopped] = checkEmulatorsRule(
      [
        {
          ...healthyProbe,
          containerState: { state: 'stopped' },
          healthOk: false,
          healthDetail: 'skipped (container is not running)',
        },
      ],
      [],
    )
    assert.equal(okStopped, false)
    assert.match(detailStopped, new RegExp(`container ${CID_LEDGER} is not running`))
    assert.doesNotMatch(detailStopped, /health .* failed/)

    const [okUnavailable, detailUnavailable] = checkEmulatorsRule(
      [
        {
          ...healthyProbe,
          containerState: { state: 'unavailable', detail: 'Cannot connect to the Docker daemon' },
          healthOk: false,
          healthDetail: 'skipped (container is not running)',
        },
      ],
      [],
    )
    assert.equal(okUnavailable, false)
    assert.match(detailUnavailable, /Docker unavailable \(Cannot connect to the Docker daemon\)/)
    assert.doesNotMatch(detailUnavailable, /is not running/)
    assert.doesNotMatch(detailUnavailable, /health .* failed/)
  })

  it('never passes an unregistered container recorded only in containers.json', () => {
    const [okRunningExtra, detailRunningExtra] = checkEmulatorsRule(
      [],
      [{ name: 'emulator:ledger', containerId: CID_EXTRA, containerState: { state: 'running' } }],
    )
    assert.equal(okRunningExtra, false)
    assert.match(detailRunningExtra, /without emulator registration\/health check in run\.json/)

    const [okStoppedExtra, detailStoppedExtra] = checkEmulatorsRule(
      [],
      [{ name: 'emulator:ledger', containerId: CID_EXTRA, containerState: { state: 'stopped' } }],
    )
    assert.equal(okStoppedExtra, false)
    assert.match(detailStoppedExtra, /not running/)

    const [okUnavailableExtra, detailUnavailableExtra] = checkEmulatorsRule(
      [],
      [
        {
          name: 'emulator:ledger',
          containerId: CID_EXTRA,
          containerState: { state: 'unavailable', detail: 'permission denied' },
        },
      ],
    )
    assert.equal(okUnavailableExtra, false)
    assert.match(detailUnavailableExtra, /Docker unavailable \(permission denied\)/)
  })

  it('flags an unreachable health endpoint or a dead/stolen/unlistened bridge process', () => {
    const [okHealth, detailHealth] = checkEmulatorsRule(
      [{ ...healthyProbe, healthOk: false, healthDetail: 'fetch failed' }],
      [],
    )
    assert.equal(okHealth, false)
    assert.match(detailHealth, /health .* failed \(fetch failed\)/)

    const [okBridge, detailBridge] = checkEmulatorsRule(
      [{ ...healthyProbe, bridgeAlive: false, bridgePortOwned: false, bridgePortHolders: [9999] }],
      [],
    )
    assert.equal(okBridge, false)
    assert.match(detailBridge, /bridge PID 4242 is not this run's process/)
    assert.match(detailBridge, /bridge port 15001 is held by PID 9999/)

    const [okNoListener, detailNoListener] = checkEmulatorsRule(
      [{ ...healthyProbe, bridgePortOwned: false, bridgePortHolders: [] }],
      [],
    )
    assert.equal(okNoListener, false)
    assert.match(detailNoListener, /bridge port 15001 has no listener/)
  })
})

describe('parseEmulatorCommand', () => {
  const emptyInput = {
    action: undefined,
    device: undefined,
    seed: undefined,
    model: undefined,
    button: undefined,
    mode: undefined,
  }

  it('defaults Ledger start to model flex and seed primary, and accepts nanosp', () => {
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'start', device: 'ledger' }), {
      ok: true,
      command: { action: 'start', device: 'ledger', seed: 'primary', model: 'flex', bridge: null },
    })
    assert.deepEqual(
      parseEmulatorCommand({ ...emptyInput, action: 'start', device: 'ledger', seed: 'empty', model: 'nanosp' }),
      {
        ok: true,
        command: { action: 'start', device: 'ledger', seed: 'empty', model: 'nanosp', bridge: null },
      },
    )
    const badModel = parseEmulatorCommand({ ...emptyInput, action: 'start', device: 'ledger', model: 'unknown' })
    assert.equal(badModel.ok, false)
    assert.match(badModel.error, /Unknown Ledger --model/)
  })

  it('accepts status with or without --device and all skeleton actions with valid flags', () => {
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'status' }), {
      ok: true,
      command: { action: 'status', device: undefined },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'status', device: 'trezor' }), {
      ok: true,
      command: { action: 'status', device: 'trezor' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'stop', device: 'coldcard' }), {
      ok: true,
      command: { action: 'stop', device: 'coldcard' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'press', device: 'ledger', button: 'right' }), {
      ok: true,
      command: { action: 'press', device: 'ledger', button: 'right' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'reject', device: 'trezor' }), {
      ok: true,
      command: { action: 'reject', device: 'trezor' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'disconnect', device: 'ledger' }), {
      ok: true,
      command: { action: 'disconnect', device: 'ledger' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'fault', device: 'ledger', mode: 'locked' }), {
      ok: true,
      command: { action: 'fault', device: 'ledger', mode: 'locked' },
    })
  })

  it('parses screenshot with its recipe and step, and only the Ledger buttons press knows', () => {
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'screenshot', device: 'ledger' }), {
      ok: true,
      command: { action: 'screenshot', device: 'ledger', recipe: undefined, step: 'screen' },
    })
    assert.deepEqual(
      parseEmulatorCommand({
        ...emptyInput,
        action: 'screenshot',
        device: 'ledger',
        recipe: 'add-ledger',
        step: 'sign-1',
      }),
      { ok: true, command: { action: 'screenshot', device: 'ledger', recipe: 'add-ledger', step: 'sign-1' } },
    )
    assert.equal(
      parseEmulatorCommand({ ...emptyInput, action: 'screenshot', device: 'ledger', step: '../x' }).ok,
      false,
    )
    assert.equal(
      parseEmulatorCommand({ ...emptyInput, action: 'screenshot', device: 'ledger', recipe: 'a/b' }).ok,
      false,
    )
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'screenshot' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'press', device: 'ledger', step: 'x' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'status', recipe: 'home-summary' }).ok, false)
    assert.deepEqual(parseEmulatorCommand({ ...emptyInput, action: 'press', device: 'ledger' }), {
      ok: true,
      command: { action: 'press', device: 'ledger', button: undefined },
    })
    for (const button of ['left', 'right', 'both', 'next', 'approve', 'dismiss']) {
      assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'press', device: 'ledger', button }).ok, true, button)
    }
    const unknown = parseEmulatorCommand({ ...emptyInput, action: 'press', device: 'ledger', button: 'up' })
    assert.match(unknown.ok ? '' : unknown.error, /Unknown --button up/)
  })

  it('rejects unknown actions, missing required flags, and misplaced flags', () => {
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'restart', device: 'ledger' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'start' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'fault', device: 'ledger' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'stop', device: 'ledger', seed: 'primary' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'reject', device: 'ledger', button: 'both' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'start', device: 'ledger', mode: 'locked' }).ok, false)
    assert.equal(parseEmulatorCommand({ ...emptyInput, action: 'start', device: 'trezor', seed: 'bogus' }).ok, false)
  })
})

describe('emulator screenshot destination', () => {
  const begin = (recipeId: string, attempts: Attempt[]): Attempt =>
    newAttempt(attempts, { ...recipe, id: recipeId }, '2026-11-25T17:00:00Z', liveA)

  it('picks the named or only open attempt, else the run folder, and never guesses between several', () => {
    assert.deepEqual(screenshotFolder([], undefined), { ok: true, folder: null })
    const home = begin('home-summary', [])
    assert.deepEqual(screenshotFolder([home], undefined), { ok: true, folder: 'home-summary/attempt-1' })
    assert.deepEqual(screenshotFolder([home], 'home-summary'), { ok: true, folder: 'home-summary/attempt-1' })
    const missing = screenshotFolder([home], 'add-ledger')
    assert.match(missing.ok ? '' : missing.error, /add-ledger has no open attempt/)
    const ledger = begin('add-ledger', [home])
    const several = screenshotFolder([home, ledger], undefined)
    assert.match(
      several.ok ? '' : several.error,
      /Several attempts are open \(home-summary, add-ledger\); pass --recipe/,
    )
    assert.deepEqual(screenshotFolder([home, ledger], 'add-ledger'), { ok: true, folder: 'add-ledger/attempt-1' })
    const closed = withAbandoned([home], home, '2026-11-25T18:00:00Z')
    assert.deepEqual(screenshotFolder(closed, undefined), { ok: true, folder: null })
  })

  it('numbers each screenshot after the files already in the folder', () => {
    assert.equal(nextShotName([], 'screen'), '01-ledger-screen.png')
    assert.equal(
      nextShotName(['01-home.png', '01-home.aria.txt', '02-tooltip.png', 'trace.md'], 'sign'),
      '03-ledger-sign.png',
    )
    assert.equal(nextShotName(['09-x.png', '10-ledger-a.png'], 'b'), '11-ledger-b.png')
    // Past 99 the number keeps growing instead of starting over at 100 and overwriting it.
    assert.equal(nextShotName(['99-ledger-a.png'], 'b'), '100-ledger-b.png')
    assert.equal(nextShotName(['99-ledger-a.png', '100-ledger-b.png'], 'c'), '101-ledger-c.png')
  })

  it('lists evidence in step order past 99, without renaming two-digit files', () => {
    assert.deepEqual(sortEvidence(['100-ledger-c.png', '99-ledger-b.png', '02-home.png', 'trace.md', '01-home.png']), [
      '01-home.png',
      '02-home.png',
      '99-ledger-b.png',
      '100-ledger-c.png',
      'trace.md',
    ])
  })

  it('reads --bridge and --auto-approve only on a Ledger start', () => {
    const none = { run: undefined, seed: undefined, model: undefined, button: undefined, mode: undefined }
    const start = { ...none, action: 'start', device: 'ledger' }
    assert.deepEqual(parseEmulatorCommand({ ...start, bridge: true }), {
      ok: true,
      command: { action: 'start', device: 'ledger', seed: 'primary', model: 'flex', bridge: 'manual' },
    })
    assert.deepEqual(parseEmulatorCommand({ ...start, bridge: true, autoApprove: true }), {
      ok: true,
      command: { action: 'start', device: 'ledger', seed: 'primary', model: 'flex', bridge: 'auto' },
    })
    const noBridge = parseEmulatorCommand({ ...start, autoApprove: true })
    assert.match(noBridge.ok ? '' : noBridge.error, /--auto-approve needs --bridge/)
    const onPress = parseEmulatorCommand({ ...none, action: 'press', device: 'ledger', bridge: true })
    assert.match(onPress.ok ? '' : onPress.error, /only valid with emulator start/)
  })
})

describe('checkEmulatorsRule for 3B', () => {
  const emulator: EmulatorState = {
    device: 'ledger',
    model: 'nanosp',
    seed: 'primary',
    containerId: 'a'.repeat(64),
    apiPort: 15000,
    healthUrl: 'http://127.0.0.1:15000/events?currentscreenonly=true',
  }
  const probe: EmulatorProbe = {
    emulator,
    containerState: { state: 'running' },
    healthOk: true,
    healthDetail: 'HTTP 200',
    bridgeAlive: null,
    bridgePortOwned: null,
    bridgePortHolders: [],
    healthSummary: 'screen idle',
  }

  it('says what the health check read, and fails a create still in the journal', () => {
    assert.deepEqual(checkEmulatorsRule([probe], []), [true, 'ledger (nanosp) container aaaaaaaaaaaa ok, screen idle'])
    const [ok, detail] = checkEmulatorsRule([], [], null, ['emulator:ledger'])
    assert.equal(ok, false)
    assert.match(detail, /emulator:ledger: a container create is in progress or was interrupted/)
  })
})
