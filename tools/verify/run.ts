import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { type ProcessIdentity, withLock } from './lock'
import {
  ChildEnv,
  type CommandResult,
  type DockerSelection,
  type DockerTarget,
  callerDockerSelection,
  dockerChildEnv,
  dockerChildEnvFor,
  runCommand,
  runCommandResult,
  verifyCacheDirOverride,
} from './process'

export const REPO_ROOT = resolve(import.meta.dirname, '../..')
const CHECKOUT_KEY = createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8)
/** Scratch state for this checkout's runs. Other worktrees get their own folder, so they never see these runs. */
const RUNS_ROOT = join(tmpdir(), 'bcc-verify', CHECKOUT_KEY)
/**
 * Each run's tracking lock. It sits beside RUNS_ROOT, never inside it, so no run listing shows it and cleanup removing
 * a run folder never removes the lock it holds while doing so.
 */
const LOCKS_ROOT = join(tmpdir(), 'bcc-verify-locks', CHECKOUT_KEY)
/** Evidence survives cleanup here, one folder per run. Git ignores it. */
export const EVIDENCE_ROOT = join(REPO_ROOT, 'verify-output')
export const HELPER = '.agents/skills/verify-control-center/helpers/verify'

export const EMULATOR_DEVICES = ['ledger', 'trezor', 'coldcard'] as const
export type EmulatorDevice = (typeof EMULATOR_DEVICES)[number]

export const EMULATOR_SEED_NAMES = ['primary', 'secondary', 'empty'] as const
export type EmulatorSeedName = (typeof EMULATOR_SEED_NAMES)[number]

export const LEDGER_MODELS = ['flex', 'nanosp'] as const
export type LedgerModel = (typeof LEDGER_MODELS)[number]
export const DEFAULT_LEDGER_MODEL: LedgerModel = 'flex'

const CONTAINER_ID_RE = /^[0-9a-f]{64}$/
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const ContainerIdSchema = z
  .string()
  .regex(CONTAINER_ID_RE, 'containerId must be a full 64-character lowercase hex Docker container ID')

/** True only for a full 64-character lowercase hex Docker container ID as returned by `docker run -d`. */
export function isValidContainerId(containerId: string): boolean {
  return CONTAINER_ID_RE.test(containerId)
}

/**
 * True when `rawUrl` uses one of `allowedProtocols`, has no embedded credentials, targets loopback
 * (`127.0.0.1`, `localhost`, or `[::1]`), and matches `expectedPort`.
 */
export function isLoopbackUrlForPort(
  rawUrl: string,
  expectedPort: number,
  allowedProtocols: readonly string[],
): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  if (!allowedProtocols.includes(parsed.protocol)) {
    return false
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return false
  }
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    return false
  }
  const effectivePort =
    parsed.port !== '' ? Number(parsed.port) : parsed.protocol === 'http:' || parsed.protocol === 'ws:' ? 80 : 0
  return Number.isInteger(effectivePort) && effectivePort === expectedPort
}

const ProcessSchema = z.object({ name: z.string(), pid: z.number().int().positive(), startedAt: z.string() })
export type RecordedProcess = z.infer<typeof ProcessSchema>
const ProcessListSchema = z.array(ProcessSchema)

/**
 * The Docker daemon a container was started on: its engine ID (`docker info --format {{.ID}}`) and how it was reached.
 * Holds no credentials: `endpoint` is a local socket or loopback address and `dockerConfig` a folder path.
 */
export const DockerDaemonSchema = z.object({
  daemonId: z.string().min(1),
  context: z.string().min(1).optional(),
  endpoint: z
    .string()
    .min(1)
    .refine((endpoint) => dockerEndpointProblem(endpoint) === null, {
      message:
        'endpoint must be a local Docker socket, named pipe or loopback TCP address, with no user, query or fragment',
    })
    .optional(),
  dockerConfig: z.string().min(1).optional(),
})
export type DockerDaemon = z.infer<typeof DockerDaemonSchema>

export const ContainerSchema = z.object({
  name: z.string(),
  containerId: ContainerIdSchema,
  image: z.string(),
  startedAt: z.string(),
  /** Optional only so older records still parse. Without it, cleanup can't tell an absent container from one elsewhere. */
  daemon: DockerDaemonSchema.optional(),
})
export type RecordedContainer = z.infer<typeof ContainerSchema>
const ContainerListSchema = z.array(ContainerSchema)
const PinnedContainerSchema = ContainerSchema.extend({ daemon: DockerDaemonSchema })
/** A container record naming its daemon, as `recordContainer` requires. */
export type PinnedContainer = z.infer<typeof PinnedContainerSchema>

export const EmulatorStateSchema = z
  .object({
    device: z.enum(EMULATOR_DEVICES),
    model: z.string().optional(),
    seed: z.enum(EMULATOR_SEED_NAMES).default('primary'),
    containerId: ContainerIdSchema,
    /** The daemon running `containerId`; containers.json holds the same record. */
    daemon: DockerDaemonSchema.optional(),
    apiPort: z.number().int().positive(),
    healthUrl: z.string().url(),
    bridge: ProcessSchema.extend({
      port: z.number().int().positive(),
      url: z.string().url(),
    }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.device === 'ledger' && !LEDGER_MODELS.some((model) => model === value.model)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: `A Ledger emulator's model must be one of ${LEDGER_MODELS.join(', ')}`,
      })
    }
    if (!isLoopbackUrlForPort(value.healthUrl, value.apiPort, ['http:'])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['healthUrl'],
        message: `healthUrl must target http loopback on apiPort ${value.apiPort}`,
      })
    }
    if (value.bridge !== undefined && !isLoopbackUrlForPort(value.bridge.url, value.bridge.port, ['http:', 'ws:'])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bridge', 'url'],
        message: `bridge.url must target http/ws loopback on bridge.port ${value.bridge.port}`,
      })
    }
  })
