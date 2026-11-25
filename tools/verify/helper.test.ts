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
import { describe, it } from 'vitest'
import { ChildEnv, runAsync, runToLog } from './process'
import { HELPER, REPO_ROOT, boundPort } from './run'

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

interface FakeDocker {
  binDir: string
  logFile: string
  envLogFile: string
  pathEnv: string
  setState: (state: FakeDockerState) => void
  readCalls: () => string[]
}

interface FakeDockerState {
  inspectMode: 'running' | 'stopped' | 'missing' | 'unavailable'
  rmMode: 'ok' | 'missing' | 'fail'
}

function createFakeDocker(root: string, initial: FakeDockerState): FakeDocker {
  const binDir = join(root, 'fake-bin')
  const logFile = join(root, 'docker-calls.log')
  const envLogFile = join(root, 'docker-env.log')
  const stateFile = join(root, 'docker-state.env')
  mkdirSync(binDir, { recursive: true })

  const setState = (state: FakeDockerState): void => {
    writeFileSync(stateFile, `INSPECT_MODE=${state.inspectMode}\nRM_MODE=${state.rmMode}\n`)
  }
  setState(initial)

  const script = `#!/usr/bin/env bash
source "${stateFile}"
printf '%s\\n' "$*" >> "${logFile}"
printf 'DOCKER_HOST=%s DOCKER_CONTEXT=%s DOCKER_CONFIG=%s\\n' "\${DOCKER_HOST:-}" "\${DOCKER_CONTEXT:-}" "\${DOCKER_CONFIG:-}" >> "${envLogFile}"
if [ "$1" = "inspect" ]; then
  case "$INSPECT_MODE" in
    running)
      echo "true"
      exit 0
      ;;
    stopped)
      echo "false"
      exit 0
      ;;
    missing)
      echo "Error response from daemon: No such container: $6" >&2
      exit 1
      ;;
    unavailable)
      echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2
      exit 1
      ;;
  esac
fi
if [ "$1" = "rm" ]; then
  case "$RM_MODE" in
    ok)
      echo "$4"
      exit 0
      ;;
    missing)
      echo "Error response from daemon: No such container: $4" >&2
      exit 1
      ;;
    fail)
      echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock." >&2
      exit 1
      ;;
  esac
fi
echo "unexpected docker command: $*" >&2
exit 99
`
  const dockerPath = join(binDir, 'docker')
  writeFileSync(dockerPath, script)
  chmodSync(dockerPath, 0o755)
  const basePath = ChildEnv.with().vars['PATH'] ?? ''
  return {
    binDir,
    logFile,
    envLogFile,
    pathEnv: `${binDir}${delimiter}${basePath}`,
    setState,
    readCalls: () =>
      existsSync(logFile)
        ? readFileSync(logFile, 'utf8')
            .split('\n')
            .filter((line) => line !== '')
        : [],
  }
}

