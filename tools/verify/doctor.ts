import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readArgs } from './args'
import { countAccounts, sentinelClient, signIn } from './client'
import { SHIM_FILE, bridgeControl } from './emulators/ledger-bridge'
import { classifyScreen, screenFromEvents } from './emulators/ledger-driver'
import {
  type EmulatorProbe,
  type ExtraContainerProbe,
  activeFaults,
  checkEmulatorsRule,
  freeAttemptNumber,
  freshSeedCheck,
} from './rules'
import {
  BridgeRecordSchema,
  type EmulatorState,
  HELPER,
  type RunState,
  bridgeRecordFile,
  buildStamp,
  inspectTracked,
  invalidMessage,
  isLoopbackUrlForPort,
  isOurProcess,
  isPathInside,
  listeners,
  portOwnedBy,
  readAppliedFaults,
  readContainersFile,
  readIntentsFile,
  readJsonFile,
  readRunState,
  readSeedMarker,
  runPaths,
  selectRunId,
  servesWebApp,
  trackContainers,
} from './run'

// Read-only: is this run worth driving? Every check runs, then the exit code is 1 if any failed.
// Usage: helpers/verify doctor [--run <id>] [--save <attempt folder>]
// --save also writes the output to the folder's next free doctor-<n>.log, so a later doctor never replaces a failed one.

interface Check {
  name: string
  ok: boolean
  detail: string
}

const args = readArgs({ run: { type: 'string' }, save: { type: 'string' } }).values
const paths = runPaths(selectRunId(args.run))
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
}
const attempt = async (name: string, run: () => Promise<[boolean, string]>): Promise<void> => {
  try {
    const [ok, detail] = await run()
    check(name, ok, detail)
  } catch (error) {
    check(name, false, error instanceof Error ? error.message : String(error))
  }
}

/** Process, port, isolation and build checks. True when the run's processes own their ports, so its URL is safe to call. */
function checkProcesses(state: RunState): boolean {
  const { sentinel, fakes } = state
  const alive = (ok: boolean, pid: number): string => (ok ? `PID ${pid}` : `PID ${pid} is not this run's process`)
  const sentinelOurs = isOurProcess(sentinel)
  const fakesOurs = isOurProcess(fakes)
  check(state.electron ? 'electron process' : 'sentinel process', sentinelOurs, alive(sentinelOurs, sentinel.pid))
  check('fakes process', fakesOurs, alive(fakesOurs, fakes.pid))
  const port = (name: string, number: number, leader: number): [boolean, string] => {
    const holders = listeners(number)
    return portOwnedBy(number, leader)
      ? [true, `${name} ${number}`]
      : [
          false,
          `${name} ${number} ${holders.length === 0 ? 'has no listener' : `is held by PID ${holders.join(', ')}`}`,
        ]
  }
  const ports: Array<[boolean, string]> = [
    port('Sentinel', sentinel.port, sentinel.pid),
    port('Electrum', fakes.electrumPort, fakes.pid),
    port('mempool', fakes.mempoolPort, fakes.pid),
  ]
  if (state.electron) {
    ports.push(
      state.cdpPort === undefined ? [false, 'CDP port missing in run.json'] : port('CDP', state.cdpPort, sentinel.pid),
    )
  }
  const portsOk = ports.every(([ok]) => ok)
  check('ports', portsOk, ports.map(([, detail]) => detail).join(', '))

  if (state.electron) {
    const appSupport = join(homedir(), 'Library', 'Application Support')
    const isolated =
      state.userDataDir !== undefined &&
      isPathInside(state.userDataDir, paths.runDir) &&
      !isPathInside(state.userDataDir, appSupport)
    check(
      'isolation',
      isolated,
      isolated && state.userDataDir !== undefined
        ? `userData isolated at ${state.userDataDir}`
        : `userDataDir is missing or not isolated inside ${paths.runDir}`,
    )
  }

  const current = buildStamp()
  const sameBuild = current.commit === state.build.commit && current.tree === state.build.tree
  check(
    'build',
    sameBuild,
    sameBuild
      ? `${state.build.commit.slice(0, 10)} tree ${state.build.tree}`
      : `launched from ${state.build.commit.slice(0, 10)}/${state.build.tree}, code is now ${current.commit.slice(0, 10)}/${current.tree}. Clean up and relaunch.`,
  )
  return sentinelOurs && fakesOurs && portsOk
}