export type EmulatorState = z.infer<typeof EmulatorStateSchema>

/**
 * Which packaged app an --electron run launched: built from this checkout at launch, or a prebuilt one passed with
 * --app. `release`, `commit` and `dirty` are what `desktop/build.sh` stamped into the bundle; null when it has none.
 */
export const BundleProvenanceSchema = z.object({
  origin: z.enum(['built', 'app']),
  source: z.string(),
  release: z.string().nullable(),
  commit: z.string().nullable(),
  dirty: z.boolean().nullable(),
})
export type BundleProvenance = z.infer<typeof BundleProvenanceSchema>

const RunStateSchema = z.object({
  runId: z.string(),
  launchedAt: z.string(),
  fresh: z.boolean(),
  /** Launched with --desktop: Sentinel and the web app run as the desktop app does. */
  desktop: z.boolean().default(false),
  /** Launched with --electron: the packaged macOS Electron app runs against local fakes. */
  electron: z.boolean().default(false),
  /** Launched with --setup-pin-in-ui: desktop PIN is left unset so the UI drives setup. */
  setupPinInUi: z.boolean().default(false),
  /** Launched with --pin: PINs on as on Umbrel, with the run's test PIN set. */
  pin: z.boolean().default(false),
  build: z.object({ commit: z.string(), tree: z.string(), dirty: z.boolean() }),
  url: z.string(),
  cdpPort: z.number().int().positive().optional(),
  userDataDir: z.string().optional(),
  dataDir: z.string().optional(),
  downloadsDir: z.string().optional(),
  appBundle: z.string().optional(),
  bundle: BundleProvenanceSchema.optional(),
  releaseTag: z.string().optional(),
  emulators: z.array(EmulatorStateSchema).optional(),
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

export const FAULT_MODES = ['ok', 'down', 'slow', 'error'] as const
export type FaultMode = (typeof FAULT_MODES)[number]
export const FAULT_TARGETS = ['electrum', 'mempool'] as const
export type FaultTarget = (typeof FAULT_TARGETS)[number]

/** What `helpers/verify fault` asked the fakes to do. `seq` counts changes, so the fakes can say which one they applied. */
export const FaultsSchema = z.object({
  seq: z.number().int().nonnegative(),
  electrum: z.enum(FAULT_MODES),
  mempool: z.enum(FAULT_MODES),
})
export type Faults = z.infer<typeof FaultsSchema>
export const NO_FAULTS: Faults = { seq: 0, electrum: 'ok', mempool: 'ok' }

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
  containersFile: string
  fakesFile: string
  seedFile: string
  requestLog: string
  /** Written by the fault command. */
  faultsFile: string
  /** Written by the fakes once they act on faultsFile. */
  appliedFaultsFile: string
  /** Held while run.json, processes.json or containers.json is updated; outside runDir, so cleanup never removes it. */
  lockDir: string
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
    containersFile: join(runDir, 'containers.json'),
    fakesFile: join(runDir, 'fakes.json'),
    seedFile: join(dataDir, 'verify-seed.json'),
    requestLog: join(runDir, 'logs', 'fake-requests.log'),
    faultsFile: join(runDir, 'faults.json'),
    appliedFaultsFile: join(runDir, 'faults-applied.json'),
    lockDir: join(LOCKS_ROOT, `${runId}.lock`),
  }
}

/**
 * Shared cache directory for compiled Ledger app-bitcoin ELFs (`<cache-root>/ledger-elfs`).
 * Defaults to `~/.cache/bitcoin-control-center/ledger-elfs`. `BCC_VERIFY_CACHE_DIR` overrides the cache root
 * (keeping `ledger-elfs` as a leaf underneath) and must be an absolute path, because `helpers/verify` runs from
 * the repository root regardless of the caller's cwd. No compiled binaries are committed to git.
 */
