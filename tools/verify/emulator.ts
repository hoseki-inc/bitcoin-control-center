import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readArgs } from './args'
import { emulatorApiUrl, withLedgerDriveLock } from './emulators/ledger'
import { type BridgeControl, bridgeControl } from './emulators/ledger-bridge'
import { type DriveResult, classifyScreen, drivePrompt, pressOnce, speculosApi } from './emulators/ledger-driver'
import { type LedgerLaunch, startLedger } from './emulators/ledger-launch'
import { RecordSchema } from './evidence-record'
import { EMULATOR_ACTIONS, nextShotName, parseEmulatorCommand, screenshotFolder } from './rules'
import {
  BridgeRecordSchema,
  type ContainerInspectResult,
  EMULATOR_DEVICES,
  EVIDENCE_ROOT,
  type EmulatorDevice,
  type EmulatorState,
  HELPER,
  type LedgerModel,
  type RecordedProcess,
  type RunPaths,
  type RunTracking,
  bridgeRecordFile,
  checkId,
  fail,
  inspectTracked,
  invalidMessage,
  isPathInside,
  ledgerElfCacheDir,
  liveStartProblem,
  portOwnedBy,
  readContainersFile,
  readIntentsFile,
  readJsonFile,
  readProcessesFile,
  readReservation,
  readRunState,
  removeRunContainers,
  requireJsonFile,
  reservationOwnerAlive,
  runPaths,
  selectRunId,
  stopRecordedGroups,
  trackContainers,
  withRunLock,
} from './run'

// Controls a run's hardware wallet emulators. The Ledger runs as Speculos in Docker (tools/verify/emulators), with a
// bridge when started with --bridge; Trezor and Coldcard runners, and Ledger disconnect and fault, come in later
// changes and exit 1 until then.
// Usage: helpers/verify emulator start|stop|status|press|reject|screenshot|disconnect|fault [--run <id>]
//          --device ledger|trezor|coldcard [--seed primary|secondary|empty] [--model flex|nanosp] [--bridge]
//          [--auto-approve] [--button <button>] [--recipe <id>] [--step <name>] [--mode <mode>]

const USAGE = `Usage: ${HELPER} emulator ${EMULATOR_ACTIONS.join('|')} [--run <id>] [--device ${EMULATOR_DEVICES.join('|')}] [--seed primary|secondary|empty] [--model flex|nanosp] [--bridge] [--auto-approve] [--button <button>] [--recipe <id>] [--step <name>] [--mode <mode>]`

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
  const busy = liveStartProblem(paths)
  if (busy !== null) {
    return [busy]
  }
  const name = `emulator:${device}`
  // A Ledger's bridge is in run.json once its start finished, and in processes.json from the moment it was started,
  // so a start that died in between still leaves a record to stop it by.
  const bridges: RecordedProcess[] = (stateResult.status === 'ok' ? (stateResult.value.emulators ?? []) : []).flatMap(
    (emulator) =>
      emulator.device === device && emulator.bridge !== undefined
        ? [{ name: emulator.bridge.name, pid: emulator.bridge.pid, startedAt: emulator.bridge.startedAt }]
        : [],
  )
  if (device === 'ledger') {
    const journal = readProcessesFile(paths)
    if (journal.status === 'invalid') {
      return [`${invalidMessage(journal)}; it may name a Ledger bridge, so nothing was stopped.`]
    }
    bridges.push(
      ...(journal.status === 'ok' ? journal.value : []).filter((recorded) => recorded.name === 'ledger-bridge'),
    )
  }
  const running = await stopRecordedGroups(bridges)
  if (running.length > 0) {
    // Its page could still reach the device: keep its record, the start reservation and the containers.
    return [
      `${running.map((recorded) => `${recorded.name} (PID ${recorded.pid})`).join(', ')} did not stop; nothing else was removed. Stop it, then run emulator stop again.`,
    ]
  }
  if (device === 'ledger') {
    rmSync(bridgeRecordFile(paths), { force: true })
  }
  // A start whose process died can't finish; its containers are removed below like any other.
  tracking.writeReservation(null)
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

/**
 * The control API of the Ledger's bridge, from the record the bridge wrote. Throws when there is no usable record, or
 * when the control port isn't held by the bridge's process group, so the token never goes to another process.
 */
function controlOf(paths: RunPaths, bridge: NonNullable<EmulatorState['bridge']>): BridgeControl {
  const record = readJsonFile(BridgeRecordSchema, bridgeRecordFile(paths))
  if (record.status !== 'ok' || record.value.pid !== bridge.pid || record.value.controlPort !== bridge.controlPort) {
    throw new Error(`the bridge (PID ${bridge.pid}) left no usable ${bridgeRecordFile(paths)}`)
  }
  if (!portOwnedBy(bridge.controlPort, bridge.pid)) {
    throw new Error(`control port ${bridge.controlPort} is not held by the bridge (PID ${bridge.pid})`)
  }
  return bridgeControl(record.value)
}

