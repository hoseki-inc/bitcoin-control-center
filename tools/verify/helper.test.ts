import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { describe, it } from 'vitest'
import { z } from 'zod'
import { ChildEnv, runAsync, runToLog } from './process'
import {
  type EmulatorState,
  HELPER,
  REPO_ROOT,
  type RecordedContainer,
  type RunState,
  boundPort,
  writeJson,
} from './run'

const CID_1 = '1'.repeat(64)
const CID_2 = '2'.repeat(64)

interface HelperResult {
  output: string
  failed: boolean
}

/** Runs the helper as an agent would and returns what it printed and whether it failed. */
function helper(args: string[], extra: Readonly<Record<string, string>> = {}): HelperResult {
  const dir = mkdtempSync(join(tmpdir(), 'verify-helper-'))
  try {
    return helperIn(dir, args, extra)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function helperIn(dir: string, args: string[], extra: Readonly<Record<string, string>> = {}): HelperResult {
  const logFile = join(dir, `out-${Math.random().toString(36).slice(2)}.log`)
  const log = openSync(logFile, 'w')
  let failed = false
  try {
    // Runs live under the temp folder, so the helper gets this test's own: it can never touch a real run.
    runToLog(join(REPO_ROOT, HELPER), args, { cwd: REPO_ROOT, env: ChildEnv.with({ TMPDIR: dir, ...extra }), log })
  } catch {
    failed = true
  } finally {
    closeSync(log)
  }
  return { output: readFileSync(logFile, 'utf8'), failed }
}

async function helperInAsync(
  dir: string,
  args: string[],
  extra: Readonly<Record<string, string>> = {},
): Promise<HelperResult> {
  const result = await runAsync(join(REPO_ROOT, HELPER), args, {
    cwd: REPO_ROOT,
    env: ChildEnv.with({ TMPDIR: dir, ...extra }),
  })
  return { output: `${result.stdout}${result.stderr}`, failed: result.code !== 0 }
}

function runDirIn(tmpRoot: string, runId: string): string {
  const checkoutHash = createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8)
  return join(tmpRoot, 'bcc-verify', checkoutHash, runId)
}

/** A simulated Docker installation: which daemon answers at each endpoint, and what each daemon runs. */
const FakeDockerWorldSchema = z.object({
  /** The daemon answering at each endpoint; a missing or null entry refuses connections. */
  endpoints: z.record(z.string(), z.string().nullable()),
  contexts: z.record(z.string(), z.string()),
  currentContext: z.string(),
  daemons: z.record(
    z.string(),
    z.object({
      containers: z.record(z.string(), z.enum(['running', 'stopped'])),
      rm: z.enum(['ok', 'fail']).optional(),
    }),
  ),
  /** After the next `info` at this endpoint, another daemon starts answering there. */
  switchAfterInfo: z.object({ endpoint: z.string(), daemon: z.string() }).optional(),
})
type FakeDockerWorld = z.infer<typeof FakeDockerWorldSchema>

const DockerCallSchema = z.object({
  args: z.string(),
  DOCKER_HOST: z.string(),
  DOCKER_CONTEXT: z.string(),
  DOCKER_CONFIG: z.string(),
  /** The daemon that answered, or null when none did. */
  daemon: z.string().nullable(),
})
type DockerCall = z.infer<typeof DockerCallSchema>

interface FakeDocker {
  pathEnv: string
  setWorld: (update: (world: FakeDockerWorld) => void) => void
  world: () => FakeDockerWorld
  readCalls: () => DockerCall[]
}

const ENDPOINT_A = 'unix:///fake/a.sock'
const ENDPOINT_B = 'unix:///fake/b.sock'
const DAEMON_A = { daemonId: 'daemon-a', context: 'local-a', endpoint: ENDPOINT_A, dockerConfig: '/fake/a-config' }

function baseWorld(containers: Record<string, 'running' | 'stopped'> = {}): FakeDockerWorld {
  return {
    endpoints: { [ENDPOINT_A]: 'daemon-a', [ENDPOINT_B]: 'daemon-b' },
    contexts: { 'local-a': ENDPOINT_A, 'local-b': ENDPOINT_B },
    currentContext: 'local-a',
    daemons: { 'daemon-a': { containers }, 'daemon-b': { containers: {} } },
  }
}

/**
 * A `docker` executable on PATH that resolves its daemon as the real CLI does (DOCKER_HOST, then DOCKER_CONTEXT, then
 * the current context), logs every call with the Docker variables it got, and answers info, inspect and rm. Like
 * Docker 29, `rm -f` of an ID its daemon doesn't have exits 0 and prints nothing.
 */
function createFakeDocker(root: string, initial: FakeDockerWorld): FakeDocker {
  const binDir = join(root, 'fake-bin')
  const logFile = join(root, 'docker-calls.jsonl')
  const worldFile = join(root, 'docker-world.json')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(worldFile, JSON.stringify(initial))

  const script = `#!${process.execPath}
const fs = require('node:fs')
const world = JSON.parse(fs.readFileSync(${JSON.stringify(worldFile)}, 'utf8'))
const args = process.argv.slice(2)
const vars = { DOCKER_HOST: process.env.DOCKER_HOST || '', DOCKER_CONTEXT: process.env.DOCKER_CONTEXT || '', DOCKER_CONFIG: process.env.DOCKER_CONFIG || '' }
const endpoint = vars.DOCKER_HOST || world.contexts[vars.DOCKER_CONTEXT || world.currentContext]
const daemonId = (endpoint && world.endpoints[endpoint]) || null
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ args: args.join(' '), ...vars, daemon: daemonId }) + '\\n')
const done = (code, out, err) => { if (out) process.stdout.write(out + '\\n'); if (err) process.stderr.write(err + '\\n'); process.exit(code) }
const is = (...expected) => expected.length === args.length && expected.every((part, i) => part === null || part === args[i])
if (is('context', 'show')) done(0, world.currentContext)
if (daemonId === null) done(1, '', 'Cannot connect to the Docker daemon at ' + endpoint + '. Is the docker daemon running?')
const daemon = world.daemons[daemonId]
if (is('info', '--format', '{{.ID}}')) {
  const next = world.switchAfterInfo
  if (next && next.endpoint === endpoint) {
    world.endpoints[endpoint] = next.daemon
    delete world.switchAfterInfo
    fs.writeFileSync(${JSON.stringify(worldFile)}, JSON.stringify(world))
  }
  done(0, daemonId)
}
if (is('inspect', '--type', 'container', '-f', '{{.State.Running}}', '--', null)) {
  const state = daemon.containers[args[6]]
  if (state === undefined) done(1, '', 'Error response from daemon: No such container: ' + args[6])
  done(0, state === 'running' ? 'true' : 'false')
}
if (is('rm', '-f', '--', null)) {
  if (daemon.rm === 'fail') done(1, '', 'Cannot connect to the Docker daemon at ' + endpoint + '. Is the docker daemon running?')
  if (daemon.containers[args[3]] === undefined) done(0)
  delete daemon.containers[args[3]]
  fs.writeFileSync(${JSON.stringify(worldFile)}, JSON.stringify(world))
  done(0, args[3])
}
done(99, '', 'unexpected docker command: ' + args.join(' '))
`
  const dockerPath = join(binDir, 'docker')
  writeFileSync(dockerPath, script)
  chmodSync(dockerPath, 0o755)
  const basePath = ChildEnv.with().vars['PATH'] ?? ''
  const world = (): FakeDockerWorld =>
    parseUnknown(FakeDockerWorldSchema, JSON.parse(readFileSync(worldFile, 'utf8'))).expect('fake Docker world')
  return {
    pathEnv: `${binDir}${delimiter}${basePath}`,
    setWorld: (update) => {
      const next = world()
      update(next)
      writeFileSync(worldFile, JSON.stringify(next))
    },
    world,
    readCalls: () =>
      existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
            .map((line) => parseUnknown(DockerCallSchema, JSON.parse(line)).expect('fake Docker call log'))
        : [],
  }
}

interface AttributedRun {
  result: HelperResult
  calls: DockerCall[]
}

/** The Docker calls made while `run` ran. */
function callsDuring(fakeDocker: FakeDocker, run: () => HelperResult): AttributedRun {
  const before = fakeDocker.readCalls().length
  const result = run()
  return { result, calls: fakeDocker.readCalls().slice(before) }
}

/** Asserts every recorded Docker invocation is allowlisted: the daemon's ID, or inspect or rm -f of a recorded ID. */
function assertDockerCallsAllowlisted(calls: readonly DockerCall[], allowedIds: ReadonlySet<string>): void {
  const inspectRe = /^inspect --type container -f \{\{\.State\.Running\}\} -- ([0-9a-f]{64})$/
  const rmRe = /^rm -f -- ([0-9a-f]{64})$/
  for (const { args } of calls) {
    assert.doesNotMatch(args, /\b(?:ps|ls|prune)\b|--filter/)
    if (args === 'info --format {{.ID}}') {
      continue
    }
    const id = (inspectRe.exec(args) ?? rmRe.exec(args))?.[1]
    assert.ok(id !== undefined, `Disallowed Docker call: ${args}`)
    assert.equal(allowedIds.has(id), true, `Docker called for unrecorded container ID: ${id}`)
  }
}

const pinnedTo = (daemon: typeof DAEMON_A): Pick<DockerCall, 'DOCKER_HOST' | 'DOCKER_CONTEXT' | 'DOCKER_CONFIG'> => ({
  DOCKER_HOST: daemon.endpoint,
  DOCKER_CONTEXT: '',
  DOCKER_CONFIG: daemon.dockerConfig,
})

function containerRecord(name: string, containerId: string, daemon?: typeof DAEMON_A): RecordedContainer {
  const record: RecordedContainer = {
    name,
    containerId,
    image: 'ghcr.io/ledgerhq/speculos:test',
    startedAt: '2026-11-25T17:00:00Z',
  }
  if (daemon !== undefined) {
    record.daemon = daemon
  }
  return record
}

function runStateRecord(runId: string, emulators: EmulatorState[] = []): RunState {
  const state: RunState = {
    runId,
    launchedAt: '2026-11-25T17:00:00Z',
    fresh: false,
    desktop: false,
    electron: false,
    setupPinInUi: false,
    pin: false,
    build: { commit: 'abc', tree: 't', dirty: false },
    url: 'http://127.0.0.1:4000',
    sentinel: { name: 'sentinel', pid: 999_999, startedAt: 'never', port: 4000 },
    fakes: { name: 'fakes', pid: 999_998, startedAt: 'never', electrumPort: 4001, mempoolPort: 4002 },
  }
  if (emulators.length > 0) {
    state.emulators = emulators
  }
  return state
}

describe('helpers/verify', () => {
  it("uses the caller's TMP when TMPDIR isn't set, as Node does", () => {
    const tmp = mkdtempSync(join(tmpdir(), 'verify-tmp-'))
    try {
      const { output } = helper(['cleanup', '--run', 'no-such-run'], { TMPDIR: '', TMP: tmp })
      assert.match(output, new RegExp(`Removed ${tmp}/bcc-verify/`))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  it("starts the scripts without the caller's NODE_OPTIONS or proxy settings", () => {
    const { output } = helper(['query', '--run', 'no-such-run', '--sql', 'SELECT 1'], {
      NODE_OPTIONS: '--require /no-such-hook.js',
      NODE_USE_ENV_PROXY: '1',
      HTTP_PROXY: 'http://127.0.0.1:9',
    })
    assert.doesNotMatch(output, /no-such-hook/)
  })

  it('refuses a flag without its value instead of picking a run', () => {
    const { output, failed } = helper(['cleanup', '--run'])
    assert.equal(failed, true)
    assert.match(output, /argument missing/)
  })

  it('refuses a retired or unknown flag', () => {
    const { output, failed } = helper(['evidence', 'record', 'statements', '--sub', 'listed', '--run', 'no-such-run'])
    assert.equal(failed, true)
    assert.match(output, /Unknown option '--sub'/)
  })

  it('reads --run=ID as that run', () => {
    const { output } = helper(['doctor', '--run=no-such-run'])
    assert.match(output, /no-such-run/)
  })

  it('validates emulator CLI flags, treats BCC_VERIFY_CACHE_DIR as cache root, rejects relative cache paths, and makes zero Docker calls', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-emu-cli-'))
    try {
      const fakeDocker = createFakeDocker(dir, baseWorld())
      const env = { PATH: fakeDocker.pathEnv }

      const bad = helperIn(dir, ['emulator', 'bogus'], env)
      assert.equal(bad.failed, true)
      assert.match(bad.output, /Expected emulator action/)

      const missingDevice = helperIn(dir, ['emulator', 'press'], env)
      assert.equal(missingDevice.failed, true)
      assert.match(missingDevice.output, /--device is required/)

      const startLedger = helperIn(dir, ['emulator', 'start', '--device', 'ledger'], {
        ...env,
        BCC_VERIFY_CACHE_DIR: '/tmp/bcc-test-cache-root',
      })
      assert.equal(startLedger.failed, true)
      assert.match(startLedger.output, /Ledger emulator runner is not implemented yet/)
      assert.match(startLedger.output, /model: flex/)
      assert.match(startLedger.output, /seed: primary/)
      assert.match(startLedger.output, /\/tmp\/bcc-test-cache-root\/ledger-elfs/)

      const relativeCache = helperIn(dir, ['emulator', 'start', '--device', 'ledger'], {
        ...env,
        BCC_VERIFY_CACHE_DIR: './relative-cache',
      })
      assert.equal(relativeCache.failed, true)
      assert.match(relativeCache.output, /BCC_VERIFY_CACHE_DIR must be an absolute path/)

      const emptyDoctor = helperIn(dir, ['doctor', '--run', 'empty-run'], env)
      assert.match(emptyDoctor.output, /PASS\s+emulators\s+none/)

      mkdirSync(runDirIn(dir, 'empty-cleanup-run'), { recursive: true })
      const emptyStop = helperIn(dir, ['emulator', 'stop', '--run', 'empty-cleanup-run', '--device', 'ledger'], env)
      assert.equal(emptyStop.failed, false)
      assert.match(emptyStop.output, /No ledger emulator recorded/)
      const emptyCleanup = helperIn(dir, ['cleanup', '--run', 'empty-cleanup-run'], env)
      assert.equal(emptyCleanup.failed, false)
      assert.equal(existsSync(runDirIn(dir, 'empty-cleanup-run')), false)

      // Neither skeleton start, nor doctor, stop or cleanup on an empty run may invoke Docker, not even docker info.
      assert.deepEqual(fakeDocker.readCalls(), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('pins Docker calls to the recorded daemon, attributes each removal to its command, and forwards DOCKER_* for unpinned records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-cli-'))
    try {
      const callerSocket = 'unix:///tmp/colima.sock'
      const fakeDocker = createFakeDocker(dir, {
        ...baseWorld({ [CID_1]: 'stopped', [CID_2]: 'stopped' }),
        endpoints: { [ENDPOINT_A]: 'daemon-a', [callerSocket]: 'daemon-a' },
      })
      const runDir = runDirIn(dir, 'docker-test-run')
      mkdirSync(runDir, { recursive: true })
      // CID_2 is an older record without its daemon: only the caller's own Docker settings can reach it.
      writeJson(join(runDir, 'containers.json'), [
        containerRecord('emulator:ledger', CID_1, DAEMON_A),
        containerRecord('emulator:trezor', CID_2),
      ])

      const callerEnv = {
        PATH: fakeDocker.pathEnv,
        DOCKER_HOST: callerSocket,
        DOCKER_CONTEXT: 'local-b',
        DOCKER_CONFIG: '/tmp/colima-config',
      }
      const fromCaller = { DOCKER_HOST: callerSocket, DOCKER_CONTEXT: 'local-b', DOCKER_CONFIG: '/tmp/colima-config' }

      const doctorStopped = helperIn(dir, ['doctor', '--run', 'docker-test-run'], callerEnv)
      assert.equal(doctorStopped.failed, true)
      assert.match(doctorStopped.output, new RegExp(`FAIL\\s+emulators\\s+.*${CID_1}.*not running`))

      // Even if inspect says running, an unregistered container only in containers.json must FAIL doctor.
      fakeDocker.setWorld((world) => {
        world.daemons['daemon-a'] = { containers: { [CID_1]: 'running', [CID_2]: 'running' } }
      })
      const doctorUnregistered = helperIn(dir, ['doctor', '--run', 'docker-test-run'], callerEnv)
      assert.equal(doctorUnregistered.failed, true)
      assert.match(doctorUnregistered.output, /FAIL\s+emulators\s+.*without emulator registration\/health check/)

      const status = callsDuring(fakeDocker, () =>
        helperIn(dir, ['emulator', 'status', '--run', 'docker-test-run'], callerEnv),
      )
      assert.equal(status.result.failed, false)
      assert.match(status.result.output, new RegExp(`${CID_1} \\(running\\)`))
      assert.deepEqual(status.calls, [
        { args: 'info --format {{.ID}}', ...pinnedTo(DAEMON_A), daemon: 'daemon-a' },
        {
          args: `inspect --type container -f {{.State.Running}} -- ${CID_1}`,
          ...pinnedTo(DAEMON_A),
          daemon: 'daemon-a',
        },
        { args: `inspect --type container -f {{.State.Running}} -- ${CID_2}`, ...fromCaller, daemon: 'daemon-a' },
      ])

      const stop = callsDuring(fakeDocker, () =>
        helperIn(dir, ['emulator', 'stop', '--run', 'docker-test-run', '--device', 'ledger'], callerEnv),
      )
      assert.equal(stop.result.failed, false)
      assert.match(stop.result.output, new RegExp(`removed container ${CID_1}`))
      // The stop touches only the ledger container, on its own daemon, whatever the caller's shell selects.
      assert.deepEqual(stop.calls, [
        { args: 'info --format {{.ID}}', ...pinnedTo(DAEMON_A), daemon: 'daemon-a' },
        { args: `rm -f -- ${CID_1}`, ...pinnedTo(DAEMON_A), daemon: 'daemon-a' },
      ])

      const cleanup = callsDuring(fakeDocker, () => helperIn(dir, ['cleanup', '--run', 'docker-test-run'], callerEnv))
      assert.equal(cleanup.result.failed, false)
      assert.equal(existsSync(runDir), false)
      // Cleanup removes only what stop left, and only with Docker echoing the unpinned record's ID back.
      assert.deepEqual(cleanup.calls, [{ args: `rm -f -- ${CID_2}`, ...fromCaller, daemon: 'daemon-a' }])
      assert.deepEqual(fakeDocker.world().daemons['daemon-a']?.containers, {})

      assertDockerCallsAllowlisted(fakeDocker.readCalls(), new Set([CID_1, CID_2]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps containers another daemon now answers for, through both stop and cleanup, then retries cleanly on the owner', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-switch-'))
    try {
      const runId = 'switch-run'
      const runDir = runDirIn(dir, runId)
      mkdirSync(runDir, { recursive: true })
      const containersFile = join(runDir, 'containers.json')
      const stateFile = join(runDir, 'run.json')
      writeJson(containersFile, [
        containerRecord('emulator:ledger', CID_1, DAEMON_A),
        containerRecord('emulator:trezor', CID_2, DAEMON_A),
      ])
      writeJson(
        stateFile,
        runStateRecord(runId, [
          {
            device: 'ledger',
            model: 'flex',
            seed: 'primary',
            containerId: CID_1,
            daemon: DAEMON_A,
            apiPort: 15000,
            healthUrl: 'http://127.0.0.1:15000/events',
          },
        ]),
      )
      const containersBefore = readFileSync(containersFile, 'utf8')
      const stateBefore = readFileSync(stateFile, 'utf8')

      // local-a's socket now reaches local-b's daemon, which has no such containers and exits 0 on rm -f.
      const fakeDocker = createFakeDocker(dir, {
        ...baseWorld({ [CID_1]: 'running', [CID_2]: 'running' }),
        endpoints: { [ENDPOINT_A]: 'daemon-b', [ENDPOINT_B]: 'daemon-b' },
      })
      const onB = { PATH: fakeDocker.pathEnv, DOCKER_CONTEXT: 'local-b' }

      const stop = callsDuring(fakeDocker, () =>
        helperIn(dir, ['emulator', 'stop', '--run', runId, '--device', 'ledger'], onB),
      )
      assert.equal(stop.result.failed, true)
      assert.match(stop.result.output, /now reaches Docker daemon daemon-b, not daemon-a/)
      assert.deepEqual(
        stop.calls.map((call) => call.args),
        ['info --format {{.ID}}'],
      )

      const cleanup = callsDuring(fakeDocker, () => helperIn(dir, ['cleanup', '--run', runId], onB))
      assert.equal(cleanup.result.failed, true)
      assert.match(cleanup.result.output, /daemon-b, not daemon-a/)
      assert.match(cleanup.result.output, /Kept .* because cleanup had errors/)
      assert.deepEqual(
        cleanup.calls.map((call) => call.args),
        ['info --format {{.ID}}', 'info --format {{.ID}}'],
      )

      // Neither command removed or forgot anything, and the owner still runs both containers.
      assert.equal(existsSync(runDir), true)
      assert.equal(readFileSync(containersFile, 'utf8'), containersBefore)
      assert.equal(readFileSync(stateFile, 'utf8'), stateBefore)
      assert.deepEqual(Object.keys(fakeDocker.world().daemons['daemon-a']?.containers ?? {}), [CID_1, CID_2])

      // Switch back to local-a.
      fakeDocker.setWorld((world) => {
        world.endpoints[ENDPOINT_A] = 'daemon-a'
        world.currentContext = 'local-a'
      })
      const onA = { PATH: fakeDocker.pathEnv, DOCKER_CONTEXT: 'local-a' }

      const retryStop = callsDuring(fakeDocker, () =>
        helperIn(dir, ['emulator', 'stop', '--run', runId, '--device', 'ledger'], onA),
      )
      assert.equal(retryStop.result.failed, false, retryStop.result.output)
      assert.deepEqual(
        retryStop.calls.map((call) => `${call.args} @${call.daemon ?? 'none'}`),
        ['info --format {{.ID}} @daemon-a', `rm -f -- ${CID_1} @daemon-a`],
      )
      assert.doesNotMatch(readFileSync(containersFile, 'utf8'), new RegExp(CID_1))
      assert.doesNotMatch(readFileSync(stateFile, 'utf8'), new RegExp(CID_1))

      const retryCleanup = callsDuring(fakeDocker, () => helperIn(dir, ['cleanup', '--run', runId], onA))
      assert.equal(retryCleanup.result.failed, false, retryCleanup.result.output)
      assert.deepEqual(
        retryCleanup.calls.map((call) => `${call.args} @${call.daemon ?? 'none'}`),
        ['info --format {{.ID}} @daemon-a', `rm -f -- ${CID_2} @daemon-a`],
      )
      assert.equal(existsSync(runDir), false)
      assert.deepEqual(fakeDocker.world().daemons['daemon-a']?.containers, {})

      assertDockerCallsAllowlisted(fakeDocker.readCalls(), new Set([CID_1, CID_2]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps records when the socket changes daemons between the identity check and the removal, through stop and cleanup', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-midway-'))
    try {
      const runId = 'midway-run'
      const runDir = runDirIn(dir, runId)
      mkdirSync(runDir, { recursive: true })
      const containersFile = join(runDir, 'containers.json')
      writeJson(containersFile, [
        containerRecord('emulator:ledger', CID_1, DAEMON_A),
        containerRecord('emulator:trezor', CID_2, DAEMON_A),
      ])
      const containersBefore = readFileSync(containersFile, 'utf8')
      const fakeDocker = createFakeDocker(dir, baseWorld({ [CID_1]: 'running', [CID_2]: 'running' }))
      const env = { PATH: fakeDocker.pathEnv }
      const switchMidway = (): void => {
        fakeDocker.setWorld((world) => {
          world.endpoints[ENDPOINT_A] = 'daemon-a'
          world.switchAfterInfo = { endpoint: ENDPOINT_A, daemon: 'daemon-b' }
        })
      }

      // daemon-a answers the check, then daemon-b answers rm -f with a silent exit 0 for an ID it doesn't have.
      switchMidway()
      const stop = callsDuring(fakeDocker, () =>
        helperIn(dir, ['emulator', 'stop', '--run', runId, '--device', 'ledger'], env),
      )
      assert.equal(stop.result.failed, true)
      assert.match(stop.result.output, /Docker reported it absent, but then .*daemon-b, not daemon-a/)
      assert.deepEqual(
        stop.calls.map((call) => `${call.args} @${call.daemon ?? 'none'}`),
        ['info --format {{.ID}} @daemon-a', `rm -f -- ${CID_1} @daemon-b`, 'info --format {{.ID}} @daemon-b'],
      )

      switchMidway()
      const cleanup = callsDuring(fakeDocker, () => helperIn(dir, ['cleanup', '--run', runId], env))
      assert.equal(cleanup.result.failed, true)
      assert.match(cleanup.result.output, /Docker reported it absent, but then/)
      assert.equal(existsSync(runDir), true)
      assert.equal(readFileSync(containersFile, 'utf8'), containersBefore)
      assert.deepEqual(Object.keys(fakeDocker.world().daemons['daemon-a']?.containers ?? {}), [CID_1, CID_2])

      // With daemon-a answering throughout, the retry removes both and the run.
      fakeDocker.setWorld((world) => {
        world.endpoints[ENDPOINT_A] = 'daemon-a'
      })
      const retry = helperIn(dir, ['cleanup', '--run', runId], env)
      assert.equal(retry.failed, false, retry.output)
      assert.equal(existsSync(runDir), false)
      assert.deepEqual(fakeDocker.world().daemons['daemon-a']?.containers, {})
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps container records and exits nonzero on failed docker rm, and succeeds on retry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-fail-rm-'))
    try {
      const fakeDocker = createFakeDocker(dir, baseWorld({ [CID_1]: 'running' }))
      fakeDocker.setWorld((world) => {
        world.daemons['daemon-a'] = { containers: { [CID_1]: 'running' }, rm: 'fail' }
      })
      const runDir = runDirIn(dir, 'retry-rm-run')
      mkdirSync(runDir, { recursive: true })
      const containersFile = join(runDir, 'containers.json')
      writeJson(containersFile, [containerRecord('emulator:ledger', CID_1, DAEMON_A)])

      const env = { PATH: fakeDocker.pathEnv }

      const failedStop = helperIn(dir, ['emulator', 'stop', '--run', 'retry-rm-run', '--device', 'ledger'], env)
      assert.equal(failedStop.failed, true)
      assert.match(failedStop.output, /Cannot connect to the Docker daemon/)
      assert.match(readFileSync(containersFile, 'utf8'), new RegExp(CID_1))

      const failedCleanup = helperIn(dir, ['cleanup', '--run', 'retry-rm-run'], env)
      assert.equal(failedCleanup.failed, true)
      assert.match(failedCleanup.output, /Cannot connect to the Docker daemon/)
      assert.equal(existsSync(runDir), true)
      assert.match(readFileSync(containersFile, 'utf8'), new RegExp(CID_1))

      // Docker recovers: retry succeeds and removes the run directory.
      fakeDocker.setWorld((world) => {
        world.daemons['daemon-a'] = { containers: { [CID_1]: 'stopped' } }
      })
      const retryCleanup = helperIn(dir, ['cleanup', '--run', 'retry-rm-run'], env)
      assert.equal(retryCleanup.failed, false)
      assert.equal(existsSync(runDir), false)

      assertDockerCallsAllowlisted(fakeDocker.readCalls(), new Set([CID_1]))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats corrupt containers.json as an error across status, stop, doctor, and cleanup without overwriting or deleting it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-corrupt-containers-'))
    try {
      const fakeDocker = createFakeDocker(dir, baseWorld())
      const runDir = runDirIn(dir, 'corrupt-containers-run')
      mkdirSync(runDir, { recursive: true })
      const containersFile = join(runDir, 'containers.json')
      const corruptBytes = '{corrupt containers json'
      writeFileSync(containersFile, corruptBytes)
      const env = { PATH: fakeDocker.pathEnv }

      const statusResult = helperIn(dir, ['emulator', 'status', '--run', 'corrupt-containers-run'], env)
      assert.equal(statusResult.failed, true)
      assert.match(statusResult.output, /does not parse/)
      assert.doesNotMatch(statusResult.output, /No emulators recorded/)

      const stopResult = helperIn(
        dir,
        ['emulator', 'stop', '--run', 'corrupt-containers-run', '--device', 'ledger'],
        env,
      )
      assert.equal(stopResult.failed, true)
      assert.match(stopResult.output, /does not parse/)

      const doctorResult = helperIn(dir, ['doctor', '--run', 'corrupt-containers-run'], env)
      assert.equal(doctorResult.failed, true)
      assert.match(doctorResult.output, /FAIL\s+emulators\s+.*does not parse/)

      const cleanupResult = helperIn(dir, ['cleanup', '--run', 'corrupt-containers-run'], env)
      assert.equal(cleanupResult.failed, true)
      assert.match(cleanupResult.output, /does not parse/)

      assert.equal(existsSync(runDir), true)
      assert.equal(readFileSync(containersFile, 'utf8'), corruptBytes)
      assert.deepEqual(fakeDocker.readCalls(), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('says a run.json naming another run does not match its folder, and cleanup still clears it from the journals', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-mismatch-cli-'))
    try {
      const fakeDocker = createFakeDocker(dir, baseWorld({ [CID_1]: 'running' }))
      const env = { PATH: fakeDocker.pathEnv }
      const runId = 'mismatch-run'
      const runDir = runDirIn(dir, runId)
      mkdirSync(runDir, { recursive: true })
      writeJson(join(runDir, 'run.json'), runStateRecord('another-run'))
      writeJson(join(runDir, 'containers.json'), [containerRecord('emulator:ledger', CID_1, DAEMON_A)])
      writeJson(join(runDir, 'processes.json'), [{ name: 'sentinel', pid: 999_999, startedAt: 'never' }])
      const mismatch = /run ID "another-run" does not match directory "mismatch-run"/

      const doctor = helperIn(dir, ['doctor', '--run', runId], env)
      assert.equal(doctor.failed, true)
      assert.match(doctor.output, new RegExp(`FAIL\\s+run\\s+.*${mismatch.source}`))
      const query = helperIn(dir, ['query', '--run', runId, '--sql', 'SELECT 1'], env)
      assert.equal(query.failed, true)
      assert.match(query.output, mismatch)
      assert.match(query.output, /Clean up this run and launch a new one/)
      const status = helperIn(dir, ['emulator', 'status', '--run', runId], env)
      assert.equal(status.failed, true)
      assert.match(status.output, mismatch)
      for (const result of [doctor, query, status]) {
        assert.doesNotMatch(result.output, /run\.json does not parse/)
      }

      // The advice works: cleanup removes the journaled container and the folder.
      const cleanup = callsDuring(fakeDocker, () => helperIn(dir, ['cleanup', '--run', runId], env))
      assert.equal(cleanup.result.failed, false, cleanup.result.output)
      assert.deepEqual(
        cleanup.calls.map((call) => call.args),
        ['info --format {{.ID}}', `rm -f -- ${CID_1}`],
      )
      assert.equal(existsSync(runDir), false)

      // A run.json that doesn't parse at all is cleared the same way.
      const corruptDir = runDirIn(dir, 'corrupt-state-run')
      mkdirSync(corruptDir, { recursive: true })
      writeFileSync(join(corruptDir, 'run.json'), '{"runId": ')
      const corrupt = helperIn(dir, ['cleanup', '--run', 'corrupt-state-run'], env)
      assert.equal(corrupt.failed, false, corrupt.output)
      assert.match(corrupt.output, /run\.json does not parse; cleaning up from containers\.json and processes\.json/)
      assert.equal(existsSync(corruptDir), false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps the run and exits nonzero when processes.json does not parse', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-bad-procs-cli-'))
    try {
      const runDir = runDirIn(dir, 'bad-procs-run')
      mkdirSync(runDir, { recursive: true })
      const processesFile = join(runDir, 'processes.json')
      writeFileSync(processesFile, '[{"name": "sentinel"')
      const result = helperIn(dir, ['cleanup', '--run', 'bad-procs-run'])
      assert.equal(result.failed, true)
      assert.match(result.output, /processes\.json does not parse; keeping/)
      assert.equal(readFileSync(processesFile, 'utf8'), '[{"name": "sentinel"')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips health HTTP probes when inspect says container is down, passes on loopback 200 when running, and rejects 3xx redirects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-doctor-health-'))
    let healthHits = 0
    let redirectTargetHits = 0
    let mode: 'ok' | 'redirect' = 'ok'
    const server = createServer((req, res) => {
      if (req.url === '/redirected') {
        redirectTargetHits += 1
        res.writeHead(200, { connection: 'close' })
        res.end('redirected')
        return
      }
      healthHits += 1
      if (mode === 'redirect') {
        res.writeHead(302, { location: '/redirected', connection: 'close' })
        res.end()
        return
      }
      res.writeHead(200, { connection: 'close' })
      res.end('ok')
    })

    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', () => {
        resolveListen()
      })
    })

    try {
      const port = boundPort(server.address())
      const fakeDocker = createFakeDocker(dir, baseWorld({ [CID_1]: 'stopped' }))
      const runId = 'doctor-probe-run'
      const runDir = runDirIn(dir, runId)
      mkdirSync(runDir, { recursive: true })
      writeJson(join(runDir, 'containers.json'), [containerRecord('emulator:coldcard', CID_1, DAEMON_A)])
      writeJson(
        join(runDir, 'run.json'),
        runStateRecord(runId, [
          {
            device: 'coldcard',
            seed: 'primary',
            containerId: CID_1,
            daemon: DAEMON_A,
            apiPort: port,
            healthUrl: `http://127.0.0.1:${port}/health`,
          },
        ]),
      )

      const env = { PATH: fakeDocker.pathEnv }

      // 1. Container is stopped -> doctor must NOT send any HTTP request to healthUrl.
      const downResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 0)
      assert.match(downResult.output, new RegExp(`FAIL\\s+emulators\\s+coldcard: container ${CID_1} is not running`))
      assert.doesNotMatch(downResult.output, /health .* failed/)

      // 2. Docker daemon unreachable -> distinct message and still 0 HTTP requests.
      fakeDocker.setWorld((world) => {
        world.endpoints[ENDPOINT_A] = null
      })
      const unavailableResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 0)
      assert.match(
        unavailableResult.output,
        /FAIL\s+emulators\s+coldcard: Docker unavailable \(cannot confirm Docker daemon daemon-a/,
      )

      // 3. Container is running + 200 OK -> probes once and passes emulators check.
      fakeDocker.setWorld((world) => {
        world.endpoints[ENDPOINT_A] = 'daemon-a'
        world.daemons['daemon-a'] = { containers: { [CID_1]: 'running' } }
      })
      const upResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 1)
      assert.match(upResult.output, new RegExp(`PASS\\s+emulators\\s+coldcard container ${CID_1.slice(0, 12)} ok`))

      // 4. Container is running + 302 redirect -> rejects redirect without following it.
      mode = 'redirect'
      const redirectResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 2)
      assert.equal(redirectTargetHits, 0)
      assert.match(redirectResult.output, /FAIL\s+emulators\s+.*HTTP 302 \(redirect rejected\)/)

      assertDockerCallsAllowlisted(fakeDocker.readCalls(), new Set([CID_1]))
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolveClose) => {
        server.close(() => {
          resolveClose()
        })
      })
      rmSync(dir, { recursive: true, force: true })
    }
  }, 15_000)
})