export function ledgerElfCacheDir(override = verifyCacheDirOverride()): string {
  const trimmed = override?.trim()
  if (trimmed === undefined || trimmed === '') {
    return join(homedir(), '.cache', 'bitcoin-control-center', 'ledger-elfs')
  }
  if (!isAbsolute(trimmed)) {
    throw new Error(`BCC_VERIFY_CACHE_DIR must be an absolute path (got: ${trimmed})`)
  }
  return join(resolve(trimmed), 'ledger-elfs')
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

/** A file that is unreadable or the wrong shape (`parse`), or a run.json naming another run (`mismatch`). */
export type InvalidJsonFile =
  | { status: 'invalid'; file: string; reason: 'parse' }
  | { status: 'invalid'; file: string; reason: 'mismatch'; detail: string }

export type JsonFile<T> = { status: 'missing' } | InvalidJsonFile | { status: 'ok'; value: T }

/** What is wrong with an invalid file, for error messages. */
export function invalidMessage(result: InvalidJsonFile): string {
  return result.reason === 'mismatch' ? `${result.file}: ${result.detail}` : `${result.file} does not parse`
}

/** A JSON file checked against its schema. A file that is missing, unreadable or the wrong shape is reported, not thrown. */
export function readJsonFile<S extends z.ZodType>(schema: S, file: string): JsonFile<z.infer<S>> {
  if (!existsSync(file)) {
    return { status: 'missing' }
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { status: 'invalid', file, reason: 'parse' }
  }
  const parsed = parseUnknown(schema, raw)
  return parsed.isOk() ? { status: 'ok', value: parsed.unwrap() } : { status: 'invalid', file, reason: 'parse' }
}

/** The value, or null when missing; an invalid file stops the script. */
export function requireJsonFile<T>(result: JsonFile<T>): T | null {
  if (result.status === 'invalid') {
    fail(`${invalidMessage(result)}. Clean up this run and launch a new one.`)
  }
  return result.status === 'ok' ? result.value : null
}

export function resolveDataDir(paths: RunPaths, state: RunState | null = null): string {
  return state?.dataDir ?? paths.dataDir
}

export function resolveSeedFile(paths: RunPaths, state: RunState | null = null): string {
  return join(resolveDataDir(paths, state), 'verify-seed.json')
}

export function readRunState(paths: RunPaths): JsonFile<RunState> {
  const result = readJsonFile(RunStateSchema, paths.stateFile)
  if (result.status === 'ok' && result.value.runId !== paths.runId) {
    return {
      status: 'invalid',
      file: paths.stateFile,
      reason: 'mismatch',
      detail: `run ID ${JSON.stringify(result.value.runId)} does not match directory ${JSON.stringify(paths.runId)}`,
    }
  }
  return result
}

export function readSeedMarker(paths: RunPaths, state: RunState | null = null): JsonFile<SeedMarker> {
  return readJsonFile(SeedMarkerSchema, resolveSeedFile(paths, state))
}

/** The faults the fakes are acting on now. No file means none. */
export function readAppliedFaults(paths: RunPaths): JsonFile<Faults> {
  const result = readJsonFile(FaultsSchema, paths.appliedFaultsFile)
  return result.status === 'missing' ? { status: 'ok', value: NO_FAULTS } : result
}

export function readProcessesFile(paths: RunPaths): JsonFile<RecordedProcess[]> {
  return readJsonFile(ProcessListSchema, paths.processesFile)
}

/** Reads `processes.json`. Returns `[]` only when missing; throws if the file exists but cannot be parsed. */
export function readProcesses(paths: RunPaths): RecordedProcess[] {
  const result = readProcessesFile(paths)
  if (result.status === 'invalid') {
    throw new Error(`${invalidMessage(result)}.`)
  }
  return result.status === 'ok' ? result.value : []
}

export function readContainersFile(paths: RunPaths): JsonFile<RecordedContainer[]> {
  return readJsonFile(ContainerListSchema, paths.containersFile)
}

/** Reads `containers.json`. Returns `[]` only when missing; throws if the file exists but cannot be parsed. */
export function readContainers(paths: RunPaths): RecordedContainer[] {
  const result = readContainersFile(paths)
  if (result.status === 'invalid') {
    throw new Error(`${invalidMessage(result)}.`)
  }
  return result.status === 'ok' ? result.value : []
}

/**
 * Read-modify-write access to a run's tracking files, handed out only inside `withRunLock`. Every write refuses once
 * the lock is released or cleanup has removed the run folder, so a late writer can never recreate a removed run.
 */
export interface RunTracking {
  recordProcess: (recorded: RecordedProcess) => void
  /** Refuses an ID that is not 64 lowercase hex characters, a record without its daemon, and a corrupt file. */
  recordContainer: (recorded: PinnedContainer) => void
  /** Drops these IDs from containers.json. Does nothing when it is missing; refuses a corrupt one. */
  forgetContainers: (containerIds: ReadonlySet<string>) => void
  writeRunState: (state: RunState) => void
  /** Writes the seed marker, which lives in the run's data folder. */
  writeSeedMarker: (file: string, marker: SeedMarker) => void
  /** Writes the faults the fakes should apply. */
  writeFaults: (faults: Faults) => void
}

interface TrackingHandle {
  tracking: RunTracking
  /** Ends the handle's writes when the lock is released. */
  close: () => void
}

function trackingFor(paths: RunPaths): TrackingHandle {
  let open = true
  const write = (file: string, value: JsonRecord): void => {
    if (!open) {
      throw new Error(`Refusing to write ${file} without holding ${paths.lockDir}`)
    }
    if (!existsSync(paths.runDir)) {
      throw new Error(
        `Run ${paths.runId} was cleaned up (${paths.runDir} is gone); refusing to write ${basename(file)}`,
      )
    }
    writeJson(file, value)
  }
  const tracking: RunTracking = {
    recordProcess: (recorded) => {
      write(paths.processesFile, [...readProcesses(paths), recorded])
    },
    recordContainer: (recorded) => {
      const parsed = parseUnknown(PinnedContainerSchema, recorded)
      if (parsed.isErr()) {
        throw new Error(
          `Invalid container record for ${recorded.name}: it needs a 64-character lowercase hex Docker ID and its daemon`,
        )
      }
      write(paths.containersFile, [...readContainers(paths), parsed.unwrap()])
    },
    forgetContainers: (containerIds) => {
      for (const containerId of containerIds) {
        if (!isValidContainerId(containerId)) {
          throw new Error(`Invalid container ID: ${containerId}`)
        }
      }
      const existing = readContainersFile(paths)
      if (existing.status === 'invalid') {
        throw new Error(`${invalidMessage(existing)}.`)
      }
      if (existing.status === 'ok') {
        write(
          paths.containersFile,
          existing.value.filter((entry) => !containerIds.has(entry.containerId)),
        )
      }
    },
    writeRunState: (state) => {
      write(paths.stateFile, state)
    },
    writeSeedMarker: (file, marker) => {
      write(file, marker)
    },
    writeFaults: (faults) => {
      write(paths.faultsFile, faults)
    },
  }
  return {
    tracking,
    close: () => {
      open = false
    },
  }
}

/**
 * Runs `fn` holding the run's tracking lock, which every process updating run.json, processes.json or containers.json
 * takes, so concurrent helpers never lose each other's writes. Waits for another holder; not re-entrant.
 */
export async function withRunLock<T>(paths: RunPaths, fn: (tracking: RunTracking) => T | Promise<T>): Promise<T> {
  return withLock(paths.lockDir, { identify: processIdentity }, async () => {
    const { tracking, close } = trackingFor(paths)
    try {
      return await fn(tracking)
    } finally {
      close()
    }
  })
}

/** Launch calls this as each process starts, so cleanup can stop them even if launch dies before it finishes. */
export async function recordProcess(paths: RunPaths, recorded: RecordedProcess): Promise<void> {
  await withRunLock(paths, (tracking) => {
    tracking.recordProcess(recorded)
  })
}

/** Records a started Docker container and its daemon at once, so cleanup can remove it even if its starter dies. */
export async function recordContainer(paths: RunPaths, recorded: PinnedContainer): Promise<void> {
  await withRunLock(paths, (tracking) => {
    tracking.recordContainer(recorded)
  })
}

/** Removes a confirmed-removed container ID from `containers.json`. */
export async function forgetContainer(paths: RunPaths, containerId: string): Promise<void> {
  await withRunLock(paths, (tracking) => {
    tracking.forgetContainers(new Set([containerId]))
  })
}

/** Writes run.json under the run's lock, refusing once cleanup has removed the run. */
export async function writeRunState(paths: RunPaths, state: RunState): Promise<void> {
  await withRunLock(paths, (tracking) => {
    tracking.writeRunState(state)
  })
}

const PortSchema = z.object({ port: z.number().int().positive() })

/** The port a server bound, from `server.address()`. */
export function boundPort(address: string | { port: number } | null): number {
  const parsed = parseUnknown(PortSchema, address)
  return parsed.isOk() ? parsed.unwrap().port : fail('The server is not listening on a TCP port')
}

type JsonRecord =
  | RunState
  | SeedMarker
  | RecordedProcess[]
  | RecordedContainer[]
  | Faults
  | z.infer<typeof FakesRecordSchema>

/** Writes through a sibling temp file and a rename, so readers see the old file or the new one, never half of one. */
export function writeJson(file: string, value: JsonRecord): void {
  mkdirSync(dirname(file), { recursive: true })
  const tempFile = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`)
    renameSync(tempFile, file)
  } catch (error) {
    try {
      rmSync(tempFile, { force: true })
    } catch {
      // Report the write's own error, not this one.
    }
    throw error
  }
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

const NoSuchProcessSchema = z.object({ code: z.literal('ESRCH') })
const NotPermittedSchema = z.object({ code: z.literal('EPERM') })

/**
 * What a PID is now, for deciding whether a lock's holder is gone. Only the kernel saying no such process gives
 * `exited`; a failed or empty `ps` for a PID that exists gives `unknown`, which never counts as gone.
 */
export function processIdentity(pid: number): ProcessIdentity {
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (parseUnknown(NoSuchProcessSchema, error).isOk()) {
      return { state: 'exited' }
    }
    if (parseUnknown(NotPermittedSchema, error).isErr()) {
      return { state: 'unknown', detail: error instanceof Error ? error.message : String(error) }
    }
  }
  const result = runCommandResult('ps', ['-o', 'lstart=', '-p', String(pid)], {
    env: ChildEnv.with({ TZ: 'UTC', LC_ALL: 'C' }),
  })
  const started = result.stdout.trim()
  if (result.error === null && result.status === 0 && started !== '') {
    return { state: 'running', startedAt: started }
  }
  return { state: 'unknown', detail: `ps -p ${pid} gave no start time: ${dockerFailureDetail(result)}` }
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

/** Canonicalizes a path by resolving symlinks on its deepest existing ancestor. */
export function canonicalizePath(targetPath: string): string {
  let probe = resolve(targetPath)
  const suffix: string[] = []
  for (;;) {
    try {
      const real = realpathSync.native(probe)
      return suffix.length > 0 ? join(real, ...suffix.reverse()) : real
    } catch {
      const parent = dirname(probe)
      if (parent === probe) {
        return suffix.length > 0 ? join(probe, ...suffix.reverse()) : probe
      }
      suffix.push(basename(probe))
      probe = parent
    }
  }
}

function normalizeForCompare(value: string, platform: NodeJS.Platform): string {
  return platform === 'darwin' || platform === 'win32' ? value.toLowerCase() : value
}

/** True when `childPath` is equal to or strictly inside `parentPath` after symlink canonicalization. */
export function isPathInside(
  childPath: string,
  parentPath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const rel = relative(
    normalizeForCompare(canonicalizePath(parentPath), platform),
    normalizeForCompare(canonicalizePath(childPath), platform),
  )
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

const AsarDirSchema = z.object({ files: z.record(z.string(), z.unknown()) })
const AsarFileSchema = z.object({ offset: z.string(), size: z.number().int().nonnegative() })
const ASAR_LIMIT = 32 * 1024 * 1024

/** One packed file from an asar archive, by its path inside it; null when it is missing, unpacked or unreadable. */
export function readAsarFile(asarPath: string, path: readonly string[]): Buffer | null {
  let fd: number | null = null
  try {
    fd = openSync(asarPath, 'r')
    const pre = Buffer.alloc(16)
    if (readSync(fd, pre, 0, 16, 0) !== 16) {
      return null
    }
    const headerSize = pre.readUInt32LE(4)
    const jsonLen = pre.readUInt32LE(12)
    if (jsonLen === 0 || jsonLen > ASAR_LIMIT || headerSize < jsonLen) {
      return null
    }
    const headerBuf = Buffer.alloc(jsonLen)
    if (readSync(fd, headerBuf, 0, jsonLen, 16) !== jsonLen) {
      return null
    }
    let node: unknown = JSON.parse(headerBuf.toString('utf8'))
    for (const name of path) {
      const dir = parseUnknown(AsarDirSchema, node)
      if (dir.isErr()) {
        return null
      }
      node = dir.unwrap().files[name]
    }
    const parsed = parseUnknown(AsarFileSchema, node)
    if (parsed.isErr()) {
      return null
    }
    const entry = parsed.unwrap()
    const offset = Number(entry.offset)
    if (!Number.isSafeInteger(offset) || offset < 0 || entry.size > ASAR_LIMIT) {
      return null
    }
    const contents = Buffer.alloc(entry.size)
    return readSync(fd, contents, 0, entry.size, 8 + headerSize + offset) === entry.size ? contents : null
  } catch {
    return null
  } finally {
    if (fd !== null) {
      closeSync(fd)
    }
  }
}

const asarOf = (appBundle: string): string => join(appBundle, 'Contents/Resources/app.asar')

const BundlePackageSchema = z.object({
  bccReleaseVersion: z.string().nullable().catch(null),
  bccSourceCommit: z.string().nullable().catch(null),
  bccSourceDirty: z.boolean().nullable().catch(null),
})

/** What `desktop/build.sh` stamped into a bundle's `package.json`, or null when that file can't be read. */
export function readBundleProvenance(appBundle: string): Omit<BundleProvenance, 'origin' | 'source'> | null {
  const raw = readAsarFile(asarOf(appBundle), ['package.json'])
  if (raw === null) {
    return null
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw.toString('utf8'))
  } catch {
    return null
  }
  const parsed = parseUnknown(BundlePackageSchema, decoded)
  if (parsed.isErr()) {
    return null
  }
  const { bccReleaseVersion, bccSourceCommit, bccSourceDirty } = parsed.unwrap()
  return { release: bccReleaseVersion, commit: bccSourceCommit, dirty: bccSourceDirty }
}

/** Why a packaged macOS .app bundle cannot be safely launched in verify mode, or null when verify-capable. */
export function verifyCapableBundleProblem(appBundle: string): string | null {
  if (!existsSync(join(appBundle, 'Contents/MacOS/Bitcoin Control Center'))) {
    return `does not look like a macOS Bitcoin Control Center.app bundle: ${appBundle}`
  }
  const asarPath = asarOf(appBundle)
  if (!existsSync(asarPath)) {
    return `is missing Contents/Resources/app.asar (not verify-capable): ${appBundle}`
  }
  const mainIndex = readAsarFile(asarPath, ['app', 'main', 'index.js'])?.toString('utf8') ?? null
  if (mainIndex === null) {
    return `could not read app/main/index.js from Contents/Resources/app.asar (not verify-capable): ${appBundle}`
  }
  if (!mainIndex.includes('BCC_VERIFY_CONFIG')) {
    return `does not contain the BCC_VERIFY_CONFIG marker in Contents/Resources/app.asar (older or non-verify-capable bundle): ${appBundle}`
  }
  return null
}

/** PIDs currently belonging to the process group led by `leader`. */
export function processGroupPids(leader: number): number[] {
  return lines('pgrep', ['-g', String(leader)])
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    return
  }
}

function signalGroup(leader: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-leader, signal)
  } catch {
    // The group exited between the check and the signal.
  }
}

export interface CleanQuitResult {
  wasRunning: boolean
  exited: boolean
  survivors: number[]
}

/**
 * Asks a single recorded leader process to quit gracefully via SIGTERM (not SIGKILL, and not signaling the whole
 * group) so Electron runs its `before-quit` hook and stops Sentinel and Tor cleanly.
 */
export async function quitProcessCleanly(recorded: RecordedProcess, timeoutMs = 12_000): Promise<CleanQuitResult> {
  if (!isOurProcess(recorded)) {
    const survivors = processGroupPids(recorded.pid)
    return { wasRunning: false, exited: false, survivors }
  }
  signalProcess(recorded.pid, 'SIGTERM')
  for (let waited = 0; waited < timeoutMs; waited += 200) {
    if (!isOurProcess(recorded) && processGroupPids(recorded.pid).length === 0) {
      return { wasRunning: true, exited: true, survivors: [] }
    }
    await wait(200)
  }
  const survivors = processGroupPids(recorded.pid)
  return { wasRunning: true, exited: !isOurProcess(recorded) && survivors.length === 0, survivors }
}

/**
 * Stops a process group this run started, and nothing else. A group ID cannot be reused while any member lives, so
 * members left behind by a dead leader are still ours; a PID another process took over is left alone.
 */
export async function stopProcess(recorded: RecordedProcess): Promise<void> {
  const leaderStart = processStartTime(recorded.pid)
  const ours = leaderStart === recorded.startedAt || (leaderStart === null && processGroupPids(recorded.pid).length > 0)
  if (!ours) {
    console.log(`${recorded.name}: not running (PID ${recorded.pid} has exited or belongs to another process)`)
    return
  }
  const groupAlive = (): boolean => processGroupPids(recorded.pid).length > 0
  if (recorded.name === 'electron' && leaderStart === recorded.startedAt) {
    signalProcess(recorded.pid, 'SIGTERM')
    for (let waited = 0; waited < 8_000 && groupAlive(); waited += 200) {
      await wait(200)
    }
  }
  if (groupAlive()) {
    signalGroup(recorded.pid, 'SIGTERM')
    for (let waited = 0; waited < 10_000 && groupAlive(); waited += 200) {
      await wait(200)
    }
  }
  if (groupAlive()) {
    signalGroup(recorded.pid, 'SIGKILL')
  }
  console.log(`${recorded.name}: stopped PID ${recorded.pid}`)
}

/** Runs one Docker CLI command: against `target` when given, else with the caller's own Docker settings. */
export type DockerCommandRunner = (args: string[], target?: DockerTarget) => CommandResult

const runDocker: DockerCommandRunner = (args, target) =>
  runCommandResult('docker', args, { env: target === undefined ? dockerChildEnv() : dockerChildEnvFor(target) })

export type ContainerInspectResult =
  | { state: 'running' }
  | { state: 'stopped' }
  | { state: 'unavailable'; detail: string }

function dockerFailureDetail(result: CommandResult): string {
  const stderr = result.stderr.trim()
  if (stderr !== '') {
    return stderr
  }
  if (result.error !== null && result.error !== '') {
    return result.error
  }
  return result.status === null
    ? 'docker process terminated without an exit status'
    : `docker exited with status ${result.status}`
}

const succeeded = (result: CommandResult): boolean => result.error === null && result.status === 0

const DOCKER_CONTEXT_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/
const DAEMON_ID_RE = /^[\w.:-]+$/
const DockerContextInspectSchema = z
  .array(
    z.object({
      Endpoints: z.object({ docker: z.object({ Host: z.string().min(1), SkipTLSVerify: z.boolean().optional() }) }),
      TLSMaterial: z.record(z.string(), z.unknown()).nullish(),
    }),
  )
  .length(1)

/**
 * Why emulators can't use this Docker endpoint, or null when they can. Their ports are published on 127.0.0.1, which
 * only a daemon on this machine can do, so only a unix socket, a named pipe or plain TCP on loopback qualifies. An
 * endpoint with a user, query or fragment is refused for every protocol, and the message never repeats those parts,
 * so they can't reach an error or a tracking file.
 */
export function dockerEndpointProblem(endpoint: string): string | null {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return 'The Docker endpoint is not a URL'
  }
  if (url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    return `The ${url.protocol}// Docker endpoint carries a user, query or fragment; use a plain local socket or loopback address`
  }
  if (url.protocol === 'unix:' || url.protocol === 'npipe:') {
    return null
  }
  if (url.protocol === 'tcp:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return null
  }
  return `Docker endpoint ${url.protocol}//${url.host} is not local; emulators need a daemon on this machine that can publish 127.0.0.1 ports`
}