async function checkApp(state: RunState): Promise<void> {
  const { url, fakes } = state
  const client = sentinelClient(url)
  await attempt('health', async () => {
    const response = await fetch(`${url}/health`)
    return [response.ok, `/health answered ${response.status}`]
  })
  await attempt('web app', async () => [await servesWebApp(url), 'Sentinel serves the built web app'])
  const pinProgress = { awaitingUiPinSetup: false }
  await attempt('pin', async () => {
    const status = await client.auth.status.query()
    if (state.electron) {
      if (status.platform !== 'desktop') {
        return [false, `expected PINs on for desktop; got ${status.platform ?? 'PINs off'}`]
      }
      if (status.state === 'no-pin') {
        if (state.setupPinInUi) {
          pinProgress.awaitingUiPinSetup = true
          return [true, 'PINs are on (desktop); awaiting UI PIN setup']
        }
        return [false, "expected desktop PIN to be set; got state 'no-pin'"]
      }
      await signIn(client)
      return [true, "PINs are on (desktop); signed in with the run's PIN"]
    }
    if (!state.pin) {
      // Standalone Sentinel runs with PINs off, so every tab is already signed in.
      return [
        status.platform === null,
        status.platform === null ? 'PINs are off (standalone)' : `PINs are on for ${status.platform}`,
      ]
    }
    if (status.platform !== 'umbrel' || status.state === 'no-pin') {
      return [false, `expected PINs on for umbrel with the run's PIN set; got ${status.platform ?? 'PINs off'}`]
    }
    // The doctor signs in as its own tab. A browser tab's session is separate, so this doesn't sign the browser in.
    await signIn(client)
    return [true, "PINs are on (umbrel); signed in with the run's PIN"]
  })
  if (pinProgress.awaitingUiPinSetup) {
    return
  }
  await attempt('electrum', async () => {
    const status = await client.portalProve.settings.electrumStatus.query()
    const fake = status.host === '127.0.0.1' && status.port === fakes.electrumPort
    return [
      status.connected && fake,
      `${status.connected ? 'connected' : 'not connected'} to ${fake ? 'the fake' : 'another server'}`,
    ]
  })
  await attempt('prices', async () => {
    const options = await client.portalProve.price.options.query()
    return [
      options.selected === 'mempool' && !options.fallbacks,
      `source ${options.selected}, fallbacks ${options.fallbacks ? 'on' : 'off'}`,
    ]
  })
  await attempt('seed', async () => {
    const marker = readSeedMarker(paths, state)
    if (state.fresh) {
      return freshSeedCheck(marker.status, await countAccounts(client))
    }
    if (marker.status === 'missing') {
      return [false, `not seeded; run ${HELPER} seed`]
    }
    if (marker.status === 'invalid') {
      return [false, `${marker.file} does not parse; launch a new run`]
    }
    const accounts = new Set<string>((await client.portalProve.accounts.list.query()).map((claim) => claim.id))
    const statements = new Set((await client.portalProve.statements.list.query()).map((statement) => statement.id))
    const missing = [
      ...Object.entries(marker.value.accounts).filter(([, id]) => !accounts.has(id)),
      ...marker.value.statements.filter((id) => !statements.has(id)).map((id) => ['statement', id]),
    ]
    return missing.length === 0
      ? [true, `seeded ${marker.value.seededAt}, baseline intact`]
      : [false, `seeded data is gone (${missing.map(([name]) => name).join(', ')}); launch a new run for the baseline`]
  })
}

