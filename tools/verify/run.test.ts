import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, hostname, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result'
import { describe, it, vi } from 'vitest'
import { blockTime, currentPrice, indexChain, tipHeight } from './chain'
import { ChildEnv, type CommandResult, runAsync, runCommand } from './process'
import {
  type CleanupDeps,
  ContainerSchema,
  type DockerCommandRunner,
  type DockerDaemon,
  type EmulatorState,
  EmulatorStateSchema,
  LEDGER_MODELS,
  NO_FAULTS,
  type PinnedContainer,
  REPO_ROOT,
  type RecordedProcess,
  type RunPaths,
  type RunState,
  buildStamp,
  captureDockerDaemon,
  cleanupRunResources,
  forgetContainer,
  inspectContainer,
  invalidMessage,
  isLoopbackUrlForPort,
  isPathInside,
  isValidContainerId,
  ledgerElfCacheDir,
  ownsSentinel,
  processStartTime,
  quitProcessCleanly,
  readAsarFile,
  readBundleProvenance,
  readContainers,
  readContainersFile,
  readProcesses,
  readRunState,
  recordContainer,
  recordProcess,
  removeContainer,
  reportsOnlyAbsence,
  resolveDataDir,
  resolveSeedFile,
  runPaths,
  verifyCapableBundleProblem,
  wait,
  withRunLock,
  writeJson,
} from './run'

/** An asar archive holding `files`, keyed by their path inside it, such as `app/main/index.js`. */
function buildAsar(files: Readonly<Record<string, string>>): Buffer {
  interface Dir {
    files: Record<string, Dir | { offset: string; size: number }>
  }
  const root: Dir = { files: {} }
  const payloads: Buffer[] = []
  let offset = 0
  for (const [path, text] of Object.entries(files)) {
    const names = path.split('/')
    const fileName = names.pop() ?? ''
    let dir = root
    for (const name of names) {
      const existing = dir.files[name]
      const child: Dir = existing !== undefined && 'files' in existing ? existing : { files: {} }
      dir.files[name] = child
      dir = child
    }
    const payload = Buffer.from(text, 'utf8')
    dir.files[fileName] = { offset: String(offset), size: payload.byteLength }
    payloads.push(payload)
    offset += payload.byteLength
  }
  const jsonBuf = Buffer.from(JSON.stringify(root), 'utf8')
  const paddedJson = Buffer.alloc(Math.ceil(jsonBuf.byteLength / 4) * 4)
  jsonBuf.copy(paddedJson)
  const headerSize = paddedJson.byteLength + 8
  const pre = Buffer.alloc(16)
  pre.writeUInt32LE(4, 0)
  pre.writeUInt32LE(headerSize, 4)
  pre.writeUInt32LE(headerSize - 4, 8)
  pre.writeUInt32LE(jsonBuf.byteLength, 12)
  return Buffer.concat([pre, paddedJson, ...payloads])
}

const buildMinimalAsar = (mainIndexSource: string): Buffer => buildAsar({ 'app/main/index.js': mainIndexSource })

/** A fake .app bundle in `root` whose app.asar holds `files`. */
function fakeBundle(root: string, files: Readonly<Record<string, string>>): string {
  const app = join(root, 'Fake.app')
  mkdirSync(join(app, 'Contents', 'Resources'), { recursive: true })
  writeFileSync(join(app, 'Contents', 'Resources', 'app.asar'), buildAsar(files))
  return app
}