type Checked<T> = { ok: true; value: T } | { ok: false; detail: string }

function readDaemonId(result: CommandResult): Checked<string> {
  if (!succeeded(result)) {
    return { ok: false, detail: dockerFailureDetail(result) }
  }
  const id = result.stdout.trim()
  return DAEMON_ID_RE.test(id)
    ? { ok: true, value: id }
    : { ok: false, detail: `unexpected docker info output: ${JSON.stringify(id)}` }
}

const INFO_ID = ['info', '--format', '{{.ID}}']

/**
 * The local Docker daemon the caller's shell selects now, resolved in the Docker CLI's order (DOCKER_HOST, then
 * DOCKER_CONTEXT, then `docker context show`), with its engine ID. Refuses remote and TLS endpoints. Runners call
 * this before creating a container and record the result with it; doctor and cleanup never do.
 */
export function captureDockerDaemon(
  docker: DockerCommandRunner = runDocker,
  selection: DockerSelection = callerDockerSelection(),
): Result<DockerDaemon, string> {
  let endpoint = selection.host
  let context: string | undefined
  if (endpoint === undefined) {
    if (selection.context !== undefined) {
      context = selection.context
    } else {
      const shown = docker(['context', 'show'])
      if (!succeeded(shown)) {
        return Err(`Could not read the current Docker context: ${dockerFailureDetail(shown)}`)
      }
      context = shown.stdout.trim()
    }
    if (!DOCKER_CONTEXT_NAME_RE.test(context)) {
      return Err(`Docker context name ${JSON.stringify(context)} is not valid`)
    }
    const inspected = docker(['context', 'inspect', '--', context])
    if (!succeeded(inspected)) {
      return Err(`Could not inspect Docker context ${context}: ${dockerFailureDetail(inspected)}`)
    }
    let raw: unknown
    try {
      raw = JSON.parse(inspected.stdout)
    } catch {
      return Err(`docker context inspect ${context} did not print JSON`)
    }
    const parsed = parseUnknown(DockerContextInspectSchema, raw)
    const entry = parsed.isOk() ? parsed.unwrap()[0] : undefined
    if (entry === undefined) {
      return Err(`docker context inspect ${context} printed an unexpected shape`)
    }
    if (Object.keys(entry.TLSMaterial ?? {}).length > 0 || entry.Endpoints.docker.SkipTLSVerify === true) {
      return Err(
        `Docker context ${context} uses TLS, so its daemon is not local; emulators need a daemon on this machine`,
      )
    }
    endpoint = entry.Endpoints.docker.Host
  }
  const problem = dockerEndpointProblem(endpoint)
  if (problem !== null) {
    return Err(problem)
  }
  const target: DockerTarget = { endpoint }
  if (context !== undefined) {
    target.context = context
  }
  if (selection.config !== undefined) {
    target.dockerConfig = selection.config
  }
  const id = readDaemonId(docker(INFO_ID, target))
  if (!id.ok) {
    return Err(`Could not read the Docker daemon's ID at ${endpoint}: ${id.detail}`)
  }
  return Ok({ daemonId: id.value, ...target })
}

