import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ChildEnv } from './process'
import { type FaultMode, type FaultTarget, type Faults, REPO_ROOT, type RunState, readJsonFile } from './run'

// Pure rules the scripts share, kept apart so tests can check them without starting anything.

const MapSchema = z.object({
  areas: z.array(
    z.object({
      features: z.array(
        z.object({
          id: z.string(),
          subFeatures: z.array(z.object({ id: z.string() })),
          recipes: z.array(z.object({ file: z.string(), proves: z.array(z.string()) })).optional(),
        }),
      ),
    }),
  ),
})

/** A recipe from features/map.json: its feature, the sub-features a passing run proves, and why it can't be driven. */
export interface Recipe {
  id: string
  feature: string
  proves: string[]
  /** Null when the recipe is sound; otherwise what is wrong with its map entry or file. */
  problem: string | null
}

export const MAP_FILE = join(REPO_ROOT, '.agents/skills/verify-control-center/features/map.json')
const FEATURES_DIR = join(REPO_ROOT, '.agents/skills/verify-control-center/features')

/** The sub-feature IDs a recipe file names on its `Proves:` line. */
export function provesLine(text: string): string[] {
  const line = /^Proves: (.+)$/m.exec(text)?.[1] ?? ''
  return Array.from(line.matchAll(/`([\w-]+)`/g), (match) => match[1] ?? '')
}

function recipeProblem(file: string, proves: string[], subFeatures: Set<string>, dir: string): string | null {
  if (!/^[\w-]+\.md$/.test(file)) {
    return `${file}: recipe files are named with letters, digits, - and _ only, ending in .md`
  }
  if (proves.length === 0) {
    return `${file} proves nothing`
  }
  const foreign = proves.filter((id) => !subFeatures.has(id))
  if (foreign.length > 0) {
    return `${file} claims ${foreign.join(', ')}, which ${foreign.length === 1 ? 'is not a sub-feature' : 'are not sub-features'} of its feature`
  }
  // Exact name: a case-insensitive disk would accept a different spelling and split the recipe's results.
  if (!existsSync(dir) || !readdirSync(dir).includes(file)) {
    return `${file} does not exist`
  }
  const named = provesLine(readFileSync(join(dir, file), 'utf8'))
  const byName = (a: string, b: string): number => a.localeCompare(b)
  if ([...named].sort(byName).join(',') !== [...proves].sort(byName).join(',')) {
    return `${file}'s Proves line does not match its proves list in map.json`
  }
  return null
}

/** Every recipe in the map by ID, the file name without `.md`, each checked against its feature and file. */
export function readRecipes(file = MAP_FILE, dir = FEATURES_DIR): Map<string, Recipe> | null {
  const result = readJsonFile(MapSchema, file)
  if (result.status !== 'ok') {
    return null
  }
  const entries = result.value.areas.flatMap((area) =>
    area.features.flatMap((feature) => {
      const subFeatures = new Set(feature.subFeatures.map((sub) => sub.id))
      return (feature.recipes ?? []).map((recipe) => ({
        id: recipe.file.replace(/\.md$/, ''),
        feature: feature.id,
        proves: recipe.proves,
        problem: recipeProblem(recipe.file, recipe.proves, subFeatures, dir),
      }))
    }),
  )
  // A recipe listed twice, or two names that differ only in case, would leave its feature ambiguous.
  const counts = new Map<string, number>()
  for (const entry of entries) {
    counts.set(entry.id.toLowerCase(), (counts.get(entry.id.toLowerCase()) ?? 0) + 1)
  }
  return new Map(
    entries.map((entry) => {
      const listed = counts.get(entry.id.toLowerCase()) ?? 0
      const problem =
        listed > 1
          ? `${entry.id}.md is listed ${listed} times in map.json, counting names that differ only in case`
          : entry.problem
      return [entry.id, { ...entry, problem }] as const
    }),
  )
}

export const STATUSES = ['verified', 'failed', 'unreachable'] as const
export type Status = (typeof STATUSES)[number]

export interface Outcome {
  status: Status
  reason: string | null
  recordedAt: string
  artifacts: string[]
}

/**
 * One attempt at a recipe, saved when it begins. Its feature and proves list are a snapshot of the recipe at that
 * moment, so a later edit to the map can't change what an attempt claims. Open until its outcome is recorded.
 */
