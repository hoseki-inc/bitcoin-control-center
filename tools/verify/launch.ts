import { existsSync, mkdirSync, openSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { readArgs } from './args'
import { sentinelClient } from './client'
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
  fail,
  isOurProcess,
  newRunId,
  processStartTime,
  readJsonFile,
  readRunState,
  recordProcess,
  requireJsonFile,
  runPaths,
  servesWebApp,
  stopProcess,
  wait,
  writeJson,
} from './run'

// Starts Control Center for verification: the web app built into the run folder, served by Sentinel from source
// on a free port, against the local fakes on an empty data folder. Never touches `pnpm dev` or its data.
// Usage: helpers/verify launch [--run <id>] [--fresh]

const TSX = join(REPO_ROOT, 'node_modules/.bin/tsx')
const VITE = join(REPO_ROOT, 'node_modules/.bin/vite')
const READY_TIMEOUT_MS = 90_000

const { values } = readArgs({ run: { type: 'string' }, fresh: { type: 'boolean' } })
const runId = values.run ?? newRunId()
const fresh = values.fresh === true
const paths = runPaths(runId)

const existing = requireJsonFile(readRunState(paths))
const alive = existing && isOurProcess(existing.sentinel) && isOurProcess(existing.fakes) ? existing : null
const decision = launchDecision({
  alive,
  folderExists: existsSync(paths.runDir),
  evidenceExists: existsSync(join(EVIDENCE_ROOT, runId)),
  fresh,
})
if (decision.action === 'running' && alive) {
  console.log(`Run ${runId} is already running at ${alive.url}${alive.fresh ? ' (fresh: no seed)' : ''}`)
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

async function until<T>(what: string, check: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  for (;;) {
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

const build = buildStamp()

console.log(`Run ${runId}: building the web app`)
const buildLog = openSync(join(paths.logsDir, 'ui-build.log'), 'a')
try {
  runToLog(
    VITE,
    ['build', '--mode', 'production.sentinel', '--outDir', join(paths.appDir, 'public'), '--emptyOutDir'],
    {
      cwd: join(REPO_ROOT, 'apps/control-center'),
      env: webBuildEnv(),
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
  const sentinelEnv = ChildEnv.with({
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
  })
  const sentinelProcess = await startProcess(
    'sentinel',
    TSX,
    ['src/cli.ts'],
    join(REPO_ROOT, 'apps/api-sentinel'),
    sentinelEnv,
  )

  // Ready means usable: the API answers, the web app is served, and Sentinel reached the fake Electrum.
  const client = sentinelClient(url)
  await until('Sentinel /health', async () => ((await fetch(`${url}/health`)).ok ? true : null))
  await until('the web app', async () => ((await servesWebApp(url)) ? true : null))
  await until('Electrum to connect', async () =>
    (await client.settings.electrumStatus.query()).connected ? true : null,
  )

  // The fake mempool is the only price source; with fallbacks off, prices never come from a public service.
  await client.portalProve.price.setSettings.mutate({ source: 'mempool', fallbacks: false })

  const state: RunState = {
    runId,
    launchedAt: new Date().toISOString(),
    fresh,
    build,
    url,
    sentinel: { ...sentinelProcess, port },
    fakes: { ...fakesProcess, ...fakes },
  }
  writeJson(paths.stateFile, state)
  console.log(`
Run ${runId} is ready at ${url}${fresh ? ' (fresh: no seed)' : ''}
  data:  ${paths.dataDir}
  logs:  ${paths.logsDir}
Next: ${fresh ? '' : `${HELPER} seed --run ${runId}\n      `}${HELPER} doctor --run ${runId}`)
} catch (error) {
  await abort(`Launch failed: ${error instanceof Error ? error.message : String(error)}`)
}
