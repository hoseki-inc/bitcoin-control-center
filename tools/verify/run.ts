import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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
  fakesFile: string
  seedFile: string
  requestLog: string
  /** Written by the fault command. */
  faultsFile: string
  /** Written by the fakes once they act on faultsFile. */
  appliedFaultsFile: string
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
    faultsFile: join(runDir, 'faults.json'),
    appliedFaultsFile: join(runDir, 'faults-applied.json'),
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

export function resolveDataDir(paths: RunPaths, state: RunState | null = null): string {
  return state?.dataDir ?? paths.dataDir
}

export function resolveSeedFile(paths: RunPaths, state: RunState | null = null): string {
  return join(resolveDataDir(paths, state), 'verify-seed.json')
}

export function readRunState(paths: RunPaths): JsonFile<RunState> {
  return readJsonFile(RunStateSchema, paths.stateFile)
}

export function readSeedMarker(paths: RunPaths, state: RunState | null = null): JsonFile<SeedMarker> {
  return readJsonFile(SeedMarkerSchema, resolveSeedFile(paths, state))
}

/** The faults the fakes are acting on now. No file means none. */
export function readAppliedFaults(paths: RunPaths): JsonFile<Faults> {
  const result = readJsonFile(FaultsSchema, paths.appliedFaultsFile)
  return result.status === 'missing' ? { status: 'ok', value: NO_FAULTS } : result
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

type JsonRecord = RunState | SeedMarker | RecordedProcess[] | Faults | z.infer<typeof FakesRecordSchema>

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
