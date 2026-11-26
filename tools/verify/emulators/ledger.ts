import { Err, Ok, type Result } from '@hoseki/packages/result'
import { EMULATOR_SEEDS } from '../emulator-seeds'
import {
  type DockerCommandRunner,
  type DockerDaemon,
  type EmulatorSeedName,
  type EmulatorState,
  type LedgerModel,
  type RunPaths,
  createTrackedContainer,
  discardContainer,
  readContainersFile,
  readIntentsFile,
  readRunState,
  runDocker,
  withRunLock,
} from '../run'
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

/** The Speculos API of a recorded Ledger emulator, after checking its health URL is loopback on its port. */
export function emulatorApiUrl(emulator: EmulatorState): string {
  return `http://127.0.0.1:${emulator.apiPort}`
}

/** Why a Ledger emulator can't start on this run now, or null. Read under the run's lock. */
function startProblem(paths: RunPaths): string | null {
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

/** The host port Docker published for the container's API, from `docker port`. */
function publishedPort(output: string): number | null {
  const match = /^127\.0\.0\.1:(\d+)$/m.exec(output.trim())
  const port = Number(match?.[1])
  return Number.isInteger(port) && port > 0 && port < 65_536 ? port : null
}

export interface LedgerStart {
  model: LedgerModel
  seed: EmulatorSeedName
  arch: LedgerArch
  elfPath: string
  daemon: DockerDaemon
  /** How long Speculos may take to show the idle screen. */
  bootTimeoutMs?: number
}

/**
 * Starts Speculos for this run and registers it in run.json once its app shows the idle screen. The container is
 * recorded before it starts, and removed again when any later step fails, so a failed start leaves nothing running.
 */
export async function startLedgerEmulator(
  paths: RunPaths,
  start: LedgerStart,
  docker: DockerCommandRunner = runDocker,
  api: (baseUrl: string) => SpeculosApi = speculosApi,
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
    () => startProblem(paths),
    docker,
  )
  if (created.isErr()) {
    return Err(created.unwrapErr())
  }
  const containerId = created.unwrap()
  const abandon = async (detail: string): Promise<Result<EmulatorState, string>> =>
    Err(`${detail}; ${await discardContainer(paths, containerId, start.daemon, docker)}`)

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
  const emulator: EmulatorState = {
    device: 'ledger',
    model: start.model,
    seed: start.seed,
    containerId,
    daemon: start.daemon,
    apiPort,
    healthUrl: `http://127.0.0.1:${apiPort}/events?currentscreenonly=true`,
  }
  try {
    await withRunLock(paths, (tracking) => {
      const state = readRunState(paths)
      if (state.status !== 'ok') {
        throw new Error(`run.json changed while Speculos started (${state.status})`)
      }
      tracking.writeRunState({ ...state.value, emulators: [...(state.value.emulators ?? []), emulator] })
    })
  } catch (error) {
    return abandon(error instanceof Error ? error.message : String(error))
  }
  return Ok(emulator)
}