function describeDaemon(daemon: DockerDaemon): string {
  const where = [daemon.context !== undefined ? `context ${daemon.context}` : '', daemon.endpoint ?? ''].filter(Boolean)
  return where.length > 0 ? where.join(' at ') : "the caller's Docker settings"
}

/** Null when the recorded daemon is the one answering at its endpoint now; otherwise why that can't be confirmed. */
export function dockerDaemonProblem(daemon: DockerDaemon, docker: DockerCommandRunner = runDocker): string | null {
  const id = readDaemonId(docker(INFO_ID, daemon))
  if (!id.ok) {
    return `cannot confirm Docker daemon ${daemon.daemonId} (${describeDaemon(daemon)}): ${id.detail}`
  }
  return id.value === daemon.daemonId
    ? null
    : `${describeDaemon(daemon)} now reaches Docker daemon ${id.value}, not ${daemon.daemonId}, which runs the container`
}

/**
 * Asks the recorded endpoint for its daemon again after Docker reported a container absent, since the identity check
 * and the command were separate connections. Null when the owner still answers; otherwise why absence proves nothing.
 */
function daemonChangedDuring(daemon: DockerDaemon, docker: DockerCommandRunner): string | null {
  const problem = dockerDaemonProblem(daemon, docker)
  return problem === null ? null : `Docker reported it absent, but then ${problem}`
}

