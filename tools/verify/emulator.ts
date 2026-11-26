import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readArgs } from './args'
import { emulatorApiUrl, startLedgerEmulator } from './emulators/ledger'
import { type DriveResult, classifyScreen, drivePrompt, pressOnce, speculosApi } from './emulators/ledger-driver'
import { dockerArch, ensureLedgerElf } from './emulators/ledger-elf'
import { RecordSchema } from './evidence-record'
import { EMULATOR_ACTIONS, nextShotName, parseEmulatorCommand, screenshotFolder } from './rules'
import {
  type ContainerInspectResult,
  EMULATOR_DEVICES,
  EVIDENCE_ROOT,
  type EmulatorDevice,
  type EmulatorState,
  HELPER,
  type LedgerModel,
  type RunPaths,
  type RunTracking,
  captureDockerDaemon,
  checkId,
  fail,
  inspectTracked,
  invalidMessage,
  isPathInside,
  ledgerElfCacheDir,
  readContainersFile,
  readJsonFile,
  readRunState,
  removeRunContainers,
  requireJsonFile,
  runPaths,
  selectRunId,
  stopProcess,
  trackContainers,
  withRunLock,
} from './run'

// Controls a run's hardware wallet emulators. The Ledger runs as Speculos in Docker (tools/verify/emulators); Trezor
// and Coldcard runners, and Ledger disconnect and fault, come in later changes and exit 1 until then.
// Usage: helpers/verify emulator start|stop|status|press|reject|screenshot|disconnect|fault [--run <id>]
//          --device ledger|trezor|coldcard [--seed primary|secondary|empty] [--model flex|nanosp] [--button <button>]
//          [--recipe <id>] [--step <name>] [--mode <mode>]

const USAGE = `Usage: ${HELPER} emulator ${EMULATOR_ACTIONS.join('|')} [--run <id>] [--device ${EMULATOR_DEVICES.join('|')}] [--seed primary|secondary|empty] [--model flex|nanosp] [--button <button>] [--recipe <id>] [--step <name>] [--mode <mode>]`

const DEVICE_LABELS: Readonly<Record<EmulatorDevice, string>> = {
  ledger: 'Ledger',
  trezor: 'Trezor',
  coldcard: 'Coldcard',
}

function formatContainerState(state: ContainerInspectResult): string {
  return state.state === 'unavailable' ? `Docker unavailable: ${state.detail}` : state.state
}

/**
 * Stops a device's bridges and removes its containers, forgetting each container only once Docker confirms it gone
 * from the daemon that runs it. Runs under the run's lock; returns the failures, so the caller exits after releasing it.
 */
async function stopDevice(paths: RunPaths, tracking: RunTracking, device: EmulatorDevice): Promise<string[]> {
  const stateResult = readRunState(paths)
  if (stateResult.status === 'invalid') {
    return [`${invalidMessage(stateResult)}.`]
  }
  const containersResult = readContainersFile(paths)
  if (containersResult.status === 'invalid') {
    return [`${invalidMessage(containersResult)}.`]
  }
  const name = `emulator:${device}`
  for (const emulator of stateResult.status === 'ok' ? (stateResult.value.emulators ?? []) : []) {
    if (emulator.device === device && emulator.bridge !== undefined) {
      await stopProcess({ name: emulator.bridge.name, pid: emulator.bridge.pid, startedAt: emulator.bridge.startedAt })
    }
  }
  const { results, errors } = removeRunContainers(paths, tracking, {
    select: (recorded) => recorded === name,
    log: (line) => {
      console.log(line)
    },
  })
  if (results.length === 0 && errors.length === 0) {
    console.log(`No ${device} emulator recorded for run ${paths.runId}.`)
  }
  return errors
}

/** The run's Ledger emulator, once its container is running on the daemon its records name; otherwise a failure. */
function recordedLedger(paths: RunPaths): EmulatorState & { model: LedgerModel } {
  const state = requireJsonFile(readRunState(paths)) ?? fail(`Run ${paths.runId} has no run.json.`)
  const ledger = (state.emulators ?? []).find((emulator) => emulator.device === 'ledger')
  if (ledger === undefined) {
    fail(
      `No Ledger emulator is running for run ${paths.runId}. Start one with ${HELPER} emulator start --device ledger.`,
    )
  }
  const containers = requireJsonFile(readContainersFile(paths)) ?? []
  const inspected = inspectTracked(ledger.containerId, trackContainers(containers, [ledger]).get(ledger.containerId))
  if (inspected.state !== 'running') {
    fail(
      `The Ledger emulator's container ${ledger.containerId} is ${formatContainerState(inspected)}; stop it and start it again.`,
    )
  }
  return { ...ledger, model: ledger.model === 'nanosp' ? 'nanosp' : 'flex' }
}

