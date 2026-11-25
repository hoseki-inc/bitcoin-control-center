import type { ScriptTypeBalanceState } from '@hoseki/packages/ui/design-system'

const CHUNK_SIZE = 10
const GAP_LIMIT = 20
const MAX_ADDRESS_INDEX = 10_000
const COMPLETED_TTL_MS = 60_000
const HANDOFF_GRACE_MS = 30_000

export interface ScanChunkInput {
  account: string
  chain: 'receive' | 'change'
  startIndex: number
  count: number
}

export interface ScanChunkResult {
  usedIndexes: number[]
  balanceSats: string
}

export type FetchScanChunk = (input: ScanChunkInput) => Promise<ScanChunkResult>
export type CancelScanChunk = (input: ScanChunkInput) => void

type Listener = (state: ScriptTypeBalanceState) => void

interface ActiveScan {
  state: ScriptTypeBalanceState
  listeners: Set<Listener>
  cancelled: boolean
  completedAt: number | null
  handoffUntil: number
  handoffTimer: ReturnType<typeof setTimeout> | null
  evictionTimer: ReturnType<typeof setTimeout> | null
  pendingPrune: boolean
  activeChunk: ScanChunkInput | null
  cancelChunk: CancelScanChunk | null
}

const scans = new Map<string, ActiveScan>()

function clearTimers(entry: ActiveScan): void {
  if (entry.handoffTimer !== null) {
    clearTimeout(entry.handoffTimer)
    entry.handoffTimer = null
  }
  if (entry.evictionTimer !== null) {
    clearTimeout(entry.evictionTimer)
    entry.evictionTimer = null
  }
}

function cancelActiveChunk(entry: ActiveScan): void {
  if (entry.activeChunk !== null) {
    const active = entry.activeChunk
    entry.activeChunk = null
    entry.cancelChunk?.(active)
  }
}

function notify(entry: ActiveScan): void {
  for (const listener of entry.listeners) {
    listener(entry.state)
  }
}

function scheduleEviction(accountKey: string, entry: ActiveScan): void {
  if (entry.completedAt === null || entry.evictionTimer !== null) {
    return
  }
  const remainingMs = Math.max(0, COMPLETED_TTL_MS - (Date.now() - entry.completedAt))
  if (remainingMs === 0) {
    if (scans.get(accountKey) === entry) {
      scans.delete(accountKey)
    }
    return
  }
  entry.evictionTimer = setTimeout(() => {
    entry.evictionTimer = null
    if (entry.listeners.size === 0 && Date.now() >= entry.handoffUntil && scans.get(accountKey) === entry) {
      scans.delete(accountKey)
    }
  }, remainingMs)
}

function maybeCancelAndPrune(accountKey: string, entry: ActiveScan): void {
  if (entry.listeners.size > 0 || Date.now() < entry.handoffUntil) {
    return
  }
  if (entry.state.status === 'loading') {
    entry.cancelled = true
    clearTimers(entry)
    cancelActiveChunk(entry)
    if (scans.get(accountKey) === entry) {
      scans.delete(accountKey)
    }
    return
  }
  scheduleEviction(accountKey, entry)
}

function schedulePruneCheck(accountKey: string, entry: ActiveScan): void {
  if (entry.listeners.size > 0 || entry.pendingPrune) {
    return
  }
  entry.pendingPrune = true
  queueMicrotask(() => {
    entry.pendingPrune = false
    if (scans.get(accountKey) !== entry) {
      return
    }
    maybeCancelAndPrune(accountKey, entry)
  })
}

async function scanChain(
  account: string,
  chain: 'receive' | 'change',
  fetchChunk: FetchScanChunk,
  onChunkBalance: (chunkSats: bigint) => void,
  isCancelled: () => boolean,
  stopAfterFirstEmptyWave = false,
): Promise<{ anyUsed: boolean }> {
  let index = 0
  let unusedStreak = 0
  let anyUsed = false

  while (unusedStreak < GAP_LIMIT && index < MAX_ADDRESS_INDEX) {
    if (isCancelled()) {
      return { anyUsed }
    }
    const remaining = GAP_LIMIT - unusedStreak
    const count = Math.min(CHUNK_SIZE, remaining, MAX_ADDRESS_INDEX - index)
    const chunk = await fetchChunk({ account, chain, startIndex: index, count })
    if (isCancelled()) {
      return { anyUsed }
    }

    const usedSet = new Set(chunk.usedIndexes)
    for (let offset = 0; offset < count; offset += 1) {
      if (usedSet.has(index + offset)) {
        unusedStreak = 0
        anyUsed = true
      } else {
        unusedStreak += 1
      }
    }

    const chunkSats = BigInt(chunk.balanceSats)
    if (chunkSats > 0n) {
      onChunkBalance(chunkSats)
    }
    index += count

    if (stopAfterFirstEmptyWave && !anyUsed) {
      break
    }
  }

  return { anyUsed }
}