/**
 * True only when stderr is Docker's absence diagnostic for exactly this ID and nothing else, so a second error or
 * another container's diagnostic never reads as "already gone".
 */
export function reportsOnlyAbsence(stderr: string, containerId: string): boolean {
  const match = /^(?:Error response from daemon: |Error: )?No such (?:container|object): ([0-9a-f]{64})$/.exec(
    stderr.trim(),
  )
  return match?.[1] === containerId
}

/**
 * Inspects one recorded container by its full ID on the daemon its record names, after confirming that daemon is the
 * one answering. Absence counts as stopped only on a confirmed daemon; a record without a daemon can't confirm it.
 */
export function inspectContainer(
  containerId: string,
  daemon: DockerDaemon | undefined,
  docker: DockerCommandRunner = runDocker,
): ContainerInspectResult {
  if (!isValidContainerId(containerId)) {
    return { state: 'unavailable', detail: `invalid container ID: ${containerId}` }
  }
  const problem = daemon === undefined ? null : dockerDaemonProblem(daemon, docker)
  if (problem !== null) {
    return { state: 'unavailable', detail: problem }
  }
  const result = docker(['inspect', '--type', 'container', '-f', '{{.State.Running}}', '--', containerId], daemon)
  if (succeeded(result)) {
    const out = result.stdout.trim()
    if (out === 'true') {
      return { state: 'running' }
    }
    if (out === 'false') {
      return { state: 'stopped' }
    }
    return { state: 'unavailable', detail: `unexpected docker inspect output: ${JSON.stringify(out)}` }
  }
  if (result.error === null && reportsOnlyAbsence(result.stderr, containerId)) {
    if (daemon === undefined) {
      return {
        state: 'unavailable',
        detail: `no daemon recorded for ${containerId}; it may be running on another daemon`,
      }
    }
    const changed = daemonChangedDuring(daemon, docker)
    return changed === null ? { state: 'stopped' } : { state: 'unavailable', detail: changed }
  }
  return { state: 'unavailable', detail: dockerFailureDetail(result) }
}