describe('processStartTime', () => {
  it('reads the same start time whatever the caller’s time zone', () => {
    try {
      vi.stubEnv('TZ', 'Asia/Tokyo')
      const tokyo = processStartTime(process.pid)
      vi.stubEnv('TZ', 'America/New_York')
      const newYork = processStartTime(process.pid)
      assert.ok(tokyo !== null)
      assert.equal(tokyo, newYork)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('buildStamp', () => {
  it('marks uncommitted code dirty, but not edits to the skill’s own files', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-stamp-'))
    const git = (...args: string[]): void => {
      runCommand('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], {
        cwd: root,
        // The fixture ignores the developer's own git config, such as commit signing or hooks.
        env: ChildEnv.with({ GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }),
      })
    }
    // A git hook exports GIT_DIR; a child that inherited it would act on that repository instead of this one.
    const elsewhere = join(root, 'elsewhere.git')
    vi.stubEnv('GIT_DIR', elsewhere)
    // A developer who signs every commit: the fixture's commit must not try to sign.
    vi.stubEnv('HOME', join(root, 'home'))
    mkdirSync(join(root, 'home'))
    writeFileSync(join(root, 'home/.gitconfig'), '[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n')
    try {
      git('init', '-q')
      writeFileSync(join(root, 'app.ts'), 'one\n')
      git('add', '.')
      git('commit', '-qm', 'start')
      mkdirSync(join(root, '.agents'))
      writeFileSync(join(root, '.agents/recipe.md'), 'notes\n')
      assert.equal(buildStamp(root).dirty, false)
      writeFileSync(join(root, 'app.ts'), 'two\n')
      assert.equal(buildStamp(root).dirty, true)
      assert.equal(existsSync(elsewhere), false)
    } finally {
      vi.unstubAllEnvs()
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('ownsSentinel', () => {
  it('refuses a run whose Sentinel process is gone', () => {
    const gone = { name: 'sentinel', pid: 999_999, startedAt: 'never', port: 1 }
    const fakes = { name: 'fakes', pid: 999_998, startedAt: 'never', electrumPort: 2, mempoolPort: 3 }
    const state = {
      runId: 'test',
      launchedAt: '',
      fresh: false,
      desktop: false,
      electron: false,
      setupPinInUi: false,
      pin: false,
      build: { commit: '', tree: '', dirty: false },
      url: 'http://127.0.0.1:1',
      sentinel: gone,
      fakes,
    }
    assert.equal(ownsSentinel(state), false)
  })
})

describe('Electron run paths and isolation', () => {
  it('resolves dataDir and seedFile from RunState when set', () => {
    const paths = runPaths('electron-path-test')
    assert.equal(resolveDataDir(paths, null), paths.dataDir)
    assert.equal(resolveSeedFile(paths, null), paths.seedFile)

    const electronData = join(paths.runDir, 'user-data', 'data')
    const state = {
      runId: 'electron-path-test',
      launchedAt: '',
      fresh: false,
      desktop: false,
      electron: true,
      setupPinInUi: false,
      pin: false,
      build: { commit: '', tree: '', dirty: false },
      url: 'http://127.0.0.1:1',
      dataDir: electronData,
      sentinel: { name: 'electron', pid: 1, startedAt: 'x', port: 1 },
      fakes: { name: 'fakes', pid: 2, startedAt: 'x', electrumPort: 2, mempoolPort: 3 },
    }
    assert.equal(resolveDataDir(paths, state), electronData)
    assert.equal(resolveSeedFile(paths, state), join(electronData, 'verify-seed.json'))
  })

  it('checks path containment accurately including case-variant darwin paths and ..foo children', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-inside-'))
    try {
      assert.equal(isPathInside(join(root, 'user-data'), root), true)
      assert.equal(isPathInside(join(root, '..foo'), root), true)
      assert.equal(isPathInside(join(root, '..'), root), false)
      assert.equal(isPathInside(join(root, '..', 'outside'), root), false)

      const appSupportDesktop = join(root, 'Library', 'Application Support', 'desktop')
      const appSupportCaseVariant = join(root, 'Library', 'Application Support', 'Desktop', 'data', 'sentinel.db')
      assert.equal(isPathInside(appSupportCaseVariant, appSupportDesktop, 'darwin'), true)
      assert.equal(isPathInside(appSupportCaseVariant, appSupportDesktop, 'win32'), true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a macOS bundle without the BCC_VERIFY_CONFIG marker without launching it', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-bundle-'))
    try {
      const olderApp = join(root, 'Older.app')
      mkdirSync(join(olderApp, 'Contents', 'MacOS'), { recursive: true })
      mkdirSync(join(olderApp, 'Contents', 'Resources'), { recursive: true })
      const markerFile = join(root, 'was-launched')
      writeFileSync(
        join(olderApp, 'Contents', 'MacOS', 'Bitcoin Control Center'),
        `#!/bin/sh\necho launched > "${markerFile}"\n`,
        { mode: 0o755 },
      )
      writeFileSync(
        join(olderApp, 'Contents', 'Resources', 'app.asar'),
        buildMinimalAsar('const x = "production-only-main";'),
      )

      let launched = false
      const olderProblem = verifyCapableBundleProblem(olderApp)
      if (olderProblem === null) {
        launched = true
      }
      assert.ok(olderProblem?.includes('BCC_VERIFY_CONFIG') === true)
      assert.equal(launched, false)
      assert.equal(existsSync(markerFile), false)

      const missingAsarApp = join(root, 'NoAsar.app')
      mkdirSync(join(missingAsarApp, 'Contents', 'MacOS'), { recursive: true })
      writeFileSync(join(missingAsarApp, 'Contents', 'MacOS', 'Bitcoin Control Center'), '#!/bin/sh\n', {
        mode: 0o755,
      })
      const missingAsarProblem = verifyCapableBundleProblem(missingAsarApp)
      assert.ok(missingAsarProblem?.includes('app.asar') === true)

      const verifyApp = join(root, 'VerifyCapable.app')
      mkdirSync(join(verifyApp, 'Contents', 'MacOS'), { recursive: true })
      mkdirSync(join(verifyApp, 'Contents', 'Resources'), { recursive: true })
      writeFileSync(join(verifyApp, 'Contents', 'MacOS', 'Bitcoin Control Center'), '#!/bin/sh\n', { mode: 0o755 })
      writeFileSync(
        join(verifyApp, 'Contents', 'Resources', 'app.asar'),
        buildMinimalAsar('const env = process.env["BCC_VERIFY_CONFIG"];'),
      )
      assert.equal(verifyCapableBundleProblem(verifyApp), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports wasRunning=false when quitProcessCleanly is called on a process that is already gone', async () => {
    const gone = { name: 'electron', pid: 999_999, startedAt: 'never' }
    const result = await quitProcessCleanly(gone, 500)
    assert.deepEqual(result, { wasRunning: false, exited: false, survivors: [] })
  })
})

describe('bundle provenance', () => {
  const stamp = {
    name: 'bitcoin-control-center',
    version: '1.4.3',
    bccReleaseVersion: '1.4.3:0',
    bccSourceCommit: '41939c22ece770653439f4673dfd36b85b968fe1',
    bccSourceDirty: false,
  }

  it('reads the release, commit and dirty flag desktop/build.sh stamps into app.asar', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-provenance-'))
    try {
      const app = fakeBundle(root, {
        'app/main/index.js': 'process.env.BCC_VERIFY_CONFIG',
        'package.json': JSON.stringify(stamp),
      })
      assert.deepEqual(readBundleProvenance(app), {
        release: '1.4.3:0',
        commit: '41939c22ece770653439f4673dfd36b85b968fe1',
        dirty: false,
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('gives null for each stamp a bundle lacks or has the wrong type for', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-provenance-'))
    try {
      const app = fakeBundle(root, {
        'package.json': JSON.stringify({ version: '1.0.0', bccSourceCommit: 7, bccSourceDirty: 'true' }),
      })
      assert.deepEqual(readBundleProvenance(app), { release: null, commit: null, dirty: null })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('gives null when package.json is missing, unparsable or the asar is not there', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-provenance-'))
    try {
      assert.equal(readBundleProvenance(fakeBundle(join(root, 'a'), { 'app/main/index.js': 'x' })), null)
      assert.equal(readBundleProvenance(fakeBundle(join(root, 'b'), { 'package.json': '{not json' })), null)
      assert.equal(readBundleProvenance(join(root, 'Missing.app')), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reads nested files from an asar, and refuses directories, unpacked entries and garbage headers', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-asar-'))
    try {
      const asar = join(root, 'app.asar')
      writeFileSync(asar, buildAsar({ 'app/main/index.js': 'main', 'package.json': '{}' }))
      assert.equal(readAsarFile(asar, ['app', 'main', 'index.js'])?.toString('utf8'), 'main')
      assert.equal(readAsarFile(asar, ['package.json'])?.toString('utf8'), '{}')
      assert.equal(readAsarFile(asar, ['app', 'main']), null)
      assert.equal(readAsarFile(asar, ['app', 'main', 'index.js', 'deeper']), null)
      assert.equal(readAsarFile(asar, ['nope']), null)

      const header = Buffer.from(JSON.stringify({ files: { 'native.node': { size: 4, unpacked: true } } }), 'utf8')
      const padded = Buffer.alloc(Math.ceil(header.byteLength / 4) * 4)
      header.copy(padded)
      const pre = Buffer.alloc(16)
      pre.writeUInt32LE(4, 0)
      pre.writeUInt32LE(padded.byteLength + 8, 4)
      pre.writeUInt32LE(padded.byteLength + 4, 8)
      pre.writeUInt32LE(header.byteLength, 12)
      const unpacked = join(root, 'unpacked.asar')
      writeFileSync(unpacked, Buffer.concat([pre, padded]))
      assert.equal(readAsarFile(unpacked, ['native.node']), null)

      const garbage = join(root, 'garbage.asar')
      writeFileSync(garbage, 'not an asar archive at all')
      assert.equal(readAsarFile(garbage, ['package.json']), null)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('the fake chain and prices', () => {
  it('puts every transaction at noon UTC, so its date matches from UTC-11 to UTC+11', () => {
    const heights = [...indexChain(tipHeight()).byTxid.values()].map((entry) => entry.height)
    assert.ok(heights.length > 0)
    for (const height of heights) {
      assert.equal(new Date(blockTime(height) * 1000).getUTCHours(), 12)
    }
  })

  it('serves a price far below any real Bitcoin price', () => {
    assert.ok(currentPrice().USD < 10_000)
  })
})

function tempPaths(root: string, runId = 'container-test'): ReturnType<typeof runPaths> {
  const runDir = join(root, runId)
  const dataDir = join(runDir, 'data')
  return {
    runId,
    runDir,
    dataDir,
    appDir: join(runDir, 'app'),
    logsDir: join(runDir, 'logs'),
    stateFile: join(runDir, 'run.json'),
    processesFile: join(runDir, 'processes.json'),
    containersFile: join(runDir, 'containers.json'),
    fakesFile: join(runDir, 'fakes.json'),
    seedFile: join(dataDir, 'verify-seed.json'),
    requestLog: join(runDir, 'logs', 'fake-requests.log'),
    faultsFile: join(runDir, 'faults.json'),
    appliedFaultsFile: join(runDir, 'faults-applied.json'),
    lockDir: join(root, 'locks', `${runId}.lock`),
  }
}

/** A temp root with a run folder in it, removed afterwards. */
async function withRun(
  prefix: string,
  runId: string,
  fn: (paths: RunPaths, root: string) => Promise<void> | void,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), prefix))
  try {
    const paths = tempPaths(root, runId)
    mkdirSync(paths.runDir, { recursive: true })
    await fn(paths, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const cmdOk = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '', error: null })
const cmdFail = (stderr: string, status = 1): CommandResult => ({ status, stdout: '', stderr, error: null })

const ENDPOINT_A = 'unix:///fake/colima.sock'
const DAEMON_A: DockerDaemon = { daemonId: 'daemon-a', context: 'local-a', endpoint: ENDPOINT_A }

interface FakeDaemon {
  id: string
  /** Container ID to running (true) or stopped (false). */
  containers: Map<string, boolean>
  rm?: 'ok' | 'fail'
  /** How `rm -f` reports an absent ID: silently as Docker 29 does, or with the diagnostic as older CLIs do. */
  absent?: 'silent' | 'stderr'
}

/**
 * A Docker CLI double. `endpoints` says which daemon answers at each endpoint (`caller` stands for the caller's own
 * settings); change it to simulate switching contexts or a socket now served by another daemon.
 */
interface RunnerCall {
  args: string
  endpoint: string | undefined
}

interface DockerDouble {
  runner: DockerCommandRunner
  calls: RunnerCall[]
}

function fakeDocker(endpoints: Readonly<Record<string, FakeDaemon | null>>): DockerDouble {
  const calls: RunnerCall[] = []
  const runner: DockerCommandRunner = (args, target) => {
    const endpoint = target?.endpoint ?? 'caller'
    calls.push({ args: args.join(' '), endpoint: target?.endpoint })
    const daemon = endpoints[endpoint]
    if (daemon === undefined || daemon === null) {
      return cmdFail(`Cannot connect to the Docker daemon at ${endpoint}. Is the docker daemon running?`)
    }
    const [command] = args
    const id = args.at(-1) ?? ''
    if (command === 'info') {
      return cmdOk(`${daemon.id}\n`)
    }
    if (command === 'inspect') {
      const running = daemon.containers.get(id)
      return running === undefined
        ? cmdFail(`Error response from daemon: No such container: ${id}`)
        : cmdOk(`${String(running)}\n`)
    }
    if (command === 'rm') {
      if (daemon.rm === 'fail') {
        return cmdFail(`Cannot connect to the Docker daemon at ${endpoint}. Is the docker daemon running?`)
      }
      if (daemon.containers.delete(id)) {
        return cmdOk(`${id}\n`)
      }
      return daemon.absent === 'stderr'
        ? { status: 0, stdout: '', stderr: `Error response from daemon: No such container: ${id}\n`, error: null }
        : cmdOk()
    }
    return cmdFail(`unexpected docker command: ${args.join(' ')}`, 99)
  }
  return { runner, calls }
}

function runStateFixture(runId: string, emulators: EmulatorState[] = []): RunState {
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
    sentinel: { name: 'sentinel', pid: 1003, startedAt: 't3', port: 4000 },
    fakes: { name: 'fakes', pid: 1001, startedAt: 't1', electrumPort: 4001, mempoolPort: 4002 },
  }
  if (emulators.length > 0) {
    state.emulators = emulators
  }
  return state
}

const noopCleanup = (root: string): Pick<CleanupDeps, 'evidenceRoot' | 'log' | 'stopProcess'> => ({
  stopProcess: async () => {},
  evidenceRoot: join(root, 'evidence'),
  log: () => {},
})

describe('container tracking and cleanup', () => {
  const CID_LEDGER = 'a'.repeat(64)
  const CID_TREZOR = 'b'.repeat(64)
  const CID_COLDCARD = 'c'.repeat(64)
  const container = (name: string, containerId: string, daemon: DockerDaemon = DAEMON_A): PinnedContainer => ({
    name,
    containerId,
    image: 'speculos:test',
    startedAt: '2026-11-25T17:00:00Z',
    daemon,
  })

  it('validates full 64-character lowercase hex container IDs at schema and recording boundaries', async () => {
    const invalidIds = [
      '',
      'cid-ledger-1',
      'deadbeef1234',
      'A'.repeat(64),
      `-${'a'.repeat(63)}`,
      `${'a'.repeat(63)}g`,
      'a'.repeat(63),
      'a'.repeat(65),
      ` ${'a'.repeat(64)}`,
    ]

    assert.equal(isValidContainerId(CID_LEDGER), true)
    for (const badId of invalidIds) {
      assert.equal(isValidContainerId(badId), false, badId)
      assert.equal(
        parseUnknown(ContainerSchema, {
          name: 'emulator:ledger',
          containerId: badId,
          image: 'speculos:test',
          startedAt: '2026-11-25T17:00:00Z',
        }).isErr(),
        true,
        `ContainerSchema must reject ${badId}`,
      )
      assert.equal(
        parseUnknown(EmulatorStateSchema, {
          device: 'ledger',
          model: 'flex',
          seed: 'primary',
          containerId: badId,
          apiPort: 15000,
          healthUrl: 'http://127.0.0.1:15000/events',
        }).isErr(),
        true,
        `EmulatorStateSchema must reject ${badId}`,
      )
    }

    await withRun('verify-invalid-cid-', 'invalid-cid-run', async (paths) => {
      await assert.rejects(
        recordContainer(paths, container('emulator:ledger', 'short-id')),
        /64-character lowercase hex/,
      )
      assert.equal(existsSync(paths.containersFile), false)
      await assert.rejects(forgetContainer(paths, '--all'), /Invalid container ID/)

      const { runner, calls } = fakeDocker({ [ENDPOINT_A]: { id: 'daemon-a', containers: new Map() } })
      assert.equal(inspectContainer('-bad', DAEMON_A, runner).state, 'unavailable')
      assert.equal(removeContainer('short-id', DAEMON_A, runner).removed, false)
      assert.deepEqual(calls, [])
    })
  })

  it('refuses a container record without its Docker daemon, but still parses older records without one', async () => {
    await withRun('verify-unpinned-', 'unpinned-run', async (paths) => {
      const unpinned = { name: 'emulator:ledger', containerId: CID_LEDGER, image: 'x', startedAt: 't' }
      // @ts-expect-error recordContainer takes only records that name their daemon.
      await assert.rejects(recordContainer(paths, unpinned), /and its daemon/)
      assert.equal(existsSync(paths.containersFile), false)
      assert.equal(parseUnknown(ContainerSchema, unpinned).isOk(), true)
      assert.equal(parseUnknown(ContainerSchema, { ...unpinned, daemon: { daemonId: '' } }).isErr(), true)
      // Endpoints are checked again where records are written and read, so no user, query or fragment is stored.
      for (const endpoint of [
        'unix:///var/run/docker.sock?token=marker',
        'tcp://u:marker@127.0.0.1:2375',
        'ssh://host',
      ]) {
        const daemon = { daemonId: 'daemon-a', endpoint }
        assert.equal(parseUnknown(ContainerSchema, { ...unpinned, daemon }).isErr(), true, endpoint)
        await assert.rejects(recordContainer(paths, { ...unpinned, daemon }), /and its daemon/)
      }
      assert.equal(existsSync(paths.containersFile), false)
    })
  })

  it('requires loopback healthUrl matching apiPort and loopback bridge.url matching bridge.port', () => {
    assert.equal(isLoopbackUrlForPort('http://127.0.0.1:15000/events', 15000, ['http:']), true)
    assert.equal(isLoopbackUrlForPort('http://localhost:15000/events', 15000, ['http:']), true)
    assert.equal(isLoopbackUrlForPort('ws://127.0.0.1:21335/connect-ws', 21335, ['http:', 'ws:']), true)
    assert.equal(isLoopbackUrlForPort('http://169.254.169.254:15000/latest', 15000, ['http:']), false)
    assert.equal(isLoopbackUrlForPort('http://127.0.0.1:15001/events', 15000, ['http:']), false)
    assert.equal(isLoopbackUrlForPort('https://127.0.0.1:15000/events', 15000, ['http:']), false)
    assert.equal(isLoopbackUrlForPort('http://user:pass@127.0.0.1:15000/events', 15000, ['http:']), false)

    const validEmulator = {
      device: 'ledger',
      model: 'flex',
      seed: 'primary',
      containerId: CID_LEDGER,
      apiPort: 15000,
      healthUrl: 'http://127.0.0.1:15000/events',
      bridge: {
        name: 'emulator:ledger-bridge',
        pid: 1002,
        startedAt: 't2',
        port: 15001,
        url: 'http://127.0.0.1:15001',
      },
    }
    assert.equal(parseUnknown(EmulatorStateSchema, validEmulator).isOk(), true)
    assert.equal(
      parseUnknown(EmulatorStateSchema, { ...validEmulator, healthUrl: 'http://example.com:15000/events' }).isErr(),
      true,
    )
    assert.equal(
      parseUnknown(EmulatorStateSchema, { ...validEmulator, healthUrl: 'http://127.0.0.1:19999/events' }).isErr(),
      true,
    )
    assert.equal(
      parseUnknown(EmulatorStateSchema, {
        ...validEmulator,
        bridge: { ...validEmulator.bridge, url: 'http://127.0.0.1:19999' },
      }).isErr(),
      true,
    )
  })

  it('accepts only the Ledger models the runner supports for a Ledger emulator', () => {
    const ledger = {
      device: 'ledger',
      seed: 'primary',
      containerId: CID_LEDGER,
      apiPort: 15000,
      healthUrl: 'http://127.0.0.1:15000/events',
      daemon: DAEMON_A,
    }
    for (const model of LEDGER_MODELS) {
      assert.equal(parseUnknown(EmulatorStateSchema, { ...ledger, model }).isOk(), true, model)
    }
    for (const model of ['nanos', 'stax', 'Flex', '', undefined]) {
      assert.equal(parseUnknown(EmulatorStateSchema, { ...ledger, model }).isErr(), true, String(model))
    }
    // Other devices name their own models; the Ledger list doesn't apply to them.
    assert.equal(parseUnknown(EmulatorStateSchema, { ...ledger, device: 'trezor', model: 'T2T1' }).isOk(), true)
  })

  it('reports a run.json naming another run as a mismatch, not as a file that does not parse', async () => {
    await withRun('verify-runid-mismatch-', 'expected-run', (paths) => {
      writeJson(paths.stateFile, runStateFixture('different-run'))
      const result = readRunState(paths)
      assert.ok(result.status === 'invalid')
      assert.equal(result.reason, 'mismatch')
      const message = invalidMessage(result)
      assert.match(message, /run ID "different-run" does not match directory "expected-run"/)
      assert.doesNotMatch(message, /does not parse/)

      writeFileSync(paths.stateFile, '{not json')
      const broken = readRunState(paths)
      assert.ok(broken.status === 'invalid')
      assert.equal(broken.reason, 'parse')
      assert.match(invalidMessage(broken), /run\.json does not parse/)
    })
  })

  it('records, reads, and forgets Docker containers in containers.json', async () => {
    await withRun('verify-containers-', 'containers-run', async (paths) => {
      assert.equal(readContainersFile(paths).status, 'missing')
      assert.deepEqual(readContainers(paths), [])

      await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
      await recordContainer(paths, container('emulator:trezor', CID_TREZOR))
      assert.deepEqual(readContainers(paths), [
        container('emulator:ledger', CID_LEDGER),
        container('emulator:trezor', CID_TREZOR),
      ])

      await forgetContainer(paths, CID_LEDGER)
      assert.deepEqual(
        readContainers(paths).map((entry) => entry.containerId),
        [CID_TREZOR],
      )
    })
  })

  it('never treats corrupt containers.json as empty or overwrites/deletes it', async () => {
    await withRun('verify-corrupt-unit-', 'corrupt-unit-run', async (paths, root) => {
      const corruptBytes = '[{"name": "broken"'
      writeFileSync(paths.containersFile, corruptBytes)

      assert.equal(readContainersFile(paths).status, 'invalid')
      assert.throws(() => readContainers(paths), /does not parse/)
      await assert.rejects(recordContainer(paths, container('emulator:ledger', CID_LEDGER)), /does not parse/)
      await assert.rejects(forgetContainer(paths, CID_LEDGER), /does not parse/)
      assert.equal(readFileSync(paths.containersFile, 'utf8'), corruptBytes)

      const summary = await cleanupRunResources(paths, {
        ...noopCleanup(root),
        removeContainer: () => {
          throw new Error('should not call removeContainer for corrupt containers.json')
        },
      })
      assert.equal(summary.ok, false)
      assert.equal(summary.removedRunDir, false)
      assert.equal(existsSync(paths.runDir), true)
      assert.equal(readFileSync(paths.containersFile, 'utf8'), corruptBytes)
    })
  })

  it('inspects and force-removes containers with --type container and -- on the recorded daemon', () => {
    const daemonA: FakeDaemon = { id: 'daemon-a', containers: new Map([[CID_LEDGER, true]]) }
    const { runner, calls } = fakeDocker({ [ENDPOINT_A]: daemonA })

    assert.deepEqual(inspectContainer(CID_LEDGER, DAEMON_A, runner), { state: 'running' })
    daemonA.containers.set(CID_LEDGER, false)
    assert.deepEqual(inspectContainer(CID_LEDGER, DAEMON_A, runner), { state: 'stopped' })
    assert.deepEqual(removeContainer(CID_LEDGER, DAEMON_A, runner), {
      containerId: CID_LEDGER,
      removed: true,
      detail: `removed container ${CID_LEDGER}`,
    })
    assert.deepEqual(calls, [
      { args: 'info --format {{.ID}}', endpoint: ENDPOINT_A },
      { args: `inspect --type container -f {{.State.Running}} -- ${CID_LEDGER}`, endpoint: ENDPOINT_A },
      { args: 'info --format {{.ID}}', endpoint: ENDPOINT_A },
      { args: `inspect --type container -f {{.State.Running}} -- ${CID_LEDGER}`, endpoint: ENDPOINT_A },
      { args: 'info --format {{.ID}}', endpoint: ENDPOINT_A },
      { args: `rm -f -- ${CID_LEDGER}`, endpoint: ENDPOINT_A },
    ])

    // Gone from the confirmed daemon: inspect says stopped, and rm -f counts it removed whichever way it reports it.
    assert.deepEqual(inspectContainer(CID_LEDGER, DAEMON_A, runner), { state: 'stopped' })
    const silent = removeContainer(CID_LEDGER, DAEMON_A, runner)
    assert.equal(silent.removed, true)
    assert.match(silent.detail, /already absent from daemon-a/)
    daemonA.absent = 'stderr'
    assert.equal(removeContainer(CID_LEDGER, DAEMON_A, runner).removed, true)

    daemonA.rm = 'fail'
    const failed = removeContainer(CID_LEDGER, DAEMON_A, runner)
    assert.equal(failed.removed, false)
    assert.match(failed.detail, /Cannot connect to the Docker daemon/)

    const spawnFailed = removeContainer(CID_LEDGER, DAEMON_A, (args) =>
      args[0] === 'info'
        ? cmdOk('daemon-a\n')
        : { status: null, stdout: '', stderr: '', error: 'spawnSync docker ENOENT' },
    )
    assert.equal(spawnFailed.removed, false)
    assert.match(spawnFailed.detail, /ENOENT/)
  })

  it('keeps a container another daemon now answers for, without asking that daemon to remove it', () => {
    // The recorded socket now reaches a different daemon, as when /var/run/docker.sock is re-pointed.
    const daemonB: FakeDaemon = { id: 'daemon-b', containers: new Map() }
    const { runner, calls } = fakeDocker({ [ENDPOINT_A]: daemonB })

    const inspected = inspectContainer(CID_LEDGER, DAEMON_A, runner)
    assert.ok(inspected.state === 'unavailable')
    assert.match(inspected.detail, /now reaches Docker daemon daemon-b, not daemon-a/)

    const removed = removeContainer(CID_LEDGER, DAEMON_A, runner)
    assert.equal(removed.removed, false)
    assert.match(removed.detail, /kept container .*daemon-b, not daemon-a/)
    assert.deepEqual(
      calls.map((call) => call.args),
      ['info --format {{.ID}}', 'info --format {{.ID}}'],
    )

    // The owner answers the identity check, then the socket changes hands before the removal or inspection, and
    // the other daemon reports the ID absent. Asking again shows the change, so the record stays.
    const owner: FakeDaemon = { id: 'daemon-a', containers: new Map([[CID_LEDGER, true]]) }
    const switching = { [ENDPOINT_A]: owner }
    const midway = fakeDocker(switching)
    const switchAfterInfo: DockerCommandRunner = (args, target) => {
      const result = midway.runner(args, target)
      if (args[0] === 'info') {
        switching[ENDPOINT_A] = daemonB
      }
      return result
    }
    const kept = removeContainer(CID_LEDGER, DAEMON_A, switchAfterInfo)
    assert.equal(kept.removed, false)
    assert.match(kept.detail, /Docker reported it absent, but then .*daemon-b, not daemon-a/)
    switching[ENDPOINT_A] = owner
    const unsure = inspectContainer(CID_LEDGER, DAEMON_A, switchAfterInfo)
    assert.ok(unsure.state === 'unavailable')
    assert.match(unsure.detail, /Docker reported it absent, but then/)
    assert.equal(owner.containers.has(CID_LEDGER), true)
    assert.deepEqual(
      midway.calls.map((call) => call.args.split(' ')[0]),
      ['info', 'rm', 'info', 'info', 'inspect', 'info'],
    )

    // An unreachable daemon can't be confirmed either.
    const down = removeContainer(CID_LEDGER, DAEMON_A, fakeDocker({}).runner)
    assert.equal(down.removed, false)
    assert.match(down.detail, /cannot confirm Docker daemon daemon-a .*Cannot connect/)
    const odd = removeContainer(CID_LEDGER, DAEMON_A, () => cmdOk('two\nlines\n'))
    assert.equal(odd.removed, false)
    assert.match(odd.detail, /unexpected docker info output/)
  })

  it('counts only an exact, lone absence diagnostic for the requested ID as absence', () => {
    const lone = `Error response from daemon: No such container: ${CID_LEDGER}`
    assert.equal(reportsOnlyAbsence(lone, CID_LEDGER), true)
    assert.equal(reportsOnlyAbsence(`${lone}\n`, CID_LEDGER), true)
    assert.equal(reportsOnlyAbsence(`Error: No such object: ${CID_LEDGER}`, CID_LEDGER), true)
    assert.equal(reportsOnlyAbsence(`No such container: ${CID_LEDGER}`, CID_LEDGER), true)
    assert.equal(reportsOnlyAbsence(`Error response from daemon: No such container: ${CID_TREZOR}`, CID_LEDGER), false)
    assert.equal(
      reportsOnlyAbsence(`Error response from daemon: No such container: ${CID_LEDGER.slice(0, 12)}`, CID_LEDGER),
      false,
    )
    assert.equal(reportsOnlyAbsence(`${lone}\nCannot connect to the Docker daemon`, CID_LEDGER), false)
    assert.equal(reportsOnlyAbsence(`Cannot connect to the Docker daemon\n${lone}`, CID_LEDGER), false)
    assert.equal(reportsOnlyAbsence(`${lone}extra`, CID_LEDGER), false)
    assert.equal(reportsOnlyAbsence('', CID_LEDGER), false)

    const answer =
      (result: CommandResult): DockerCommandRunner =>
      (args) =>
        args[0] === 'info' ? cmdOk('daemon-a\n') : result
    const compound = cmdFail(`${lone}\nError response from daemon: removal of container is already in progress`)
    assert.equal(removeContainer(CID_LEDGER, DAEMON_A, answer(compound)).removed, false)
    assert.equal(inspectContainer(CID_LEDGER, DAEMON_A, answer(compound)).state, 'unavailable')
    const otherId = cmdFail(`Error response from daemon: No such container: ${CID_TREZOR}`)
    assert.equal(removeContainer(CID_LEDGER, DAEMON_A, answer(otherId)).removed, false)
    assert.equal(inspectContainer(CID_LEDGER, DAEMON_A, answer(otherId)).state, 'unavailable')
    // Exit 0 with output that isn't the ID, or with a warning beside the diagnostic, is not a confirmed removal.
    assert.equal(removeContainer(CID_LEDGER, DAEMON_A, answer(cmdOk(`${CID_TREZOR}\n`))).removed, false)
    const warned = { status: 0, stdout: '', stderr: `WARNING: something\n${lone}`, error: null }
    assert.equal(removeContainer(CID_LEDGER, DAEMON_A, answer(warned)).removed, false)
  })

  it('removes an unpinned older record only when Docker echoes its ID, never on absence', () => {
    const caller: FakeDaemon = { id: 'daemon-x', containers: new Map([[CID_LEDGER, false]]) }
    const { runner, calls } = fakeDocker({ caller })
    assert.deepEqual(inspectContainer(CID_LEDGER, undefined, runner), { state: 'stopped' })
    assert.equal(removeContainer(CID_LEDGER, undefined, runner).removed, true)
    // No daemon to confirm, so nothing calls docker info, and absence proves nothing.
    assert.equal(
      calls.some((call) => call.args.startsWith('info')),
      false,
    )
    assert.ok(calls.every((call) => call.endpoint === undefined))
    const absent = removeContainer(CID_LEDGER, undefined, runner)
    assert.equal(absent.removed, false)
    assert.match(absent.detail, /names no daemon/)
    const inspected = inspectContainer(CID_LEDGER, undefined, runner)
    assert.equal(inspected.state, 'unavailable')
  })

  it('removes every recorded container on its daemon and stops every recorded process group during cleanup', async () => {
    await withRun('verify-cleanup-', 'cleanup-emu-run', async (paths, root) => {
      const evidenceRoot = join(root, 'evidence')
      mkdirSync(paths.logsDir, { recursive: true })
      writeFileSync(join(paths.logsDir, 'sentinel.log'), 'hello\n')

      const daemonB: DockerDaemon = { daemonId: 'daemon-b', endpoint: 'unix:///fake/desktop.sock' }
      await recordProcess(paths, { name: 'fakes', pid: 1001, startedAt: 't1' })
      await recordProcess(paths, { name: 'emulator:ledger-bridge', pid: 1002, startedAt: 't2' })
      await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
      writeJson(
        paths.stateFile,
        runStateFixture(paths.runId, [
          {
            device: 'ledger',
            model: 'flex',
            seed: 'primary',
            containerId: CID_LEDGER,
            daemon: DAEMON_A,
            apiPort: 15000,
            healthUrl: 'http://127.0.0.1:15000/events',
            bridge: {
              name: 'emulator:ledger-bridge',
              pid: 1002,
              startedAt: 't2',
              port: 15001,
              url: 'http://127.0.0.1:15001',
            },
          },
          {
            device: 'trezor',
            seed: 'secondary',
            containerId: CID_TREZOR,
            daemon: daemonB,
            apiPort: 9001,
            healthUrl: 'http://127.0.0.1:9001/health',
            bridge: {
              name: 'emulator:trezor-bridge',
              pid: 1004,
              startedAt: 't4',
              port: 21335,
              url: 'ws://127.0.0.1:21335/connect-ws',
            },
          },
        ]),
      )

      const stopped: RecordedProcess[] = []
      const removed: Array<[string, string | undefined]> = []
      const summary = await cleanupRunResources(paths, {
        stopProcess: async (recorded) => {
          stopped.push(recorded)
        },
        removeContainer: (containerId, daemon) => {
          removed.push([containerId, daemon?.daemonId])
          return { containerId, removed: true, detail: `removed container ${containerId}` }
        },
        evidenceRoot,
        log: () => {},
      })

      assert.equal(summary.ok, true)
      assert.equal(summary.removedRunDir, true)
      // processes.json first, then run.json's Sentinel and bridges it lacks, each once.
      assert.deepEqual(
        stopped.map((entry) => entry.pid),
        [1001, 1002, 1003, 1004],
      )
      assert.deepEqual(removed, [
        [CID_LEDGER, 'daemon-a'],
        [CID_TREZOR, 'daemon-b'],
      ])
      assert.equal(existsSync(paths.runDir), false)
      assert.equal(readFileSync(join(evidenceRoot, paths.runId, 'logs', 'sentinel.log'), 'utf8'), 'hello\n')
    })
  })

  it('preserves runDir and failed container records on partial docker rm failure, then cleans up on retry', async () => {
    await withRun('verify-cleanup-retry-', 'cleanup-retry-run', async (paths, root) => {
      await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
      await recordContainer(paths, container('emulator:coldcard', CID_COLDCARD))

      const firstSummary = await cleanupRunResources(paths, {
        ...noopCleanup(root),
        removeContainer: (containerId) =>
          containerId === CID_LEDGER
            ? { containerId, removed: true, detail: `removed container ${containerId}` }
            : { containerId, removed: false, detail: `could not remove container ${containerId}: daemon error` },
      })

      assert.equal(firstSummary.ok, false)
      assert.equal(firstSummary.removedRunDir, false)
      assert.equal(existsSync(paths.runDir), true)
      // The confirmed-removed container is pruned; the failed one stays tracked, with its daemon, for the retry.
      assert.deepEqual(readContainers(paths), [container('emulator:coldcard', CID_COLDCARD)])

      const retriedIds: string[] = []
      const retrySummary = await cleanupRunResources(paths, {
        ...noopCleanup(root),
        removeContainer: (containerId) => {
          retriedIds.push(containerId)
          return { containerId, removed: true, detail: `removed container ${containerId}` }
        },
      })

      assert.equal(retrySummary.ok, true)
      assert.equal(retrySummary.removedRunDir, true)
      assert.deepEqual(retriedIds, [CID_COLDCARD])
      assert.equal(existsSync(paths.runDir), false)
    })
  })

  it('keeps the run when the recorded socket reaches another daemon, then cleans up once the owner answers again', async () => {
    await withRun('verify-cleanup-switch-', 'cleanup-switch-run', async (paths, root) => {
      const daemonA: FakeDaemon = { id: 'daemon-a', containers: new Map([[CID_LEDGER, true]]) }
      const daemonB: FakeDaemon = { id: 'daemon-b', containers: new Map() }
      const endpoints = { [ENDPOINT_A]: daemonB }
      const { runner, calls } = fakeDocker(endpoints)
      await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
      writeJson(
        paths.stateFile,
        runStateFixture(paths.runId, [
          {
            device: 'ledger',
            model: 'nanosp',
            seed: 'primary',
            containerId: CID_LEDGER,
            daemon: DAEMON_A,
            apiPort: 15000,
            healthUrl: 'http://127.0.0.1:15000/events',
          },
        ]),
      )
      const containersBefore = readFileSync(paths.containersFile, 'utf8')
      const deps: CleanupDeps = {
        ...noopCleanup(root),
        removeContainer: (containerId, daemon) => removeContainer(containerId, daemon, runner),
      }

      const refused = await cleanupRunResources(paths, deps)
      assert.equal(refused.ok, false)
      assert.match(refused.errors.join('\n'), /daemon-b, not daemon-a/)
      assert.equal(existsSync(paths.runDir), true)
      assert.equal(readFileSync(paths.containersFile, 'utf8'), containersBefore)
      assert.equal(
        calls.some((call) => call.args.startsWith('rm')),
        false,
      )
      assert.equal(daemonA.containers.has(CID_LEDGER), true)

      endpoints[ENDPOINT_A] = daemonA
      const retried = await cleanupRunResources(paths, deps)
      assert.equal(retried.ok, true)
      assert.equal(existsSync(paths.runDir), false)
      assert.equal(daemonA.containers.has(CID_LEDGER), false)
    })
  })

  it('cleans up from the journals when run.json is invalid, keeping logs and removing the run folder', async () => {
    for (const [label, writeState] of [
      [
        'corrupt',
        (paths: RunPaths) => {
          writeFileSync(paths.stateFile, '{"runId": ')
        },
      ],
      [
        'mismatched',
        (paths: RunPaths) => {
          writeJson(paths.stateFile, runStateFixture('someone-else'))
        },
      ],
    ] as const) {
      await withRun(`verify-cleanup-badstate-${label}-`, 'badstate-run', async (paths, root) => {
        mkdirSync(paths.logsDir, { recursive: true })
        writeFileSync(join(paths.logsDir, 'sentinel.log'), 'kept\n')
        await recordProcess(paths, { name: 'sentinel', pid: 2001, startedAt: 't1' })
        await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
        writeState(paths)

        const stopped: number[] = []
        const removed: string[] = []
        const lines: string[] = []
        const summary = await cleanupRunResources(paths, {
          stopProcess: async (recorded) => {
            stopped.push(recorded.pid)
          },
          removeContainer: (containerId) => {
            removed.push(containerId)
            return { containerId, removed: true, detail: `removed container ${containerId}` }
          },
          evidenceRoot: join(root, 'evidence'),
          log: (line) => {
            lines.push(line)
          },
        })

        assert.equal(summary.ok, true, label)
        assert.deepEqual(stopped, [2001])
        assert.deepEqual(removed, [CID_LEDGER])
        assert.equal(existsSync(paths.runDir), false)
        assert.equal(readFileSync(join(root, 'evidence', paths.runId, 'logs', 'sentinel.log'), 'utf8'), 'kept\n')
        assert.match(lines.join('\n'), /cleaning up from containers\.json and processes\.json/)
      })
    }
    await withRun('verify-cleanup-badstate-mismatch-text-', 'badstate-run', async (paths, root) => {
      writeJson(paths.stateFile, runStateFixture('someone-else'))
      const lines: string[] = []
      await cleanupRunResources(paths, {
        ...noopCleanup(root),
        log: (line) => {
          lines.push(line)
        },
      })
      assert.match(lines.join('\n'), /does not match directory/)
      assert.doesNotMatch(lines.join('\n'), /does not parse/)
    })
  })

  it('keeps the run folder and fails when processes.json is invalid, instead of treating it as no processes', async () => {
    await withRun('verify-cleanup-badprocs-', 'badprocs-run', async (paths, root) => {
      const corrupt = '[{"name": "sentinel", "pid": '
      writeFileSync(paths.processesFile, corrupt)
      await recordContainer(paths, container('emulator:ledger', CID_LEDGER))
      writeJson(paths.stateFile, runStateFixture(paths.runId))

      assert.throws(() => readProcesses(paths), /processes\.json does not parse/)
      await assert.rejects(recordProcess(paths, { name: 'x', pid: 1, startedAt: 't' }), /does not parse/)

      const stopped: number[] = []
      const summary = await cleanupRunResources(paths, {
        ...noopCleanup(root),
        stopProcess: async (recorded) => {
          stopped.push(recorded.pid)
        },
        removeContainer: (containerId) => ({ containerId, removed: true, detail: 'removed' }),
      })
      assert.equal(summary.ok, false)
      assert.match(summary.errors.join('\n'), /processes\.json does not parse; keeping/)
      assert.equal(existsSync(paths.runDir), true)
      assert.equal(readFileSync(paths.processesFile, 'utf8'), corrupt)
      // It still stops what run.json names and removes what containers.json names.
      assert.deepEqual(stopped, [1001, 1003])
      assert.deepEqual(readContainers(paths), [])
    })
  })

  it('resolves the shared Ledger ELF cache dir under BCC_VERIFY_CACHE_DIR root and rejects relative paths', () => {
    try {
      vi.stubEnv('BCC_VERIFY_CACHE_DIR', '')
      assert.equal(ledgerElfCacheDir(), join(homedir(), '.cache', 'bitcoin-control-center', 'ledger-elfs'))
      vi.stubEnv('BCC_VERIFY_CACHE_DIR', '   ')
      assert.equal(ledgerElfCacheDir(), join(homedir(), '.cache', 'bitcoin-control-center', 'ledger-elfs'))
      vi.stubEnv('BCC_VERIFY_CACHE_DIR', '  /tmp/custom-bcc-cache-root  ')
      assert.equal(ledgerElfCacheDir(), '/tmp/custom-bcc-cache-root/ledger-elfs')
      vi.stubEnv('BCC_VERIFY_CACHE_DIR', 'relative/cache-dir')
      assert.throws(() => ledgerElfCacheDir(), /BCC_VERIFY_CACHE_DIR must be an absolute path/)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('captureDockerDaemon', () => {
  const contextJson = (host: string, tls: Readonly<Record<string, readonly string[]>> = {}): string =>
    JSON.stringify([{ Name: 'x', Endpoints: { docker: { Host: host, SkipTLSVerify: false } }, TLSMaterial: tls }])

  /** A Docker double answering context and info calls; records each call with where it was sent. */
  function contextDocker(contexts: Record<string, string>, current: string, ids: Record<string, string>) {
    const calls: Array<{ args: string; endpoint: string | undefined }> = []
    const runner: DockerCommandRunner = (args, target) => {
      calls.push({ args: args.join(' '), endpoint: target?.endpoint })
      if (args.join(' ') === 'context show') {
        return cmdOk(`${current}\n`)
      }
      if (args[0] === 'context' && args[1] === 'inspect') {
        const host = contexts[args.at(-1) ?? '']
        return host === undefined ? cmdFail('context not found') : cmdOk(host)
      }
      if (args[0] === 'info') {
        const id = ids[target?.endpoint ?? '']
        return id === undefined ? cmdFail('Cannot connect to the Docker daemon') : cmdOk(`${id}\n`)
      }
      return cmdFail('unexpected', 99)
    }
    return { runner, calls }
  }

  it('follows the Docker CLI: DOCKER_HOST over DOCKER_CONTEXT over the current context', () => {
    const contexts = {
      colima: contextJson('unix:///u/.colima/docker.sock'),
      desktop: contextJson('unix:///u/.docker/run/docker.sock'),
    }
    const ids = {
      'unix:///u/.colima/docker.sock': 'colima-id',
      'unix:///u/.docker/run/docker.sock': 'desktop-id',
      'unix:///custom.sock': 'custom-id',
    }

    const byHost = contextDocker(contexts, 'desktop', ids)
    const host = captureDockerDaemon(byHost.runner, { host: 'unix:///custom.sock', context: 'colima', config: '/cfg' })
    assert.deepEqual(host.unwrap(), { daemonId: 'custom-id', endpoint: 'unix:///custom.sock', dockerConfig: '/cfg' })
    assert.deepEqual(byHost.calls, [{ args: 'info --format {{.ID}}', endpoint: 'unix:///custom.sock' }])

    const byContext = contextDocker(contexts, 'desktop', ids)
    const context = captureDockerDaemon(byContext.runner, { context: 'colima' })
    assert.deepEqual(context.unwrap(), {
      daemonId: 'colima-id',
      context: 'colima',
      endpoint: 'unix:///u/.colima/docker.sock',
    })
    assert.deepEqual(
      byContext.calls.map((call) => call.args),
      ['context inspect -- colima', 'info --format {{.ID}}'],
    )

    const byCurrent = contextDocker(contexts, 'desktop', ids)
    const current = captureDockerDaemon(byCurrent.runner, {})
    assert.deepEqual(current.unwrap(), {
      daemonId: 'desktop-id',
      context: 'desktop',
      endpoint: 'unix:///u/.docker/run/docker.sock',
    })
    assert.deepEqual(byCurrent.calls, [
      { args: 'context show', endpoint: undefined },
      { args: 'context inspect -- desktop', endpoint: undefined },
      { args: 'info --format {{.ID}}', endpoint: 'unix:///u/.docker/run/docker.sock' },
    ])
  })

  it('accepts loopback TCP and refuses remote, TLS, unknown and unreachable daemons before recording anything', () => {
    const ids = { 'tcp://127.0.0.1:2375': 'loopback-id' }
    const loopback = contextDocker({}, 'default', ids)
    assert.equal(
      captureDockerDaemon(loopback.runner, { host: 'tcp://127.0.0.1:2375' }).unwrap()?.daemonId,
      'loopback-id',
    )

    for (const [host, pattern] of [
      ['ssh://build.example.com', /ssh:\/\/build\.example\.com is not local/],
      ['ssh://builder@build.example.com', /ssh:\/\/ Docker endpoint carries a user/],
      ['tcp://10.0.0.5:2376', /tcp:\/\/10\.0\.0\.5:2376 is not local/],
      ['tcp://user:secret@127.0.0.1:2375', /carries a user, query or fragment/],
      ['unix://user:secret@localhost/var/run/docker.sock', /carries a user, query or fragment/],
      ['unix://user:secret@/var/run/docker.sock', /not a URL/],
      ['unix:///var/run/docker.sock?token=secret', /carries a user, query or fragment/],
      ['npipe:////./pipe/docker_engine#secret', /carries a user, query or fragment/],
      ['tcp://127.0.0.1:2375/?secret=1', /carries a user, query or fragment/],
      ['tcp://127.0.0.1:2375#secret', /carries a user, query or fragment/],
      ['not a url', /not a URL/],
    ] as const) {
      const { runner, calls } = contextDocker({}, 'default', ids)
      const result = captureDockerDaemon(runner, { host })
      assert.equal(result.isErr(), true, host)
      assert.match(result.unwrapErr() ?? '', pattern)
      assert.doesNotMatch(result.unwrapErr() ?? '', /secret|builder/)
      assert.deepEqual(calls, [], host)
    }

    const tls = contextDocker(
      { remote: contextJson('tcp://127.0.0.1:2376', { docker: ['ca.pem', 'cert.pem', 'key.pem'] }) },
      'remote',
      ids,
    )
    assert.match(captureDockerDaemon(tls.runner, {}).unwrapErr() ?? '', /uses TLS/)
    assert.equal(
      tls.calls.some((call) => call.args.startsWith('info')),
      false,
    )
    // Docker turns TLS on for a context that skips verification, even with no certificate files.
    const skipVerify = contextDocker(
      {
        skip: JSON.stringify([
          {
            Name: 'skip',
            Endpoints: { docker: { Host: 'tcp://127.0.0.1:2376', SkipTLSVerify: true } },
            TLSMaterial: {},
          },
        ]),
      },
      'skip',
      { 'tcp://127.0.0.1:2376': 'tls-id' },
    )
    assert.match(captureDockerDaemon(skipVerify.runner, {}).unwrapErr() ?? '', /uses TLS/)
    assert.deepEqual(
      skipVerify.calls.map((call) => call.args),
      ['context show', 'context inspect -- skip'],
    )

    const badName = contextDocker({}, '--host=evil', ids)
    assert.match(captureDockerDaemon(badName.runner, {}).unwrapErr() ?? '', /is not valid/)
    const missing = contextDocker({}, 'gone', ids)
    assert.match(captureDockerDaemon(missing.runner, {}).unwrapErr() ?? '', /Could not inspect Docker context gone/)
    const down = contextDocker({}, 'default', {})
    assert.match(
      captureDockerDaemon(down.runner, { host: 'unix:///nobody.sock' }).unwrapErr() ?? '',
      /Could not read the Docker daemon's ID/,
    )
  })
})

describe('run tracking lock', () => {
  const daemon: DockerDaemon = { daemonId: 'daemon-a', endpoint: ENDPOINT_A }
  const hexId = (label: string): string => createHash('sha256').update(label).digest('hex')

  it('keeps run locks outside every run folder and outside the folder run listings read', () => {
    const paths = runPaths('lock-location-run')
    assert.equal(isPathInside(paths.lockDir, paths.runDir), false)
    assert.equal(isPathInside(paths.lockDir, dirname(paths.runDir)), false)
    assert.equal(basename(paths.lockDir), 'lock-location-run.lock')
  })

  it('serializes concurrent writers across processes without losing an entry', async () => {
    await withRun('verify-lock-procs-', 'lock-procs-run', async (paths, root) => {
      const worker = join(root, 'worker.mts')
      writeFileSync(
        worker,
        `import { recordContainer, recordProcess } from ${JSON.stringify(join(REPO_ROOT, 'tools/verify/run.ts'))}
import { createHash } from 'node:crypto'
const [pathsJson, label, count] = process.argv.slice(2)
const paths = JSON.parse(pathsJson)
for (let i = 0; i < Number(count); i++) {
  await recordProcess(paths, { name: label + '-' + i, pid: 1000 + i, startedAt: label })
  const containerId = createHash('sha256').update(label + '-' + i).digest('hex')
  await recordContainer(paths, { name: label + '-' + i, containerId, image: 'x', startedAt: label, daemon: ${JSON.stringify(daemon)} })
}
`,
      )
      const labels = ['w1', 'w2', 'w3', 'w4']
      const perWorker = 8
      const results = await Promise.all(
        labels.map(async (label) =>
          runAsync(
            join(REPO_ROOT, 'node_modules/.bin/tsx'),
            ['--tsconfig', 'tools/verify/tsconfig.json', worker, JSON.stringify(paths), label, String(perWorker)],
            { cwd: REPO_ROOT, env: ChildEnv.with(), timeoutMs: 60_000 },
          ),
        ),
      )
      for (const result of results) {
        assert.equal(result.code, 0, result.stderr)
      }
      const expected = labels.flatMap((label) => Array.from({ length: perWorker }, (_, i) => `${label}-${i}`)).sort()
      assert.deepEqual(
        readProcesses(paths)
          .map((entry) => entry.name)
          .sort(),
        expected,
      )
      assert.deepEqual(
        readContainers(paths)
          .map((entry) => entry.name)
          .sort(),
        expected,
      )
      assert.deepEqual(
        readContainers(paths)
          .map((entry) => entry.containerId)
          .sort(),
        expected.map(hexId).sort(),
      )
      assert.equal(existsSync(paths.lockDir), false)
    })
  }, 90_000)

  it('serializes concurrent writers in one process', async () => {
    await withRun('verify-lock-inproc-', 'lock-inproc-run', async (paths) => {
      await Promise.all(
        Array.from({ length: 12 }, async (_, i) => {
          await recordProcess(paths, { name: `p${i}`, pid: 100 + i, startedAt: 't' })
          await recordContainer(paths, container(`c${i}`, hexId(`c${i}`)))
        }),
      )
      assert.equal(readProcesses(paths).length, 12)
      assert.equal(readContainers(paths).length, 12)
    })

    function container(name: string, containerId: string): PinnedContainer {
      return { name, containerId, image: 'x', startedAt: 't', daemon }
    }
  })

  it('reclaims a lock left by a process that has exited', async () => {
    await withRun('verify-lock-stale-', 'lock-stale-run', async (paths) => {
      mkdirSync(paths.lockDir, { recursive: true })
      // A PID that no longer runs this process: ps reports another start time, or none.
      writeFileSync(
        join(paths.lockDir, 'owner.json'),
        JSON.stringify({ pid: process.pid, startedAt: 'long ago', hostname: hostname(), token: 'dead' }),
      )
      await recordProcess(paths, { name: 'after-stale', pid: 7, startedAt: 't' })
      assert.deepEqual(
        readProcesses(paths).map((entry) => entry.name),
        ['after-stale'],
      )
      assert.equal(existsSync(paths.lockDir), false)
    })
  })

  it('makes a writer that waited on cleanup refuse to recreate the removed run', async () => {
    await withRun('verify-lock-late-', 'lock-late-run', async (paths, root) => {
      await recordProcess(paths, { name: 'sentinel', pid: 3001, startedAt: 't' })
      let release = (): void => {}
      const held = new Promise<void>((done) => {
        release = done
      })
      let entered = (): void => {}
      const stopping = new Promise<void>((done) => {
        entered = done
      })
      const cleanup = cleanupRunResources(paths, {
        ...noopCleanup(root),
        stopProcess: async () => {
          entered()
          await held
        },
      })
      await stopping
      // Cleanup holds the lock while it stops processes; this writer has to wait for it.
      const late = recordProcess(paths, { name: 'late', pid: 3002, startedAt: 't' })
      await wait(100)
      release()
      assert.equal((await cleanup).ok, true)
      await assert.rejects(late, /was cleaned up .*refusing to write processes\.json/)
      assert.equal(existsSync(paths.runDir), false)
    })
  })

  it('makes seed and fault writes refuse once cleanup has removed the run', async () => {
    await withRun('verify-lock-seed-fault-', 'lock-seed-fault-run', async (paths) => {
      await withRunLock(paths, (tracking) => {
        tracking.writeFaults(NO_FAULTS)
        tracking.writeSeedMarker(paths.seedFile, { seededAt: 't', accounts: {}, statements: [] })
      })
      assert.equal(existsSync(paths.faultsFile), true)
      assert.equal(existsSync(paths.seedFile), true)
      rmSync(paths.runDir, { recursive: true, force: true })
      await assert.rejects(
        withRunLock(paths, (tracking) => {
          tracking.writeFaults(NO_FAULTS)
        }),
        /was cleaned up .*refusing to write faults\.json/,
      )
      await assert.rejects(
        withRunLock(paths, (tracking) => {
          tracking.writeSeedMarker(paths.seedFile, { seededAt: 't', accounts: {}, statements: [] })
        }),
        /refusing to write verify-seed\.json/,
      )
      assert.equal(existsSync(paths.runDir), false)
    })
  })

  it('refuses writes through a tracking handle once its lock is released', async () => {
    await withRun('verify-lock-handle-', 'lock-handle-run', async (paths) => {
      const leaked = await withRunLock(paths, (tracking) => tracking)
      assert.throws(() => {
        leaked.recordProcess({ name: 'late', pid: 1, startedAt: 't' })
      }, /without holding/)
      assert.equal(existsSync(paths.processesFile), false)
    })
  })
})

describe('writeJson', () => {
  const tempSiblings = (dir: string): string[] => readdirSync(dir).filter((name) => name.endsWith('.tmp'))

  it('removes its temp file and rethrows when the rename fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-writejson-rename-'))
    try {
      const target = join(root, 'run.json')
      // A non-empty directory in the target's place makes the rename fail after the temp file is written.
      mkdirSync(join(target, 'occupied'), { recursive: true })
      assert.throws(() => {
        writeJson(target, NO_FAULTS)
      }, /EISDIR|ENOTEMPTY|EEXIST|EPERM/)
      assert.deepEqual(tempSiblings(root), [])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('leaves nothing behind and rethrows when the write fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-writejson-write-'))
    try {
      const target = join(root, 'faults.json')
      writeJson(target, NO_FAULTS)
      chmodSync(root, 0o500)
      try {
        assert.throws(() => {
          writeJson(target, { ...NO_FAULTS, seq: 1 })
        }, /EACCES|EPERM/)
      } finally {
        chmodSync(root, 0o700)
      }
      assert.deepEqual(tempSiblings(root), [])
      assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(NO_FAULTS, null, 2)}\n`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
