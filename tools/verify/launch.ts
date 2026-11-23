import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { readArgs } from './args'
import { VERIFY_PIN, sentinelClient, signIn } from './client'
import { ChildEnv, runToLog, startGroup } from './process'
import { launchDecision, webBuildEnv } from './rules'
import {
  EVIDENCE_ROOT,
  FakesRecordSchema,
  HELPER,
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
  readJsonFile,
  readRunState,
  recordProcess,
  requireJsonFile,
  runPaths,
  servesWebApp,
  stopProcess,
  verifyCapableBundleProblem,
  wait,
  writeJson,
} from './run'

// Starts Control Center for verification: the web app built into the run folder, served by Sentinel from source
// on a free port, against the local fakes on an empty data folder. Never touches `pnpm dev` or its data.
// With --desktop, Sentinel and the web app run as the desktop app does (`pnpm dev:desktop`), so Settings shows the
// desktop-only sections; there is no Electron shell. With --pin, PINs are on as on Umbrel, and launch sets the run's
// test PIN (VERIFY_PIN in client.ts), which the helper commands sign in with.

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
})
const runId = values.run ?? newRunId()
const fresh = values.fresh === true
const desktop = values.desktop === true
const pin = values.pin === true
const electron = values.electron === true
const appPath = values.app
const setupPinInUi = values['setup-pin-in-ui'] === true
const releaseTag = values['release-tag']

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
const decision = launchDecision({
  alive,
  folderExists: existsSync(paths.runDir),
  evidenceExists: existsSync(join(EVIDENCE_ROOT, runId)),
  fresh,
  desktop,
  pin,
  electron,
  setupPinInUi,
  releaseTag,
})
if (decision.action === 'running' && alive) {
  console.log(
    `Run ${runId} is already running at ${alive.url}${alive.fresh ? ' (fresh: no seed)' : ''}${alive.electron ? ' (electron)' : ''}${alive.desktop ? ' (desktop)' : ''}${alive.pin ? ' (PIN)' : ''}${alive.setupPinInUi ? ' (PIN setup in UI)' : ''}`,
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
let aborting = false

async function abort(message: string): Promise<never> {
  if (!aborting) {
    aborting = true
    for (const recorded of started) {
      await stopProcess(recorded)
    }
  }
  return fail(`${message}\nLogs: ${paths.logsDir}\nThen run ${HELPER} cleanup --run ${runId}`)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    void abort(`Launch was interrupted (${signal})`)
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
  recordProcess(paths, recorded)
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

const build = buildStamp()

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
      [`--user-data-dir=${userDataDir}`, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${cdpPort}`],
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
      sentinel: { ...electronProcess, port },
      fakes: { ...fakesProcess, ...fakes },
    }
    if (releaseTag !== undefined) {
      state.releaseTag = releaseTag
    }
    writeJson(paths.stateFile, state)
    console.log(`
Run ${runId} is ready (packaged macOS Electron)
  url:       ${url}
  cdp:       http://127.0.0.1:${cdpPort}
  userData:  ${userDataDir}
  downloads: ${downloadsDir}
  logs:      ${paths.logsDir}
  pin:       ${setupPinInUi ? 'unset (drive PIN setup in UI)' : `${VERIFY_PIN} (desktop)`}
Next: ${fresh || setupPinInUi ? '' : `${HELPER} seed --run ${runId}\n      `}${HELPER} doctor --run ${runId}`)
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
  writeJson(paths.stateFile, state)
  console.log(`
Run ${runId} is ready at ${url}${fresh ? ' (fresh: no seed)' : ''}${desktop ? ' (desktop)' : ''}${pin ? ` (PIN ${VERIFY_PIN})` : ''}
  data:  ${paths.dataDir}
  logs:  ${paths.logsDir}
Next: ${fresh ? '' : `${HELPER} seed --run ${runId}\n      `}${HELPER} doctor --run ${runId}`)
} catch (error) {
  await abort(`Launch failed: ${error instanceof Error ? error.message : String(error)}`)
}
