import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { readArgs } from './args'
import { VERIFY_PIN, sentinelClient, signIn } from './client'
import { bridgeModeNow } from './emulators/ledger'
import { startLedger } from './emulators/ledger-launch'
import { describeBundle } from './evidence-record'
import { ChildEnv, runToLog, startGroup } from './process'
import { type LiveLedger, launchDecision, webBuildEnv } from './rules'
import {
  type BundleProvenance,
  EMULATOR_SEED_NAMES,
  EVIDENCE_ROOT,
  FakesRecordSchema,
  HELPER,
  LEDGER_MODELS,
  REPO_ROOT,
  type RecordedProcess,
  type RunState,
  boundPort,
  buildStamp,
  canonicalizePath,
  fail,
  isOurProcess,
  newRunId,
  portOwnedBy,
  processStartTime,
  readBundleProvenance,
  readJsonFile,
  readProcessesFile,
  readRunState,
  recordProcess,
  removeRunContainers,
  requireJsonFile,
  runPaths,
  servesWebApp,
  stopProcess,
  verifyCapableBundleProblem,
  wait,
  withRunLock,
  writeRunState,
} from './run'

// Starts Control Center for verification: the web app built into the run folder, served by Sentinel from source
// on a free port, against the local fakes on an empty data folder. Never touches `pnpm dev` or its data.
// With --desktop, Sentinel and the web app run as the desktop app does (`pnpm dev:desktop`), so Settings shows the
// desktop-only sections; there is no Electron shell. With --pin, PINs are on as on Umbrel, and launch sets the run's
// test PIN (VERIFY_PIN in client.ts), which the helper commands sign in with. With --emulator ledger, a Speculos Ledger
// and its bridge start too, and the app is opened at the bridge's drive URL, where it can reach the device.

const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx')
const VITE = join(REPO_ROOT, 'node_modules/.bin/vite')
const READY_TIMEOUT_MS = 90_000
const DEFAULT_MAC_APP = join(REPO_ROOT, 'desktop/release/mac-arm64/Bitcoin Control Center.app')
const CdpTargetListSchema = z.array(z.object({ type: z.string(), url: z.string() }))

const { values } = readArgs({
  run: { type: 'string' },
  fresh: { type: 'boolean' },
  desktop: { type: 'boolean' },
  pin: { type: 'boolean' },
  electron: { type: 'boolean' },
  app: { type: 'string' },
  'setup-pin-in-ui': { type: 'boolean' },
  'release-tag': { type: 'string' },
  emulator: { type: 'string' },
  'ledger-model': { type: 'string' },
  'emulator-seed': { type: 'string' },
  'auto-approve': { type: 'boolean' },
})
const runId = values.run ?? newRunId()
const fresh = values.fresh === true
const desktop = values.desktop === true
const pin = values.pin === true
const electron = values.electron === true
const appPath = values.app
const setupPinInUi = values['setup-pin-in-ui'] === true
const releaseTag = values['release-tag']
const emulator = values.emulator
const ledgerModel = values['ledger-model'] ?? 'flex'
const emulatorSeed = values['emulator-seed'] ?? 'primary'
const autoApprove = values['auto-approve'] === true

if (electron && desktop) {
  fail('--electron and --desktop do not combine.')
}
if (electron && pin) {
  fail('--electron and --pin do not combine: the packaged desktop app already enables desktop PINs.')
}
if (desktop && pin) {
  // The desktop app turns PINs on through its own launcher, which verify doesn't run.
  fail('--desktop and --pin do not combine: the desktop PIN needs the Electron shell.')
}
if ((appPath !== undefined || setupPinInUi || releaseTag !== undefined) && !electron) {
  fail('--app, --setup-pin-in-ui, and --release-tag require --electron.')
}
if (emulator !== undefined && emulator !== 'ledger') {
  fail(`--emulator ${emulator} is not available; only --emulator ledger is.`)
}
if (
  emulator === undefined &&
  (values['ledger-model'] !== undefined || values['emulator-seed'] !== undefined || autoApprove)
) {
  fail('--ledger-model, --emulator-seed and --auto-approve require --emulator ledger.')
}
if (emulator !== undefined && electron) {
  fail('--emulator does not combine with --electron yet: the packaged app reaches the Ledger in a later change.')
}
const model =
  LEDGER_MODELS.find((candidate) => candidate === ledgerModel) ??
  fail(`--ledger-model must be ${LEDGER_MODELS.join(' or ')}.`)
