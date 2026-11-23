import { lstatSync, readdirSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import type { AsyncCommandResult } from './process'
import { isPathInside, processStartTime, wait } from './run'

const EnoentErrorSchema = z.object({ code: z.literal('ENOENT') })

export type StepStatus = 'pass' | 'fail' | 'offline-unverified'

export interface StepResult {
  name: string
  status: StepStatus
  detail: string
  durationMs: number
  screenshot?: string
}

export interface SmokeVerdictInput {
  steps: StepResult[]
  orchestrationError: string | null
  cleanupRequired: boolean
  cleanedUp: boolean
}

export interface SmokeVerdict {
  status: StepStatus
  reasons: string[]
}

export interface SmokeRunCheck {
  runId: string
  runDirExists: boolean
  evidenceDirExists: boolean
}

export interface DirEntryDigest {
  path: string
  kind: 'file' | 'dir' | 'symlink' | 'other'
  size: number
  mtimeMs: number
  linkTarget?: string
}

export interface DirSnapshot {
  path: string
  exists: boolean
  liveLockTarget: string | null
  entries: DirEntryDigest[]
}

const REQUIRED_CHECK_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8] as const

const MAIN_PROCESS_ERROR_MARKERS = [
  'Desktop verify uncaughtException:',
  'Desktop verify unhandledRejection:',
  'Desktop verify startup failed:',
] as const

export function smokeRunProblem(check: SmokeRunCheck): string | null {
  if (check.runDirExists) {
    return `Smoke requires a fresh run id, but run "${check.runId}" already exists. Choose a new --run id or omit --run.`
  }
  if (check.evidenceDirExists) {
    return `Smoke requires a fresh run id, but evidence directory for "${check.runId}" already exists. Choose a new --run id or omit --run.`
  }
  return null
}

function readLiveLockTarget(dir: string): string | null {
  const lockPath = join(dir, 'SingletonLock')
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(lockPath)
  } catch (error) {
    if (parseUnknown(EnoentErrorSchema, error).isOk()) {
      return null
    }
    throw error
  }
  if (!stat.isSymbolicLink()) {
    return null
  }
  const target = readlinkSync(lockPath)
  const match = /-(\d+)$/.exec(target)
  if (match?.[1] === undefined) {
    return null
  }
  const pid = Number(match[1])
  return Number.isInteger(pid) && pid > 0 && processStartTime(pid) !== null ? target : null
}

function collectEntriesRecursive(rootDir: string, relDir: string, entries: DirEntryDigest[]): void {
  const currentDir = relDir.length === 0 ? rootDir : join(rootDir, relDir)
  const names = readdirSync(currentDir).sort((a, b) => a.localeCompare(b))
  for (const name of names) {
    const relPath = relDir.length === 0 ? name : `${relDir}/${name}`
    const fullPath = join(currentDir, name)
    const stat = lstatSync(fullPath)
    if (stat.isSymbolicLink()) {
      entries.push({
        path: relPath,
        kind: 'symlink',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        linkTarget: readlinkSync(fullPath),
      })
    } else if (stat.isDirectory()) {
      entries.push({
        path: relPath,
        kind: 'dir',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })
      collectEntriesRecursive(rootDir, relPath, entries)
    } else if (stat.isFile()) {
      entries.push({
        path: relPath,
        kind: 'file',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })
    } else {
      entries.push({
        path: relPath,
        kind: 'other',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })
    }
  }
}

export function snapshotDir(dir: string): DirSnapshot {
  try {
    lstatSync(dir)
  } catch (error) {
    if (parseUnknown(EnoentErrorSchema, error).isOk()) {
      return { path: dir, exists: false, liveLockTarget: null, entries: [] }
    }
    throw error
  }
  const entries: DirEntryDigest[] = []
  collectEntriesRecursive(dir, '', entries)
  return { path: dir, exists: true, liveLockTarget: readLiveLockTarget(dir), entries }
}

export function verifyFolderUntouched(before: DirSnapshot, after: DirSnapshot): string | null {
  if (before.liveLockTarget !== null) {
    // Another live Electron app owns this folder (e.g. an installed Control Center running in the tray),
    // so Chromium background caches like DIPS-wal may flush on their own schedule. Verify we did not
    // disturb its SingletonLock or Sentinel port file; Check 7 also verifies zero open FDs from our process group.
    if (after.liveLockTarget !== before.liveLockTarget) {
      return `${before.path}: SingletonLock changed (${before.liveLockTarget} -> ${after.liveLockTarget ?? 'missing'})`
    }
    const beforePort = before.entries.find((entry) => entry.path === 'port')
    const afterPort = after.entries.find((entry) => entry.path === 'port')
    if (JSON.stringify(beforePort) !== JSON.stringify(afterPort)) {
      return `${before.path}: port file changed`
    }
    return null
  }
  if (before.exists !== after.exists) {
    return `${before.path}: existence changed (${String(before.exists)} -> ${String(after.exists)})`
  }
  const beforeMap = new Map(before.entries.map((entry) => [entry.path, JSON.stringify(entry)]))
  const afterMap = new Map(after.entries.map((entry) => [entry.path, JSON.stringify(entry)]))
  const changed: string[] = []
  for (const relPath of new Set([...beforeMap.keys(), ...afterMap.keys()])) {
    if (beforeMap.get(relPath) !== afterMap.get(relPath)) {
      changed.push(relPath)
    }
  }
  return changed.length === 0 ? null : `${before.path}: modified entries [${changed.join(', ')}]`
}