/** Fetches a running emulator's health URL; for a Ledger, its answer must be a screen, and the idle one. */
async function probeHealth(emulator: EmulatorState): Promise<{ ok: boolean; detail: string; summary?: string }> {
  if (!isLoopbackUrlForPort(emulator.healthUrl, emulator.apiPort, ['http:'])) {
    return {
      ok: false,
      detail: `healthUrl ${emulator.healthUrl} does not match loopback http port ${emulator.apiPort}`,
    }
  }
  try {
    const response = await fetch(emulator.healthUrl, { redirect: 'manual', signal: AbortSignal.timeout(3_000) })
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, detail: `HTTP ${response.status} (redirect rejected)` }
    }
    if (!response.ok || emulator.device !== 'ledger') {
      return { ok: response.ok, detail: `HTTP ${response.status}` }
    }
    const model = emulator.model === 'nanosp' || emulator.model === 'flex' ? emulator.model : null
    if (model === null) {
      return {
        ok: false,
        detail: `run.json records Ledger model ${JSON.stringify(emulator.model)}, not flex or nanosp`,
      }
    }
    const elements = screenFromEvents(await response.text())
    if (elements === null) {
      return { ok: false, detail: 'Speculos /events did not answer a screen' }
    }
    const screen = classifyScreen(model, elements)
    return screen.kind === 'idle'
      ? { ok: true, detail: 'HTTP 200', summary: 'screen idle' }
      : {
          ok: false,
          detail: `screen is ${screen.kind} ${JSON.stringify(screen.texts)}, not idle; finish it with ${HELPER} emulator press|reject --device ledger`,
        }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

const STUCK_APDU_SECONDS = 10

