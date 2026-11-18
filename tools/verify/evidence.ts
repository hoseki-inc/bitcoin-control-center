import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { readArgs } from './args'
import { ChildEnv, runCommand } from './process'
import {
  type Attempt,
  LiveRun,
  MAP_FILE,
  STATUSES,
  beginProblem,
  freeAttemptNumber,
  latestRecorded,
  newAttempt,
  openAttempt,
  readRecipes,
  recordProblem,
  withAbandoned,
  withOutcome,
} from './rules'
import {
  EVIDENCE_ROOT,
  HELPER,
  REPO_ROOT,
  buildStamp,
  checkId,
  fail,
  ownsSentinel,
  readJsonFile,
  readRunState,
  readSeedMarker,
  requireJsonFile,
  runPaths,
  selectRunId,
} from './run'

// Keeps verify-output/<run-id>/evidence.json and report.md. A recipe is the unit of evidence. `begin` saves an open
// attempt with a snapshot of what the recipe proves and makes its empty folder; the agent saves that attempt's proof
// there; `record` closes the open attempt with an outcome built from the snapshot alone, and rewrites the report.
// Usage: helpers/verify evidence start [--run <id>]
//        helpers/verify evidence begin <recipe> [--run <id>]
//        helpers/verify evidence record <recipe> --status verified|failed|unreachable [--reason "<text>"] [--run <id>]
//        helpers/verify evidence abandon <recipe> [--run <id>]

const RecordSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  commit: z.string(),
  tree: z.string(),
  dirty: z.boolean(),
  baseline: z.enum(['seeded', 'fresh']),
  /** Which app the run served: the standalone web app or, with launch --desktop, the desktop one. */
  app: z.enum(['standalone', 'desktop']).default('standalone'),
  url: z.string(),
  versions: z.record(z.string(), z.string()),
  attempts: z.array(
    z.object({
      recipe: z.string(),
      number: z.number().int().positive(),
      feature: z.string(),
      proves: z.array(z.string()),
      begunAt: z.string(),
      sentinelStartedAt: z.string(),
      abandonedAt: z.string().nullable(),
      outcome: z
        .object({
          status: z.enum(STATUSES),
          reason: z.string().nullable(),
          recordedAt: z.string(),
          artifacts: z.array(z.string()),
        })
        .nullable(),
    }),
  ),
})
type EvidenceRecord = z.infer<typeof RecordSchema>

const { values, positionals } = readArgs(
  { run: { type: 'string' }, status: { type: 'string' }, reason: { type: 'string' } },
  2,
)
const paths = runPaths(selectRunId(values.run))
const folder = join(EVIDENCE_ROOT, paths.runId)
const recordFile = join(folder, 'evidence.json')

function save(record: EvidenceRecord): void {
  mkdirSync(folder, { recursive: true })
  writeFileSync(recordFile, `${JSON.stringify(record, null, 2)}\n`)
  writeFileSync(join(folder, 'report.md'), report(record))
}

function load(): EvidenceRecord {
  return (
    requireJsonFile(readJsonFile(RecordSchema, recordFile)) ??
    fail(`No evidence record for run ${paths.runId}. Run ${HELPER} evidence start first.`)
  )
}

const LABELS: Record<(typeof STATUSES)[number], string> = {
  verified: 'Verified',
  failed: 'Failed',
  unreachable: 'Verified-unreachable',
}

function report(record: EvidenceRecord): string {
  const lines = [
    `# Verification report: ${record.runId}`,
    '',
    `- Commit: ${record.commit}${record.dirty ? ` with uncommitted changes (tree ${record.tree})` : ''}`,
    `- Baseline: ${record.baseline === 'fresh' ? 'fresh run, not seeded' : 'seeded'}`,
    `- App: ${record.app === 'desktop' ? 'desktop (launch --desktop, no Electron shell)' : 'standalone web app'}`,
    `- Started: ${record.startedAt}`,
    `- Versions: ${Object.entries(record.versions)
      .map(([name, version]) => `${name} ${version}`)
      .join(', ')}`,
    '',
  ]
  const shown = latestRecorded(record.attempts)
  if (shown.length === 0) {
    lines.push('No recipes recorded yet.')
  }
  for (const attempt of shown) {
    const { outcome } = attempt
    lines.push(
      `## ${attempt.recipe}: ${LABELS[outcome.status]}`,
      '',
      `Feature: ${attempt.feature}, attempt ${attempt.number}`,
      '',
      `${outcome.status === 'verified' ? 'Proves' : 'Would prove'}: ${attempt.proves.join(', ')}`,
      '',
    )
    if (outcome.reason !== null) {
      lines.push(
        outcome.status === 'unreachable' ? `Missing precondition: ${outcome.reason}` : `Reason: ${outcome.reason}`,
        '',
      )
    }
    lines.push(`Recorded ${outcome.recordedAt}.`, '')
    if (outcome.artifacts.length > 0) {
      lines.push('Artifacts:', '', ...outcome.artifacts.map((file) => `- [${file}](${file})`), '')
    }
  }
  return `${lines.join('\n').trimEnd()}\n`
}

