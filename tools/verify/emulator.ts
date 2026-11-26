import { readArgs } from './args'
import { EMULATOR_ACTIONS, parseEmulatorCommand } from './rules'
import {
  type ContainerInspectResult,
  DEFAULT_LEDGER_MODEL,
  EMULATOR_DEVICES,
  type EmulatorDevice,
  HELPER,
  type RunPaths,
  type RunTracking,
  checkId,
  fail,
  inspectContainer,
  invalidMessage,
  ledgerElfCacheDir,
  readContainersFile,
  readRunState,
  removeContainer,
  runPaths,
  selectRunId,
  stopProcess,
  trackContainers,
  withRunLock,
} from './run'

// CLI skeleton for controlling hardware wallet emulators during a verification run.
// Device runners (Ledger Speculos, Trezor, Coldcard) are added in later chunks; this command validates flags,
// inspects/stops recorded containers and bridge processes, and rejects unimplemented runner actions clearly.
// Usage: helpers/verify emulator start|stop|status|press|reject|disconnect|fault [--run <id>] --device ledger|trezor|coldcard [--seed primary|secondary|empty] [--model <model>] [--button <button>] [--mode <mode>]

const USAGE = `Usage: ${HELPER} emulator ${EMULATOR_ACTIONS.join('|')} [--run <id>] [--device ${EMULATOR_DEVICES.join('|')}] [--seed primary|secondary|empty] [--model <model>] [--button <button>] [--mode <mode>]`

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
  const containersResult = readContainersFile(paths)
  if (stateResult.status === 'invalid') {
    return [`${invalidMessage(stateResult)}.`]
  }
  if (containersResult.status === 'invalid') {
    return [`${invalidMessage(containersResult)}.`]
  }
  const state = stateResult.status === 'ok' ? stateResult.value : null
  const recordedContainers = containersResult.status === 'ok' ? containersResult.value : []
  const tracked = trackContainers(recordedContainers, state?.emulators ?? [])

  const matchingEmulators = (state?.emulators ?? []).filter((entry) => entry.device === device)
  const containerIds = new Set<string>(matchingEmulators.map((entry) => entry.containerId))
  for (const recorded of recordedContainers) {
    if (recorded.name === `emulator:${device}`) {
      containerIds.add(recorded.containerId)
    }
  }

  if (matchingEmulators.length === 0 && containerIds.size === 0) {
    console.log(`No ${device} emulator recorded for run ${paths.runId}.`)
    return []
  }

  for (const emulator of matchingEmulators) {
    if (emulator.bridge !== undefined) {
      await stopProcess({
        name: emulator.bridge.name,
        pid: emulator.bridge.pid,
        startedAt: emulator.bridge.startedAt,
      })
    }
  }
  const confirmedRemovedIds = new Set<string>()
  const failures: string[] = []
  for (const containerId of containerIds) {
    const result = removeContainer(containerId, tracked.get(containerId)?.daemon)
    console.log(`emulator:${device}: ${result.detail}`)
    if (result.removed) {
      confirmedRemovedIds.add(containerId)
      tracking.forgetContainers(new Set([containerId]))
    } else {
      failures.push(result.detail)
    }
  }
  if (state?.emulators !== undefined && confirmedRemovedIds.size > 0) {
    const remaining = state.emulators.filter(
      (entry) => entry.device !== device || !confirmedRemovedIds.has(entry.containerId),
    )
    tracking.writeRunState({ ...state, emulators: remaining })
  }
  return failures
}

const { values, positionals } = readArgs(
  {
    run: { type: 'string' },
    device: { type: 'string' },
    seed: { type: 'string' },
    model: { type: 'string' },
    button: { type: 'string' },
    mode: { type: 'string' },
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
})

if (!parsed.ok) {
  console.error(`${parsed.error}\n${USAGE}`)
  process.exit(2)
}

if (values.run !== undefined) {
  checkId('Run', values.run)
}

const { command } = parsed

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

    for (const emulator of emulators) {
      const stateLabel = formatContainerState(
        inspectContainer(emulator.containerId, tracked.get(emulator.containerId)?.daemon),
      )
      const modelPart = emulator.model !== undefined ? ` model=${emulator.model}` : ''
      const bridgePart =
        emulator.bridge !== undefined ? ` bridge=${emulator.bridge.url} (PID ${emulator.bridge.pid})` : ''
      console.log(
        `${emulator.device}:${modelPart} seed=${emulator.seed} container=${emulator.containerId} (${stateLabel}) health=${emulator.healthUrl}${bridgePart}`,
      )
    }
    for (const container of extraContainers) {
      const stateLabel = formatContainerState(inspectContainer(container.containerId, container.daemon))
      console.log(`${container.name}: container=${container.containerId} (${stateLabel}) image=${container.image}`)
    }
    process.exit(0)
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
    if (command.device === 'ledger') {
      const model = command.model ?? DEFAULT_LEDGER_MODEL
      let cacheDir: string
      try {
        cacheDir = ledgerElfCacheDir()
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
      fail(
        `Ledger emulator runner is not implemented yet (model: ${model}, seed: ${command.seed}, ELF cache: ${cacheDir}).`,
      )
    }
    const modelSuffix = command.model !== undefined ? `, model: ${command.model}` : ''
    fail(
      `${DEVICE_LABELS[command.device]} emulator runner is not implemented yet (seed: ${command.seed}${modelSuffix}).`,
    )
  }

  case 'press':
  case 'reject':
  case 'disconnect':
  case 'fault': {
    fail(`${DEVICE_LABELS[command.device]} emulator runner is not implemented yet; cannot run '${command.action}'.`)
  }
}
