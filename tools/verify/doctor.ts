import { existsSync, readFileSync } from 'node:fs'
import { readArgs } from './args'
import { countAccounts, sentinelClient, signIn } from './client'
import { activeFaults } from './rules'
import {
  HELPER,
  type RunState,
  buildStamp,
  isOurProcess,
  listeners,
  portOwnedBy,
  readAppliedFaults,
  readRunState,
  readSeedMarker,
  runPaths,
  selectRunId,
  servesWebApp,
} from './run'

// Read-only: is this run worth driving? Every check runs, then the exit code is 1 if any failed.
// Usage: helpers/verify doctor [--run <id>]

interface Check {
  name: string
  ok: boolean
  detail: string
}

const paths = runPaths(selectRunId(readArgs({ run: { type: 'string' } }).values.run))
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

/** Process, port and build checks. True when the run's processes own their ports, so its URL is safe to call. */
function checkProcesses(state: RunState): boolean {
  const { sentinel, fakes } = state
  const alive = (ok: boolean, pid: number): string => (ok ? `PID ${pid}` : `PID ${pid} is not this run's process`)
  const sentinelOurs = isOurProcess(sentinel)
  const fakesOurs = isOurProcess(fakes)
  check('sentinel process', sentinelOurs, alive(sentinelOurs, sentinel.pid))
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
  const ports = [
    port('Sentinel', sentinel.port, sentinel.pid),
    port('Electrum', fakes.electrumPort, fakes.pid),
    port('mempool', fakes.mempoolPort, fakes.pid),
  ]
  const portsOk = ports.every(([ok]) => ok)
  check('ports', portsOk, ports.map(([, detail]) => detail).join(', '))

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
  await attempt('pin', async () => {
    const status = await client.auth.status.query()
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
    const marker = readSeedMarker(paths)
    if (state.fresh) {
      return marker.status === 'missing' && (await countAccounts(client)) === 0
        ? [true, 'fresh run: not seeded, no accounts']
        : [false, 'fresh run, but it has accounts or a seed']
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

const state = readRunState(paths)
if (state.status === 'missing') {
  check('run', false, `No run state at ${paths.stateFile}. Run ${HELPER} launch.`)
} else if (state.status === 'invalid') {
  check('run', false, `${state.file} does not parse. Clean up and relaunch.`)
} else {
  check(
    'run',
    true,
    `${state.value.runId} launched ${state.value.launchedAt}${state.value.fresh ? ' (fresh)' : ''}${state.value.desktop ? ' (desktop)' : ''}${state.value.pin ? ' (PIN)' : ''}`,
  )
  if (checkProcesses(state.value)) {
    await checkApp(state.value)
  } else {
    check('app', false, "skipped: this run doesn't own its processes and ports, so its URL may be another server")
  }
}

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

for (const { name, ok, detail } of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(16)} ${detail}`)
}
process.exit(checks.every((item) => item.ok) ? 0 : 1)
