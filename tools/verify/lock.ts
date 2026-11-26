import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'

// An exclusive lock shared by every process on this machine, held across awaits. The lock is a directory holding
// owner.json, which names its holder. Every change to that directory (taking it, releasing it, reclaiming it from a
// holder that exited) happens inside a short SQLite exclusive transaction on a file beside it. The OS drops that
// transaction's lock when a process dies, so it never needs recovering, and no two changes can interleave. Checking
// whether a holder still runs is slow, so it happens outside the transaction; a reclaim then removes the lock only if
// it still holds the owner token that was judged, so it can never remove a successor's lock.

const OwnerSchema = z.object({
  pid: z.number().int().positive(),
  startedAt: z.string().min(1),
  hostname: z.string(),
  /** Tells holders apart, including two in one process or a later holder with a reused PID. */
  token: z.string().min(1),
})
export type LockOwner = z.infer<typeof OwnerSchema>

/** What a PID is now. `unknown` means the lookup failed, which never counts as the holder having exited. */
export type ProcessIdentity =
  | { state: 'running'; startedAt: string }
  | { state: 'exited' }
  | { state: 'unknown'; detail: string }

export interface LockOptions {
  /** Looks up a PID. Only `exited`, or `running` with another start time (a reused PID), lets a lock be reclaimed. */
  identify: (pid: number) => ProcessIdentity
  /** How long to wait for the lock before giving up. */
  timeoutMs?: number
  pollMs?: number
}

const OWNER_FILE = 'owner.json'
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_POLL_MS = 25
/** How long a holder judged alive is trusted before it is looked up again. */
const RECHECK_MS = 500

const MissingFileSchema = z.object({ code: z.literal('ENOENT') })

/**
 * The lock's owner; null when owner.json is missing or isn't a valid owner record; 'gone' when there is no lock. Any
 * other failure to read it (EACCES, EIO, EMFILE) says nothing about the holder, so it is thrown, never taken as null.
 */
function readOwner(lockDir: string): LockOwner | null | 'gone' {
  if (!existsSync(lockDir)) {
    return 'gone'
  }
  let raw: string
  try {
    raw = readFileSync(join(lockDir, OWNER_FILE), 'utf8')
  } catch (error) {
    if (parseUnknown(MissingFileSchema, error).isOk()) {
      return null
    }
    throw error
  }
  let decoded: unknown
  try {
    decoded = JSON.parse(raw)
  } catch {
    return null
  }
  const parsed = parseUnknown(OwnerSchema, decoded)
  return parsed.isOk() ? parsed.unwrap() : null
}

/**
 * Runs `fn` inside an exclusive SQLite transaction on `<lockDir>.mutex.sqlite`, waiting for other processes' turns.
 * `fn` must be synchronous and quick: it only reads owner.json and makes, renames or removes the lock directory.
 */
function underMutex<T>(lockDir: string, deadline: number, fn: () => T): T {
  const database = new DatabaseSync(`${lockDir}.mutex.sqlite`)
  try {
    database.exec(`PRAGMA busy_timeout = ${Math.max(1, deadline - Date.now())}`)
    database.exec('BEGIN EXCLUSIVE')
    try {
      return fn()
    } finally {
      database.exec('COMMIT')
    }
  } finally {
    database.close()
  }
}

/** Moves the lock aside in one step, so nothing can take its path between the check and the removal. */
function moveAside(lockDir: string): string {
  const tombstone = `${lockDir}.gone-${randomBytes(6).toString('hex')}`
  renameSync(lockDir, tombstone)
  return tombstone
}

function writeOwner(lockDir: string, owner: LockOwner): void {
  const target = join(lockDir, OWNER_FILE)
  const temp = `${target}.${owner.token}.tmp`
  writeFileSync(temp, `${JSON.stringify(owner)}\n`)
  renameSync(temp, target)
}

type Attempt = { kind: 'acquired' } | { kind: 'held'; owner: LockOwner }