export interface ContainerRemoveResult {
  containerId: string
  removed: boolean
  detail: string
}

/**
 * Force-removes one recorded container (`docker rm -f -- <containerId>`) on the daemon its record names, after
 * confirming that daemon is the one answering. Counts as removed only when Docker echoes the ID, or reports exactly
 * this ID absent on the confirmed daemon. Anything else, including a different daemon now behind the same socket,
 * returns `removed: false`, so callers keep the record and exit nonzero.
 */
export function removeContainer(
  containerId: string,
  daemon: DockerDaemon | undefined,
  docker: DockerCommandRunner = runDocker,
): ContainerRemoveResult {
  if (!isValidContainerId(containerId)) {
    return { containerId, removed: false, detail: `refusing invalid container ID: ${containerId}` }
  }
  const problem = daemon === undefined ? null : dockerDaemonProblem(daemon, docker)
  if (problem !== null) {
    return { containerId, removed: false, detail: `kept container ${containerId}: ${problem}` }
  }
  const result = docker(['rm', '-f', '--', containerId], daemon)
  const stdout = result.stdout.trim()
  if (succeeded(result) && stdout === containerId) {
    return { containerId, removed: true, detail: `removed container ${containerId}` }
  }
  // `rm -f` exits 0 for a missing ID, silently on current CLIs and with the diagnostic on older ones.
  const absent =
    result.error === null &&
    stdout === '' &&
    (result.stderr.trim() === '' ? result.status === 0 : reportsOnlyAbsence(result.stderr, containerId))
  if (absent && daemon !== undefined) {
    const changed = daemonChangedDuring(daemon, docker)
    return changed === null
      ? { containerId, removed: true, detail: `container ${containerId} already absent from ${daemon.daemonId}` }
      : { containerId, removed: false, detail: `kept container ${containerId}: ${changed}` }
  }
  if (absent) {
    return {
      containerId,
      removed: false,
      detail: `kept container ${containerId}: the current Docker daemon has no such container, but its record names no daemon, so it may still run on another one`,
    }
  }
  return {
    containerId,
    removed: false,
    detail: `could not remove container ${containerId}: ${succeeded(result) ? `unexpected docker rm output: ${JSON.stringify(stdout)}` : dockerFailureDetail(result)}`,
  }
}

export interface TrackedContainer {
  name: string
  containerId: string
  daemon: DockerDaemon | undefined
}