const seed =
  EMULATOR_SEED_NAMES.find((candidate) => candidate === emulatorSeed) ??
  fail(`--emulator-seed must be ${EMULATOR_SEED_NAMES.join(', ')}.`)
if (electron && process.platform !== 'darwin') {
  fail('--electron currently supports macOS (darwin) only.')
}
if (electron && appPath !== undefined) {
  const problem = verifyCapableBundleProblem(resolve(appPath))
  if (problem !== null) {
    fail(`Refusing --app bundle: ${problem}`)
  }
}

const paths = runPaths(runId)

const existing = requireJsonFile(readRunState(paths))
const alive = existing && isOurProcess(existing.sentinel) && isOurProcess(existing.fakes) ? existing : null

/** The live run's Ledger, with its bridge's mode as the bridge reports it now (a manual press turns auto off). */
async function liveLedger(state: RunState): Promise<LiveLedger> {
  const ledger = state.emulators?.find((entry) => entry.device === 'ledger')
  if (ledger === undefined) {
    return null
  }
  const { bridge } = ledger
  const live = { model: ledger.model ?? 'unknown', seed: ledger.seed }
  if (bridge === undefined) {
    return { ...live, mode: null }
  }
  const now = await bridgeModeNow(paths, bridge)
  return 'mode' in now ? { ...live, mode: now.mode } : { ...live, mode: 'unknown', problem: now.problem }
}

const decisionInput: Parameters<typeof launchDecision>[0] = {
  alive: alive === null ? null : { ...alive, ledger: await liveLedger(alive) },
  folderExists: existsSync(paths.runDir),
  evidenceExists: existsSync(join(EVIDENCE_ROOT, runId)),
  fresh,
  desktop,
  pin,
  electron,
  setupPinInUi,
  releaseTag,
}
if (emulator === 'ledger') {
  decisionInput.ledger = { model, seed, autoApprove }
}
const decision = launchDecision(decisionInput)
if (decision.action === 'running' && alive) {
  const drive = alive.emulators?.find((entry) => entry.bridge !== undefined)?.bridge?.url
  console.log(
    `Run ${runId} is already running at ${alive.url}${alive.fresh ? ' (fresh: no seed)' : ''}${alive.electron ? ' (electron)' : ''}${alive.desktop ? ' (desktop)' : ''}${alive.pin ? ' (PIN)' : ''}${alive.setupPinInUi ? ' (PIN setup in UI)' : ''}${drive === undefined ? '' : `; open ${drive} to reach its Ledger`}`,
  )
  process.exit(0)
}
if (decision.action === 'refuse') {
  fail(
    `Run ${runId} ${decision.reason}${alive === null && existsSync(paths.runDir) ? ` Run ${HELPER} cleanup --run ${runId}.` : ''}`,
  )
}
mkdirSync(paths.dataDir, { recursive: true })
mkdirSync(paths.logsDir, { recursive: true })

const started: RecordedProcess[] = []
let aborting: Promise<never> | null = null

/** Stops what the run started and exits 1. A second call, as from a repeated Ctrl-C, waits for the first. */
async function abort(message: string): Promise<never> {
  aborting ??= stopEverything(message)
  return aborting
}

