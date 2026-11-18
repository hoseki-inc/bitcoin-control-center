import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { ChildEnv, runCommand } from './process'

export const REPO_ROOT = resolve(import.meta.dirname, '../..')
/** Scratch state for this checkout's runs. Other worktrees get their own folder, so they never see these runs. */
const RUNS_ROOT = join(tmpdir(), 'bcc-verify', createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8))
/** Evidence survives cleanup here, one folder per run. Git ignores it. */
export const EVIDENCE_ROOT = join(REPO_ROOT, 'verify-output')
export const HELPER = '.agents/skills/verify-control-center/helpers/verify'

const ProcessSchema = z.object({ name: z.string(), pid: z.number().int().positive(), startedAt: z.string() })
export type RecordedProcess = z.infer<typeof ProcessSchema>
const ProcessListSchema = z.array(ProcessSchema)

const RunStateSchema = z.object({
  runId: z.string(),
  launchedAt: z.string(),
  fresh: z.boolean(),
  /** Launched with --desktop: Sentinel and the web app run as the desktop app does. */
  desktop: z.boolean().default(false),
  /** Launched with --pin: PINs on as on Umbrel, with the run's test PIN set. */
  pin: z.boolean().default(false),
  build: z.object({ commit: z.string(), tree: z.string(), dirty: z.boolean() }),
  url: z.string(),
  sentinel: ProcessSchema.extend({ port: z.number().int().positive() }),
  fakes: ProcessSchema.extend({
    electrumPort: z.number().int().positive(),
    mempoolPort: z.number().int().positive(),
  }),
})
export type RunState = z.infer<typeof RunStateSchema>

export const FakesRecordSchema = z.object({
  electrumPort: z.number().int().positive(),
  mempoolPort: z.number().int().positive(),
})

const SeedMarkerSchema = z.object({
  seededAt: z.string(),
  accounts: z.record(z.string(), z.string()),
  statements: z.array(z.string()),
})
export type SeedMarker = z.infer<typeof SeedMarkerSchema>

export interface RunPaths {
  runId: string
  runDir: string
  dataDir: string
  appDir: string
  logsDir: string
  stateFile: string
  processesFile: string
  fakesFile: string
  seedFile: string
  requestLog: string
}

/** IDs become folder names, so they are letters, digits, - and _ only. */
export function checkId(kind: string, id: string): string {
  return /^[\w-]+$/.test(id) ? id : fail(`${kind} IDs use letters, digits, - and _ only: ${id}`)
}

export function runPaths(runId: string): RunPaths {
  const runDir = join(RUNS_ROOT, checkId('Run', runId))
  const dataDir = join(runDir, 'data')
  return {
    runId,
    runDir,
    dataDir,
    appDir: join(runDir, 'app'),
    logsDir: join(runDir, 'logs'),
    stateFile: join(runDir, 'run.json'),
    processesFile: join(runDir, 'processes.json'),
    fakesFile: join(runDir, 'fakes.json'),
    seedFile: join(dataDir, 'verify-seed.json'),
    requestLog: join(runDir, 'logs', 'fake-requests.log'),
  }
}

export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
  return `${stamp}-${randomBytes(2).toString('hex')}`
}

/** The run named by `--run`, or this checkout's only run when no run is named. */
export function selectRunId(named: string | undefined): string {
  if (named !== undefined) {
    return named
  }
  const runs = existsSync(RUNS_ROOT) ? readdirSync(RUNS_ROOT) : []
  if (runs.length === 1 && runs[0] !== undefined) {
    return runs[0]
  }
  fail(
    runs.length === 0
      ? `No verification run exists for this checkout. Start one with ${HELPER} launch.`
      : `Several runs exist; pass --run <id>. Runs: ${runs.join(', ')}`,
  )
}

export type JsonFile<T> = { status: 'missing' } | { status: 'invalid'; file: string } | { status: 'ok'; value: T }