async function runScan(accountKey: string, entry: ActiveScan, fetchChunk: FetchScanChunk): Promise<void> {
  let runningSats = 0n
  const isCancelled = (): boolean => entry.cancelled
  const fetchTrackedChunk: FetchScanChunk = async (input) => {
    entry.activeChunk = input
    try {
      return await fetchChunk(input)
    } finally {
      if (entry.activeChunk === input) {
        entry.activeChunk = null
      }
    }
  }
  const handleChunkBalance = (chunkSats: bigint): void => {
    runningSats += chunkSats
    if (!entry.cancelled) {
      entry.state = { status: 'loading', balanceSats: runningSats }
      notify(entry)
    }
  }

  try {
    const receive = await scanChain(accountKey, 'receive', fetchTrackedChunk, handleChunkBalance, isCancelled)
    if (isCancelled()) {
      return
    }
    await scanChain(accountKey, 'change', fetchTrackedChunk, handleChunkBalance, isCancelled, !receive.anyUsed)
    if (isCancelled()) {
      return
    }
    entry.state = { status: 'loaded', balanceSats: runningSats }
    entry.completedAt = Date.now()
    notify(entry)
    maybeCancelAndPrune(accountKey, entry)
  } catch {
    if (!isCancelled()) {
      entry.state = { status: 'error' }
      entry.completedAt = Date.now()
      notify(entry)
      maybeCancelAndPrune(accountKey, entry)
    }
  }
}

function getReusableScan(accountKey: string): ActiveScan | undefined {
  const existing = scans.get(accountKey)
  if (existing === undefined || existing.cancelled) {
    return undefined
  }
  if (existing.state.status === 'error') {
    clearTimers(existing)
    scans.delete(accountKey)
    return undefined
  }
  if (existing.completedAt !== null && Date.now() - existing.completedAt >= COMPLETED_TTL_MS) {
    clearTimers(existing)
    scans.delete(accountKey)
    return undefined
  }
  return existing
}

export function readActiveAccountScan(accountKey: string): ScriptTypeBalanceState | undefined {
  return getReusableScan(accountKey)?.state
}

export function subscribeAccountScan(
  accountKey: string,
  fetchChunk: FetchScanChunk,
  listener: Listener,
  cancelChunk?: CancelScanChunk,
): () => void {
  let entry = getReusableScan(accountKey)
  if (entry === undefined) {
    entry = {
      state: { status: 'loading' },
      listeners: new Set(),
      cancelled: false,
      completedAt: null,
      handoffUntil: 0,
      handoffTimer: null,
      evictionTimer: null,
      pendingPrune: false,
      activeChunk: null,
      cancelChunk: cancelChunk ?? null,
    }
    scans.set(accountKey, entry)
    void runScan(accountKey, entry, fetchChunk)
  } else {
    if (entry.evictionTimer !== null) {
      clearTimeout(entry.evictionTimer)
      entry.evictionTimer = null
    }
    if (cancelChunk !== undefined) {
      entry.cancelChunk = cancelChunk
    }
  }

  entry.listeners.add(listener)
  listener(entry.state)

  const currentEntry = entry
  return () => {
    currentEntry.listeners.delete(listener)
    schedulePruneCheck(accountKey, currentEntry)
  }
}

export function subscribeExistingAccountScan(accountKey: string, listener: Listener): (() => void) | null {
  const entry = getReusableScan(accountKey)
  if (entry === undefined) {
    return null
  }
  clearTimers(entry)
  entry.handoffUntil = 0
  entry.listeners.add(listener)
  listener(entry.state)

  return () => {
    entry.listeners.delete(listener)
    schedulePruneCheck(accountKey, entry)
  }
}

export function handOffAccountScan(accountKey: string): void {
  const entry = getReusableScan(accountKey)
  if (entry === undefined) {
    return
  }
  clearTimers(entry)
  entry.handoffUntil = Date.now() + HANDOFF_GRACE_MS
  entry.handoffTimer = setTimeout(() => {
    entry.handoffTimer = null
    entry.handoffUntil = 0
    maybeCancelAndPrune(accountKey, entry)
  }, HANDOFF_GRACE_MS)
}

export function resetXpubScanStore(): void {
  for (const entry of scans.values()) {
    entry.cancelled = true
    clearTimers(entry)
    cancelActiveChunk(entry)
  }
  scans.clear()
}