/** Prints a drive's steps and the screen it left; on failure saves the screen to the run's logs and exits 1. */
function report(paths: RunPaths, what: string, done: string, result: DriveResult): never {
  for (const line of result.trace) {
    console.log(`  ${line}`)
  }
  if (result.ok) {
    const { kind, texts } = result.ended
    console.log(
      `Ledger: ${done}. It now shows ${kind === 'idle' ? 'its idle screen' : `a ${kind} screen ${JSON.stringify(texts)}`}.`,
    )
    process.exit(0)
  }
  let saved = ''
  if (result.screenshot !== null) {
    mkdirSync(paths.logsDir, { recursive: true })
    const file = join(paths.logsDir, `ledger-${what}-${new Date().toISOString().replace(/[:.]/g, '-')}.png`)
    writeFileSync(file, result.screenshot)
    saved = ` Screen saved to ${file}`
  }
  fail(`Ledger ${what} stopped: ${result.reason}.${saved}`)
}

const { values, positionals } = readArgs(
  {
    run: { type: 'string' },
    device: { type: 'string' },
    seed: { type: 'string' },
    model: { type: 'string' },
    button: { type: 'string' },
    mode: { type: 'string' },
    recipe: { type: 'string' },
    step: { type: 'string' },
  },
  1,
)

const parsed = parseEmulatorCommand({
  action: positionals[0],
  device: values.device,
  seed: values.seed,
  model: values.model,
  button: values.button,
  mode: values.mode,
  recipe: values.recipe,
  step: values.step,
})

if (!parsed.ok) {
  console.error(`${parsed.error}\n${USAGE}`)
  process.exit(2)
}

if (values.run !== undefined) {
  checkId('Run', values.run)
}

const { command } = parsed
const notYet = (device: EmulatorDevice, action: string): never =>
  fail(`${DEVICE_LABELS[device]} emulator runner is not implemented yet; cannot run '${action}'.`)

