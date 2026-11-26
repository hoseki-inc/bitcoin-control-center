import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import { withLock } from '../lock'
import { ChildEnv, runCommandResult } from '../process'
import {
  type DockerCommandRunner,
  type DockerDaemon,
  type LedgerModel,
  type RunPaths,
  createTrackedContainer,
  discardContainer,
  processIdentity,
  runDocker,
} from '../run'
import {
  APP_BITCOIN_COMMIT,
  APP_BITCOIN_REPO,
  LEDGER_APP_BUILDER_IMAGE,
  LEDGER_ARCHES,
  LEDGER_SDK_VARS,
  type LedgerArch,
  PINNED_ELF_SHA256,
} from './ledger'

// Builds app-bitcoin from the pinned commit with the pinned builder image and caches app.elf per builder platform
// and model. The source goes into the builder with `docker cp` and the ELF comes out the same way, so nothing is
// bind-mounted. Every build and every cache hit is checked against the pinned SHA-256 before Speculos may load it.

const BUILDER_DIGEST = LEDGER_APP_BUILDER_IMAGE.slice(LEDGER_APP_BUILDER_IMAGE.indexOf('sha256:') + 7)
export const ELF_CACHE_KEY = `app-bitcoin-${APP_BITCOIN_COMMIT.slice(0, 8)}-builder-${BUILDER_DIGEST.slice(0, 8)}`
const BUILD_LOCK_TIMEOUT_MS = 30 * 60_000

const ManifestSchema = z.object({
  appCommit: z.string(),
  builderImage: z.string(),
  arch: z.enum(LEDGER_ARCHES),
  model: z.string(),
  sha256: z.string(),
  size: z.number().int().positive(),
  builtAt: z.string(),
})
type Manifest = z.infer<typeof ManifestSchema>

export interface ElfCachePaths {
  dir: string
  elf: string
  manifest: string
  /** Held while this platform and model is checked or built. It sits beside the target, never inside it. */
  lockDir: string
}

export function elfCachePaths(cacheDir: string, arch: LedgerArch, model: LedgerModel): ElfCachePaths {
  const keyDir = join(cacheDir, ELF_CACHE_KEY)
  const dir = join(keyDir, `linux-${arch}`, model)
  return {
    dir,
    elf: join(dir, 'app.elf'),
    manifest: join(dir, 'manifest.json'),
    lockDir: join(keyDir, `.lock-linux-${arch}-${model}`),
  }
}

export const sha256Hex = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/** The Docker daemon's platform, which picks the builder and Speculos image variants. */
export function dockerArch(daemon: DockerDaemon, docker: DockerCommandRunner = runDocker): Result<LedgerArch, string> {
  const result = docker(['version', '--format', '{{.Server.Arch}}'], daemon)
  const arch = result.stdout.trim()
  const known = LEDGER_ARCHES.find((candidate) => candidate === arch)
  return known === undefined
    ? Err(`Docker reports server platform ${JSON.stringify(arch)}; expected arm64 or amd64`)
    : Ok(known)
}

/** Fetches exactly the pinned commit into an empty folder and checks HEAD is that commit. */
export type SourceFetcher = (dir: string) => Result<void, string>