async function stopEverything(message: string): Promise<never> {
  // Every process recorded for the run, the Ledger bridge included, and those launch started itself.
  const recorded = readProcessesFile(paths)
  for (const recordedProcess of [...(recorded.status === 'ok' ? recorded.value : []), ...started]) {
    await stopProcess(recordedProcess)
  }
  // Containers recorded for the run (none yet in a plain launch) are removed too, each on its own daemon.
  if (existsSync(paths.runDir)) {
    try {
      const { errors } = await withRunLock(paths, (tracking) => removeRunContainers(paths, tracking, {}))
      for (const error of errors) {
        console.error(error)
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error))
    }
  }
  return fail(`${message}\nLogs: ${paths.logsDir}\nThen run ${HELPER} cleanup --run ${runId}`)
}

// Kept for the whole launch, so a second Ctrl-C can't kill launch halfway through stopping what it started. tsx
// SIGKILLs launch unless launch acknowledges a signal within about 60 ms; its acknowledgement goes out once the event
// loop turns, so the abort, whose first steps block, waits for that turn.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    setTimeout(() => {
      void abort(`Launch was interrupted (${signal})`)
    }, 10)
  })
}

async function startProcess(
  name: string,
  command: string,
  args: string[],
  cwd: string,
  env: ChildEnv,
): Promise<RecordedProcess> {
  const log = openSync(join(paths.logsDir, `${name}.log`), 'a')
  const { pid } = startGroup(command, args, { cwd, env, log })
  const startedAt = pid === undefined ? null : processStartTime(pid)
  if (pid === undefined || startedAt === null) {
    return abort(`${name} did not start`)
  }
  const recorded = { name, pid, startedAt }
  started.push(recorded)
  await recordProcess(paths, recorded)
  return recorded
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => {
    server.listen(0, '127.0.0.1', done)
  })
  const port = boundPort(server.address())
  await new Promise<void>((done) => {
    server.close(() => {
      done()
    })
  })
  return port
}

async function until<T>(what: string, check: () => Promise<T | null>, guard?: () => Promise<void>): Promise<T> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
    if (guard !== undefined) {
      await guard()
    }
    const value = await check().catch(() => null)
    if (value !== null) {
      return value
    }
    if (Date.now() > deadline) {
      return abort(`Timed out waiting for ${what}`)
    }
    await wait(500)
  }
}

function readPortFile(file: string): number | null {
  if (!existsSync(file)) {
    return null
  }
  const parsed = Number(readFileSync(file, 'utf8').trim())
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535 ? parsed : null
}

async function hasPageTarget(cdpPort: number, origin: string): Promise<boolean> {
  const response = await fetch(`http://127.0.0.1:${cdpPort}/json/list`)
  if (!response.ok) {
    return false
  }
  const parsed = parseUnknown(CdpTargetListSchema, await response.json())
  return parsed.isOk() && parsed.unwrap().some((target) => target.type === 'page' && target.url.startsWith(origin))
}

// A terminal's Ctrl-C kills git too, and buildStamp throws. Yield first, so the signal is acknowledged (see above) and
// its handler names it.
let build: RunState['build']
try {
  build = buildStamp()
} catch (error) {
  await wait(100)
  build = await abort(
    `Launch was interrupted or git failed while stamping the build: ${error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)}`,
  )
}