/** A live bridge's control port, token record, shim and queue: what else must hold for a browser to drive the Ledger. */
async function probeBridge(bridge: NonNullable<EmulatorState['bridge']>): Promise<string[]> {
  const problems: string[] = []
  const record = readJsonFile(BridgeRecordSchema, bridgeRecordFile(paths))
  if (!portOwnedBy(bridge.controlPort, bridge.pid)) {
    // The token goes only to the bridge's own port.
    problems.push(`bridge control port ${bridge.controlPort} is not the bridge's`)
  } else if (
    record.status !== 'ok' ||
    record.value.pid !== bridge.pid ||
    record.value.controlPort !== bridge.controlPort
  ) {
    problems.push(`${bridgeRecordFile(paths)} is missing or names another bridge`)
  } else {
    try {
      const { inFlight } = await bridgeControl(record.value, 3_000).status()
      // An APDU answers in well under a second unless it waits on a prompt nobody has decided.
      if (inFlight !== null && inFlight.seconds >= STUCK_APDU_SECONDS) {
        problems.push(
          `an APDU has waited ${inFlight.seconds} s on the device; finish its prompt with ${HELPER} emulator press|reject --device ledger`,
        )
      }
    } catch (error) {
      problems.push(`bridge control API: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    const shim = await fetch(`${bridge.url}${SHIM_FILE}`, { redirect: 'manual', signal: AbortSignal.timeout(3_000) })
    if (!shim.ok || !(await shim.text()).includes('bcc-verify.webhid-shim')) {
      problems.push(`the drive proxy does not serve the WebHID shim (HTTP ${shim.status})`)
    }
  } catch (error) {
    problems.push(`the drive proxy did not answer: ${error instanceof Error ? error.message : String(error)}`)
  }
  return problems
}

async function checkEmulators(state: RunState | null): Promise<void> {
  const containersFile = readContainersFile(paths)
  const intentsFile = readIntentsFile(paths)
  if (containersFile.status === 'invalid' || intentsFile.status === 'invalid') {
    const [ok, detail] = checkEmulatorsRule(
      [],
      [],
      containersFile.status === 'invalid' ? containersFile.file : paths.intentsFile,
    )
    check('emulators', ok, detail)
    return
  }
  const pending = intentsFile.status === 'ok' ? intentsFile.value.map((intent) => intent.name) : []
  const recordedContainers = containersFile.status === 'ok' ? containersFile.value : []
  const emulators = state?.emulators ?? []
  const tracked = trackContainers(recordedContainers, emulators)

  const probes: EmulatorProbe[] = []
  for (const emulator of emulators) {
    const containerState = inspectTracked(emulator.containerId, tracked.get(emulator.containerId))
    const health =
      containerState.state === 'running'
        ? await probeHealth(emulator)
        : { ok: false, detail: 'skipped (container is not running)' }

    const bridgeAlive = emulator.bridge !== undefined ? isOurProcess(emulator.bridge) : null
    const bridgePortHolders = emulator.bridge !== undefined ? listeners(emulator.bridge.port) : []
    const bridgePortOwned =
      emulator.bridge !== undefined ? portOwnedBy(emulator.bridge.port, emulator.bridge.pid) : null

    probes.push({
      emulator,
      containerState,
      healthOk: health.ok,
      healthDetail: health.detail,
      healthSummary: health.summary,
      bridgeAlive,
      bridgePortOwned,
      bridgePortHolders,
      bridgeProblems: emulator.bridge !== undefined && bridgeAlive === true ? await probeBridge(emulator.bridge) : [],
    })
  }

  const coveredIds = new Set(emulators.map((emulator) => emulator.containerId))
  const extraContainers: ExtraContainerProbe[] = recordedContainers
    .filter((recorded) => !coveredIds.has(recorded.containerId))
    .map((recorded) => ({
      name: recorded.name,
      containerId: recorded.containerId,
      containerState: inspectTracked(recorded.containerId, tracked.get(recorded.containerId)),
    }))

  const [ok, detail] = checkEmulatorsRule(probes, extraContainers, null, pending)
  check('emulators', ok, detail)
}

const state = readRunState(paths)
if (state.status === 'missing') {
  check('run', false, `No run state at ${paths.stateFile}. Run ${HELPER} launch.`)
} else if (state.status === 'invalid') {
  check('run', false, `${invalidMessage(state)}. Clean up and relaunch.`)
} else {
  check(
    'run',
    true,
    `${state.value.runId} launched ${state.value.launchedAt}${state.value.fresh ? ' (fresh)' : ''}${state.value.electron ? ' (electron)' : ''}${state.value.desktop ? ' (desktop)' : ''}${state.value.pin ? ' (PIN)' : ''}`,
  )
  if (checkProcesses(state.value)) {
    await checkApp(state.value)
  } else {
    check('app', false, "skipped: this run doesn't own its processes and ports, so its URL may be another server")
  }
}

await checkEmulators(state.status === 'ok' ? state.value : null)

const applied = readAppliedFaults(paths)
const faults = applied.status === 'ok' ? activeFaults(applied.value) : null
check(
  'faults',
  faults?.length === 0,
  faults === null
    ? `${paths.appliedFaultsFile} does not parse`
    : faults.length === 0
      ? 'none'
      : `${faults.join(', ')}; put them right with ${HELPER} fault <target> ok`,
)

const unserved = existsSync(paths.requestLog)
  ? readFileSync(paths.requestLog, 'utf8')
      .split('\n')
      .filter((line) => line.includes('UNHANDLED') || line.includes(' ERROR'))
  : []
check(
  'fake coverage',
  unserved.length === 0,
  unserved.length === 0 ? 'the fakes answered every request' : unserved.slice(0, 3).join('; '),
)

const output = checks.map(({ name, ok, detail }) => `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} ${detail}`).join('\n')
console.log(output)
const saveTo = args.save
if (saveTo !== undefined) {
  const logFile = (n: number): string => join(saveTo, `doctor-${n}.log`)
  const file = logFile(freeAttemptNumber(1, (n) => existsSync(logFile(n))))
  writeFileSync(file, `${new Date().toISOString()}\n${output}\n`, { flag: 'wx' })
  console.log(`Saved ${file}`)
}
process.exit(checks.every((item) => item.ok) ? 0 : 1)
