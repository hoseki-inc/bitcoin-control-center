import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result'
import { describe, it, vi } from 'vitest'
import { blockTime, currentPrice, indexChain, tipHeight } from './chain'
import { ChildEnv, type CommandResult, runCommand } from './process'
import {
  ContainerSchema,
  EmulatorStateSchema,
  type RecordedProcess,
  buildStamp,
  cleanupRunResources,
  forgetContainer,
  inspectContainer,
  isContainerRunning,
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
  readRunState,
  recordContainer,
  recordProcess,
  removeContainer,
  resolveDataDir,
  resolveSeedFile,
  runPaths,
  verifyCapableBundleProblem,
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
  }
}

describe('container tracking and cleanup', () => {
  const CID_LEDGER = 'a'.repeat(64)
  const CID_TREZOR = 'b'.repeat(64)
  const CID_COLDCARD = 'c'.repeat(64)

  const cmdOk = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '', error: null })
  const cmdFail = (stderr: string, status = 1): CommandResult => ({ status, stdout: '', stderr, error: null })

  it('validates full 64-character lowercase hex container IDs at schema and recording boundaries', () => {
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

    const root = mkdtempSync(join(tmpdir(), 'verify-invalid-cid-'))
    try {
      const paths = tempPaths(root)
      assert.throws(() => {
        recordContainer(paths, {
          name: 'emulator:ledger',
          containerId: 'short-id',
          image: 'speculos:test',
          startedAt: '2026-11-25T17:00:00Z',
        })
      }, /64-character lowercase hex/)
      assert.equal(existsSync(paths.containersFile), false)

      assert.throws(() => {
        forgetContainer(paths, '--all')
      }, /Invalid container ID/)

      const dockerCalls: string[][] = []
      const spyDocker = (args: string[]): CommandResult => {
        dockerCalls.push(args)
        return cmdOk()
      }
      assert.equal(inspectContainer('-bad', spyDocker).state, 'unavailable')
      assert.equal(removeContainer('short-id', spyDocker).removed, false)
      assert.deepEqual(dockerCalls, [])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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

  it('rejects run.json when runId does not match the run folder', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-runid-mismatch-'))
    try {
      const paths = tempPaths(root, 'expected-run')
      writeJson(paths.stateFile, {
        runId: 'different-run',
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
      })
      assert.equal(readRunState(paths).status, 'invalid')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('records, reads, and forgets Docker containers in containers.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-containers-'))
    try {
      const paths = tempPaths(root)
      assert.equal(readContainersFile(paths).status, 'missing')
      assert.deepEqual(readContainers(paths), [])

      recordContainer(paths, {
        name: 'emulator:ledger',
        containerId: CID_LEDGER,
        image: 'ghcr.io/ledgerhq/speculos:latest',
        startedAt: '2026-11-25T17:00:00Z',
      })
      recordContainer(paths, {
        name: 'emulator:trezor',
        containerId: CID_TREZOR,
        image: 'trezor-emu:test',
        startedAt: '2026-11-25T17:01:00Z',
      })
      assert.equal(readContainers(paths).length, 2)

      forgetContainer(paths, CID_LEDGER)
      assert.deepEqual(
        readContainers(paths).map((entry) => entry.containerId),
        [CID_TREZOR],
      )
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('never treats corrupt containers.json as empty or overwrites/deletes it', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-corrupt-unit-'))
    try {
      const paths = tempPaths(root, 'corrupt-unit-run')
      mkdirSync(paths.runDir, { recursive: true })
      const corruptBytes = '[{"name": "broken"'
      writeFileSync(paths.containersFile, corruptBytes)

      assert.equal(readContainersFile(paths).status, 'invalid')
      assert.throws(() => readContainers(paths), /does not parse/)
      assert.throws(() => {
        recordContainer(paths, {
          name: 'emulator:ledger',
          containerId: CID_LEDGER,
          image: 'speculos:test',
          startedAt: '2026-11-25T17:00:00Z',
        })
      }, /does not parse/)
      assert.throws(() => {
        forgetContainer(paths, CID_LEDGER)
      }, /does not parse/)
      assert.equal(readFileSync(paths.containersFile, 'utf8'), corruptBytes)

      const summary = await cleanupRunResources(paths, {
        stopProcess: async () => {},
        removeContainer: () => {
          throw new Error('should not call removeContainer for corrupt containers.json')
        },
        evidenceRoot: join(root, 'evidence'),
        log: () => {},
      })
      assert.equal(summary.ok, false)
      assert.equal(summary.removedRunDir, false)
      assert.equal(existsSync(paths.runDir), true)
      assert.equal(readFileSync(paths.containersFile, 'utf8'), corruptBytes)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('inspects and force-removes containers with --type container and --, distinguishing absence from Docker failures', () => {
    const inspectCalls: string[][] = []
    assert.deepEqual(
      inspectContainer(CID_LEDGER, (args) => {
        inspectCalls.push(args)
        return cmdOk('true\n')
      }),
      { state: 'running' },
    )
    assert.deepEqual(inspectCalls[0], ['inspect', '--type', 'container', '-f', '{{.State.Running}}', '--', CID_LEDGER])
    assert.equal(
      isContainerRunning(CID_LEDGER, () => cmdOk('false\n')),
      false,
    )
    assert.deepEqual(
      inspectContainer(CID_LEDGER, () => cmdFail(`Error response from daemon: No such container: ${CID_LEDGER}`)),
      { state: 'stopped' },
    )
    const unavailable = inspectContainer(CID_LEDGER, () => cmdFail('Cannot connect to the Docker daemon'))
    assert.equal(unavailable.state, 'unavailable')
    assert.match(unavailable.detail, /Cannot connect to the Docker daemon/)

    const rmCalls: string[][] = []
    const okResult = removeContainer(CID_LEDGER, (args) => {
      rmCalls.push(args)
      return cmdOk(`${CID_LEDGER}\n`)
    })
    assert.equal(okResult.removed, true)
    assert.deepEqual(rmCalls[0], ['rm', '-f', '--', CID_LEDGER])

    const absentResult = removeContainer(CID_LEDGER, () =>
      cmdFail(`Error response from daemon: No such container: ${CID_LEDGER}`),
    )
    assert.equal(absentResult.removed, true)
    assert.match(absentResult.detail, /already absent/)

    const errResult = removeContainer(CID_LEDGER, () => cmdFail('Cannot connect to the Docker daemon'))
    assert.equal(errResult.removed, false)
    assert.match(errResult.detail, /Cannot connect to the Docker daemon/)

    const spawnErrResult = removeContainer(CID_LEDGER, () => ({
      status: null,
      stdout: '',
      stderr: '',
      error: 'spawnSync docker ENOENT',
    }))
    assert.equal(spawnErrResult.removed, false)
    assert.match(spawnErrResult.detail, /ENOENT/)
  })

  it('removes every recorded container ID and stops every bridge process group during cleanup', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-cleanup-'))
    try {
      const paths = tempPaths(root, 'cleanup-emu-run')
      const evidenceRoot = join(root, 'evidence')
      mkdirSync(paths.logsDir, { recursive: true })
      writeFileSync(join(paths.logsDir, 'sentinel.log'), 'hello\n')

      recordProcess(paths, { name: 'fakes', pid: 1001, startedAt: 't1' })
      recordProcess(paths, { name: 'emulator:ledger-bridge', pid: 1002, startedAt: 't2' })
      recordContainer(paths, {
        name: 'emulator:ledger',
        containerId: CID_LEDGER,
        image: 'ghcr.io/ledgerhq/speculos:latest',
        startedAt: 't2',
      })
      writeJson(paths.stateFile, {
        runId: paths.runId,
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
        emulators: [
          {
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
          },
          {
            device: 'trezor',
            seed: 'secondary',
            containerId: CID_TREZOR,
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
        ],
      })

      const stopped: RecordedProcess[] = []
      const removedIds: string[] = []
      const summary = await cleanupRunResources(paths, {
        stopProcess: async (recorded) => {
          stopped.push(recorded)
        },
        removeContainer: (containerId) => {
          removedIds.push(containerId)
          return { containerId, removed: true, detail: `removed container ${containerId}` }
        },
        evidenceRoot,
        log: () => {},
      })

      assert.equal(summary.ok, true)
      assert.equal(summary.removedRunDir, true)
      assert.deepEqual(
        stopped.map((entry) => entry.pid),
        [1001, 1002, 1004],
      )
      assert.deepEqual(removedIds, [CID_LEDGER, CID_TREZOR])
      assert.equal(summary.removedContainers.length, 2)
      assert.equal(existsSync(paths.runDir), false)
      assert.equal(readFileSync(join(evidenceRoot, paths.runId, 'logs', 'sentinel.log'), 'utf8'), 'hello\n')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves runDir and failed container records on partial docker rm failure, then cleans up on retry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'verify-cleanup-retry-'))
    try {
      const paths = tempPaths(root, 'cleanup-retry-run')
      const evidenceRoot = join(root, 'evidence')
      recordContainer(paths, {
        name: 'emulator:ledger',
        containerId: CID_LEDGER,
        image: 'speculos:test',
        startedAt: 't1',
      })
      recordContainer(paths, {
        name: 'emulator:coldcard',
        containerId: CID_COLDCARD,
        image: 'coldcard:test',
        startedAt: 't2',
      })

      const firstSummary = await cleanupRunResources(paths, {
        stopProcess: async () => {},
        removeContainer: (containerId) =>
          containerId === CID_LEDGER
            ? { containerId, removed: true, detail: `removed container ${containerId}` }
            : { containerId, removed: false, detail: `could not remove container ${containerId}: daemon error` },
        evidenceRoot,
        log: () => {},
      })

      assert.equal(firstSummary.ok, false)
      assert.equal(firstSummary.removedRunDir, false)
      assert.equal(existsSync(paths.runDir), true)
      // Confirmed-removed container is pruned; failed container remains tracked for retry.
      assert.deepEqual(
        readContainers(paths).map((entry) => entry.containerId),
        [CID_COLDCARD],
      )

      const retriedIds: string[] = []
      const retrySummary = await cleanupRunResources(paths, {
        stopProcess: async () => {},
        removeContainer: (containerId) => {
          retriedIds.push(containerId)
          return { containerId, removed: true, detail: `removed container ${containerId}` }
        },
        evidenceRoot,
        log: () => {},
      })

      assert.equal(retrySummary.ok, true)
      assert.equal(retrySummary.removedRunDir, true)
      assert.deepEqual(retriedIds, [CID_COLDCARD])
      assert.equal(existsSync(paths.runDir), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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