export interface Attempt {
  recipe: string
  number: number
  feature: string
  proves: string[]
  begunAt: string
  /** When Sentinel started on the run the attempt began on, so a verified outcome can't come from another run. */
  sentinelStartedAt: string
  /** Set when the attempt was given up without an outcome; the report then keeps the recipe's earlier result. */
  abandonedAt: string | null
  outcome: Outcome | null
}

/**
 * Proof that the run can be verified against right now: its own Sentinel holds its port, and the code hasn't changed
 * since launch. Only `liveRun` builds one, so begin and a verified record can't skip either check.
 */
export class LiveRun {
  readonly #sentinelStartedAt: string

  private constructor(sentinelStartedAt: string) {
    this.#sentinelStartedAt = sentinelStartedAt
  }

  public get sentinelStartedAt(): string {
    return this.#sentinelStartedAt
  }

  /** The run's LiveRun, or why it isn't one. */
  public static of(state: RunState | null, ownsItsPort: boolean, current: RunState['build']): LiveRun | string {
    if (state === null || !ownsItsPort) {
      return 'This run is not running. Evidence is only gathered on a live run; launch a new one.'
    }
    if (current.commit !== state.build.commit || current.tree !== state.build.tree) {
      return 'The code changed since this run launched, so the running app is not the code under test. Clean up and launch a new run.'
    }
    return new LiveRun(state.sentinel.startedAt)
  }
}

export function openAttempt(attempts: Attempt[], recipeId: string): Attempt | undefined {
  return attempts.find(
    (attempt) => attempt.recipe === recipeId && attempt.outcome === null && attempt.abandonedAt === null,
  )
}

/** Why an attempt at a recipe can't begin, or null when it can. */
export function beginProblem(
  attempts: Attempt[],
  recipeId: string,
  recipe: Recipe | undefined,
  live: LiveRun | string,
): string | null {
  if (!(live instanceof LiveRun)) {
    return live
  }
  if (recipe === undefined) {
    return `${recipeId} is not a recipe in map.json. Recipe IDs are recipe file names without .md, exactly.`
  }
  if (recipe.problem !== null) {
    return `${recipeId} can't be driven yet: ${recipe.problem}`
  }
  const open = openAttempt(attempts, recipeId)
  return open === undefined
    ? null
    : `Attempt ${open.number} of ${recipeId} is still open. Record its outcome, or run evidence abandon ${recipeId} to give it up, before beginning another.`
}

/** A new open attempt, numbered after every earlier attempt at the recipe. */
export function newAttempt(attempts: Attempt[], recipe: Recipe, begunAt: string, live: LiveRun): Attempt {
  const earlier = attempts.filter((attempt) => attempt.recipe === recipe.id).map((attempt) => attempt.number)
  return {
    recipe: recipe.id,
    number: Math.max(0, ...earlier) + 1,
    feature: recipe.feature,
    proves: [...recipe.proves],
    begunAt,
    sentinelStartedAt: live.sentinelStartedAt,
    abandonedAt: null,
    outcome: null,
  }
}

export interface RecordRequest {
  status: Status
  reason: string | null
  /** File names in the open attempt's folder. */
  files: string[]
  /** The run as it is now: live with unchanged code, or why not. */
  live: LiveRun | string
}

/** Why the open attempt's outcome can't be recorded, or null when it can. */
export function recordProblem(open: Attempt | undefined, recipeId: string, request: RecordRequest): string | null {
  if (open === undefined) {
    return `${recipeId} has no open attempt. Run evidence begin ${recipeId} before driving it.`
  }
  if (request.status !== 'verified') {
    return request.reason === null
      ? 'A failed or unreachable outcome needs --reason: what broke, or which precondition is missing'
      : null
  }
  if (!(request.live instanceof LiveRun)) {
    return `Attempt ${open.number} can't be verified. ${request.live} Record it as failed, or abandon it.`
  }
  if (request.live.sentinelStartedAt !== open.sentinelStartedAt) {
    return `Attempt ${open.number} began on a Sentinel that is no longer running, so it can't be verified. Record it as failed, or abandon it, then begin again on a live run.`
  }
  if (!request.files.includes('trace.md') || !request.files.some((file) => /\.(jpe?g|png)$/i.test(file))) {
    return `A verified outcome needs trace.md and at least one screenshot in attempt ${open.number}'s folder`
  }
  return null
}

