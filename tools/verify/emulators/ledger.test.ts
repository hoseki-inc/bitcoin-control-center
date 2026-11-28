import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { Ok } from '@hoseki/packages/result'
import { describe, it } from 'vitest'
import { EMULATOR_PRIMARY } from '../emulator-seeds'
import { ChildEnv, type CommandResult, runCommandResult, startGroup } from '../process'
import {
  type DockerCommandRunner,
  type DockerDaemon,
  EVIDENCE_ROOT,
  HELPER,
  type LedgerModel,
  REPO_ROOT,
  type RunPaths,
  type RunState,
  boundPort,
  processStartTime,
  readContainers,
  readIntentsFile,
  readRunState,
  writeJson,
} from '../run'
import {
  APP_BITCOIN_COMMIT,
  LEDGER_APP_BUILDER_IMAGE,
  PINNED_ELF_SHA256,
  SPECULOS_IMAGE,
  startLedgerEmulator,
} from './ledger'
import {
  type Decision,
  type LedgerButton,
  type NanoButton,
  type ScreenElement,
  type SpeculosApi,
  classifyScreen,
  drivePrompt,
  nextAction,
  pressOnce,
} from './ledger-driver'
import { ELF_CACHE_KEY, dockerArch, elfCachePaths, ensureLedgerElf, sha256Hex } from './ledger-elf'

const DAEMON: DockerDaemon = { daemonId: 'daemon-a', endpoint: 'unix:///fake/a.sock' }

function tempPaths(root: string, runId = 'ledger-test'): RunPaths {
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
    intentsFile: join(runDir, 'container-intents.json'),
    fakesFile: join(runDir, 'fakes.json'),
    seedFile: join(dataDir, 'verify-seed.json'),
    requestLog: join(runDir, 'logs', 'fake-requests.log'),
    faultsFile: join(runDir, 'faults.json'),
    appliedFaultsFile: join(runDir, 'faults-applied.json'),
    lockDir: join(root, 'locks', `${runId}.lock`),
  }
}

