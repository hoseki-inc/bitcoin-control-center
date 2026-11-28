import { closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { EMULATOR_SEEDS } from '../emulator-seeds'
import { withLock } from '../lock'
import { ChildEnv, startGroup } from '../process'
import {
  BridgeRecordSchema,
  type DockerCommandRunner,
  type DockerDaemon,
  type EmulatorSeedName,
  type EmulatorState,
  type LedgerModel,
  REPO_ROOT,
  type RecordedProcess,
  type RunPaths,
  bridgeRecordFile,
  createTrackedContainer,
  discardContainer,
  invalidMessage,
  isOurProcess,
  ownStartedAt,
  ownsReservation,
  portOwnedBy,
  processIdentity,
  processStartTime,
  readContainersFile,
  readIntentsFile,
  readJsonFile,
  readReservation,
  readRunState,
  recordProcess,
  reservationOwnerAlive,
  runDocker,
  stopOwnGroup,
  stopProcess,
  wait,
  withRunLock,
} from '../run'
import { type BridgeMode, bridgeControl } from './ledger-bridge'
import { type SpeculosApi, speculosApi, waitForIdle } from './ledger-driver'

// Runs Ledger's unmodified Speculos image as a headless Ledger on this machine's Docker daemon, loaded with the
// app-bitcoin ELF built from the pinned commit. Nothing is bind-mounted: the ELF goes in with `docker cp`, and the
// API is published on an ephemeral 127.0.0.1 port that `docker port` reports.

export const APP_BITCOIN_REPO = 'https://github.com/LedgerHQ/app-bitcoin.git'
/** app-bitcoin v2.5.1: tags `nanos+_1.6.1_2.5.1_sdk_v26.6.2` and `flex_1.6.1_2.5.1_sdk_v26.6.2`. */
export const APP_BITCOIN_COMMIT = '44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a'
export const LEDGER_APP_BUILDER_IMAGE =
  'ghcr.io/ledgerhq/ledger-app-builder/ledger-app-builder@sha256:49c9ad6ee86bbe5fa23aba34f936ecc4eeabc7e1de21edc29272ac20fbe176b4'
/** Speculos 0.27.4. */
export const SPECULOS_IMAGE =
  'ghcr.io/ledgerhq/speculos@sha256:56c7ec84c903147dac28e68706d3241218a3d9beb9562dd4a8c02947b2a24f47'

/** What an evidence record names as the Ledger's firmware and emulator. */
export const LEDGER_FIRMWARE = `app-bitcoin 2.5.1 (${APP_BITCOIN_COMMIT.slice(0, 8)}) on Speculos 0.27.4 (${SPECULOS_IMAGE.slice(-64, -52)})`

export const LEDGER_ARCHES = ['arm64', 'amd64'] as const
export type LedgerArch = (typeof LEDGER_ARCHES)[number]

const ELF_SHA256: Readonly<Record<LedgerModel, string>> = {
  nanosp: 'be32e0d37ae85381bd5bbcf046e65e459abaf0962bb009989a76d5f6704a0801',
  flex: '4d012b9da309c4ed1b0462652674311a257c1444538935342ea025c2ddbb9524',
}

/**
 * The SHA-256 of `bin/app.elf` that the pinned builder makes from the pinned commit, per builder platform. Both
 * platforms build the same bytes (measured 2026-11-25 on Docker Desktop, amd64 under emulation). A build for a model
 * or platform missing here is refused, never trusted on first use.
 */
export const PINNED_ELF_SHA256: Readonly<Record<LedgerArch, Readonly<Partial<Record<LedgerModel, string>>>>> = {
  arm64: ELF_SHA256,
  amd64: ELF_SHA256,
}

/** The builder image's SDK variable for each model. */
export const LEDGER_SDK_VARS: Readonly<Record<LedgerModel, string>> = { nanosp: 'NANOSP_SDK', flex: 'FLEX_SDK' }

const SPECULOS_PORT = '5000'
const CONTAINER_ELF = '/speculos/app-bitcoin.elf'
const BOOT_TIMEOUT_MS = 90_000

/**
 * The Speculos REST API of a recorded Ledger, on the loopback port Docker published. It has no authentication. Once a
 * bridge runs, drive the device through the bridge's control port instead, so drives never interleave.
 */
export function emulatorApiUrl(emulator: EmulatorState): string {
  return `http://127.0.0.1:${emulator.apiPort}`
}

const RESERVATION = 'emulator:ledger'
/** A manual prompt can wait on a person, so a second drive may wait that long for the first. */
const DRIVE_LOCK_TIMEOUT_MS = 15 * 60_000

/**
 * Runs one drive of a Ledger that has no bridge (one started as in 3B) holding a per-device lock, so two `press` or
 * `reject` commands never interleave their presses. With a bridge, the bridge serializes drives itself.
 */
export async function withLedgerDriveLock<T>(paths: RunPaths, fn: () => Promise<T>): Promise<T> {
  return withLock(`${paths.lockDir}.ledger-drive`, { identify: processIdentity, timeoutMs: DRIVE_LOCK_TIMEOUT_MS }, fn)
}

/**
 * Why a Ledger emulator can't start on this run now, or null. A start this process already reserved may go on; a
 * reservation whose owner died is taken over once nothing else is recorded. Read under the run's lock.
 */
function startProblem(paths: RunPaths): string | null {
  const reservation = readReservation(paths)
  if (reservation.status === 'invalid') {
    return `${invalidMessage(reservation)}; delete it once no emulator start is running`
  }
  if (reservation.status === 'ok' && ownsReservation(reservation.value)) {
    return null
  }
  if (reservation.status === 'ok' && reservationOwnerAlive(reservation.value)) {
    return `Run ${paths.runId} already has a Ledger start in progress (PID ${reservation.value.pid})`
  }
  const state = readRunState(paths)
  if (state.status !== 'ok') {
    return state.status === 'missing'
      ? `Run ${paths.runId} has no run.json; launch it first`
      : `${state.file} is not usable; clean up and relaunch`
  }
  const containers = readContainersFile(paths)
  const intents = readIntentsFile(paths)
  if (containers.status === 'invalid' || intents.status === 'invalid') {
    return `${containers.status === 'invalid' ? containers.file : paths.intentsFile} does not parse`
  }
  const recorded =
    (state.value.emulators ?? []).some((emulator) => emulator.device === 'ledger') ||
    (containers.status === 'ok' && containers.value.some((entry) => entry.name === 'emulator:ledger')) ||
    (intents.status === 'ok' && intents.value.some((entry) => entry.name === 'emulator:ledger'))
  return recorded ? `Run ${paths.runId} already has a Ledger emulator; stop it first` : null
}

/** Reserves the Ledger start for this process under the run's lock, unless something refuses it. */
export async function reserve(paths: RunPaths): Promise<string | null> {
  return withRunLock(paths, (tracking) => {
    const problem = startProblem(paths)
    if (problem !== null || holdsReservation(paths)) {
      return problem
    }
    // Without its own start time this process couldn't later tell its reservation from a PID reused by another.
    const startedAt = ownStartedAt()
    if (startedAt === null) {
      return `could not read this process's start time from ps, so the Ledger start can't be reserved`
    }
    tracking.writeReservation({ name: RESERVATION, pid: process.pid, startedAt, reservedAt: new Date().toISOString() })
    return null
  })
}

/** True while this process holds the run's start reservation. Read under the run's lock. */
function holdsReservation(paths: RunPaths): boolean {
  const held = readReservation(paths)
  return held.status === 'ok' && ownsReservation(held.value)
}

/** Gives up this process's start reservation, if it still holds it. */
export async function release(paths: RunPaths): Promise<void> {
  if (!existsSync(paths.runDir)) {
    return
  }
  await withRunLock(paths, (tracking) => {
    if (holdsReservation(paths)) {
      tracking.writeReservation(null)
    }
  }).catch(() => undefined)
}

/** The host port Docker published for the container's API, from `docker port`. */
function publishedPort(output: string): number | null {
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(output.trim())
  const port = Number(match?.[1])
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null
}

/** How the bridge runs: its mode, and the Sentinel its drive proxy serves. */
export interface BridgeRequest {
  mode: BridgeMode
  target: string
}

type BridgeState = NonNullable<EmulatorState['bridge']>

/** Starts a bridge process for a running Speculos; tests replace it. */
export type BridgeLauncher = (
  paths: RunPaths,
  request: BridgeRequest & { model: LedgerModel; speculosUrl: string },
) => Promise<Result<BridgeState, string>>

const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx')
const BRIDGE_READY_MS = 30_000

/** Starts the detached bridge, records its process at once, and waits until it writes its ports and token. */
/**
 * Starts the detached bridge, records its process at once, and waits until it writes its ports and token. Any failure
 * stops the group it started, confirmed gone, before the error returns. `readStartTime` is for tests.
 */
export async function launchBridge(
  paths: RunPaths,
  request: BridgeRequest & { model: LedgerModel; speculosUrl: string },
  readStartTime: (pid: number) => string | null = processStartTime,
): Promise<Result<BridgeState, string>> {
  mkdirSync(paths.logsDir, { recursive: true })
  const log = openSync(join(paths.logsDir, 'ledger-bridge.log'), 'a')
  const { pid } = startGroup(
    TSX,
    [
      '--tsconfig',
      'tools/verify/tsconfig.json',
      'tools/verify/emulators/ledger-bridge-daemon.ts',
      ...['--run', paths.runId, '--model', request.model, '--speculos', request.speculosUrl],
      ...['--target', request.target, '--mode', request.mode],
    ],
    { cwd: REPO_ROOT, env: ChildEnv.with(), log },
  )
  closeSync(log)
  if (pid === undefined) {
    return Err('the Ledger bridge did not start')
  }
  // From here on, every failure stops the group this call started, by its PID since this call saw it start, and
  // removes the bridge's record only once the group is gone, so the daemon can't write it again afterwards.
  const giveUp = async (detail: string): Promise<Result<BridgeState, string>> => {
    if (!(await stopOwnGroup(pid))) {
      return Err(`${detail}; its process group ${pid} did not stop, so ${bridgeRecordFile(paths)} is kept`)
    }
    rmSync(bridgeRecordFile(paths), { force: true })
    return Err(detail)
  }
  // ps can miss a process in the moment after it starts; ask again briefly before giving up.
  let startedAt = readStartTime(pid)
  for (let tries = 1; startedAt === null && tries < 10; tries += 1) {
    await wait(50)
    startedAt = readStartTime(pid)
  }
  if (startedAt === null) {
    return giveUp('the Ledger bridge did not start: its start time could not be read')
  }
  const bridgeProcess: RecordedProcess = { name: 'ledger-bridge', pid, startedAt }
  // recordProcess throws when processes.json doesn't parse; that is a failed start like any other.
  let ready: Result<BridgeState, string>
  try {
    ready = await bridgeReady(paths, bridgeProcess, request.mode)
  } catch (error) {
    ready = Err(error instanceof Error ? error.message : String(error))
  }
  return ready.isOk() ? ready : giveUp(`the Ledger bridge did not start: ${ready.unwrapErr()}`)
}

/** Records the bridge's process, then waits for the record it writes once it listens. */
async function bridgeReady(
  paths: RunPaths,
  bridgeProcess: RecordedProcess,
  mode: BridgeMode,
): Promise<Result<BridgeState, string>> {
  const { pid } = bridgeProcess
  await recordProcess(paths, bridgeProcess)
  for (const deadline = Date.now() + BRIDGE_READY_MS; Date.now() < deadline;) {
    const record = readJsonFile(BridgeRecordSchema, bridgeRecordFile(paths))
    if (record.status === 'ok' && record.value.pid === pid) {
      const url = `http://127.0.0.1:${record.value.drivePort}`
      return Ok({
        ...bridgeProcess,
        port: record.value.drivePort,
        url,
        controlPort: record.value.controlPort,
        mode,
      })
    }
    if (!isOurProcess(bridgeProcess)) {
      break
    }
    await wait(200)
  }
  return Err(`it did not come up; see ${join(paths.logsDir, 'ledger-bridge.log')}`)
}

export interface LedgerStart {
  model: LedgerModel
  seed: EmulatorSeedName
  arch: LedgerArch
  elfPath: string
  daemon: DockerDaemon
  /** Also start the bridge, so a browser can reach the device. */
  bridge?: BridgeRequest
  launchBridge?: BridgeLauncher
  /** How long Speculos may take to show the idle screen. */
  bootTimeoutMs?: number
}

/**
 * Starts Speculos for this run, and its bridge when asked, and registers both in run.json once the app shows the idle
 * screen. The start is reserved first, so stop and cleanup wait for it and a second start is refused. The container is
 * recorded before it starts, and it and the bridge are removed again when any later step fails, so a failed start
 * leaves nothing running.
 */
export async function startLedgerEmulator(
  paths: RunPaths,
  start: LedgerStart,
  docker: DockerCommandRunner = runDocker,
  api: (baseUrl: string) => SpeculosApi = speculosApi,
): Promise<Result<EmulatorState, string>> {
  const refused = await reserve(paths)
  if (refused !== null) {
    return Err(refused)
  }
  try {
    return await startReserved(paths, start, docker, api)
  } finally {
    await release(paths)
  }
}

async function startReserved(
  paths: RunPaths,
  start: LedgerStart,
  docker: DockerCommandRunner,
  api: (baseUrl: string) => SpeculosApi,
): Promise<Result<EmulatorState, string>> {
  const created = await createTrackedContainer(
    paths,
    {
      name: 'emulator:ledger',
      role: 'ledger',
      image: SPECULOS_IMAGE,
      daemon: start.daemon,
      options: ['--platform', `linux/${start.arch}`, '-p', `127.0.0.1::${SPECULOS_PORT}`],
      command: [
        '--model',
        start.model,
        '--display',
        'headless',
        '--api-port',
        SPECULOS_PORT,
        '--seed',
        EMULATOR_SEEDS[start.seed].mnemonic,
        CONTAINER_ELF,
      ],
    },
    () => (holdsReservation(paths) ? null : `Run ${paths.runId} lost its Ledger start reservation`),
    docker,
  )
  if (created.isErr()) {
    return Err(created.unwrapErr())
  }
  const containerId = created.unwrap()
  let bridge: BridgeState | undefined
  const abandon = async (detail: string): Promise<Result<EmulatorState, string>> => {
    if (bridge !== undefined) {
      await stopProcess(bridge)
    }
    return Err(`${detail}; ${await discardContainer(paths, containerId, start.daemon, docker)}`)
  }

  const step = (args: string[]): string | null => {
    const result = docker(args, start.daemon)
    return result.error === null && result.status === 0 ? result.stdout : null
  }
  if (step(['cp', start.elfPath, `${containerId}:${CONTAINER_ELF}`]) === null) {
    return abandon('docker cp of app.elf into the Speculos container failed')
  }
  if (step(['start', containerId]) === null) {
    return abandon('docker start of the Speculos container failed')
  }
  const apiPort = publishedPort(step(['port', containerId, `${SPECULOS_PORT}/tcp`]) ?? '')
  if (apiPort === null) {
    return abandon('docker port did not report a 127.0.0.1 port for the Speculos API')
  }
  const idle = await waitForIdle(
    api(`http://127.0.0.1:${apiPort}`),
    start.model,
    start.bootTimeoutMs ?? BOOT_TIMEOUT_MS,
  )
  if (idle !== null) {
    return abandon(`Speculos did not reach the Bitcoin app's idle screen: ${idle}`)
  }
  if (start.bridge !== undefined) {
    let launched: Result<BridgeState, string>
    try {
      launched = await (start.launchBridge ?? launchBridge)(paths, {
        ...start.bridge,
        model: start.model,
        speculosUrl: `http://127.0.0.1:${apiPort}`,
      })
    } catch (error) {
      launched = Err(error instanceof Error ? error.message : String(error))
    }
    if (launched.isErr()) {
      return abandon(launched.unwrapErr())
    }
    bridge = launched.unwrap()
  }
  const emulator: EmulatorState = {
    device: 'ledger',
    model: start.model,
    seed: start.seed,
    containerId,
    daemon: start.daemon,
    apiPort,
    healthUrl: `http://127.0.0.1:${apiPort}/events?currentscreenonly=true`,
  }
  if (bridge !== undefined) {
    emulator.bridge = bridge
  }
  try {
    await withRunLock(paths, (tracking) => {
      const state = readRunState(paths)
      if (state.status !== 'ok') {
        throw new Error(`run.json changed while Speculos started (${state.status})`)
      }
      if (!holdsReservation(paths)) {
        throw new Error(`Run ${paths.runId} lost its Ledger start reservation`)
      }
      tracking.writeRunState({ ...state.value, emulators: [...(state.value.emulators ?? []), emulator] })
      tracking.writeReservation(null)
    })
  } catch (error) {
    return abandon(error instanceof Error ? error.message : String(error))
  }
  return Ok(emulator)
}

/**
 * The mode a run's bridge reports now, or why it can't say: no usable record, a control port another process holds
 * (the token is never sent there), or no answer. Launch and evidence read it; a manual press turns auto off.
 */
export async function bridgeModeNow(
  paths: RunPaths,
  bridge: NonNullable<EmulatorState['bridge']>,
  timeoutMs = 3_000,
): Promise<{ mode: BridgeMode } | { problem: string }> {
  const record = readJsonFile(BridgeRecordSchema, bridgeRecordFile(paths))
  if (record.status !== 'ok' || record.value.pid !== bridge.pid || record.value.controlPort !== bridge.controlPort) {
    return { problem: `${bridgeRecordFile(paths)} is missing or names another bridge` }
  }
  if (!portOwnedBy(bridge.controlPort, bridge.pid)) {
    return { problem: `control port ${bridge.controlPort} is not held by the bridge (PID ${bridge.pid})` }
  }
  try {
    return { mode: (await bridgeControl(record.value, timeoutMs).status()).mode }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}
