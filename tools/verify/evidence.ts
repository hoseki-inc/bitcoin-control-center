import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { readArgs } from './args'
import { LEDGER_FIRMWARE, bridgeModeNow } from './emulators/ledger'
import {
  CdpVersionSchema,
  type EmulatorProvenance,
  type EvidenceRecord,
  LABELS,
  RecordSchema,
  type RuntimeVersions,
  cdpVersions,
  describeEmulator,
  newRecord,
  report,
  startProblem,
} from './evidence-record'
import { ChildEnv, runCommand } from './process'
import {
  type Attempt,
  LiveRun,
  MAP_FILE,
  STATUSES,
  beginProblem,
  freeAttemptNumber,
  newAttempt,
  openAttempt,
  readRecipes,
  recordProblem,
  sortEvidence,
  withAbandoned,
  withOutcome,
} from './rules'
import {
  EVIDENCE_ROOT,
  HELPER,
  REPO_ROOT,
  type RunState,
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

async function readElectronVersions(cdpPort: number): Promise<RuntimeVersions> {
  try {
    const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
    if (!response.ok) {
      return {}
    }
    const parsed = parseUnknown(CdpVersionSchema, await response.json())
    return parsed.isOk() ? cdpVersions(parsed.unwrap()) : {}
  } catch {
    return {}
  }
}

/** The run's Ledger as an attempt records it, with the bridge's mode now; undefined when the run has none. */
async function ledgerProvenance(state: RunState | null): Promise<EmulatorProvenance | undefined> {
  const ledger = state?.emulators?.find((emulator) => emulator.device === 'ledger')
  if (ledger === undefined) {
    return undefined
  }
  let bridge = 'none (Speculos API only)'
  if (ledger.bridge !== undefined) {
    const now = await bridgeModeNow(paths, ledger.bridge)
    bridge = 'mode' in now ? now.mode : `not answering (${now.problem})`
  }
  return { device: 'ledger', model: ledger.model ?? null, seed: ledger.seed, firmware: LEDGER_FIRMWARE, bridge }
}

const listing = (directory: string): string[] => (existsSync(directory) ? sortEvidence(readdirSync(directory)) : [])

const [command, recipeArg] = positionals
if (command === 'start') {
  const state = requireJsonFile(readRunState(paths)) ?? fail(`Run ${paths.runId} is not running.`)
  if (existsSync(recordFile)) {
    console.log(`Evidence for run ${paths.runId} already started: ${folder}`)
    process.exit(0)
  }
  const seeded = requireJsonFile(readSeedMarker(paths, state)) !== null
  const problem = startProblem(state, { seeded, smokeReport: existsSync(join(folder, 'smoke.json')) }, HELPER)
  if (problem !== null) {
    fail(problem)
  }
  const electronVersions =
    state.electron && state.cdpPort !== undefined ? await readElectronVersions(state.cdpPort) : {}
  save(
    newRecord(state, {
      seeded,
      startedAt: new Date().toISOString(),
      versions: {
        'Control Center': runCommand(process.execPath, [join(REPO_ROOT, 'start9/scripts/version.mjs'), 'umbrel'], {
          env: ChildEnv.with(),
        }).trim(),
        Node: process.version,
        ...electronVersions,
      },
    }),
  )
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
    const emulator = await ledgerProvenance(state)
    const attempt = emulator === undefined ? { ...planned, number } : { ...planned, number, emulator }
    const folderPath = join(folder, attemptFolder(attempt))
    mkdirSync(folderPath, { recursive: true })
    save({ ...record, attempts: [...record.attempts, attempt] })
    console.log(
      `Attempt ${attempt.number} of ${recipeId}. Save its evidence in ${folderPath}${emulator === undefined ? '' : `\nEmulator: ${describeEmulator(emulator)}`}`,
    )
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