/**
 * Every recorded container once, keyed by ID: containers.json first, then run.json emulators missing from it. A
 * record's daemon comes from containers.json, or from the emulator registration when containers.json lacks one.
 */
export function trackContainers(
  recorded: readonly RecordedContainer[],
  emulators: readonly EmulatorState[],
): Map<string, TrackedContainer> {
  const tracked = new Map<string, TrackedContainer>()
  for (const entry of recorded) {
    if (!tracked.has(entry.containerId)) {
      tracked.set(entry.containerId, { name: entry.name, containerId: entry.containerId, daemon: entry.daemon })
    }
  }
  for (const emulator of emulators) {
    const existing = tracked.get(emulator.containerId)
    if (existing === undefined) {
      tracked.set(emulator.containerId, {
        name: `emulator:${emulator.device}`,
        containerId: emulator.containerId,
        daemon: emulator.daemon,
      })
    } else {
      existing.daemon ??= emulator.daemon
    }
  }
  return tracked
}

export interface CleanupDeps {
  stopProcess?: (recorded: RecordedProcess) => Promise<void>
  removeContainer?: (containerId: string, daemon: DockerDaemon | undefined) => ContainerRemoveResult
  evidenceRoot?: string
  log?: (line: string) => void
}

export interface CleanupSummary {
  ok: boolean
  errors: string[]
  stoppedProcesses: RecordedProcess[]
  removedContainers: ContainerRemoveResult[]
  keptLogsDir: string | null
  removedRunDir: boolean
}

/**
 * Holding the run's lock, stops every process group recorded for this run (including emulator bridges), removes
 * every recorded container on its own daemon, keeps logs under `verify-output/<run-id>/logs/`, and deletes the run's
 * scratch folder. An invalid run.json doesn't block that: containers.json and processes.json, written first, are the
 * journal. The folder stays, and the summary fails, while a container isn't confirmed removed or a journal is invalid.
 */
export async function cleanupRunResources(paths: RunPaths, deps: CleanupDeps = {}): Promise<CleanupSummary> {
  return withRunLock(paths, async (tracking) => cleanupLocked(paths, tracking, deps))
}

async function cleanupLocked(paths: RunPaths, tracking: RunTracking, deps: CleanupDeps): Promise<CleanupSummary> {
  const stop = deps.stopProcess ?? stopProcess
  const remove = deps.removeContainer ?? removeContainer
  const evidenceRoot = deps.evidenceRoot ?? EVIDENCE_ROOT
  const log = deps.log ?? console.log

  const stateResult = readRunState(paths)
  const containersFile = readContainersFile(paths)
  const processesFile = readProcessesFile(paths)
  const errors: string[] = []
  if (stateResult.status === 'invalid') {
    log(`${invalidMessage(stateResult)}; cleaning up from containers.json and processes.json`)
  }
  for (const journal of [containersFile, processesFile]) {
    if (journal.status === 'invalid') {
      errors.push(`${invalidMessage(journal)}; keeping ${paths.runDir}`)
    }
  }
  const state = stateResult.status === 'ok' ? stateResult.value : null
  const emulators = state?.emulators ?? []

  const processes: RecordedProcess[] = []
  const seenProcesses = new Set<string>()
  const addProcess = ({ name, pid, startedAt }: RecordedProcess): void => {
    const key = `${pid}:${startedAt}`
    if (!seenProcesses.has(key)) {
      seenProcesses.add(key)
      processes.push({ name, pid, startedAt })
    }
  }
  for (const recorded of processesFile.status === 'ok' ? processesFile.value : []) {
    addProcess(recorded)
  }
  // Also in processes.json, unless it is corrupt: then these are the processes cleanup can still find.
  if (state !== null) {
    addProcess(state.fakes)
    addProcess(state.sentinel)
  }
  for (const emulator of emulators) {
    if (emulator.bridge !== undefined) {
      addProcess(emulator.bridge)
    }
  }
  for (const recorded of processes) {
    await stop(recorded)
  }

  const tracked = trackContainers(containersFile.status === 'ok' ? containersFile.value : [], emulators)
  const removedContainers: ContainerRemoveResult[] = []
  const confirmedRemovedIds = new Set<string>()
  for (const { name, containerId, daemon } of tracked.values()) {
    const result = remove(containerId, daemon)
    removedContainers.push(result)
    log(`${name}: ${result.detail}`)
    if (result.removed) {
      confirmedRemovedIds.add(containerId)
    } else {
      errors.push(`${name}: ${result.detail}`)
    }
  }

  let keptLogsDir: string | null = null
  if (existsSync(paths.logsDir)) {
    keptLogsDir = join(evidenceRoot, paths.runId, 'logs')
    cpSync(paths.logsDir, keptLogsDir, { recursive: true })
    log(`Logs kept in ${keptLogsDir}`)
  }

  if (errors.length > 0) {
    if (confirmedRemovedIds.size > 0) {
      if (containersFile.status === 'ok') {
        tracking.forgetContainers(confirmedRemovedIds)
      }
      if (state?.emulators !== undefined) {
        tracking.writeRunState({
          ...state,
          emulators: state.emulators.filter((entry) => !confirmedRemovedIds.has(entry.containerId)),
        })
      }
    }
    log(`Kept ${paths.runDir} because cleanup had errors`)
    return { ok: false, errors, stoppedProcesses: processes, removedContainers, keptLogsDir, removedRunDir: false }
  }

  rmSync(paths.runDir, { recursive: true, force: true })
  log(`Removed ${paths.runDir}`)
  return { ok: true, errors: [], stoppedProcesses: processes, removedContainers, keptLogsDir, removedRunDir: true }
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
