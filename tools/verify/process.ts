import { type ChildProcess, execFileSync, spawn } from 'node:child_process'
import { tmpdir } from 'node:os'

// The only module in tools/verify that starts other programs (lint enforces it). Every child gets a ChildEnv, so the
// caller's GIT_*, VITE_*, TZ or anything else outside the allowlist can never steer what a child acts on.

/** Variables a child may take from the caller. Everything else is left out. */
const INHERITED = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG'] as const

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
