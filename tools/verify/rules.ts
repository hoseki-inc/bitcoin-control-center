import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { LEDGER_BUTTONS, type LedgerButton } from './emulators/ledger-driver'
import { ChildEnv } from './process'
import {
  type ContainerInspectResult,
  DEFAULT_LEDGER_MODEL,
  EMULATOR_DEVICES,
  EMULATOR_SEED_NAMES,
  type EmulatorDevice,
  type EmulatorSeedName,
  type EmulatorState,
  type FaultMode,
  type FaultTarget,
  type Faults,
  LEDGER_MODELS,
  type LedgerModel,
  REPO_ROOT,
  type RunState,
  readJsonFile,
} from './run'

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
  alive: {
    fresh: boolean
    desktop: boolean
    pin: boolean
    electron?: boolean
    setupPinInUi?: boolean
    releaseTag?: string
  } | null
  folderExists: boolean
  evidenceExists: boolean
  fresh: boolean
  desktop: boolean
  pin: boolean
  electron?: boolean
  setupPinInUi?: boolean
  releaseTag?: string
}): LaunchDecision {
  if (run.alive !== null) {
    if (run.fresh && !run.alive.fresh) {
      return { action: 'refuse', reason: 'is already running seeded, not fresh. Launch a new run ID with --fresh.' }
    }
    const wantElectron = run.electron === true
    const aliveElectron = run.alive.electron === true
    if (wantElectron !== aliveElectron) {
      const kind = aliveElectron ? 'as the packaged Electron app' : 'without the Electron shell'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    if (run.desktop !== run.alive.desktop) {
      const kind = run.alive.desktop ? 'as the desktop app' : 'as the standalone app'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    if (run.pin !== run.alive.pin) {
      const kind = run.alive.pin ? 'with PINs on' : 'with PINs off'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    const wantSetupPin = run.setupPinInUi === true
    const aliveSetupPin = run.alive.setupPinInUi === true
    if (wantSetupPin !== aliveSetupPin) {
      const kind = aliveSetupPin ? 'with --setup-pin-in-ui' : 'with PIN already set'
      return { action: 'refuse', reason: `is already running ${kind}. Launch a new run ID.` }
    }
    if (run.releaseTag !== run.alive.releaseTag) {
      return { action: 'refuse', reason: 'is already running with a different --release-tag. Launch a new run ID.' }
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

export type TorMode = 'online' | 'allow-offline'

export interface TorOutcome {
  status: 'connected' | 'offline-unverified' | 'failed'
  detail: string
}

/**
 * Classifies a Tor bootstrap outcome after polling `electrumStatus.tor`.
 * In `allow-offline`, a missing binary, spawn error, unexpected exit, or failure before the local
 * SOCKS listener binds is STILL a hard failure — only a post-SOCKS bootstrap timeout becomes `offline-unverified`.
 */
export function classifyTorOutcome(
  mode: TorMode,
  tor: {
    state: 'stopped' | 'starting' | 'ready' | 'failed' | 'unavailable'
    message?: string
    socksReady?: boolean
    progress?: number
  },
  torDataExists: boolean,
): TorOutcome {
  if (tor.state === 'unavailable') {
    return { status: 'failed', detail: 'Bundled Tor is unavailable in Sentinel' }
  }
  if (!torDataExists) {
    return { status: 'failed', detail: 'Scratch tor-data directory was not created' }
  }
  if (tor.state === 'ready') {
    return tor.socksReady === true
      ? { status: 'connected', detail: 'Bundled Tor bound local SOCKS listener and bootstrapped to 100%' }
      : { status: 'failed', detail: 'Tor reported ready without binding its local SOCKS listener' }
  }
  if (tor.socksReady !== true) {
    return {
      status: 'failed',
      detail: `Bundled Tor failed before binding local SOCKS listener (state=${tor.state}${tor.message !== undefined ? `: ${tor.message}` : ''})`,
    }
  }
  if (tor.state === 'failed' && tor.message !== undefined && !tor.message.includes('two minutes')) {
    return { status: 'failed', detail: `Bundled Tor failed after SOCKS bind: ${tor.message}` }
  }
  const progressText = tor.progress !== undefined ? ` at ${tor.progress}%` : ''
  if (mode === 'allow-offline') {
    return {
      status: 'offline-unverified',
      detail: `Bundled Tor binary started and bound SOCKS, but network bootstrap did not finish${progressText} (allow-offline)`,
    }
  }
  return {
    status: 'failed',
    detail: `Bundled Tor bound SOCKS but did not finish bootstrapping${progressText}${tor.message !== undefined ? `: ${tor.message}` : ''}`,
  }
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
/**
 * Doctor's `seed` check on a --fresh run. Only the seed marker decides: seed refuses fresh runs, so any accounts were
 * added by a journey, which is what fresh-run recipes do.
 */
export function freshSeedCheck(marker: 'missing' | 'invalid' | 'ok', accounts: number): [boolean, string] {
  if (marker !== 'missing') {
    return [false, 'fresh run, but it has a seed marker; launch a new run with --fresh']
  }
  return [true, `fresh run: not seeded, ${accounts} ${accounts === 1 ? 'account' : 'accounts'} added by journeys`]
}

export function activeFaults(faults: Faults): string[] {
  return (['electrum', 'mempool'] as const)
    .filter((target) => faults[target] !== 'ok')
    .map((target) => `${target} ${faults[target]}`)
}

export interface EmulatorProbe {
  emulator: EmulatorState
  containerState: ContainerInspectResult
  healthOk: boolean
  healthDetail: string
  bridgeAlive: boolean | null
  bridgePortOwned: boolean | null
  bridgePortHolders: number[]
  /** What a passing health check read, such as a Ledger's idle screen. */
  healthSummary?: string | undefined
}

export interface ExtraContainerProbe {
  name: string
  containerId: string
  containerState: ContainerInspectResult
}

/**
 * Doctor's `emulators` check: every recorded emulator must have its Docker container running, its health endpoint
 * answering, and any recorded bridge process alive and owning its port. Any extra container present only in
 * `containers.json` without a `run.json` emulator registration and health check always fails.
 */
export function checkEmulatorsRule(
  probes: readonly EmulatorProbe[],
  extraContainers: readonly ExtraContainerProbe[],
  containersInvalidFile: string | null = null,
  pendingCreates: readonly string[] = [],
): [boolean, string] {
  if (containersInvalidFile !== null) {
    return [false, `${containersInvalidFile} does not parse`]
  }
  if (probes.length === 0 && extraContainers.length === 0 && pendingCreates.length === 0) {
    return [true, 'none']
  }

  const issues: string[] = pendingCreates.map(
    (name) => `${name}: a container create is in progress or was interrupted; stop the device or clean up`,
  )
  const okSummaries: string[] = []

  for (const probe of probes) {
    const { emulator } = probe
    const label = `${emulator.device}${emulator.model !== undefined ? ` (${emulator.model})` : ''}`
    const localIssues: string[] = []

    if (probe.containerState.state === 'unavailable') {
      localIssues.push(`Docker unavailable (${probe.containerState.detail})`)
    } else if (probe.containerState.state === 'stopped') {
      localIssues.push(`container ${emulator.containerId} is not running`)
    } else if (!probe.healthOk) {
      localIssues.push(`health ${emulator.healthUrl} failed (${probe.healthDetail})`)
    }
    if (emulator.bridge !== undefined) {
      if (probe.bridgeAlive !== true) {
        localIssues.push(`bridge PID ${emulator.bridge.pid} is not this run's process`)
      }
      if (probe.bridgePortOwned !== true) {
        const holderDetail =
          probe.bridgePortHolders.length === 0
            ? 'has no listener'
            : `is held by PID ${probe.bridgePortHolders.join(', ')}`
        localIssues.push(`bridge port ${emulator.bridge.port} ${holderDetail}`)
      }
    }

    if (localIssues.length > 0) {
      issues.push(`${label}: ${localIssues.join(', ')}`)
    } else {
      const bridgeSummary = emulator.bridge !== undefined ? `, bridge ${emulator.bridge.port}` : ''
      const health = probe.healthSummary !== undefined ? `, ${probe.healthSummary}` : ''
      okSummaries.push(`${label} container ${emulator.containerId.slice(0, 12)} ok${health}${bridgeSummary}`)
    }
  }

  for (const extra of extraContainers) {
    if (extra.containerState.state === 'unavailable') {
      issues.push(`${extra.name} (${extra.containerId}): Docker unavailable (${extra.containerState.detail})`)
    } else if (extra.containerState.state === 'stopped') {
      issues.push(`${extra.name} (${extra.containerId}): container is not running (not registered in run.json)`)
    } else {
      issues.push(
        `${extra.name} (${extra.containerId}): container is running without emulator registration/health check in run.json`,
      )
    }
  }

  return issues.length === 0 ? [true, okSummaries.join('; ')] : [false, issues.join('; ')]
}

export const EMULATOR_ACTIONS = [
  'start',
  'stop',
  'status',
  'press',
  'reject',
  'screenshot',
  'disconnect',
  'fault',
] as const
export type EmulatorAction = (typeof EMULATOR_ACTIONS)[number]

export interface EmulatorCommandInput {
  action: string | undefined
  device: string | undefined
  seed: string | undefined
  model: string | undefined
  button: string | undefined
  mode: string | undefined
  recipe?: string | undefined
  step?: string | undefined
}

export type EmulatorCommand =
  | { action: 'start'; device: EmulatorDevice; seed: EmulatorSeedName; model: string | undefined }
  | { action: 'stop'; device: EmulatorDevice }
  | { action: 'status'; device: EmulatorDevice | undefined }
  | { action: 'press'; device: EmulatorDevice; button: LedgerButton | undefined }
  | { action: 'reject'; device: EmulatorDevice }
  | { action: 'screenshot'; device: EmulatorDevice; recipe: string | undefined; step: string }
  | { action: 'disconnect'; device: EmulatorDevice }
  | { action: 'fault'; device: EmulatorDevice; mode: string }

export type ParsedEmulatorCommand = { ok: true; command: EmulatorCommand } | { ok: false; error: string }

const isEmulatorAction = (value: string | undefined): value is EmulatorAction =>
  EMULATOR_ACTIONS.some((action) => action === value)

const isEmulatorDevice = (value: string | undefined): value is EmulatorDevice =>
  EMULATOR_DEVICES.some((device) => device === value)

const isEmulatorSeedName = (value: string | undefined): value is EmulatorSeedName =>
  EMULATOR_SEED_NAMES.some((seed) => seed === value)

const isLedgerModel = (value: string | undefined): value is LedgerModel =>
  LEDGER_MODELS.some((model) => model === value)

/** Validates `helpers/verify emulator <action> [flags]` arguments and applies locked defaults (Ledger model: flex). */
export function parseEmulatorCommand(input: EmulatorCommandInput): ParsedEmulatorCommand {
  if (!isEmulatorAction(input.action)) {
    return {
      ok: false,
      error: `Expected emulator action: ${EMULATOR_ACTIONS.join('|')}`,
    }
  }

  if (input.seed !== undefined && input.action !== 'start') {
    return { ok: false, error: '--seed is only valid with emulator start' }
  }
  if (input.model !== undefined && input.action !== 'start') {
    return { ok: false, error: '--model is only valid with emulator start' }
  }
  if (input.button !== undefined && input.action !== 'press') {
    return { ok: false, error: '--button is only valid with emulator press' }
  }
  if (input.mode !== undefined && input.action !== 'fault') {
    return { ok: false, error: '--mode is only valid with emulator fault' }
  }
  if ((input.recipe !== undefined || input.step !== undefined) && input.action !== 'screenshot') {
    return { ok: false, error: '--recipe and --step are only valid with emulator screenshot' }
  }

  if (input.action === 'status') {
    if (input.device !== undefined && !isEmulatorDevice(input.device)) {
      return { ok: false, error: `Unknown --device ${input.device}. Expected: ${EMULATOR_DEVICES.join('|')}` }
    }
    return {
      ok: true,
      command: {
        action: 'status',
        device: input.device !== undefined && isEmulatorDevice(input.device) ? input.device : undefined,
      },
    }
  }

  if (!isEmulatorDevice(input.device)) {
    return {
      ok: false,
      error: `--device is required for emulator ${input.action}. Expected: ${EMULATOR_DEVICES.join('|')}`,
    }
  }

  switch (input.action) {
    case 'start': {
      const seed = input.seed ?? 'primary'
      if (!isEmulatorSeedName(seed)) {
        return { ok: false, error: `Unknown --seed ${seed}. Expected: ${EMULATOR_SEED_NAMES.join('|')}` }
      }
      if (input.device === 'ledger') {
        const model = input.model ?? DEFAULT_LEDGER_MODEL
        if (!isLedgerModel(model)) {
          return { ok: false, error: `Unknown Ledger --model ${model}. Expected: ${LEDGER_MODELS.join('|')}` }
        }
        return { ok: true, command: { action: 'start', device: 'ledger', seed, model } }
      }
      return { ok: true, command: { action: 'start', device: input.device, seed, model: input.model } }
    }
    case 'stop':
      return { ok: true, command: { action: 'stop', device: input.device } }
    case 'press': {
      const { button } = input
      if (button === undefined) {
        return { ok: true, command: { action: 'press', device: input.device, button: undefined } }
      }
      const known = LEDGER_BUTTONS.find((candidate) => candidate === button)
      return known === undefined
        ? { ok: false, error: `Unknown --button ${button}. Expected: ${LEDGER_BUTTONS.join('|')}` }
        : { ok: true, command: { action: 'press', device: input.device, button: known } }
    }
    case 'screenshot': {
      const step = input.step ?? 'screen'
      if (!/^[a-z0-9][a-z0-9-]*$/.test(step)) {
        return { ok: false, error: '--step uses lowercase letters, digits and -' }
      }
      if (input.recipe !== undefined && !/^[\w-]+$/.test(input.recipe)) {
        return { ok: false, error: `Recipe IDs use letters, digits, - and _ only: ${input.recipe}` }
      }
      return { ok: true, command: { action: 'screenshot', device: input.device, recipe: input.recipe, step } }
    }
    case 'reject':
      return { ok: true, command: { action: 'reject', device: input.device } }
    case 'disconnect':
      return { ok: true, command: { action: 'disconnect', device: input.device } }
    case 'fault': {
      if (input.mode === undefined || input.mode.trim() === '') {
        return { ok: false, error: '--mode is required for emulator fault' }
      }
      return { ok: true, command: { action: 'fault', device: input.device, mode: input.mode } }
    }
  }
}

/**
 * Where `emulator screenshot` saves: the named recipe's open attempt, else the only open attempt, else the run's
 * evidence folder itself when none is open. A named recipe with no open attempt, or several open without a name, is
 * refused rather than guessed.
 */
export function screenshotFolder(
  attempts: readonly Attempt[],
  recipe: string | undefined,
): { ok: true; folder: string | null } | { ok: false; error: string } {
  const open = attempts.filter((attempt) => attempt.outcome === null && attempt.abandonedAt === null)
  const picked = recipe === undefined ? open : open.filter((attempt) => attempt.recipe === recipe)
  if (recipe !== undefined && picked.length === 0) {
    return { ok: false, error: `${recipe} has no open attempt; run evidence begin ${recipe} first` }
  }
  if (picked.length > 1) {
    return { ok: false, error: `Several attempts are open (${picked.map((a) => a.recipe).join(', ')}); pass --recipe` }
  }
  const [attempt] = picked
  return { ok: true, folder: attempt === undefined ? null : `${attempt.recipe}/attempt-${attempt.number}` }
}

/** The next `NN-ledger-<step>.png` after the numbered files already in a folder. */
export function nextShotName(files: readonly string[], step: string): string {
  const last = Math.max(0, ...files.map((file) => Number(/^(\d{2})-/.exec(file)?.[1] ?? 0)))
  return `${String(last + 1).padStart(2, '0')}-ledger-${step}.png`
}