export function parseLsofOpenFiles(
  result: AsyncCommandResult,
  dirs: string[],
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (result.timedOut) {
    throw new Error('lsof timed out while inspecting open files')
  }
  if (result.signal !== null) {
    throw new Error(`lsof terminated by signal ${result.signal}`)
  }
  const stderr = result.stderr.trim()
  const ok = result.code === 0 || (result.code === 1 && stderr.length === 0)
  if (!ok) {
    throw new Error(`lsof failed (code=${String(result.code)}): ${stderr.length > 0 ? stderr : 'no stderr'}`)
  }
  const hits: string[] = []
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('n/')) {
      continue
    }
    const filePath = line.slice(1)
    if (dirs.some((dir) => isPathInside(filePath, dir, platform))) {
      hits.push(filePath)
    }
  }
  return [...new Set(hits)]
}

export function findMainProcessErrors(electronLog: string): string[] {
  const matches: string[] = []
  for (const rawLine of electronLog.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) {
      continue
    }
    if (MAIN_PROCESS_ERROR_MARKERS.some((marker) => line.includes(marker))) {
      matches.push(line)
    }
  }
  return matches
}

export function verifyCleanShutdownLog(electronLog: string): string | null {
  if (electronLog.includes('Desktop verify shutdown failed')) {
    return 'electron.log recorded Desktop verify shutdown failed'
  }
  if (electronLog.includes('Desktop verify shutdown forced')) {
    return 'electron.log recorded Desktop verify shutdown forced'
  }
  if (!hasLogLine(electronLog, 'verify-shutdown:clean')) {
    return 'electron.log is missing affirmative verify-shutdown:clean confirmation'
  }
  return null
}

export function hasLogLine(logSlice: string, expectedLine: string): boolean {
  return logSlice.split('\n').some((line) => line.trim() === expectedLine)
}

export function parseVerifyDownloadEvent(logSlice: string): { state: string; fileName: string } | null {
  for (const rawLine of logSlice.split('\n')) {
    const match = /^verify-download:([^:]+):(.+)$/.exec(rawLine.trim())
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { state: match[1], fileName: match[2] }
    }
  }
  return null
}

export function computeSmokeVerdict(input: SmokeVerdictInput): SmokeVerdict {
  const reasons: string[] = []
  if (input.orchestrationError !== null) {
    reasons.push(`orchestration error: ${input.orchestrationError}`)
  }
  for (const step of input.steps) {
    if (step.status === 'fail') {
      reasons.push(`step failed: ${step.name}`)
    }
  }
  for (const num of REQUIRED_CHECK_NUMBERS) {
    const prefix = `${num}. `
    if (!input.steps.some((step) => step.name.startsWith(prefix))) {
      reasons.push(`missing required check ${num}`)
    }
  }
  if (input.cleanupRequired && !input.cleanedUp) {
    reasons.push('cleanup did not succeed')
  }
  if (reasons.length > 0) {
    return { status: 'fail', reasons }
  }
  if (input.steps.some((step) => step.status === 'offline-unverified')) {
    return { status: 'offline-unverified', reasons: [] }
  }
  return { status: 'pass', reasons: [] }
}

export function parseScopedUsdAmount(text: string): number | null {
  const match = /^\$([\d,]+(?:\.\d{2})?)$/.exec(text.trim())
  if (match?.[1] === undefined) {
    return null
  }
  const value = Number(match[1].replace(/,/g, ''))
  return Number.isFinite(value) && value > 0 ? value : null
}

export function isWithinPortfolioUsdTolerance(renderedUsd: number, expectedUsd: number, accountCount: number): boolean {
  if (!Number.isFinite(renderedUsd) || !Number.isFinite(expectedUsd) || accountCount < 0) {
    return false
  }
  return Math.abs(renderedUsd - expectedUsd) <= accountCount * 0.01 + 1e-9
}

export function matchesAnyPortfolioUsdQuote(
  renderedUsd: number,
  expectedUsdQuotes: readonly number[],
  accountCount: number,
): boolean {
  return expectedUsdQuotes.some((expectedUsd) => isWithinPortfolioUsdTolerance(renderedUsd, expectedUsd, accountCount))
}

export async function waitForValue<T>(
  description: string,
  read: () => Promise<T | null> | T | null,
  timeoutMs: number,
  intervalMs = 250,
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value !== null) {
      return value
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${description}`)
    }
    await wait(Math.min(intervalMs, remaining))
  }
}

export async function waitForCondition(
  description: string,
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 250,
): Promise<void> {
  await waitForValue(description, async () => ((await check()) ? true : null), timeoutMs, intervalMs)
}