/** The attempts with the open one closed by this outcome. Nothing else changes, including what it proves. */
export function withOutcome(attempts: Attempt[], open: Attempt, outcome: Outcome): Attempt[] {
  return attempts.map((attempt) => (attempt === open ? { ...attempt, outcome } : attempt))
}

/** The attempts with the open one given up: closed, with no outcome. */
export function withAbandoned(attempts: Attempt[], open: Attempt, abandonedAt: string): Attempt[] {
  return attempts.map((attempt) => (attempt === open ? { ...attempt, abandonedAt } : attempt))
}

/** The first attempt number at or after `start` whose folder doesn't exist yet, skipping leftovers. */
export function freeAttemptNumber(start: number, folderExists: (number: number) => boolean): number {
  let number = start
  while (folderExists(number)) {
    number += 1
  }
  return number
}

/** Each recipe's latest recorded attempt, the one the report shows. */
export function latestRecorded(attempts: Attempt[]): Array<Attempt & { outcome: Outcome }> {
  const latest = new Map<string, Attempt & { outcome: Outcome }>()
  for (const attempt of attempts) {
    const { outcome } = attempt
    const current = latest.get(attempt.recipe)
    if (outcome !== null && (current === undefined || attempt.number > current.number)) {
      latest.set(attempt.recipe, { ...attempt, outcome })
    }
  }
  return [...latest.values()]
}

export type LaunchDecision = { action: 'start' } | { action: 'running' } | { action: 'refuse'; reason: string }

/** What launch should do with a run ID, given what already exists for it. */
export function launchDecision(run: {
  alive: { fresh: boolean; desktop: boolean; pin: boolean } | null
  folderExists: boolean
  evidenceExists: boolean
  fresh: boolean
  desktop: boolean
  pin: boolean
}): LaunchDecision {
  if (run.alive !== null) {
    if (run.fresh && !run.alive.fresh) {
      return { action: 'refuse', reason: 'is already running seeded, not fresh. Launch a new run ID with --fresh.' }
    }
    if (run.desktop !== run.alive.desktop) {
      const kind = run.alive.desktop ? 'as the desktop app' : 'as the standalone app'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    if (run.pin !== run.alive.pin) {
      const kind = run.alive.pin ? 'with PINs on' : 'with PINs off'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    return { action: 'running' }
  }
  if (run.folderExists) {
    return { action: 'refuse', reason: 'has a run folder but its processes are not running. Clean it up first.' }
  }
  if (run.evidenceExists) {
    return { action: 'refuse', reason: 'already has evidence from an earlier run. Use a new run ID.' }
  }
  return { action: 'start' }
}

/**
 * The web build's environment. Exported variables beat every .env file, including a developer's own .local ones, so
 * setting these here pins the build to the standalone app that talks to the run's own Sentinel.
 */
export function webBuildEnv(desktop = false): ChildEnv {
  return ChildEnv.with({
    VITE_BACKEND_API_URL: '/trpc',
    VITE_BACKEND_BASE_URL: '',
    VITE_PLATFORM: desktop ? 'desktop' : '',
  })
}

/** How long `slow` holds each answer: long enough to see loading states, short of Sentinel's 30-second timeouts. */
export const SLOW_FAULT_MS = 5_000

// Under `error` the fake Electrum still answers these, so Sentinel stays connected while every data request fails.
const KEEPALIVE_METHODS = new Set(['server.version', 'server.ping', 'blockchain.headers.subscribe'])

export interface FaultedAnswer {
  delayMs: number
  fail: boolean
}

/** What a fake does with one request under a fault: `request` is an Electrum method or a mempool path. */
export function faultedAnswer(target: FaultTarget, mode: FaultMode, request: string): FaultedAnswer {
  return {
    delayMs: mode === 'slow' ? SLOW_FAULT_MS : 0,
    fail: mode === 'down' || (mode === 'error' && !(target === 'electrum' && KEEPALIVE_METHODS.has(request))),
  }
}

/** The faults after setting one target's mode, as the next change. */
export function withFault(current: Faults, target: FaultTarget, mode: FaultMode): Faults {
  const seq = current.seq + 1
  return target === 'electrum' ? { ...current, seq, electrum: mode } : { ...current, seq, mempool: mode }
}

/** The faults in effect, such as `electrum down`, or nothing when the fakes behave. */
export function activeFaults(faults: Faults): string[] {
  return (['electrum', 'mempool'] as const)
    .filter((target) => faults[target] !== 'ok')
    .map((target) => `${target} ${faults[target]}`)
}
