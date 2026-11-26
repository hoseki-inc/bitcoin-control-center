import { type ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'

// The only module in tools/verify that starts other programs (lint enforces it). Every child gets a ChildEnv, so the
// caller's GIT_*, VITE_*, TZ or anything else outside the allowlist can never steer what a child acts on.

/** Variables a child may take from the caller. Everything else is left out. */
const INHERITED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG'] as const

/** Extra variables forwarded exclusively to Docker CLI invocations (never to Sentinel, fakes, or app children). */
const DOCKER_INHERITED = ['DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG'] as const

/**
 * A child's whole environment: the allowlisted variables, the parent's temp folder, and what the caller sets on
 * purpose. The private field makes the type nominal, so nothing but `ChildEnv.with` can build one.
 */
export class ChildEnv {
  readonly #vars: Readonly<Record<string, string>>

  private constructor(vars: Readonly<Record<string, string>>) {
    this.#vars = vars
  }

  public get vars(): Readonly<Record<string, string>> {
    return this.#vars
  }

  public static with(extra: Readonly<Record<string, string>> = {}): ChildEnv {
    const inherited = Object.fromEntries(
      INHERITED.flatMap((name) => {
        const value = process.env[name]
        return value === undefined ? [] : [[name, value]]
      }),
    )
    // The temp folder the parent resolved (from TMPDIR, TMP or TEMP), so parent and child agree on run folders.
    return new ChildEnv({ ...inherited, TMPDIR: tmpdir(), ...extra })
  }
}

/** Optional cache root override (`BCC_VERIFY_CACHE_DIR`) for emulator artifacts such as compiled Ledger ELFs. */
export function verifyCacheDirOverride(): string | undefined {
  const value = process.env['BCC_VERIFY_CACHE_DIR']?.trim()
  return value !== undefined && value !== '' ? value : undefined
}

/** True when the caller opted into the live Docker emulator tests with `BCC_VERIFY_EMULATOR_TESTS=1`. */
export function emulatorTestsEnabled(): boolean {
  return process.env['BCC_VERIFY_EMULATOR_TESTS'] === '1'
}

function callerVars(names: readonly string[]): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => {
      const value = process.env[name]
      return value === undefined ? [] : [[name, value]]
    }),
  )
}

/** Child environment for Docker CLI calls, forwarding DOCKER_HOST, DOCKER_CONTEXT, and DOCKER_CONFIG when set. */
export function dockerChildEnv(): ChildEnv {
  return ChildEnv.with(callerVars(DOCKER_INHERITED))
}

/** The caller's Docker selection, in the CLI's order of precedence: DOCKER_HOST, then DOCKER_CONTEXT. */
export interface DockerSelection {
  host?: string
  context?: string
  config?: string
}

/** The DOCKER_HOST, DOCKER_CONTEXT and DOCKER_CONFIG the caller set, ignoring empty values as the Docker CLI does. */
export function callerDockerSelection(): DockerSelection {
  const read = (name: (typeof DOCKER_INHERITED)[number]): string | undefined => {
    const value = process.env[name]?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  const selection: DockerSelection = {}
  const host = read('DOCKER_HOST')
  const context = read('DOCKER_CONTEXT')
  const config = read('DOCKER_CONFIG')
  if (host !== undefined) {
    selection.host = host
  }
  if (context !== undefined) {
    selection.context = context
  }
  if (config !== undefined) {
    selection.config = config
  }
  return selection
}

/** Where a recorded container's Docker daemon was reached. */
export interface DockerTarget {
  endpoint?: string
  context?: string
  dockerConfig?: string
}

/**
 * Child environment pinned to a recorded Docker daemon: DOCKER_HOST set to its endpoint (or DOCKER_CONTEXT to its
 * context when no endpoint was recorded) and DOCKER_CONFIG to its recorded config folder, whatever the caller's shell
 * selects now. With neither endpoint nor context it is the caller's own Docker environment, with any recorded config.
 */
export function dockerChildEnvFor(target: DockerTarget): ChildEnv {
  const config: Record<string, string> = target.dockerConfig !== undefined ? { DOCKER_CONFIG: target.dockerConfig } : {}
  if (target.endpoint !== undefined) {
    return ChildEnv.with({ DOCKER_HOST: target.endpoint, ...config })
  }
  if (target.context !== undefined) {
    return ChildEnv.with({ DOCKER_CONTEXT: target.context, ...config })
  }
  return ChildEnv.with({ ...callerVars(DOCKER_INHERITED), ...config })
}

/**
 * Environment for a nested `helpers/verify` call: the base allowlist plus BCC_VERIFY_CACHE_DIR and the Docker
 * selection, which the helper forwards only to its own Docker calls. Sentinel, fakes and apps still get `ChildEnv.with`.
 */
export function verifyHelperEnv(extra: Readonly<Record<string, string>> = {}): ChildEnv {
  return ChildEnv.with({ ...callerVars(['BCC_VERIFY_CACHE_DIR', ...DOCKER_INHERITED]), ...extra })
}

interface CommandOptions {
  env: ChildEnv
  cwd?: string
}

/** Runs a program to completion and returns its output. Its error output is dropped; a failure still throws. */
export function runCommand(command: string, args: string[], { env, cwd }: CommandOptions): string {
  return execFileSync(command, args, {
    cwd,
    env: env.vars,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

export interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
  error: string | null
}

/** Runs a program to completion without throwing, capturing stdout, stderr, exit status, and spawn errors. */
export function runCommandResult(command: string, args: string[], { env, cwd }: CommandOptions): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    env: env.vars,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error?.message ?? null,
  }
}

/** Runs a program to completion with all its output in a log file. Throws when it fails. */
export function runToLog(command: string, args: string[], { env, cwd, log }: CommandOptions & { log: number }): void {
  execFileSync(command, args, { cwd, env: env.vars, stdio: ['ignore', log, log] })
}

/** Starts a program as its own process group, writing to a log file, and lets it outlive the caller. */
export function startGroup(
  command: string,
  args: string[],
  { env, cwd, log }: CommandOptions & { log: number },
): ChildProcess {
  const child = spawn(command, args, { cwd, env: env.vars, detached: true, stdio: ['ignore', log, log] })
  child.unref()
  return child
}

export interface AsyncCommandResult {
  code: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** Runs a program asynchronously with an optional timeout, capturing stdout and stderr without throwing. */
export async function runAsync(
  command: string,
  args: string[],
  { env, cwd, timeoutMs }: CommandOptions & { timeoutMs?: number },
): Promise<AsyncCommandResult> {
  return new Promise((done) => {
    const child = spawn(command, args, {
      cwd,
      env: env.vars,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer !== null) {
        clearTimeout(timer)
      }
      done({ code, signal, stdout, stderr, timedOut })
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    const timer =
      timeoutMs === undefined
        ? null
        : setTimeout(() => {
            timedOut = true
            try {
              if (child.pid !== undefined) {
                process.kill(-child.pid, 'SIGKILL')
              } else {
                child.kill('SIGKILL')
              }
            } catch {
              try {
                child.kill('SIGKILL')
              } catch {
                void child.exitCode
              }
            }
            setTimeout(() => {
              finish(null, 'SIGKILL')
            }, 500)
          }, timeoutMs)
    child.on('error', (error) => {
      stderr += `${error.message}\n`
      finish(1, null)
    })
    child.on('close', (code, signal) => {
      finish(code, signal)
    })
  })
}