function runState(runId: string): RunState {
  return {
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
}

async function withRun(fn: (paths: RunPaths, root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'verify-ledger-'))
  try {
    const paths = tempPaths(root)
    mkdirSync(paths.runDir, { recursive: true })
    writeJson(paths.stateFile, runState(paths.runId))
    await fn(paths, root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const ok = (stdout = ''): CommandResult => ({ status: 0, stdout, stderr: '', error: null })
const no = (stderr: string): CommandResult => ({ status: 1, stdout: '', stderr, error: null })

interface FakeDocker {
  runner: DockerCommandRunner
  calls: string[][]
  /** Container IDs that exist now. */
  live: Set<string>
}

/** A Docker CLI double for builds and Speculos: create writes its cidfile, cp out of a container writes `elf`. */
function fakeDocker(
  elf: Buffer,
  fail: string | null = null,
  onCall: (args: readonly string[]) => void = () => {},
): FakeDocker {
  const calls: string[][] = []
  const live = new Set<string>()
  let created = 0
  const runner: DockerCommandRunner = (args) => {
    calls.push(args)
    onCall(args)
    const [command = ''] = args
    if (command === fail) {
      return no(`fake ${command} failure`)
    }
    const id = args.find((arg) => /^[0-9a-f]{64}/.test(arg))?.slice(0, 64) ?? ''
    switch (command) {
      case 'info':
        return ok('daemon-a\n')
      case 'version':
        return ok('arm64\n')
      case 'create': {
        created += 1
        const newId = String(created).repeat(64).slice(0, 64)
        writeFileSync(args[args.indexOf('--cidfile') + 1] ?? '', `${newId}\n`)
        live.add(newId)
        return ok(`${newId}\n`)
      }
      case 'cp': {
        const destination = args[2] ?? ''
        if (!destination.includes(':')) {
          writeFileSync(destination, elf)
        }
        return ok()
      }
      case 'start':
        return ok(args.includes('--attach') ? 'make output\n' : `${id}\n`)
      case 'port':
        return ok('127.0.0.1:61234\n')
      case 'rm':
        return live.delete(id) ? ok(`${id}\n`) : ok()
      case 'inspect':
        return no(`Error: No such container: ${args.at(-1) ?? ''}`)
      default:
        return no(`unexpected docker ${args.join(' ')}`)
    }
  }
  return { runner, calls, live }
}

const commands = (docker: FakeDocker): string[] => docker.calls.map((args) => args[0] ?? '')
const noSource = (): ReturnType<typeof Ok<undefined>> => Ok(undefined)

describe('Ledger pins', () => {
  it('pins app-bitcoin 2.5.1, both images by digest, and the arm64 ELF hashes from the spike', () => {
    assert.equal(APP_BITCOIN_COMMIT, '44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a')
    assert.match(LEDGER_APP_BUILDER_IMAGE, /@sha256:49c9ad6ee86bbe5fa23aba34f936ecc4eeabc7e1de21edc29272ac20fbe176b4$/)
    assert.match(SPECULOS_IMAGE, /@sha256:56c7ec84c903147dac28e68706d3241218a3d9beb9562dd4a8c02947b2a24f47$/)
    assert.deepEqual(PINNED_ELF_SHA256.arm64, {
      nanosp: 'be32e0d37ae85381bd5bbcf046e65e459abaf0962bb009989a76d5f6704a0801',
      flex: '4d012b9da309c4ed1b0462652674311a257c1444538935342ea025c2ddbb9524',
    })
    // The amd64 builder makes the same bytes.
    assert.deepEqual(PINNED_ELF_SHA256.amd64, PINNED_ELF_SHA256.arm64)
    assert.equal(ELF_CACHE_KEY, 'app-bitcoin-44ecd041-builder-49c9ad6e')
  })

  it('keeps one cache folder per builder platform and model, with its lock beside it', () => {
    const arm = elfCachePaths('/cache', 'arm64', 'flex')
    assert.equal(arm.elf, `/cache/${ELF_CACHE_KEY}/linux-arm64/flex/app.elf`)
    assert.equal(arm.manifest, `/cache/${ELF_CACHE_KEY}/linux-arm64/flex/manifest.json`)
    assert.equal(arm.lockDir, `/cache/${ELF_CACHE_KEY}/.lock-linux-arm64-flex`)
    assert.equal(elfCachePaths('/cache', 'amd64', 'nanosp').elf, `/cache/${ELF_CACHE_KEY}/linux-amd64/nanosp/app.elf`)
    assert.equal(arm.lockDir.startsWith(arm.dir), false)
  })

  it('reads the daemon platform and refuses one it has no images for', () => {
    assert.equal(dockerArch(DAEMON, () => ok('amd64\n')).unwrap(), 'amd64')
    assert.match(dockerArch(DAEMON, () => ok('s390x\n')).unwrapErr() ?? '', /expected arm64 or amd64/)
  })
})

describe('ensureLedgerElf', { timeout: 15_000 }, () => {
  const elf = Buffer.from('fake app.elf bytes')
  const pins = { arm64: { flex: sha256Hex(elf) }, amd64: {} }

  it('fails closed on a platform with no pin, before fetching or calling Docker', async () => {
    await withRun(async (paths, root) => {
      const docker = fakeDocker(elf)
      let fetched = false
      const result = await ensureLedgerElf(
        paths,
        { cacheDir: root, arch: 'amd64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
        docker.runner,
        () => {
          fetched = true
          return Ok(undefined)
        },
      )
      assert.match(result.unwrapErr() ?? '', /No pinned app\.elf SHA-256 for flex on linux\/amd64/)
      assert.equal(fetched, false)
      assert.deepEqual(docker.calls, [])
    })
  })

  it('builds with docker create, cp, start and cp out, never a bind mount, records the builder, and removes it', async () => {
    await withRun(async (paths, root) => {
      const seen: string[] = []
      const docker = fakeDocker(elf, null, (args) => {
        // The builder is in the journal before Docker is asked to create it, and recorded before it starts.
        if (args[0] === 'create') {
          seen.push(`intent:${readIntentsFile(paths).status}`)
        }
        if (args[0] === 'start') {
          seen.push(
            `recorded:${readContainers(paths)
              .map((c) => c.name)
              .join(',')}`,
          )
        }
      })
      const result = await ensureLedgerElf(
        paths,
        { cacheDir: root, arch: 'arm64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
        docker.runner,
        noSource,
      )
      const cache = elfCachePaths(root, 'arm64', 'flex')
      assert.equal(result.unwrap(), cache.elf)
      assert.deepEqual(readFileSync(cache.elf), elf)
      const manifest: unknown = JSON.parse(readFileSync(cache.manifest, 'utf8'))
      assert.deepEqual(
        { ...Object(manifest), builtAt: 'x' },
        {
          appCommit: APP_BITCOIN_COMMIT,
          builderImage: LEDGER_APP_BUILDER_IMAGE,
          arch: 'arm64',
          model: 'flex',
          sha256: sha256Hex(elf),
          size: elf.byteLength,
          builtAt: 'x',
        },
      )
      assert.deepEqual(seen, ['intent:ok', 'recorded:builder:ledger-elf'])
      assert.deepEqual(commands(docker), ['info', 'create', 'cp', 'start', 'cp', 'info', 'rm'])
      const create = docker.calls[1] ?? []
      assert.equal(create.includes('-v') || create.includes('--volume') || create.includes('--mount'), false)
      assert.deepEqual(create.slice(create.indexOf('--platform'), create.indexOf('--platform') + 2), [
        '--platform',
        'linux/arm64',
      ])
      assert.equal(create.at(-4), LEDGER_APP_BUILDER_IMAGE)
      assert.deepEqual(create.slice(-3), ['bash', '-lc', 'BOLOS_SDK=$FLEX_SDK make -j"$(nproc)" COIN=bitcoin'])
      const [copyIn, copyOut] = docker.calls.filter((args) => args[0] === 'cp').map((args) => args.slice(1))
      assert.match(copyIn?.[0] ?? '', /app-bitcoin\/\.$/)
      assert.match(copyIn?.[1] ?? '', /^[0-9a-f]{64}:\/app$/)
      assert.match(copyOut?.[0] ?? '', /^[0-9a-f]{64}:\/app\/bin\/app\.elf$/)
      assert.deepEqual(docker.calls[3]?.slice(0, 2), ['start', '--attach'])
      assert.deepEqual(docker.calls.at(-1)?.slice(0, 3), ['rm', '-f', '--'])
      // The builder is gone from Docker and from the journal.
      assert.equal(docker.live.size, 0)
      assert.deepEqual(readContainers(paths), [])
      assert.deepEqual(readIntentsFile(paths), { status: 'ok', value: [] })

      // A cache hit is checked against the pin and needs no Docker at all.
      const again = fakeDocker(elf)
      const hit = await ensureLedgerElf(
        paths,
        { cacheDir: root, arch: 'arm64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
        again.runner,
        noSource,
      )
      assert.equal(hit.unwrap(), cache.elf)
      assert.deepEqual(again.calls, [])

      // A tampered cache file is removed and rebuilt from the pinned source.
      writeFileSync(cache.elf, 'tampered')
      const lines: string[] = []
      const rebuilt = fakeDocker(elf)
      const fixed = await ensureLedgerElf(
        paths,
        {
          cacheDir: root,
          arch: 'arm64',
          model: 'flex',
          daemon: DAEMON,
          pins,
          log: (line) => {
            lines.push(line)
          },
        },
        rebuilt.runner,
        noSource,
      )
      assert.equal(fixed.unwrap(), cache.elf)
      assert.deepEqual(readFileSync(cache.elf), elf)
      assert.match(lines.join('\n'), /does not match its pinned SHA-256; rebuilding/)
      assert.equal(commands(rebuilt).includes('create'), true)
    })
  })

  it('refuses to cache or run a build whose hash is not the pin, and still removes the builder', async () => {
    await withRun(async (paths, root) => {
      const docker = fakeDocker(Buffer.from('something else'))
      const result = await ensureLedgerElf(
        paths,
        { cacheDir: root, arch: 'arm64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
        docker.runner,
        noSource,
      )
      assert.match(result.unwrapErr() ?? '', /not the pinned .*refusing to cache or run it/)
      const cache = elfCachePaths(root, 'arm64', 'flex')
      assert.equal(existsSync(cache.elf), false)
      assert.equal(existsSync(cache.manifest), false)
      assert.equal(docker.live.size, 0)
      assert.deepEqual(readContainers(paths), [])
    })
  })

  it('removes the builder and caches nothing when the build fails', async () => {
    await withRun(async (paths, root) => {
      const docker = fakeDocker(elf, 'start')
      const result = await ensureLedgerElf(
        paths,
        { cacheDir: root, arch: 'arm64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
        docker.runner,
        noSource,
      )
      assert.match(result.unwrapErr() ?? '', /Building app-bitcoin for flex on linux\/arm64 failed; removed container/)
      assert.equal(existsSync(elfCachePaths(root, 'arm64', 'flex').elf), false)
      assert.equal(docker.live.size, 0)
    })
  })

  it('builds once when two callers want the same ELF at the same time', async () => {
    await withRun(async (paths, root) => {
      const docker = fakeDocker(elf)
      const ensure = async (): Promise<string | undefined> =>
        (
          await ensureLedgerElf(
            paths,
            { cacheDir: root, arch: 'arm64', model: 'flex', daemon: DAEMON, pins, log: () => {} },
            docker.runner,
            noSource,
          )
        ).unwrap()
      const [first, second] = await Promise.all([ensure(), ensure()])
      assert.equal(first, second)
      assert.equal(commands(docker).filter((command) => command === 'create').length, 1)
    })
  })
})

const at = (text: string, x: number, y: number, w: number, h: number): ScreenElement => ({ text, x, y, w, h })

// Screens as Speculos 0.27.4 reported them for app-bitcoin 2.5.1 (probe of 2026-11-25).
const FLEX_IDLE = [
  at('Bitcoin', 180, 234, 119, 44),
  at('This app enables signing', 75, 290, 329, 36),
  at('transactions on the Bitcoin', 62, 326, 355, 36),
  at('network.', 182, 362, 115, 36),
  at('Quit app', 183, 534, 114, 36),
]
const FLEX_REJECT = at('Reject', 53, 534, 86, 36)
const FLEX_PAGES: Readonly<Record<'pubkey' | 'message', ScreenElement[][]>> = {
  pubkey: [
    [at('Confirm public key', 78, 262, 324, 44), at('Swipe to review', 134, 326, 212, 36), FLEX_REJECT],
    [at('Path', 32, 40, 61, 36), at("48'/0'/0'/2'", 32, 80, 186, 44), at('Public key', 32, 144, 136, 36), FLEX_REJECT],
    [
      at('Approve public key', 74, 208, 332, 44),
      FLEX_REJECT,
      at('3 of 3', 296, 534, 79, 36),
      at('Approve', 182, 418, 416, 36),
    ],
  ],
  message: [
    [at('Review message', 95, 262, 289, 44), at('Swipe to review', 134, 326, 212, 36), FLEX_REJECT],
    [at('Path', 32, 40, 61, 36), at('Message content', 32, 144, 229, 36), FLEX_REJECT],
    [
      at('Sign message?', 110, 200, 260, 44),
      FLEX_REJECT,
      at('3 of 3', 296, 534, 79, 36),
      at('Hold to sign', 32, 408, 209, 44),
    ],
  ],
}
const NANO_IDLE = [at('Bitcoin', 44, 26, 40, 14), at('app is ready', 32, 42, 63, 14)]
const NANO_PAGES: Readonly<Record<'pubkey' | 'message', string[][]>> = {
  pubkey: [
    ['Confirm public key'],
    ['Path', "48'/0'/0'/2'"],
    ['Public key (1/3)', 'xpub6DkFAXWQ2dHx'],
    ['Public key (2/3)', 'excHZCeKS1VZYcPoB'],
    ['Public key (3/3)', 'xUFL4r6KFrf'],
    ['Approve public key'],
    ['Reject operation'],
  ],
  message: [
    ['Review message'],
    ['Path', "84'/0'/0'/0/0"],
    ['Message (1/3)', 'I, the owner, affirm '],
    ['Message (2/3)', 'third-party '],
    ['Message (3/3)', 'revocable solely by '],
    ['Sign message'],
    ['Reject message'],
  ],
}

type Prompt = 'pubkey' | 'message'

/**
 * A Speculos double that follows the firmware's screens: Nano buttons page through and confirm, Flex taps work only
 * inside an element's box (or on the text-less Next arrow), Hold to sign needs a long press, and a Flex result stays
 * until tapped while a Nano one returns to idle by itself.
 */
class FakeLedger implements SpeculosApi {
  public readonly log: string[] = []
  public outcome: 'approved' | 'rejected' | null = null
  public shots = 0
  /** A prompt the app sends as soon as this one is decided, replacing the result screen. */
  public followUp: Prompt | null = null
  /** A screen shown for this many reads right after a decision, before the result. */
  public glitch: { screen: ScreenElement[]; reads: number } | null = null
  private glitchLeft = 0
  private screenNow: ScreenElement[]
  private prompt: Prompt | null = null
  private page = 0
  private confirming = false
  private resultReads = 0
  private readonly model: LedgerModel

  public constructor(model: LedgerModel) {
    this.model = model
    this.screenNow = model === 'flex' ? FLEX_IDLE : NANO_IDLE
  }

  public begin(prompt: Prompt): void {
    this.prompt = prompt
    this.page = 0
    this.render()
  }

  public show(elements: ScreenElement[]): void {
    this.screenNow = elements
  }

  public async screen(): Promise<ScreenElement[]> {
    if (this.glitch !== null && this.glitchLeft > 0) {
      this.glitchLeft -= 1
      return this.glitch.screen
    }
    if (this.model === 'nanosp' && this.outcome !== null && this.prompt === null && ++this.resultReads > 2) {
      this.screenNow = NANO_IDLE
    }
    return this.screenNow
  }

  public async screenshot(): Promise<Buffer> {
    this.shots += 1
    return Buffer.from('png')
  }

  public async button(button: NanoButton): Promise<void> {
    this.log.push(`button ${button}`)
    if (this.model !== 'nanosp' || this.prompt === null) {
      return
    }
    const pages = NANO_PAGES[this.prompt]
    if (button === 'right') {
      this.page = Math.min(this.page + 1, pages.length - 1)
    } else if (button === 'left') {
      this.page = Math.max(this.page - 1, 0)
    } else if (this.page >= pages.length - 2) {
      this.finish(this.page === pages.length - 2 ? 'approved' : 'rejected')
      return
    }
    this.render()
  }

  public async finger(x: number, y: number, delay: number): Promise<void> {
    this.log.push(`finger ${x},${y} ${delay}`)
    const hit = this.screenNow.find((e) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.h)?.text
    if (this.model !== 'flex') {
      return
    }
    if (this.prompt === null) {
      if (this.outcome !== null) {
        this.screenNow = FLEX_IDLE
      }
      return
    }
    const pages = FLEX_PAGES[this.prompt]
    if (this.confirming) {
      if (hit === 'Yes, reject') {
        this.finish('rejected')
      }
      return
    }
    if (hit === 'Reject') {
      this.confirming = true
      const noun = this.prompt === 'pubkey' ? 'operation' : 'message'
      this.screenNow = [
        at(`Reject ${noun}?`, 89, 252, 302, 44),
        at(`Go back to ${noun}`, 98, 534, 416, 36),
        at('Yes, reject', 167, 442, 416, 36),
      ]
    } else if (hit === 'Approve' || (hit === 'Hold to sign' && delay >= 2)) {
      this.finish('approved')
    } else if (hit === undefined && x > 380 && y > 520 && this.page < pages.length - 1) {
      this.page += 1
      this.render()
    }
  }

  private finish(outcome: 'approved' | 'rejected'): void {
    const prompt = this.prompt
    this.outcome = outcome
    this.prompt = null
    this.confirming = false
    this.resultReads = 0
    this.glitchLeft = this.glitch?.reads ?? 0
    const text =
      prompt === 'pubkey' ? ['Public key', outcome] : [outcome === 'approved' ? 'Message signed' : 'Message rejected']
    this.screenNow = text.map((t, i) => at(t, 99, 304 + 40 * i, 281, 44))
    if (this.followUp !== null) {
      this.begin(this.followUp)
      this.followUp = null
    }
  }

  private render(): void {
    if (this.prompt === null) {
      return
    }
    this.screenNow =
      this.model === 'flex'
        ? (FLEX_PAGES[this.prompt][this.page] ?? [])
        : (NANO_PAGES[this.prompt][this.page] ?? []).map((t, i) => at(t, 10, 3 + 16 * i, 100, 14))
  }
}

const FAST = { promptTimeoutMs: 400, stepTimeoutMs: 1_500 }
/** For screens that never settle: the fake answers at once, so a short wait proves the same and keeps tests quick. */
const QUICK = { promptTimeoutMs: 200, stepTimeoutMs: 300 }

describe('Ledger screen driver', { timeout: 15_000 }, () => {
  it('classifies the idle, review, approve, reject and result screens of both models, and nothing else', () => {
    assert.equal(classifyScreen('flex', FLEX_IDLE).kind, 'idle')
    assert.equal(classifyScreen('nanosp', NANO_IDLE).kind, 'idle')
    assert.equal(classifyScreen('flex', FLEX_PAGES.pubkey[0] ?? []).kind, 'review')
    assert.equal(classifyScreen('flex', FLEX_PAGES.pubkey[2] ?? []).kind, 'approve')
    assert.equal(classifyScreen('flex', FLEX_PAGES.message[2] ?? []).kind, 'approve')
    // The page title alone, without the exact "Approve" button, is not an approve screen.
    assert.equal(classifyScreen('flex', [at('Approve public key', 74, 208, 332, 44), FLEX_REJECT]).kind, 'unknown')
    assert.equal(classifyScreen('flex', [at('Message signed', 99, 324, 281, 44)]).kind, 'result')
    assert.equal(classifyScreen('nanosp', [at('Public key', 0, 0, 1, 1), at('approved', 0, 0, 1, 1)]).kind, 'result')
    assert.equal(classifyScreen('nanosp', [at('Reject operation', 0, 0, 1, 1)]).kind, 'reject')
    assert.equal(classifyScreen('nanosp', [at('Message (2/3)', 0, 0, 1, 1)]).kind, 'review')
    assert.equal(classifyScreen('nanosp', [at('Version', 0, 0, 1, 1), at('2.5.1', 0, 0, 1, 1)]).kind, 'unknown')
    assert.equal(classifyScreen('flex', NANO_IDLE).kind, 'unknown')
    assert.equal(classifyScreen('flex', []).kind, 'unknown')
  })

  const cases: Array<[LedgerModel, Prompt, Decision]> = []
  for (const model of ['flex', 'nanosp'] as const) {
    for (const prompt of ['pubkey', 'message'] as const) {
      for (const decision of ['approve', 'reject'] as const) {
        cases.push([model, prompt, decision])
      }
    }
  }

  it.each(cases)('drives a %s %s prompt to %s and back to idle', async (model, prompt, decision) => {
    const device = new FakeLedger(model)
    device.begin(prompt)
    const result = await drivePrompt(device, model, decision, FAST)
    assert.equal(result.ok, true, result.ok ? '' : result.reason)
    assert.equal(device.outcome, decision === 'approve' ? 'approved' : 'rejected')
    assert.equal(classifyScreen(model, await device.screen()).kind, 'idle')
    if (model === 'flex') {
      // The result screen is dismissed with a tap on the middle of the screen.
      assert.equal(device.log.at(-1), 'finger 240,300 0.1')
    }
  })

  it('taps the exact Flex Approve button, not the "Approve public key" title, and holds Hold to sign for 2.5 s', async () => {
    const pubkey = new FakeLedger('flex')
    pubkey.begin('pubkey')
    assert.equal((await drivePrompt(pubkey, 'flex', 'approve', FAST)).ok, true)
    assert.deepEqual(pubkey.log, [
      'finger 415,550 0.1',
      'finger 415,550 0.1',
      'finger 390,436 0.1',
      'finger 240,300 0.1',
    ])

    const message = new FakeLedger('flex')
    message.begin('message')
    assert.equal((await drivePrompt(message, 'flex', 'approve', FAST)).ok, true)
    assert.deepEqual(message.log, [
      'finger 415,550 0.1',
      'finger 415,550 0.1',
      'finger 137,430 2.5',
      'finger 240,300 0.1',
    ])

    const rejected = new FakeLedger('flex')
    rejected.begin('message')
    assert.equal((await drivePrompt(rejected, 'flex', 'reject', FAST)).ok, true)
    assert.deepEqual(rejected.log, ['finger 96,552 0.1', 'finger 375,460 0.1', 'finger 240,300 0.1'])
  })

  it('pages a Nano S Plus with right and confirms with both, past Sign message to Reject message to reject', async () => {
    const device = new FakeLedger('nanosp')
    device.begin('message')
    assert.equal((await drivePrompt(device, 'nanosp', 'reject', FAST)).ok, true)
    assert.deepEqual(device.log, [...Array<string>(6).fill('button right'), 'button both'])
  })

  it('stops with a screenshot on a screen it does not know, without pressing anything', async () => {
    const device = new FakeLedger('flex')
    device.show([at('Bitcoin is not ready', 10, 10, 100, 40)])
    const result = await drivePrompt(device, 'flex', 'approve', FAST)
    assert.ok(!result.ok)
    assert.match(result.reason, /screen the driver doesn't handle/)
    assert.deepEqual(result.screenshot, Buffer.from('png'))
    assert.deepEqual(device.log, [])
  })

  it('fails when no prompt appears while idle, instead of arming a decision for a later one', async () => {
    for (const model of ['flex', 'nanosp'] as const) {
      const device = new FakeLedger(model)
      const result = await drivePrompt(device, model, 'reject', QUICK)
      assert.match(result.ok ? '' : result.reason, /no prompt appeared/)
      assert.deepEqual(device.log, [])
      // A prompt that arrives afterwards is left alone.
      device.begin('message')
      assert.equal(classifyScreen(model, await device.screen()).kind, 'review')
      const single = await pressOnce(new FakeLedger(model), model, model === 'flex' ? 'next' : 'right', QUICK)
      assert.match(single.ok ? '' : single.reason, /no prompt appeared/)
    }
  })

  it('dismisses a leftover Flex result without counting it, and still fails when no prompt follows', async () => {
    const device = new FakeLedger('flex')
    device.show([at('Message signed', 99, 324, 281, 44)])
    device.outcome = 'approved'
    const result = await drivePrompt(device, 'flex', 'approve', FAST)
    assert.ok(!result.ok)
    assert.match(result.reason, /no prompt appeared/)
    assert.deepEqual(device.log, ['finger 240,300 0.1'])
  })

  it('stops once its decision lands, leaving a prompt that follows it untouched', async () => {
    for (const model of ['flex', 'nanosp'] as const) {
      const device = new FakeLedger(model)
      device.begin('pubkey')
      device.followUp = 'message'
      const result = await drivePrompt(device, model, 'approve', FAST)
      assert.ok(result.ok)
      assert.match(result.trace.at(-1) ?? '', /next prompt left alone: \["Review message"/)
      assert.equal(classifyScreen(model, await device.screen()).kind, 'review')
    }
  })

  it('fails closed with one screenshot when an unknown screen follows the decision, on both models', async () => {
    for (const model of ['flex', 'nanosp'] as const) {
      const device = new FakeLedger(model)
      device.begin('message')
      device.glitch = { screen: [at('Unexpected device error', 10, 10, 100, 14)], reads: Number.POSITIVE_INFINITY }
      const result = await drivePrompt(device, model, 'approve', QUICK)
      assert.ok(!result.ok, model)
      assert.match(result.reason, /screen the driver doesn't handle after the decision: \["Unexpected device error"\]/)
      assert.deepEqual(result.screenshot, Buffer.from('png'))
      assert.equal(device.shots, 1)
    }
  })

  it('fails with one screenshot when a Nano still shows its reject menu after the deciding press', async () => {
    const device = new FakeLedger('nanosp')
    device.begin('message')
    device.glitch = { screen: [at('Reject message', 19, 34, 90, 14)], reads: Number.POSITIVE_INFINITY }
    const result = await drivePrompt(device, 'nanosp', 'approve', QUICK)
    assert.ok(!result.ok)
    assert.match(result.reason, /the nanosp still shows its reject menu after the decision: \["Reject message"\]/)
    assert.equal(device.shots, 1)
    // Rejecting on purpose still passes through that same menu and finishes.
    const rejecting = new FakeLedger('nanosp')
    rejecting.begin('message')
    const rejected = await drivePrompt(rejecting, 'nanosp', 'reject', FAST)
    assert.ok(rejected.ok)
    assert.equal(rejecting.outcome, 'rejected')
    assert.equal(rejected.ended.kind, 'idle')
  })

  it('waits out a blank Flex frame after Approve, then still dismisses the result back to idle', async () => {
    const device = new FakeLedger('flex')
    device.begin('pubkey')
    device.glitch = { screen: [], reads: 3 }
    const result = await drivePrompt(device, 'flex', 'approve', FAST)
    assert.ok(result.ok)
    assert.equal(result.ended.kind, 'idle')
    assert.equal(device.log.at(-1), 'finger 240,300 0.1')
    assert.equal(device.shots, 0)
  })

  it('fails a single press that lands on an unknown screen, saving it', async () => {
    const device = new FakeLedger('flex')
    device.begin('pubkey')
    assert.ok((await pressOnce(device, 'flex', 'next', FAST)).ok)
    assert.ok((await pressOnce(device, 'flex', 'next', FAST)).ok)
    device.glitch = { screen: [at('Unexpected device error', 10, 10, 100, 14)], reads: Number.POSITIVE_INFINITY }
    const result = await pressOnce(device, 'flex', 'approve', QUICK)
    assert.ok(!result.ok)
    assert.match(result.reason, /after tap Approve at \(390, 436\) the flex shows a screen the driver doesn't handle/)
    assert.equal(device.shots, 1)
  })

  it('presses one button at a time and refuses a button the model lacks or the screen does not take', async () => {
    const nano = new FakeLedger('nanosp')
    nano.begin('pubkey')
    assert.equal((await pressOnce(nano, 'nanosp', 'right', FAST)).ok, true)
    assert.deepEqual(
      (await nano.screen()).map((e) => e.text),
      ['Path', "48'/0'/0'/2'"],
    )

    const flex = new FakeLedger('flex')
    flex.begin('pubkey')
    const wrongModel: LedgerButton = 'both'
    const refused = await pressOnce(flex, 'flex', wrongModel, FAST)
    assert.match(refused.ok ? '' : refused.reason, /the flex takes --button next\|approve\|dismiss/)
    const early = await pressOnce(flex, 'flex', 'approve', FAST)
    assert.match(early.ok ? '' : early.reason, /--button approve doesn't fit the review screen/)
    assert.equal((await pressOnce(flex, 'flex', 'next', FAST)).ok, true)
    assert.equal((await pressOnce(flex, 'flex', 'next', FAST)).ok, true)
    assert.equal((await pressOnce(flex, 'flex', 'approve', FAST)).ok, true)
    assert.equal(flex.outcome, 'approved')
    assert.equal((await pressOnce(flex, 'flex', 'dismiss', FAST)).ok, true)
    assert.equal(classifyScreen('flex', await flex.screen()).kind, 'idle')
  })
})

describe('startLedgerEmulator', { timeout: 15_000 }, () => {
  const idleApi = (): SpeculosApi => new FakeLedger('flex')

  it('creates Speculos with the seed and ELF copied in, records it before starting, then registers it in run.json', async () => {
    await withRun(async (paths) => {
      const recordedAtStart: string[] = []
      const docker = fakeDocker(Buffer.alloc(0), null, (args) => {
        if (args[0] === 'start') {
          recordedAtStart.push(...readContainers(paths).map((c) => c.name))
        }
      })
      const result = await startLedgerEmulator(
        paths,
        { model: 'flex', seed: 'primary', arch: 'arm64', elfPath: '/cache/app.elf', daemon: DAEMON },
        docker.runner,
        idleApi,
      )
      const emulator = result.unwrap()
      assert.deepEqual(commands(docker), ['info', 'create', 'cp', 'start', 'port'])
      const create = docker.calls[1] ?? []
      assert.equal(create[1], '--cidfile')
      assert.match(create[2] ?? '', /\/cids\/bcc-verify-ledger-test-ledger-[0-9a-f]{8}\.cid$/)
      assert.deepEqual(create.slice(3, 5), [
        '--name',
        /bcc-verify-ledger-test-ledger-[0-9a-f]{8}/.exec(create[4] ?? '')?.[0],
      ])
      assert.deepEqual(create.slice(5), [
        '--platform',
        'linux/arm64',
        '-p',
        '127.0.0.1::5000',
        SPECULOS_IMAGE,
        '--model',
        'flex',
        '--display',
        'headless',
        '--api-port',
        '5000',
        '--seed',
        EMULATOR_PRIMARY.mnemonic,
        '/speculos/app-bitcoin.elf',
      ])
      assert.deepEqual(docker.calls[2], [
        'cp',
        '/cache/app.elf',
        `${emulator?.containerId ?? ''}:/speculos/app-bitcoin.elf`,
      ])
      assert.deepEqual(docker.calls[4], ['port', emulator?.containerId ?? '', '5000/tcp'])
      assert.deepEqual(recordedAtStart, ['emulator:ledger'])
      assert.deepEqual(emulator, {
        device: 'ledger',
        model: 'flex',
        seed: 'primary',
        containerId: emulator?.containerId,
        daemon: DAEMON,
        apiPort: 61234,
        healthUrl: 'http://127.0.0.1:61234/events?currentscreenonly=true',
      })
      const state = readRunState(paths)
      assert.deepEqual(state.status === 'ok' ? state.value.emulators : null, [emulator])
      assert.deepEqual(readIntentsFile(paths), { status: 'ok', value: [] })

      // A second Ledger on the same run is refused before Docker is asked anything.
      const again = fakeDocker(Buffer.alloc(0))
      const refused = await startLedgerEmulator(
        paths,
        { model: 'nanosp', seed: 'empty', arch: 'arm64', elfPath: '/cache/app.elf', daemon: DAEMON },
        again.runner,
        idleApi,
      )
      assert.match(refused.unwrapErr() ?? '', /already has a Ledger emulator/)
      assert.deepEqual(again.calls, [])
    })
  })

  it('removes the container and forgets it when a step after create fails, leaving run.json as it was', async () => {
    for (const failing of ['cp', 'start', 'port'] as const) {
      await withRun(async (paths) => {
        const docker = fakeDocker(Buffer.alloc(0), failing)
        const result = await startLedgerEmulator(
          paths,
          { model: 'nanosp', seed: 'secondary', arch: 'arm64', elfPath: '/cache/app.elf', daemon: DAEMON },
          docker.runner,
          idleApi,
        )
        assert.match(result.unwrapErr() ?? '', new RegExp(`docker ${failing}.*removed container`))
        assert.equal(docker.live.size, 0, failing)
        assert.deepEqual(readContainers(paths), [])
        const state = readRunState(paths)
        assert.equal(state.status === 'ok' ? state.value.emulators : 'bad', undefined)
      })
    }
  })

  it('removes the container when Speculos never shows the idle screen', async () => {
    await withRun(async (paths) => {
      const docker = fakeDocker(Buffer.alloc(0))
      const stuck = new FakeLedger('flex')
      stuck.show([at('Something else', 0, 0, 10, 10)])
      const result = await startLedgerEmulator(
        paths,
        {
          model: 'flex',
          seed: 'primary',
          arch: 'arm64',
          elfPath: '/cache/app.elf',
          daemon: DAEMON,
          bootTimeoutMs: 300,
        },
        docker.runner,
        () => stuck,
      )
      assert.match(
        result.unwrapErr() ?? '',
        /did not reach the Bitcoin app's idle screen: screen shows \["Something else"\]/,
      )
      assert.equal(docker.live.size, 0)
      assert.deepEqual(readContainers(paths), [])
    })
  })

  it('records nothing and leaves no intent when docker create itself fails', async () => {
    await withRun(async (paths) => {
      const docker = fakeDocker(Buffer.alloc(0), 'create')
      const result = await startLedgerEmulator(
        paths,
        { model: 'flex', seed: 'primary', arch: 'arm64', elfPath: '/cache/app.elf', daemon: DAEMON },
        docker.runner,
        idleApi,
      )
      assert.match(result.unwrapErr() ?? '', /docker create failed: fake create failure/)
      assert.deepEqual(readContainers(paths), [])
      assert.deepEqual(readIntentsFile(paths), { status: 'ok', value: [] })
      assert.equal(existsSync(dirname(paths.intentsFile)), true)
    })
  })
})

/** The folders the helper CLI uses for a run when TMPDIR is `root`, so a test and a CLI it starts share one run. */
function cliPaths(root: string, runId: string): RunPaths {
  const key = createHash('sha256').update(REPO_ROOT).digest('hex').slice(0, 8)
  const paths = tempPaths(join(root, 'bcc-verify', key), runId)
  return { ...paths, lockDir: join(root, 'bcc-verify-locks', key, `${runId}.lock`) }
}

/** A run the helper CLI can see, a `docker` on PATH that only logs and fails, and the CLI itself. */
async function withCliRun(
  fn: (run: {
    paths: RunPaths
    root: string
    cli: (args: string[]) => CommandResult
    dockerCalls: () => string[]
  }) => Promise<void>,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'verify-reserve-'))
  try {
    const paths = cliPaths(root, `reserve-${Math.random().toString(36).slice(2, 10)}`)
    mkdirSync(paths.runDir, { recursive: true })
    writeJson(paths.stateFile, runState(paths.runId))
    const bin = join(root, 'bin')
    const calls = join(root, 'docker-calls.log')
    mkdirSync(bin)
    // It knows its daemon and says every container runs; anything else fails.
    const script = [
      '#!/bin/sh',
      `echo "$*" >> ${JSON.stringify(calls)}`,
      'case "$1" in info) echo daemon-a ;; inspect) echo true ;; *) exit 99 ;; esac',
      '',
    ].join('\n')
    writeFileSync(join(bin, 'docker'), script, { mode: 0o755 })
    const env = ChildEnv.with({
      TMPDIR: root,
      PATH: `${bin}${delimiter}${ChildEnv.with().vars['PATH'] ?? ''}`,
      BCC_VERIFY_CACHE_DIR: join(root, 'cache'),
    })
    const cli = (args: string[]): CommandResult =>
      runCommandResult(join(REPO_ROOT, HELPER), [...args, '--run', paths.runId], { cwd: REPO_ROOT, env })
    const dockerCalls = (): string[] =>
      existsSync(calls) ? readFileSync(calls, 'utf8').split('\n').filter(Boolean) : []
    await fn({ paths, root, cli, dockerCalls })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const said = (result: CommandResult): string => `${result.stdout}${result.stderr}`

describe('Ledger start reservation', { timeout: 120_000 }, () => {
  const start = { model: 'flex', seed: 'primary', arch: 'arm64', elfPath: '/cache/app.elf', daemon: DAEMON } as const

  it('makes stop, cleanup and a second start wait while a start runs, from create to the run.json write', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      const seen: Record<string, CommandResult> = {}
      const docker = fakeDocker(Buffer.alloc(0), null, (args) => {
        // Window one: after the create intent, before docker start, and after start before run.json names the device.
        if (args[0] === 'create') {
          seen['cleanup at create'] = cli(['cleanup'])
        } else if (args[0] === 'start') {
          seen['stop at start'] = cli(['emulator', 'stop', '--device', 'ledger'])
        } else if (args[0] === 'port') {
          seen['cleanup at port'] = cli(['cleanup'])
          // Window two: a second start while this one runs.
          seen['start at port'] = cli(['emulator', 'start', '--device', 'ledger'])
          seen['status at port'] = cli(['emulator', 'status'])
        }
      })
      const started = await startLedgerEmulator(paths, start, docker.runner, () => new FakeLedger('flex'))
      const emulator = started.unwrap()
      for (const name of ['cleanup at create', 'stop at start', 'cleanup at port']) {
        const result = seen[name]
        assert.notEqual(result?.status, 0, name)
        assert.match(
          result === undefined ? '' : said(result),
          /has a emulator:ledger start in progress \(PID \d+\)/,
          name,
        )
      }
      const again = seen['start at port']
      assert.notEqual(again?.status, 0)
      assert.match(again === undefined ? '' : said(again), /already has a Ledger start in progress/)
      assert.match(seen['status at port']?.stdout ?? '', /emulator:ledger: start in progress \(PID \d+/)
      // None of them removed or made anything (status only asks the daemon who it is): the starter's container is
      // the one run.json now names.
      assert.deepEqual(
        dockerCalls().filter((call) => !call.startsWith('info ') && !call.startsWith('inspect ')),
        [],
      )
      assert.deepEqual(
        readContainers(paths).map((c) => c.containerId),
        [emulator?.containerId],
      )
      const state = readRunState(paths)
      assert.deepEqual(state.status === 'ok' ? state.value.emulators : null, [emulator])
      assert.equal(existsSync(join(paths.runDir, 'emulator-starting.json')), false)
    })
  })

  it('refuses a duplicate start, and one while another start runs, before any ELF or Docker work', async () => {
    await withCliRun(async ({ paths, root, cli, dockerCalls }) => {
      writeJson(join(paths.runDir, 'emulator-starting.json'), {
        name: 'emulator:ledger',
        pid: process.pid,
        startedAt: processStartTime(process.pid) ?? 'unknown',
        reservedAt: '2026-11-27T10:00:00Z',
      })
      const busy = cli(['emulator', 'start', '--device', 'ledger'])
      assert.notEqual(busy.status, 0)
      assert.match(said(busy), /already has a Ledger start in progress \(PID \d+\)/)

      rmSync(join(paths.runDir, 'emulator-starting.json'))
      writeJson(paths.stateFile, {
        ...runState(paths.runId),
        emulators: [
          {
            device: 'ledger',
            model: 'flex',
            seed: 'primary',
            containerId: 'a'.repeat(64),
            daemon: DAEMON,
            apiPort: 61234,
            healthUrl: 'http://127.0.0.1:61234/events?currentscreenonly=true',
          },
        ],
      })
      const duplicate = cli(['emulator', 'start', '--device', 'ledger'])
      assert.notEqual(duplicate.status, 0)
      assert.match(said(duplicate), /already has a Ledger emulator; stop it first/)
      assert.deepEqual(dockerCalls(), [])
      assert.equal(existsSync(join(root, 'cache')), false)
    })
  })

  it('takes over and clears a reservation whose owner died, and shows it as interrupted until then', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      const reservation = join(paths.runDir, 'emulator-starting.json')
      writeJson(reservation, { name: 'emulator:ledger', pid: 999_999, startedAt: 'never', reservedAt: 'earlier' })
      assert.match(
        cli(['emulator', 'status']).stdout,
        /emulator:ledger: start interrupted \(PID 999999, since earlier\)/,
      )
      const stopped = cli(['emulator', 'stop', '--device', 'ledger'])
      assert.equal(stopped.status, 0, said(stopped))
      assert.equal(existsSync(reservation), false)
      assert.deepEqual(dockerCalls(), [])

      writeJson(reservation, { name: 'emulator:ledger', pid: 999_999, startedAt: 'never', reservedAt: 'earlier' })
      const docker = fakeDocker(Buffer.alloc(0))
      assert.equal((await startLedgerEmulator(paths, start, docker.runner, () => new FakeLedger('flex'))).isOk(), true)
      assert.equal(existsSync(reservation), false)
    })
  })

  it('shows a journaled create that is not recorded yet as pending in status', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      writeJson(paths.intentsFile, [
        {
          name: 'emulator:ledger',
          containerName: `bcc-verify-${paths.runId}-ledger-0123abcd`,
          image: SPECULOS_IMAGE,
          startedAt: '2026-11-27T10:00:00Z',
          daemon: DAEMON,
        },
      ])
      const status = cli(['emulator', 'status', '--device', 'ledger'])
      assert.equal(status.status, 0, said(status))
      assert.match(
        status.stdout,
        new RegExp(
          `emulator:ledger: create pending \\(container bcc-verify-${paths.runId}-ledger-0123abcd, since 2026-11-27T10:00:00Z\\)`,
        ),
      )
      assert.doesNotMatch(status.stdout, /No ledger emulator recorded/)
      assert.deepEqual(dockerCalls(), [])
    })
  })

  it('reports an invalid containers.json with a pending create as an error naming the file, through stop and cleanup', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      writeFileSync(paths.containersFile, '{not json')
      writeJson(paths.intentsFile, [
        {
          name: 'emulator:ledger',
          containerName: `bcc-verify-${paths.runId}-ledger-0123abcd`,
          image: SPECULOS_IMAGE,
          startedAt: '2026-11-27T10:00:00Z',
          daemon: DAEMON,
        },
      ])
      for (const args of [['emulator', 'stop', '--device', 'ledger'], ['cleanup']]) {
        const result = cli(args)
        assert.notEqual(result.status, 0, args.join(' '))
        assert.match(said(result), /containers\.json does not parse/, args.join(' '))
        assert.doesNotMatch(said(result), /\n\s+at /, 'no stack trace')
      }
      assert.equal(readFileSync(paths.containersFile, 'utf8'), '{not json')
      assert.equal(existsSync(paths.intentsFile), true)
      assert.deepEqual(dockerCalls(), [])
    })
  })
})

/** The device, except that once anything is pressed its screen reads as `landing`. */
function landsOn(device: FakeLedger, landing: ScreenElement[]): SpeculosApi {
  let pressed = false
  return {
    screen: async () => (pressed ? landing : device.screen()),
    screenshot: async () => device.screenshot(),
    button: async (button) => {
      pressed = true
      await device.button(button)
    },
    finger: async (x, y, delay) => {
      pressed = true
      await device.finger(x, y, delay)
    },
  }
}

describe('Ledger driver failures', { timeout: 15_000 }, () => {
  it("pages past the Flex's own Message content page that a long message gets", () => {
    // As Speculos showed Control Center's ownership challenge, page 3 of 4.
    const page = [
      'Message content',
      'I, the owner, affirm sole ',
      'control of this account. ',
      'ID=9nQurUa5DFGSQVg',
      'VEYE9Y',
      'Reject',
      '3 of 4',
    ].map((text, i) => at(text, 32, 40 + 40 * i, 300, 36))
    assert.equal(classifyScreen('flex', page).kind, 'review')
    assert.deepEqual(nextAction('flex', classifyScreen('flex', page), page, 'approve'), {
      type: 'tap',
      x: 415,
      y: 550,
      delay: 0.1,
      label: 'next',
    })
  })

  it('fails a press whose landing contradicts the button, on both models, and passes one that fits', async () => {
    const nano = new FakeLedger('nanosp')
    nano.begin('pubkey')
    const back = await pressOnce(landsOn(nano, NANO_IDLE), 'nanosp', 'left', QUICK)
    assert.ok(!back.ok)
    assert.match(back.reason, /the nanosp shows a idle screen, which --button left can't lead to/)
    assert.equal(nano.shots, 1)

    const flex = new FakeLedger('flex')
    flex.begin('pubkey')
    const next = await pressOnce(landsOn(flex, FLEX_IDLE), 'flex', 'next', QUICK)
    assert.ok(!next.ok)
    assert.match(next.reason, /the flex shows a idle screen, which --button next can't lead to/)

    const fits = new FakeLedger('flex')
    fits.begin('pubkey')
    const fine = await pressOnce(landsOn(fits, FLEX_PAGES.pubkey[1] ?? []), 'flex', 'next', QUICK)
    assert.ok(fine.ok)
    assert.equal(fine.ended.kind, 'review')
  })

  it('turns a screen read that throws into a failed drive, for drivePrompt and pressOnce', async () => {
    const broken: SpeculosApi = {
      screen: async () => Promise.reject(new Error('fetch failed')),
      screenshot: async () => Promise.reject(new Error('fetch failed')),
      button: async () => {},
      finger: async () => {},
    }
    for (const model of ['flex', 'nanosp'] as const) {
      const driven = await drivePrompt(broken, model, 'approve', QUICK)
      assert.deepEqual(driven, {
        ok: false,
        trace: [],
        reason: `could not read the ${model} screen: fetch failed`,
        screenshot: null,
      })
      const pressed = await pressOnce(broken, model, model === 'flex' ? 'next' : 'right', QUICK)
      assert.match(pressed.ok ? '' : pressed.reason, new RegExp(`could not read the ${model} screen: fetch failed`))
    }
  })

  it('makes press, reject and screenshot exit 1 with a clear message when Speculos is gone, leaving no folder', async () => {
    await withCliRun(async ({ paths, cli }) => {
      // A port nothing listens on: Speculos is gone.
      const closed = createServer()
      await new Promise<void>((done) => {
        closed.listen(0, '127.0.0.1', done)
      })
      const apiPort = boundPort(closed.address())
      await new Promise((done) => {
        closed.close(done)
      })
      const containerId = 'a'.repeat(64)
      writeJson(paths.containersFile, [
        { name: 'emulator:ledger', containerId, image: SPECULOS_IMAGE, startedAt: 't', daemon: DAEMON },
      ])
      writeJson(paths.stateFile, {
        ...runState(paths.runId),
        emulators: [
          {
            device: 'ledger',
            model: 'flex',
            seed: 'primary',
            containerId,
            daemon: DAEMON,
            apiPort,
            healthUrl: `http://127.0.0.1:${apiPort}/events?currentscreenonly=true`,
          },
        ],
      })
      for (const args of [['press'], ['reject']]) {
        const result = cli(['emulator', ...args, '--device', 'ledger'])
        assert.equal(result.status, 1, said(result))
        assert.match(said(result), /could not read the flex screen/)
        assert.doesNotMatch(said(result), /\n\s+at |Unhandled/)
      }
      const shot = cli(['emulator', 'screenshot', '--device', 'ledger'])
      assert.equal(shot.status, 1, said(shot))
      assert.match(said(shot), /Could not read the Ledger screen/)
      assert.equal(existsSync(join(EVIDENCE_ROOT, paths.runId)), false)
    })
  })

  it("adds Docker's own error to an unreadable platform", () => {
    const failed: CommandResult = { status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon', error: null }
    assert.match(
      dockerArch(DAEMON, () => failed).unwrapErr() ?? '',
      /\(docker said: Cannot connect to the Docker daemon\)/,
    )
  })
})

describe('bridge records in the CLI', { timeout: 60_000 }, () => {
  /** run.json with a Ledger and a bridge record, as a finished bridged start leaves them. */
  function bridgedRun(
    paths: RunPaths,
    bridge: { pid: number; startedAt: string; port: number; controlPort: number },
  ): void {
    const containerId = 'a'.repeat(64)
    writeJson(paths.containersFile, [
      { name: 'emulator:ledger', containerId, image: SPECULOS_IMAGE, startedAt: 't', daemon: DAEMON },
    ])
    writeJson(paths.stateFile, {
      ...runState(paths.runId),
      emulators: [
        {
          device: 'ledger',
          model: 'flex',
          seed: 'primary',
          containerId,
          daemon: DAEMON,
          apiPort: 9,
          healthUrl: 'http://127.0.0.1:9/events?currentscreenonly=true',
          bridge: {
            name: 'ledger-bridge',
            pid: bridge.pid,
            startedAt: bridge.startedAt,
            port: bridge.port,
            url: `http://127.0.0.1:${bridge.port}`,
            controlPort: bridge.controlPort,
            mode: 'manual',
          },
        },
      ],
    })
    writeJson(join(paths.runDir, 'ledger-bridge.json'), {
      pid: bridge.pid,
      drivePort: bridge.port,
      controlPort: bridge.controlPort,
      token: 'b'.repeat(64),
    })
  }

  it('still shows the container and screen in status when the bridge died, saying it does not answer', async () => {
    await withCliRun(async ({ paths, cli }) => {
      bridgedRun(paths, { pid: 999_999, startedAt: 'never', port: 9, controlPort: 9 })
      const status = cli(['emulator', 'status', '--device', 'ledger'])
      assert.equal(status.status, 0, said(status))
      assert.match(status.stdout, /ledger: model=flex seed=primary container=a{64} \(running\)/)
      assert.match(
        status.stdout,
        /bridge=http:\/\/127\.0\.0\.1:9 \(PID 999999, not answering: control port 9 is not held/,
      )
    })
  })

  it('never sends the bridge token to a control port the bridge does not hold, from doctor or press', async () => {
    await withCliRun(async ({ paths, cli }) => {
      // A listener on the recorded control port that is not in the bridge's process group.
      const seen: Array<string | undefined> = []
      const impostor = createServer((req, res) => {
        seen.push(req.headers.authorization)
        res.end('{}')
      })
      await new Promise<void>((done) => {
        impostor.listen(0, '127.0.0.1', done)
      })
      try {
        const port = boundPort(impostor.address())
        // The bridge recorded as this test worker. The impostor listens in this same worker, but the worker is not its
        // process group's leader, so the port's owner check fails and no token may be sent.
        bridgedRun(paths, { pid: process.pid, startedAt: processStartTime(process.pid) ?? '', port, controlPort: port })
        const doctor = cli(['doctor'])
        assert.match(said(doctor), new RegExp(`bridge control port ${port} is not the bridge's`))
        const press = cli(['emulator', 'press', '--device', 'ledger'])
        assert.equal(press.status, 1)
        assert.match(said(press), new RegExp(`control port ${port} is not held by the bridge`))
        assert.deepEqual(
          seen.filter((auth) => auth !== undefined),
          [],
        )
      } finally {
        impostor.close()
      }
    })
  })

  it('keeps a reservation whose owner can not be told apart from a reused PID, through start and stop', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      // An old record with no start time, whose PID is alive: it may still be the owner, so it is not stale.
      writeJson(join(paths.runDir, 'emulator-starting.json'), {
        name: 'emulator:ledger',
        pid: process.pid,
        startedAt: 'unknown',
        reservedAt: 'earlier',
      })
      const start = cli(['emulator', 'start', '--device', 'ledger'])
      assert.notEqual(start.status, 0)
      assert.match(said(start), /already has a Ledger start in progress/)
      const stop = cli(['emulator', 'stop', '--device', 'ledger'])
      assert.notEqual(stop.status, 0)
      assert.match(said(stop), /start in progress/)
      assert.match(cli(['emulator', 'status']).stdout, /start in progress/)
      assert.equal(existsSync(join(paths.runDir, 'emulator-starting.json')), true)
      assert.deepEqual(dockerCalls(), [])
    })
  })

  it('discards the container and releases the start when the bridge fails to start', async () => {
    await withRun(async (paths) => {
      const docker = fakeDocker(Buffer.alloc(0))
      const result = await startLedgerEmulator(
        paths,
        {
          model: 'flex',
          seed: 'primary',
          arch: 'arm64',
          elfPath: '/cache/app.elf',
          daemon: DAEMON,
          bridge: { mode: 'manual', target: 'http://127.0.0.1:9' },
          launchBridge: async () => Promise.reject(new Error('processes.json does not parse')),
        },
        docker.runner,
        () => new FakeLedger('flex'),
      )
      assert.match(result.unwrapErr() ?? '', /processes\.json does not parse; removed container/)
      assert.equal(docker.live.size, 0)
      assert.deepEqual(readContainers(paths), [])
      assert.equal(existsSync(join(paths.runDir, 'emulator-starting.json')), false)
    })
  })
})

describe('launch on a live run', { timeout: 60_000 }, () => {
  it('refuses a Ledger the live run does not have, naming both, and still reopens without emulator flags', async () => {
    await withCliRun(async ({ paths, cli, dockerCalls }) => {
      // A live run: its recorded Sentinel and fakes are this very process, so launch takes them as running.
      const self = { pid: process.pid, startedAt: processStartTime(process.pid) ?? '' }
      writeJson(paths.stateFile, {
        ...runState(paths.runId),
        sentinel: { name: 'sentinel', ...self, port: 4000 },
        fakes: { name: 'fakes', ...self, electrumPort: 4001, mempoolPort: 4002 },
      })
      const wrong = cli(['launch', '--emulator', 'ledger', '--ledger-model', 'nanosp', '--emulator-seed', 'empty'])
      assert.equal(wrong.status, 1, said(wrong))
      assert.match(
        said(wrong),
        new RegExp(
          `Run ${paths.runId} is already running with no Ledger, not the requested Ledger nanosp with seed empty\\. Launch a new run ID\\.`,
        ),
      )
      const plain = cli(['launch'])
      assert.equal(plain.status, 0, said(plain))
      assert.match(plain.stdout, new RegExp(`Run ${paths.runId} is already running at http://127\\.0\\.0\\.1:4000`))
      assert.deepEqual(dockerCalls(), [])
    })
  })

  it('refuses an explicit Ledger relaunch once its bridge group is killed, and still reopens a plain one', async () => {
    await withCliRun(async ({ paths, cli }) => {
      const self = { pid: process.pid, startedAt: processStartTime(process.pid) ?? '' }
      // The recorded bridge: a process group of its own, killed below as a crash or `kill` would.
      const log = openSync(join(paths.runDir, 'bridge.log'), 'w')
      const bridge = startGroup('sleep', ['60'], { cwd: paths.runDir, env: ChildEnv.with(), log })
      closeSync(log)
      const pid = bridge.pid ?? 0
      const exited = new Promise<void>((done) => {
        bridge.on('exit', () => {
          done()
        })
      })
      writeJson(paths.stateFile, {
        ...runState(paths.runId),
        sentinel: { name: 'sentinel', ...self, port: 4000 },
        fakes: { name: 'fakes', ...self, electrumPort: 4001, mempoolPort: 4002 },
        emulators: [
          {
            device: 'ledger',
            model: 'flex',
            seed: 'primary',
            containerId: 'a'.repeat(64),
            daemon: DAEMON,
            apiPort: 9,
            healthUrl: 'http://127.0.0.1:9/events?currentscreenonly=true',
            bridge: {
              name: 'ledger-bridge',
              pid,
              startedAt: processStartTime(pid) ?? '',
              port: 9,
              url: 'http://127.0.0.1:9',
              controlPort: 9,
              mode: 'manual',
            },
          },
        ],
      })
      writeJson(join(paths.runDir, 'ledger-bridge.json'), { pid, drivePort: 9, controlPort: 9, token: 'b'.repeat(64) })
      process.kill(-pid, 'SIGKILL')
      await exited
      const explicit = cli(['launch', '--emulator', 'ledger', '--ledger-model', 'flex', '--emulator-seed', 'primary'])
      assert.equal(explicit.status, 1, said(explicit))
      assert.match(
        said(explicit),
        /is already running a Ledger flex with seed primary whose bridge does not answer \(control port 9 is not held by the bridge .*\)\. Stop the Ledger and start it again/,
      )
      const plain = cli(['launch'])
      assert.equal(plain.status, 0, said(plain))
      assert.match(plain.stdout, /is already running at http:\/\/127\.0\.0\.1:4000/)
    })
  })
})