/** Asserts every recorded Docker invocation is strictly allowlisted (inspect or rm -f of a recorded 64-hex ID). */
function assertDockerCallsAllowlisted(calls: readonly string[], allowedIds: ReadonlySet<string>): void {
  const inspectRe = /^inspect --type container -f \{\{\.State\.Running\}\} -- ([0-9a-f]{64})$/
  const rmRe = /^rm -f -- ([0-9a-f]{64})$/
  for (const call of calls) {
    assert.doesNotMatch(call, /\b(?:ps|ls|prune)\b|--filter/)
    const id = (inspectRe.exec(call) ?? rmRe.exec(call))?.[1]
    assert.ok(id !== undefined, `Disallowed Docker call: ${call}`)
    assert.equal(allowedIds.has(id), true, `Docker called for unrecorded container ID: ${id}`)
  }
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
      const fakeDocker = createFakeDocker(dir, { inspectMode: 'running', rmMode: 'ok' })
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

      // Neither skeleton start nor doctor on an empty run may invoke Docker.
      assert.deepEqual(fakeDocker.readCalls(), [])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces Docker call allowlist, forwards DOCKER_* env vars, fails unregistered containers, and cleans up recorded IDs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-cli-'))
    try {
      const fakeDocker = createFakeDocker(dir, { inspectMode: 'stopped', rmMode: 'ok' })
      const runDir = runDirIn(dir, 'docker-test-run')
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        join(runDir, 'containers.json'),
        JSON.stringify(
          [
            {
              name: 'emulator:ledger',
              containerId: CID_1,
              image: 'ghcr.io/ledgerhq/speculos:latest',
              startedAt: '2026-11-25T17:00:00Z',
            },
            {
              name: 'emulator:trezor',
              containerId: CID_2,
              image: 'trezor-emu:test',
              startedAt: '2026-11-25T17:00:01Z',
            },
          ],
          null,
          2,
        ),
      )

      const dockerEnv = {
        PATH: fakeDocker.pathEnv,
        DOCKER_HOST: 'unix:///tmp/colima.sock',
        DOCKER_CONTEXT: 'colima',
        DOCKER_CONFIG: '/tmp/colima-config',
      }

      const doctorStopped = helperIn(dir, ['doctor', '--run', 'docker-test-run'], dockerEnv)
      assert.equal(doctorStopped.failed, true)
      assert.match(doctorStopped.output, new RegExp(`FAIL\\s+emulators\\s+.*${CID_1}.*not running`))

      // Even if inspect says running, an unregistered container only in containers.json must FAIL doctor.
      fakeDocker.setState({ inspectMode: 'running', rmMode: 'ok' })
      const doctorUnregistered = helperIn(dir, ['doctor', '--run', 'docker-test-run'], dockerEnv)
      assert.equal(doctorUnregistered.failed, true)
      assert.match(doctorUnregistered.output, /FAIL\s+emulators\s+.*without emulator registration\/health check/)

      fakeDocker.setState({ inspectMode: 'stopped', rmMode: 'ok' })
      const statusResult = helperIn(dir, ['emulator', 'status', '--run', 'docker-test-run'], dockerEnv)
      assert.equal(statusResult.failed, false)
      assert.match(statusResult.output, new RegExp(`${CID_1} \\(stopped\\)`))

      const stopResult = helperIn(
        dir,
        ['emulator', 'stop', '--run', 'docker-test-run', '--device', 'ledger'],
        dockerEnv,
      )
      assert.equal(stopResult.failed, false)
      assert.match(stopResult.output, new RegExp(`removed container ${CID_1}`))

      const cleanupResult = helperIn(dir, ['cleanup', '--run', 'docker-test-run'], dockerEnv)
      assert.equal(cleanupResult.failed, false)
      assert.equal(existsSync(runDir), false)

      const calls = fakeDocker.readCalls()
      assert.ok(calls.length > 0)
      assertDockerCallsAllowlisted(calls, new Set([CID_1, CID_2]))
      assert.ok(calls.includes(`rm -f -- ${CID_1}`))
      assert.ok(calls.includes(`rm -f -- ${CID_2}`))

      const envLog = readFileSync(fakeDocker.envLogFile, 'utf8')
      assert.match(envLog, /DOCKER_HOST=unix:\/\/\/tmp\/colima\.sock/)
      assert.match(envLog, /DOCKER_CONTEXT=colima/)
      assert.match(envLog, /DOCKER_CONFIG=\/tmp\/colima-config/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps container records and exits nonzero on failed docker rm, and succeeds on retry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-docker-fail-rm-'))
    try {
      const fakeDocker = createFakeDocker(dir, { inspectMode: 'running', rmMode: 'fail' })
      const runDir = runDirIn(dir, 'retry-rm-run')
      mkdirSync(runDir, { recursive: true })
      const containersFile = join(runDir, 'containers.json')
      writeFileSync(
        containersFile,
        JSON.stringify(
          [
            {
              name: 'emulator:ledger',
              containerId: CID_1,
              image: 'ghcr.io/ledgerhq/speculos:latest',
              startedAt: '2026-11-25T17:00:00Z',
            },
          ],
          null,
          2,
        ),
      )

      const env = { PATH: fakeDocker.pathEnv }

      const failedStop = helperIn(dir, ['emulator', 'stop', '--run', 'retry-rm-run', '--device', 'ledger'], env)
      assert.equal(failedStop.failed, true)
      assert.match(failedStop.output, /Cannot connect to the Docker daemon/)
      assert.equal(existsSync(containersFile), true)
      assert.match(readFileSync(containersFile, 'utf8'), new RegExp(CID_1))

      const failedCleanup = helperIn(dir, ['cleanup', '--run', 'retry-rm-run'], env)
      assert.equal(failedCleanup.failed, true)
      assert.match(failedCleanup.output, /Cannot connect to the Docker daemon/)
      assert.equal(existsSync(runDir), true)
      assert.equal(existsSync(containersFile), true)

      // Docker recovers: retry succeeds and removes the run directory.
      fakeDocker.setState({ inspectMode: 'stopped', rmMode: 'ok' })
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
      const fakeDocker = createFakeDocker(dir, { inspectMode: 'running', rmMode: 'ok' })
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
      const fakeDocker = createFakeDocker(dir, { inspectMode: 'stopped', rmMode: 'ok' })
      const runId = 'doctor-probe-run'
      const runDir = runDirIn(dir, runId)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(
        join(runDir, 'containers.json'),
        JSON.stringify(
          [
            {
              name: 'emulator:coldcard',
              containerId: CID_1,
              image: 'coldcard-emu:test',
              startedAt: '2026-11-25T17:00:00Z',
            },
          ],
          null,
          2,
        ),
      )
      writeFileSync(
        join(runDir, 'run.json'),
        JSON.stringify(
          {
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
            emulators: [
              {
                device: 'coldcard',
                seed: 'primary',
                containerId: CID_1,
                apiPort: port,
                healthUrl: `http://127.0.0.1:${port}/health`,
              },
            ],
          },
          null,
          2,
        ),
      )

      const env = { PATH: fakeDocker.pathEnv }

      // 1. Container is stopped -> doctor must NOT send any HTTP request to healthUrl.
      const downResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 0)
      assert.match(downResult.output, new RegExp(`FAIL\\s+emulators\\s+coldcard: container ${CID_1} is not running`))
      assert.doesNotMatch(downResult.output, /health .* failed/)

      // 2. Docker daemon unavailable -> distinct message and still 0 HTTP requests.
      fakeDocker.setState({ inspectMode: 'unavailable', rmMode: 'fail' })
      const unavailableResult = await helperInAsync(dir, ['doctor', '--run', runId], env)
      assert.equal(healthHits, 0)
      assert.match(unavailableResult.output, /FAIL\s+emulators\s+coldcard: Docker unavailable/)

      // 3. Container is running + 200 OK -> probes once and passes emulators check.
      fakeDocker.setState({ inspectMode: 'running', rmMode: 'ok' })
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