/** Takes the lock if it is free, clearing one a crash left without an owner. Runs under the mutex. */
function tryTake(lockDir: string, owner: LockOwner): Attempt {
  const current = readOwner(lockDir)
  if (current !== 'gone' && current !== null) {
    return { kind: 'held', owner: current }
  }
  if (current === null) {
    // Taking the lock makes and fills it in one turn of the mutex, so an ownerless lock means its taker died midway.
    rmSync(moveAside(lockDir), { recursive: true, force: true })
  }
  mkdirSync(lockDir)
  try {
    writeOwner(lockDir, owner)
  } catch (error) {
    // Still under the mutex, so this is the directory this attempt just made, not anyone else's.
    rmSync(lockDir, { recursive: true, force: true })
    throw error
  }
  return { kind: 'acquired' }
}

/** True only on evidence that the holder is gone: it exited, or its PID now belongs to a process started later. */
function holderIsGone(owner: LockOwner, identify: LockOptions['identify']): boolean {
  // A PID from another machine can't be checked here; wait for it instead.
  if (owner.hostname !== hostname()) {
    return false
  }
  const identity = identify(owner.pid)
  return identity.state === 'exited' || (identity.state === 'running' && identity.startedAt !== owner.startedAt)
}

/** Removes the lock if it still holds `owner`'s token, under the mutex. True when it did. */
function reclaim(lockDir: string, owner: LockOwner, deadline: number): boolean {
  const tombstone = underMutex(lockDir, deadline, () => {
    const current = readOwner(lockDir)
    return current !== 'gone' && current !== null && current.token === owner.token ? moveAside(lockDir) : null
  })
  if (tombstone === null) {
    return false
  }
  rmSync(tombstone, { recursive: true, force: true })
  return true
}

function release(lockDir: string, owner: LockOwner): void {
  // Release waits for the mutex too, so a reclaim's token check and removal see the same lock.
  const tombstone = underMutex(lockDir, Date.now() + DEFAULT_TIMEOUT_MS, () => {
    const current = readOwner(lockDir)
    return current !== 'gone' && current !== null && current.token === owner.token ? moveAside(lockDir) : null
  })
  if (tombstone !== null) {
    rmSync(tombstone, { recursive: true, force: true })
  }
}

let ownStart: string | null = null

function ownStartTime(identify: LockOptions['identify']): string {
  if (ownStart === null) {
    const identity = identify(process.pid)
    if (identity.state !== 'running') {
      throw new Error(`Could not read this process's start time (PID ${process.pid}) to take a lock`)
    }
    ownStart = identity.startedAt
  }
  return ownStart
}

/**
 * Runs `fn` while holding the lock at `lockDir`, then releases it, even when `fn` throws. Waits for another holder,
 * and reclaims the lock only from a holder shown to be gone. Not re-entrant: calling it again for the same lock inside
 * `fn` waits until it times out.
 */
export async function withLock<T>(lockDir: string, options: LockOptions, fn: () => T | Promise<T>): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const owner: LockOwner = {
    pid: process.pid,
    startedAt: ownStartTime(options.identify),
    hostname: hostname(),
    token: randomBytes(8).toString('hex'),
  }
  mkdirSync(dirname(lockDir), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let judgedAlive: { token: string; at: number } | null = null
  for (;;) {
    const attempt = underMutex(lockDir, deadline, () => tryTake(lockDir, owner))
    if (attempt.kind === 'acquired') {
      break
    }
    const holder = attempt.owner
    const recentlyAlive = judgedAlive?.token === holder.token && Date.now() - judgedAlive.at < RECHECK_MS
    if (!recentlyAlive) {
      if (holderIsGone(holder, options.identify) && reclaim(lockDir, holder, deadline)) {
        continue
      }
      judgedAlive = { token: holder.token, at: Date.now() }
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs} ms waiting for ${lockDir} (held by PID ${holder.pid} on ${holder.hostname})`,
      )
    }
    await sleep(pollMs)
  }
  try {
    return await fn()
  } finally {
    release(lockDir, owner)
  }
}
