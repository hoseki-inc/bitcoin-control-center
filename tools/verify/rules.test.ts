import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { loadEnv } from 'vite'
import { describe, it, vi } from 'vitest'
import { z } from 'zod'
import {
  LiveRun,
  MAP_FILE,
  type Outcome,
  type Recipe,
  beginProblem,
  freeAttemptNumber,
  latestRecorded,
  launchDecision,
  newAttempt,
  openAttempt,
  readRecipes,
  recordProblem,
  webBuildEnv,
  withAbandoned,
  withOutcome,
} from './rules'
import { REPO_ROOT, type RunState } from './run'

const recipe: Recipe = { id: 'statements', feature: 'statements', proves: ['generate', 'listed'], problem: null }
const proof = ['01-list.jpg', 'trace.md']
const build = { commit: 'abc', tree: 'tree-1', dirty: false }
function runState(startedAt: string): RunState {
  return {
    runId: 'test',
    launchedAt: '',
    fresh: false,
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

describe('launchDecision', () => {
  it('starts a new run', () => {
    assert.deepEqual(launchDecision({ alive: null, folderExists: false, evidenceExists: false, fresh: false }), {
      action: 'start',
    })
  })

  it('leaves a live run of the same kind running', () => {
    assert.deepEqual(
      launchDecision({ alive: { fresh: true }, folderExists: true, evidenceExists: true, fresh: true }),
      {
        action: 'running',
      },
    )
  })

  it('refuses --fresh for a live seeded run', () => {
    const decision = launchDecision({ alive: { fresh: false }, folderExists: true, evidenceExists: false, fresh: true })
    assert.equal(decision.action, 'refuse')
  })

  it('refuses a run ID that already has evidence from an earlier run', () => {
    const decision = launchDecision({ alive: null, folderExists: false, evidenceExists: true, fresh: false })
    assert.equal(decision.action, 'refuse')
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
})