/** A JSON file checked against its schema. A file that is missing, unreadable or the wrong shape is reported, not thrown. */
export function readJsonFile<S extends z.ZodType>(schema: S, file: string): JsonFile<z.infer<S>> {
  if (!existsSync(file)) {
    return { status: 'missing' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { status: 'invalid', file }
  }
  const parsed = parseUnknown(schema, raw)
  return parsed.isOk() ? { status: 'ok', value: parsed.unwrap() } : { status: 'invalid', file }
}

/** The value, or null when missing; an unreadable file stops the script. */
export function requireJsonFile<T>(result: JsonFile<T>): T | null {
  if (result.status === 'invalid') {
    fail(`${result.file} does not parse. Clean up this run and launch a new one.`)
  }
  return result.status === 'ok' ? result.value : null
}

export function readRunState(paths: RunPaths): JsonFile<RunState> {
  return readJsonFile(RunStateSchema, paths.stateFile)
}

export function readSeedMarker(paths: RunPaths): JsonFile<SeedMarker> {
  return readJsonFile(SeedMarkerSchema, paths.seedFile)
}

export function readProcesses(paths: RunPaths): RecordedProcess[] {
  const result = readJsonFile(ProcessListSchema, paths.processesFile)
  return result.status === 'ok' ? result.value : []
}

/** Launch calls this as each process starts, so cleanup can stop them even if launch dies before it finishes. */
export function recordProcess(paths: RunPaths, recorded: RecordedProcess): void {
  writeJson(paths.processesFile, [...readProcesses(paths), recorded])
}

const PortSchema = z.object({ port: z.number().int().positive() })

/** The port a server bound, from `server.address()`. */
export function boundPort(address: string | { port: number } | null): number {
  const parsed = parseUnknown(PortSchema, address)
  return parsed.isOk() ? parsed.unwrap().port : fail('The server is not listening on a TCP port')
}

type JsonRecord = RunState | SeedMarker | RecordedProcess[] | z.infer<typeof FakesRecordSchema>

export function writeJson(file: string, value: JsonRecord): void {
  mkdirSync(resolve(file, '..'), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function git(root: string, args: string[]): string {
  return runCommand('git', args, { cwd: root, env: ChildEnv.with() })
}

/** The skill's own docs can change during a run; the code under test cannot. */
const CODE_ONLY = ['--', '.', ':(exclude).agents']

/**
 * The commit, a hash of every uncommitted code change, and whether there were any. Taken at launch, so the doctor
 * can tell when the code moved and the report says what was actually running.
 */
export function buildStamp(root = REPO_ROOT): RunState['build'] {
  const commit = git(root, ['rev-parse', 'HEAD']).trim()
  const diff = git(root, ['diff', 'HEAD', '--binary', ...CODE_ONLY])
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', ...CODE_ONLY])
    .split('\0')
    .filter(Boolean)
    .sort()
  const hash = createHash('sha256').update(diff)
  for (const file of untracked) {
    hash.update(file).update(readFileSync(join(root, file)))
  }
  return { commit, tree: hash.digest('hex').slice(0, 16), dirty: diff !== '' || untracked.length > 0 }
}

/** When the process started, as `ps` reports it; null once it has exited. Guards against a reused PID. */
export function processStartTime(pid: number): string | null {
  try {
    // `ps` prints the start time in local time and locale; fix both so every caller compares the same string.
    const started = runCommand('ps', ['-o', 'lstart=', '-p', String(pid)], {
      env: ChildEnv.with({ TZ: 'UTC', LC_ALL: 'C' }),
    }).trim()
    return started === '' ? null : started
  } catch {
    return null
  }
}

/** True only for the exact process this run started, never another that reused its PID. */
export function isOurProcess(recorded: RecordedProcess): boolean {
  return processStartTime(recorded.pid) === recorded.startedAt
}

function lines(command: string, args: string[]): number[] {
  try {
    return runCommand(command, args, { env: ChildEnv.with() }).split('\n').filter(Boolean).map(Number)
  } catch {
    return []
  }
}

/** PIDs listening on a TCP port. */
export function listeners(port: number): number[] {
  return lines('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'])
}

/** Launch starts each process as its own group leader, so its children share the leader's PID as their group. */
export function portOwnedBy(port: number, leader: number): boolean {
  const pids = listeners(port)
  return pids.length > 0 && pids.every((pid) => lines('ps', ['-o', 'pgid=', '-p', String(pid)])[0] === leader)
}

export async function wait(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms)
  })
}

function signalGroup(leader: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-leader, signal)
  } catch {
    // The group exited between the check and the signal.
  }
}

/**
 * Stops a process group this run started, and nothing else. A group ID cannot be reused while any member lives, so
 * members left behind by a dead leader are still ours; a PID another process took over is left alone.
 */
export async function stopProcess(recorded: RecordedProcess): Promise<void> {
  const leaderStart = processStartTime(recorded.pid)
  const ours =
    leaderStart === recorded.startedAt ||
    (leaderStart === null && lines('pgrep', ['-g', String(recorded.pid)]).length > 0)
  if (!ours) {
    console.log(`${recorded.name}: not running (PID ${recorded.pid} has exited or belongs to another process)`)
    return
  }
  const groupAlive = (): boolean => lines('pgrep', ['-g', String(recorded.pid)]).length > 0
  signalGroup(recorded.pid, 'SIGTERM')
  for (let waited = 0; waited < 10_000 && groupAlive(); waited += 200) {
    await wait(200)
  }
  if (groupAlive()) {
    signalGroup(recorded.pid, 'SIGKILL')
  }
  console.log(`${recorded.name}: stopped PID ${recorded.pid}`)
}

/** True when the run's own Sentinel is alive and holds its port, so its URL reaches this run and no other. */
export function ownsSentinel(state: RunState): boolean {
  return isOurProcess(state.sentinel) && portOwnedBy(state.sentinel.port, state.sentinel.pid)
}

/** True when Sentinel at `url` serves the built web app, not just its API. */
export async function servesWebApp(url: string): Promise<boolean> {
  return (await (await fetch(url)).text()).includes('<div id="root"')
}

export function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