switch (command.action) {
  case 'status': {
    const paths = runPaths(selectRunId(values.run))
    const stateResult = readRunState(paths)
    const containersResult = readContainersFile(paths)
    if (stateResult.status === 'invalid') {
      fail(`${invalidMessage(stateResult)}.`)
    }
    if (containersResult.status === 'invalid') {
      fail(`${invalidMessage(containersResult)}.`)
    }
    const state = stateResult.status === 'ok' ? stateResult.value : null
    const recordedContainers = containersResult.status === 'ok' ? containersResult.value : []
    const tracked = trackContainers(recordedContainers, state?.emulators ?? [])

    const emulators = (state?.emulators ?? []).filter(
      (entry) => command.device === undefined || entry.device === command.device,
    )
    const coveredIds = new Set(emulators.map((entry) => entry.containerId))
    const extraContainers = recordedContainers.filter((entry) => {
      if (coveredIds.has(entry.containerId)) {
        return false
      }
      return command.device === undefined || entry.name === `emulator:${command.device}`
    })

    if (emulators.length === 0 && extraContainers.length === 0) {
      const scope = command.device !== undefined ? `${command.device} emulator` : 'emulators'
      console.log(`No ${scope} recorded for run ${paths.runId}.`)
      process.exit(0)
    }

    const conflicted = [...tracked.values()].some(
      (entry) =>
        entry.conflict !== null &&
        (coveredIds.has(entry.containerId) || extraContainers.some((c) => c.containerId === entry.containerId)),
    )
    for (const emulator of emulators) {
      const inspected = inspectTracked(emulator.containerId, tracked.get(emulator.containerId))
      let screen = ''
      if (emulator.device === 'ledger' && inspected.state === 'running') {
        const model = emulator.model === 'nanosp' ? 'nanosp' : 'flex'
        try {
          const shown = classifyScreen(model, await speculosApi(emulatorApiUrl(emulator)).screen())
          screen = ` screen=${shown.kind} ${JSON.stringify(shown.texts)}`
        } catch (error) {
          screen = ` screen=unreadable (${error instanceof Error ? error.message : String(error)})`
        }
      }
      const modelPart = emulator.model !== undefined ? ` model=${emulator.model}` : ''
      const bridgePart =
        emulator.bridge !== undefined ? ` bridge=${emulator.bridge.url} (PID ${emulator.bridge.pid})` : ''
      console.log(
        `${emulator.device}:${modelPart} seed=${emulator.seed} container=${emulator.containerId} (${formatContainerState(inspected)}) health=${emulator.healthUrl}${screen}${bridgePart}`,
      )
    }
    for (const container of extraContainers) {
      const inspected = inspectTracked(container.containerId, tracked.get(container.containerId))
      console.log(
        `${container.name}: container=${container.containerId} (${formatContainerState(inspected)}) image=${container.image}`,
      )
    }
    process.exit(conflicted ? 1 : 0)
  }

  case 'stop': {
    const paths = runPaths(selectRunId(values.run))
    let failures: string[]
    try {
      failures = await withRunLock(paths, async (tracking) => stopDevice(paths, tracking, command.device))
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    if (failures.length > 0) {
      fail(`Failed to stop ${command.device} emulator: ${failures.join('; ')}`)
    }
    process.exit(0)
  }

  case 'start': {
    if (command.device !== 'ledger') {
      const modelSuffix = command.model !== undefined ? `, model: ${command.model}` : ''
      fail(
        `${DEVICE_LABELS[command.device]} emulator runner is not implemented yet (seed: ${command.seed}${modelSuffix}).`,
      )
    }
    const model: LedgerModel = command.model === 'nanosp' ? 'nanosp' : 'flex'
    let cacheDir: string
    try {
      cacheDir = ledgerElfCacheDir()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    const paths = runPaths(selectRunId(values.run))
    if (requireJsonFile(readRunState(paths)) === null) {
      fail(`Run ${paths.runId} has no run.json. Launch it first with ${HELPER} launch.`)
    }
    const daemon = captureDockerDaemon()
    if (daemon.isErr()) {
      fail(daemon.unwrapErr())
    }
    const arch = dockerArch(daemon.unwrap())
    if (arch.isErr()) {
      fail(arch.unwrapErr())
    }
    const start = { model, seed: command.seed, arch: arch.unwrap(), daemon: daemon.unwrap() }
    try {
      const elf = await ensureLedgerElf(paths, { ...start, cacheDir })
      if (elf.isErr()) {
        fail(elf.unwrapErr())
      }
      console.log(`Starting Speculos (${model}, seed ${command.seed}) on linux/${start.arch}`)
      const started = await startLedgerEmulator(paths, { ...start, elfPath: elf.unwrap() })
      if (started.isErr()) {
        fail(`Ledger emulator did not start: ${started.unwrapErr()}`)
      }
      const emulator = started.unwrap()
      console.log(
        `Ledger ${model} is ready: container ${emulator.containerId.slice(0, 12)}, Speculos API ${emulatorApiUrl(emulator)}`,
      )
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    process.exit(0)
  }

  case 'press':
  case 'reject': {
    if (command.device !== 'ledger') {
      notYet(command.device, command.action)
    }
    const paths = runPaths(selectRunId(values.run))
    const ledger = recordedLedger(paths)
    const api = speculosApi(emulatorApiUrl(ledger))
    if (command.action === 'reject') {
      report(paths, 'reject', 'rejected the prompt', await drivePrompt(api, ledger.model, 'reject'))
    }
    const { button } = command
    report(
      paths,
      button === undefined ? 'approve' : `press-${button}`,
      button === undefined ? 'approved the prompt' : `pressed ${button}`,
      button === undefined
        ? await drivePrompt(api, ledger.model, 'approve')
        : await pressOnce(api, ledger.model, button),
    )
  }

  case 'screenshot': {
    if (command.device !== 'ledger') {
      notYet(command.device, command.action)
    }
    const paths = runPaths(selectRunId(values.run))
    const ledger = recordedLedger(paths)
    const runFolder = join(EVIDENCE_ROOT, paths.runId)
    const record = requireJsonFile(readJsonFile(RecordSchema, join(runFolder, 'evidence.json')))
    const target = screenshotFolder(record?.attempts ?? [], command.recipe)
    if (!target.ok) {
      fail(target.error)
    }
    const folder = target.folder === null ? runFolder : join(runFolder, target.folder)
    if (!isPathInside(folder, runFolder)) {
      fail(`Refusing to write outside ${runFolder}: ${folder}`)
    }
    mkdirSync(folder, { recursive: true })
    const file = join(folder, nextShotName(existsSync(folder) ? readdirSync(folder) : [], command.step))
    try {
      writeFileSync(file, await speculosApi(emulatorApiUrl(ledger)).screenshot())
    } catch (error) {
      fail(`Could not read the Ledger screen: ${error instanceof Error ? error.message : String(error)}`)
    }
    console.log(file)
    process.exit(0)
  }

  case 'disconnect':
  case 'fault': {
    notYet(command.device, command.action)
  }
}
