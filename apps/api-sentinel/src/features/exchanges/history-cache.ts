import { Err, Ok, type Result } from '@hoseki/packages/result'

export interface ExchangeHistoryEntry {
  timestamp: Date
  value: bigint
}

export interface ExchangeHistoryKey {
  encryptedCredentials: string
  externalAccountId: string | null
  credentialsConnectedAt: string | null
}

export interface ExchangeHistoryFetchOutput {
  entries: ExchangeHistoryEntry[]
  resolvedExternalAccountId?: string | null
}

export const EXCHANGE_HISTORY_MAX_AGE_MS = 10 * 60_000
export const EXCHANGE_HISTORY_RETRY_MS = 30_000

interface ExchangeHistoryInFlight {
  key: ExchangeHistoryKey
  generation: number
  promise: Promise<Result<ExchangeHistoryEntry[], Error>>
}

interface ExchangeHistorySlot {
  key: ExchangeHistoryKey | null
  entries: ExchangeHistoryEntry[] | null
  fetchedAt: number
  inFlight: ExchangeHistoryInFlight | null
  generation: number
  lastError: Error | null
  retryAt: number
}

function keysEqual(left: ExchangeHistoryKey | null, right: ExchangeHistoryKey): boolean {
  return (
    left !== null &&
    left.encryptedCredentials === right.encryptedCredentials &&
    left.externalAccountId === right.externalAccountId &&
    left.credentialsConnectedAt === right.credentialsConnectedAt
  )
}

function cloneResult(result: Result<ExchangeHistoryEntry[], Error>): Result<ExchangeHistoryEntry[], Error> {
  return result.isOk() ? Ok([...result.unwrap()]) : result
}

export class ExchangeHistoryCache {
  private readonly now: () => number
  private readonly slots = new Map<string, ExchangeHistorySlot>()

  public constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  public async get(
    accountId: string,
    key: ExchangeHistoryKey,
    fetch: () => Promise<Result<ExchangeHistoryFetchOutput, Error>>,
  ): Promise<Result<ExchangeHistoryEntry[], Error>> {
    const slot = this.getOrCreateSlot(accountId)
    const currentNow = this.now()

    if (
      slot.entries !== null &&
      keysEqual(slot.key, key) &&
      currentNow - slot.fetchedAt <= EXCHANGE_HISTORY_MAX_AGE_MS
    ) {
      return Ok([...slot.entries])
    }

    if (keysEqual(slot.key, key) && slot.lastError !== null && currentNow < slot.retryAt) {
      if (slot.entries !== null) {
        return Ok([...slot.entries])
      }
      return Err(slot.lastError)
    }

    if (slot.inFlight !== null && slot.inFlight.generation === slot.generation && keysEqual(slot.inFlight.key, key)) {
      return cloneResult(await slot.inFlight.promise)
    }

    if (slot.inFlight !== null) {
      slot.generation += 1
    }

    const gen = slot.generation
    const run = (async (): Promise<Result<ExchangeHistoryEntry[], Error>> => {
      let result: Result<ExchangeHistoryFetchOutput, Error>
      try {
        result = await fetch()
      } catch (thrown) {
        result = Err(thrown instanceof Error ? thrown : new Error('Exchange history fetch failed'))
      }

      if (result.isOk()) {
        const { entries, resolvedExternalAccountId } = result.unwrap()
        const stored = [...entries]
        if (slot.generation === gen) {
          slot.entries = stored
          slot.fetchedAt = this.now()
          slot.key = {
            ...key,
            externalAccountId: resolvedExternalAccountId ?? key.externalAccountId,
          }
          slot.lastError = null
          slot.retryAt = 0
        }
        return Ok([...stored])
      }

      const err = result.unwrapErr()
      if (slot.generation === gen) {
        const retryAt = this.now() + EXCHANGE_HISTORY_RETRY_MS
        if (slot.entries !== null && keysEqual(slot.key, key)) {
          slot.lastError = err
          slot.retryAt = retryAt
          return Ok([...slot.entries])
        }
        slot.key = { ...key }
        slot.entries = null
        slot.lastError = err
        slot.retryAt = retryAt
      }
      return Err(err)
    })()

    const tracked = run.finally(() => {
      if (slot.inFlight?.promise === tracked) {
        slot.inFlight = null
      }
    })
    slot.inFlight = { key: { ...key }, generation: gen, promise: tracked }

    return cloneResult(await tracked)
  }

  public invalidate(accountId: string): void {
    const slot = this.slots.get(accountId)
    if (slot === undefined) {
      return
    }
    slot.generation += 1
    slot.key = null
    slot.entries = null
    slot.fetchedAt = 0
    slot.inFlight = null
    slot.lastError = null
    slot.retryAt = 0
    this.slots.delete(accountId)
  }

  private getOrCreateSlot(accountId: string): ExchangeHistorySlot {
    let slot = this.slots.get(accountId)
    if (slot === undefined) {
      slot = {
        key: null,
        entries: null,
        fetchedAt: 0,
        inFlight: null,
        generation: 0,
        lastError: null,
        retryAt: 0,
      }
      this.slots.set(accountId, slot)
    }
    return slot
  }
}