const listing = (directory: string): string[] => (existsSync(directory) ? readdirSync(directory).sort() : [])

const [command, recipeArg] = positionals
if (command === 'start') {
  const state = requireJsonFile(readRunState(paths)) ?? fail(`Run ${paths.runId} is not running.`)
  if (existsSync(recordFile)) {
    console.log(`Evidence for run ${paths.runId} already started: ${folder}`)
    process.exit(0)
  }
  if (!state.fresh && requireJsonFile(readSeedMarker(paths)) === null) {
    fail(`Run ${paths.runId} is not seeded. Run ${HELPER} seed first, or launch with --fresh.`)
  }
  save({
    runId: paths.runId,
    startedAt: new Date().toISOString(),
    commit: state.build.commit,
    tree: state.build.tree,
    dirty: state.build.dirty,
    baseline: state.fresh ? 'fresh' : 'seeded',
    app: state.desktop ? 'desktop' : 'standalone',
    url: state.url,
    versions: {
      'Control Center': runCommand(process.execPath, [join(REPO_ROOT, 'start9/scripts/version.mjs'), 'umbrel'], {
        env: ChildEnv.with(),
      }).trim(),
      Node: process.version,
    },
    attempts: [],
  })
  console.log(`Evidence for run ${paths.runId}: ${folder}`)
} else if (command === 'begin' || command === 'record' || command === 'abandon') {
  const recipeId = checkId('Recipe', recipeArg ?? fail(`Pass the recipe: ${HELPER} evidence ${command} <recipe>`))
  const record = load()
  const attemptFolder = (attempt: Attempt): string => `${attempt.recipe}/attempt-${attempt.number}`
  const state = requireJsonFile(readRunState(paths))
  const live = LiveRun.of(state, state !== null && ownsSentinel(state), buildStamp())
  const open = openAttempt(record.attempts, recipeId)

  if (command === 'begin') {
    const recipes = readRecipes() ?? fail(`${MAP_FILE} does not parse`)
    const recipe = recipes.get(recipeId)
    const problem = beginProblem(record.attempts, recipeId, recipe, live)
    if (problem !== null || recipe === undefined || !(live instanceof LiveRun)) {
      fail(problem ?? 'Nothing to begin')
    }
    const planned = newAttempt(record.attempts, recipe, new Date().toISOString(), live)
    // A folder left by an interrupted begin is skipped, never reused.
    const number = freeAttemptNumber(planned.number, (n) => existsSync(join(folder, recipeId, `attempt-${n}`)))
    const attempt = { ...planned, number }
    const folderPath = join(folder, attemptFolder(attempt))
    mkdirSync(folderPath, { recursive: true })
    save({ ...record, attempts: [...record.attempts, attempt] })
    console.log(`Attempt ${attempt.number} of ${recipeId}. Save its evidence in ${folderPath}`)
  } else if (command === 'abandon') {
    if (open === undefined) {
      fail(`${recipeId} has no open attempt to abandon.`)
    }
    save({ ...record, attempts: withAbandoned(record.attempts, open, new Date().toISOString()) })
    console.log(`Attempt ${open.number} of ${recipeId} abandoned. The report keeps the recipe's earlier result.`)
  } else {
    const status = parseUnknown(z.enum(STATUSES), values.status)
    if (status.isErr()) {
      fail(`Pass --status ${STATUSES.join('|')}`)
    }
    const reason =
      values.reason === undefined
        ? null
        : values.reason.trim() || fail('--reason needs text: what broke, or which precondition is missing')
    const files = open === undefined ? [] : listing(join(folder, attemptFolder(open)))
    const problem = recordProblem(open, recipeId, { status: status.unwrap(), reason, files, live })
    if (problem !== null || open === undefined) {
      fail(problem ?? 'Nothing to record')
    }
    const outcome = {
      status: status.unwrap(),
      reason,
      recordedAt: new Date().toISOString(),
      artifacts: files.map((file) => `${attemptFolder(open)}/${file}`),
    }
    save({ ...record, attempts: withOutcome(record.attempts, open, outcome) })
    console.log(
      `${recipeId}: ${LABELS[outcome.status]}, attempt ${open.number} (${outcome.artifacts.length} artifacts). Report: ${join(folder, 'report.md')}`,
    )
  }
} else {
  fail(
    `Usage: ${HELPER} evidence start | begin <recipe> | record <recipe> --status <status> [--reason <text>] | abandon <recipe>`,
  )
}