/** A drive through the bridge, with a bridge that doesn't answer reported as a failed drive. */
async function viaBridge(run: () => Promise<DriveResult>): Promise<DriveResult> {
  try {
    return await run()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, trace: [], reason: `the bridge did not drive the device: ${detail}`, screenshot: null }
  }
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
    bridge: { type: 'boolean' },
    'auto-approve': { type: 'boolean' },
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
  bridge: values.bridge,
  autoApprove: values['auto-approve'],
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
    const intents = readIntentsFile(paths)
    const reservation = readReservation(paths)
    // A create journaled but not yet recorded, and a start in progress, show before anything is running.
    const pending = [
      ...(intents.status === 'ok' ? intents.value : [])
        .filter((intent) => command.device === undefined || intent.name === `emulator:${command.device}`)
        .map(
          (intent) => `${intent.name}: create pending (container ${intent.containerName}, since ${intent.startedAt})`,
        ),
      ...(reservation.status === 'ok' &&
      (command.device === undefined || reservation.value.name === `emulator:${command.device}`)
        ? [
            `${reservation.value.name}: start ${reservationOwnerAlive(reservation.value) ? 'in progress' : 'interrupted'} (PID ${reservation.value.pid}, since ${reservation.value.reservedAt})`,
          ]
        : []),
    ]
    for (const line of pending) {
      console.log(line)
    }

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

    if (emulators.length === 0 && extraContainers.length === 0 && pending.length === 0) {
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
      let bridgePart = ''
      if (emulator.bridge !== undefined) {
        let mode: string
        try {
          const status = await controlOf(paths, emulator.bridge).status()
          mode = `${status.mode}${status.inFlight === null ? '' : `, APDU waiting ${status.inFlight.seconds} s`}`
        } catch (error) {
          mode = `not answering: ${error instanceof Error ? error.message : String(error)}`
        }
        bridgePart = ` bridge=${emulator.bridge.url} (PID ${emulator.bridge.pid}, ${mode})`
      }
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
    try {
      ledgerElfCacheDir()
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    const paths = runPaths(selectRunId(values.run))
    const state =
      requireJsonFile(readRunState(paths)) ??
      fail(`Run ${paths.runId} has no run.json. Launch it first with ${HELPER} launch.`)
    const launch: LedgerLaunch = { model, seed: command.seed }
    if (command.bridge !== null) {
      launch.bridge = { mode: command.bridge, target: state.url }
    }
    const started = await startLedger(paths, launch)
    if (started.isErr()) {
      fail(`Ledger emulator did not start: ${started.unwrapErr()}`)
    }
    const emulator = started.unwrap()
    console.log(
      `Ledger ${model} is ready: container ${emulator.containerId.slice(0, 12)}, Speculos API ${emulatorApiUrl(emulator)}`,
    )
    if (emulator.bridge !== undefined) {
      console.log(`Open Control Center at ${emulator.bridge.url} to reach the Ledger (bridge ${emulator.bridge.mode}).`)
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
    const button = command.action === 'press' ? command.button : undefined
    const { bridge } = ledger
    // With a bridge, the bridge drives, so its auto-approve and other commands wait their turn; without one, a lock
    // per device does the same for commands.
    const drive = async (): Promise<DriveResult> => {
      if (bridge !== undefined) {
        return viaBridge(async () => {
          const control = controlOf(paths, bridge)
          return command.action === 'reject' ? control.reject() : control.press(button)
        })
      }
      return withLedgerDriveLock(paths, async () =>
        command.action === 'reject'
          ? drivePrompt(api, ledger.model, 'reject')
          : button === undefined
            ? drivePrompt(api, ledger.model, 'approve')
            : pressOnce(api, ledger.model, button),
      )
    }
    if (command.action === 'reject') {
      report(paths, 'reject', 'rejected the prompt', await drive())
    }
    report(
      paths,
      button === undefined ? 'approve' : `press-${button}`,
      button === undefined ? 'approved the prompt' : `pressed ${button}`,
      await drive(),
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
    // The screen first, so a failed read leaves no empty folder behind.
    let png: Buffer
    try {
      png = await (ledger.bridge === undefined
        ? speculosApi(emulatorApiUrl(ledger)).screenshot()
        : controlOf(paths, ledger.bridge).screenshot())
    } catch (error) {
      fail(`Could not read the Ledger screen: ${error instanceof Error ? error.message : String(error)}`)
    }
    mkdirSync(folder, { recursive: true })
    const file = join(folder, nextShotName(readdirSync(folder), command.step))
    writeFileSync(file, png)
    console.log(file)
    process.exit(0)
  }

  case 'disconnect':
  case 'fault': {
    notYet(command.device, command.action)
  }
}