if (electron) {
  let sourceApp: string
  if (appPath !== undefined) {
    sourceApp = resolve(appPath)
    const problem = verifyCapableBundleProblem(sourceApp)
    if (problem !== null) {
      await abort(`Refusing --app bundle: ${problem}`)
    }
    console.log(`Run ${runId}: using existing app bundle ${sourceApp}`)
  } else {
    console.log(`Run ${runId}: packaging the macOS Electron app`)
    const desktopBuildLog = openSync(join(paths.logsDir, 'desktop-build.log'), 'a')
    try {
      runToLog('/bin/bash', [join(REPO_ROOT, 'desktop/build.sh'), '--mac-dir'], {
        cwd: REPO_ROOT,
        env: ChildEnv.with(),
        log: desktopBuildLog,
      })
    } catch {
      await abort(`The macOS Electron app did not build. See ${join(paths.logsDir, 'desktop-build.log')}`)
    }
    sourceApp = DEFAULT_MAC_APP
    const problem = verifyCapableBundleProblem(sourceApp)
    if (problem !== null) {
      await abort(`Built app bundle is not verify-capable: ${problem}`)
    }
  }

  mkdirSync(paths.appDir, { recursive: true })
  const copiedApp = join(paths.appDir, 'Bitcoin Control Center.app')
  const copyLog = openSync(join(paths.logsDir, 'desktop-copy.log'), 'a')
  try {
    runToLog('ditto', [sourceApp, copiedApp], { cwd: REPO_ROOT, env: ChildEnv.with(), log: copyLog })
  } catch {
    await abort(`Could not copy ${sourceApp} into ${copiedApp}. See ${join(paths.logsDir, 'desktop-copy.log')}`)
  }
  // Read from the copy, the bundle that actually runs.
  const bundle: BundleProvenance = {
    origin: appPath === undefined ? 'built' : 'app',
    source: sourceApp,
    ...(readBundleProvenance(copiedApp) ?? { release: null, commit: null, dirty: null }),
  }

  const userDataDir = canonicalizePath(join(paths.runDir, 'user-data'))
  const dataDir = join(userDataDir, 'data')
  const downloadsDir = canonicalizePath(join(paths.runDir, 'downloads'))
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(downloadsDir, { recursive: true })

  try {
    console.log('Starting the fake Electrum and mempool servers')
    const fakesArgs = ['--tsconfig', 'tools/verify/tsconfig.json', 'tools/verify/fakes.ts', '--run', runId]
    if (releaseTag !== undefined) {
      fakesArgs.push('--release-tag', releaseTag)
    }
    const fakesProcess = await startProcess('fakes', TSX, fakesArgs, REPO_ROOT, ChildEnv.with())
    const fakes = await until('the fakes to listen', async () => {
      const record = readJsonFile(FakesRecordSchema, paths.fakesFile)
      return record.status === 'ok' ? record.value : null
    })

    const cdpPort = await freePort()
    const verifyConfigFile = join(paths.runDir, 'verify-config.json')
    interface LaunchVerifyConfig {
      userDataDir: string
      electrum: { host: '127.0.0.1'; port: number; protocol: 'tcp' }
      mempoolApiUrl: string
      disableReleaseCheck: boolean
      releaseCheckUrl?: string
      downloadsDir: string
    }
    const verifyConfig: LaunchVerifyConfig = {
      userDataDir,
      electrum: { host: '127.0.0.1', port: fakes.electrumPort, protocol: 'tcp' },
      mempoolApiUrl: `http://127.0.0.1:${fakes.mempoolPort}`,
      disableReleaseCheck: releaseTag === undefined,
      downloadsDir,
    }
    if (releaseTag !== undefined) {
      verifyConfig.releaseCheckUrl = `http://127.0.0.1:${fakes.mempoolPort}/latest.json`
    }
    writeFileSync(verifyConfigFile, `${JSON.stringify(verifyConfig, null, 2)}\n`, { mode: 0o600 })

    console.log('Starting the packaged Electron app')
    const electronBin = join(copiedApp, 'Contents/MacOS/Bitcoin Control Center')
    const electronProcess = await startProcess(
      'electron',
      electronBin,
      [
        `--user-data-dir=${userDataDir}`,
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${cdpPort}`,
        // A window another window covers, or any window while the display sleeps, stops drawing frames. Animations then
        // never finish, and a driver waiting for a control to settle waits forever. Verify windows keep drawing.
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
      ],
      REPO_ROOT,
      ChildEnv.with({ BCC_VERIFY_CONFIG: verifyConfigFile }),
    )

    const electronAlive = async (): Promise<void> => {
      if (!isOurProcess(electronProcess)) {
        await abort(`Electron exited during startup. See ${join(paths.logsDir, 'electron.log')}`)
      }
    }

    const portFile = join(userDataDir, 'port')
    const port = await until(
      'Electron Sentinel port',
      async () => {
        const candidate = readPortFile(portFile)
        return candidate !== null && portOwnedBy(candidate, electronProcess.pid) ? candidate : null
      },
      electronAlive,
    )
    const url = `http://127.0.0.1:${port}`
    const client = sentinelClient(url)
    await until('Sentinel /health', async () => ((await fetch(`${url}/health`)).ok ? true : null), electronAlive)
    await until('the packaged web app', async () => ((await servesWebApp(url)) ? true : null), electronAlive)
    await until(
      'Electron CDP page target',
      async () => (portOwnedBy(cdpPort, electronProcess.pid) && (await hasPageTarget(cdpPort, url)) ? true : null),
      electronAlive,
    )

    if (setupPinInUi) {
      const authStatus = await client.auth.status.query()
      if (authStatus.platform !== 'desktop' || authStatus.state !== 'no-pin') {
        const stateText = authStatus.platform === null ? 'off' : authStatus.state
        await abort(
          `Expected desktop PIN setup state (no-pin), got platform=${authStatus.platform ?? 'null'} state=${stateText}`,
        )
      }
    } else {
      await signIn(client, true)
      await until(
        'Electrum to connect',
        async () => ((await client.portalProve.settings.electrumStatus.query()).connected ? true : null),
        electronAlive,
      )
      await client.portalProve.price.setSettings.mutate({ source: 'mempool', fallbacks: false })
    }

    const state: RunState = {
      runId,
      launchedAt: new Date().toISOString(),
      fresh,
      desktop: false,
      electron: true,
      setupPinInUi,
      pin: false,
      build,
      url,
      cdpPort,
      userDataDir,
      dataDir,
      downloadsDir,
      appBundle: copiedApp,
      bundle,
      sentinel: { ...electronProcess, port },
      fakes: { ...fakesProcess, ...fakes },
    }
    if (releaseTag !== undefined) {
      state.releaseTag = releaseTag
    }
    await writeRunState(paths, state)
    console.log(`
Run ${runId} is ready (packaged macOS Electron)
  bundle:    ${describeBundle(bundle, build.commit)}
  url:       ${url}
  cdp:       http://127.0.0.1:${cdpPort}
  userData:  ${userDataDir}
  downloads: ${downloadsDir}
  logs:      ${paths.logsDir}
  pin:       ${setupPinInUi ? 'unset (drive PIN setup in UI)' : `${VERIFY_PIN} (desktop)`}
Next: ${setupPinInUi ? `set PIN ${VERIFY_PIN} in the app\n      ` : ''}${fresh ? '' : `${HELPER} seed --run ${runId}\n      `}${HELPER} doctor --run ${runId}`)
  } catch (error) {
    await abort(`Launch failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exit(0)
}

console.log(`Run ${runId}: building the web app`)
const buildLog = openSync(join(paths.logsDir, 'ui-build.log'), 'a')
try {
  runToLog(
    VITE,
    ['build', '--mode', 'production.sentinel', '--outDir', join(paths.appDir, 'public'), '--emptyOutDir'],
    {
      cwd: join(REPO_ROOT, 'apps/control-center'),
      env: webBuildEnv(desktop),
      log: buildLog,
    },
  )
} catch {
  await abort(`The web app did not build. See ${join(paths.logsDir, 'ui-build.log')}`)
}

// From here on processes are running, so any failure stops them before exiting.
try {
  console.log('Starting the fake Electrum and mempool servers')
  const fakesProcess = await startProcess(
    'fakes',
    TSX,
    ['--tsconfig', 'tools/verify/tsconfig.json', 'tools/verify/fakes.ts', '--run', runId],
    REPO_ROOT,
    ChildEnv.with(),
  )
  const fakes = await until('the fakes to listen', async () => {
    const record = readJsonFile(FakesRecordSchema, paths.fakesFile)
    return record.status === 'ok' ? record.value : null
  })

  console.log('Starting Sentinel')
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  // Only these variables reach Sentinel, so the caller's PIN, proxy or host settings can't change the run.
  const sentinelVars = {
    // tsx hands its --tsconfig to child processes; Sentinel needs its own.
    TSX_TSCONFIG_PATH: join(REPO_ROOT, 'apps/api-sentinel/tsconfig.json'),
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    DATA_DIR: paths.dataDir,
    APP_DIR: paths.appDir,
    ELECTRUM_HOST: '127.0.0.1',
    ELECTRUM_PORT: String(fakes.electrumPort),
    ELECTRUM_PROTOCOL: 'tcp',
    BITCOIN_NETWORK: 'mainnet',
    MEMPOOL_API_URL: `http://127.0.0.1:${fakes.mempoolPort}`,
    LOG_LEVEL: 'info',
  }
  const sentinelEnv = ChildEnv.with(pin ? { ...sentinelVars, SENTINEL_PIN: 'umbrel' } : sentinelVars)
  const sentinelProcess = await startProcess(
    'sentinel',
    TSX,
    desktop ? ['src/cli.ts', '--desktop'] : ['src/cli.ts'],
    join(REPO_ROOT, 'apps/api-sentinel'),
    sentinelEnv,
  )

  // Ready means usable: the API answers, the web app is served, and Sentinel reached the fake Electrum.
  const client = sentinelClient(url)
  await until('Sentinel /health', async () => ((await fetch(`${url}/health`)).ok ? true : null))
  await until('the web app', async () => ((await servesWebApp(url)) ? true : null))
  if (pin) {
    await signIn(client, true)
  }
  await until('Electrum to connect', async () =>
    (await client.portalProve.settings.electrumStatus.query()).connected ? true : null,
  )

  // The fake mempool is the only price source; with fallbacks off, prices never come from a public service.
  await client.portalProve.price.setSettings.mutate({ source: 'mempool', fallbacks: false })

  const state: RunState = {
    runId,
    launchedAt: new Date().toISOString(),
    fresh,
    desktop,
    electron: false,
    setupPinInUi: false,
    pin,
    build,
    url,
    sentinel: { ...sentinelProcess, port },
    fakes: { ...fakesProcess, ...fakes },
  }
  await writeRunState(paths, state)
  let ledger = ''
  if (emulator === 'ledger') {
    const ledgerStart = await startLedger(paths, {
      model,
      seed,
      bridge: { mode: autoApprove ? 'auto' : 'manual', target: url },
    })
    const { bridge } = ledgerStart.isErr()
      ? await abort(`The Ledger emulator did not start: ${ledgerStart.unwrapErr()}`)
      : ledgerStart.unwrap()
    ledger = `\n  ledger: ${model}, seed ${seed}, ${autoApprove ? 'auto-approve' : 'manual'}${bridge === undefined ? '' : `\n  open:  ${bridge.url} (reaches the Ledger; ${url} does not)`}`
  }
  console.log(`
Run ${runId} is ready at ${url}${fresh ? ' (fresh: no seed)' : ''}${desktop ? ' (desktop)' : ''}${pin ? ` (PIN ${VERIFY_PIN})` : ''}
  data:  ${paths.dataDir}
  logs:  ${paths.logsDir}${ledger}
Next: ${fresh ? '' : `${HELPER} seed --run ${runId}\n      `}${HELPER} doctor --run ${runId}`)
} catch (error) {
  await abort(`Launch failed: ${error instanceof Error ? error.message : String(error)}`)
}