export const fetchPinnedSource: SourceFetcher = (dir) => {
  const git = (args: string[]): boolean => {
    const result = runCommandResult('git', args, { cwd: dir, env: ChildEnv.with() })
    return result.error === null && result.status === 0
  }
  const fetched =
    git(['init', '--quiet']) &&
    git(['fetch', '--quiet', '--depth', '1', APP_BITCOIN_REPO, APP_BITCOIN_COMMIT]) &&
    git(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', 'FETCH_HEAD'])
  if (!fetched) {
    return Err(`Could not fetch ${APP_BITCOIN_REPO} at ${APP_BITCOIN_COMMIT}`)
  }
  const head = runCommandResult('git', ['rev-parse', 'HEAD'], { cwd: dir, env: ChildEnv.with() }).stdout.trim()
  return head === APP_BITCOIN_COMMIT
    ? Ok(undefined)
    : Err(`Fetched app-bitcoin is at ${head}, not ${APP_BITCOIN_COMMIT}`)
}

export interface ElfBuild {
  arch: LedgerArch
  model: LedgerModel
  daemon: DockerDaemon
}

/**
 * Builds app.elf once in a fresh builder container recorded in the run's journal, then removes that container. Returns
 * the bytes; checking them against the pin is the caller's job.
 */
export async function buildLedgerElf(
  paths: RunPaths,
  build: ElfBuild,
  docker: DockerCommandRunner = runDocker,
  fetchSource: SourceFetcher = fetchPinnedSource,
): Promise<Result<Buffer, string>> {
  const work = mkdtempSync(join(tmpdir(), 'bcc-verify-app-bitcoin-'))
  try {
    const source = join(work, 'app-bitcoin')
    mkdirSync(source)
    const fetched = fetchSource(source)
    if (fetched.isErr()) {
      return Err(fetched.unwrapErr())
    }
    const created = await createTrackedContainer(
      paths,
      {
        name: 'builder:ledger-elf',
        role: 'elf',
        image: LEDGER_APP_BUILDER_IMAGE,
        daemon: build.daemon,
        options: ['--platform', `linux/${build.arch}`],
        command: ['bash', '-lc', `BOLOS_SDK=$${LEDGER_SDK_VARS[build.model]} make -j"$(nproc)" COIN=bitcoin`],
      },
      () => null,
      docker,
    )
    if (created.isErr()) {
      return Err(created.unwrapErr())
    }
    const containerId = created.unwrap()
    const ok = (args: string[]): boolean => {
      const result = docker(args, build.daemon)
      return result.error === null && result.status === 0
    }
    const out = join(work, 'app.elf')
    const built =
      ok(['cp', `${source}/.`, `${containerId}:/app`]) &&
      ok(['start', '--attach', containerId]) &&
      ok(['cp', `${containerId}:/app/bin/app.elf`, out]) &&
      existsSync(out)
    const removal = await discardContainer(paths, containerId, build.daemon, docker)
    return built
      ? Ok(readFileSync(out))
      : Err(`Building app-bitcoin for ${build.model} on linux/${build.arch} failed; ${removal}`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Writes through a sibling temp file and a rename, so a reader sees the whole file or none. */
function publish(file: string, bytes: Buffer | string): void {
  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  try {
    writeFileSync(temp, bytes)
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
}

function cachedElf(cache: ElfCachePaths, expected: string): 'ok' | 'missing' | 'mismatch' {
  if (!existsSync(cache.elf)) {
    return 'missing'
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(cache.manifest, 'utf8'))
  } catch {
    return 'mismatch'
  }
  const parsed = parseUnknown(ManifestSchema, manifest)
  return parsed.isOk() && parsed.unwrap().sha256 === expected && sha256Hex(readFileSync(cache.elf)) === expected
    ? 'ok'
    : 'mismatch'
}

export interface EnsureElf extends ElfBuild {
  cacheDir: string
  log?: (line: string) => void
  pins?: typeof PINNED_ELF_SHA256
}

/**
 * The cached app.elf for this platform and model, built first when missing. A cached file whose hash is not the pin
 * is removed and rebuilt; a build whose hash is not the pin, or a platform with no pin, fails without caching anything.
 */
export async function ensureLedgerElf(
  paths: RunPaths,
  ensure: EnsureElf,
  docker: DockerCommandRunner = runDocker,
  fetchSource: SourceFetcher = fetchPinnedSource,
): Promise<Result<string, string>> {
  const log = ensure.log ?? console.log
  const expected = (ensure.pins ?? PINNED_ELF_SHA256)[ensure.arch][ensure.model]
  if (expected === undefined) {
    return Err(
      `No pinned app.elf SHA-256 for ${ensure.model} on linux/${ensure.arch}; refusing to trust a first build. Pin it in tools/verify/emulators/ledger.ts after checking a build by hand.`,
    )
  }
  const cache = elfCachePaths(ensure.cacheDir, ensure.arch, ensure.model)
  mkdirSync(cache.dir, { recursive: true })
  return withLock(cache.lockDir, { identify: processIdentity, timeoutMs: BUILD_LOCK_TIMEOUT_MS }, async () => {
    const found = cachedElf(cache, expected)
    if (found === 'ok') {
      return Ok(cache.elf)
    }
    if (found === 'mismatch') {
      log(`Cached ${cache.elf} does not match its pinned SHA-256; rebuilding it`)
      rmSync(cache.elf, { force: true })
      rmSync(cache.manifest, { force: true })
    }
    log(`Building app-bitcoin ${APP_BITCOIN_COMMIT.slice(0, 8)} for ${ensure.model} on linux/${ensure.arch}`)
    const built = await buildLedgerElf(paths, ensure, docker, fetchSource)
    if (built.isErr()) {
      return Err(built.unwrapErr())
    }
    const bytes = built.unwrap()
    const actual = sha256Hex(bytes)
    if (actual !== expected) {
      return Err(
        `Built app.elf for ${ensure.model} on linux/${ensure.arch} has SHA-256 ${actual}, not the pinned ${expected}; refusing to cache or run it`,
      )
    }
    const manifest: Manifest = {
      appCommit: APP_BITCOIN_COMMIT,
      builderImage: LEDGER_APP_BUILDER_IMAGE,
      arch: ensure.arch,
      model: ensure.model,
      sha256: actual,
      size: bytes.byteLength,
      builtAt: new Date().toISOString(),
    }
    publish(cache.elf, bytes)
    publish(cache.manifest, `${JSON.stringify(manifest, null, 2)}\n`)
    return Ok(cache.elf)
  })
}
