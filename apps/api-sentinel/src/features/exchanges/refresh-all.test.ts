import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { Ok, asyncFn } from '@hoseki/packages/result'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { exchangeAccounts, exchangeBalanceSnapshots } from '../../db/schema'
import { Encrypted, generateEncryptionKey, initEncryption } from '../../lib/encrypted'
import { walletDetailLogOptions } from '../../log_redaction'
import {
  type ExchangeAccountDto,
  ExchangeRefreshTimeoutError,
  ExchangeService,
  ExchangeUserError,
  type SupportedExchange,
} from './service'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

type JsonValue = string | number | boolean | null | undefined | { [key: string]: JsonValue } | JsonValue[]

function jsonResponse(body: JsonValue, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function extractHeader(input: string | URL | Request, init: RequestInit | undefined, name: string): string {
  const fromInit = new Headers(init?.headers).get(name)
  if (fromInit !== null) {
    return fromInit
  }
  if (input instanceof Request) {
    return input.headers.get(name) ?? ''
  }
  return ''
}

function makeAccountDto(id: string, exchange: SupportedExchange, displayName: string): ExchangeAccountDto {
  const now = new Date().toISOString()
  return {
    id,
    exchange,
    displayName,
    balanceSats: '50000',
    balanceAsOf: now,
    createdAt: now,
    connectionStatus: 'connected',
  }
}

async function setup(options?: { captureLogs?: boolean; logLevel?: 'debug' | 'info'; refreshTimeLimitMs?: number }) {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-exchange-refresh-all-'))
  const logs: string[] = []
  const level = options?.logLevel ?? 'debug'
  const logger =
    options?.captureLogs === true
      ? pino(
          { level, ...walletDetailLogOptions(level) },
          new Writable({
            write(chunk, _encoding, callback) {
              logs.push(String(chunk))
              callback()
            },
          }),
        )
      : pino({ level: 'silent' })
  const db = await openDrizzleDatabase(directory, logger)
  initEncryption(generateEncryptionKey())
  const pendingCleanups: Array<() => void> = []
  onTestFinished(() => {
    for (const cleanup of pendingCleanups) {
      cleanup()
    }
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })

  const service = new ExchangeService({
    db,
    logger,
    refreshTimeLimitMs: options?.refreshTimeLimitMs ?? 50,
  })

  async function seedConnectedStrikeAccounts(
    items: Array<{ id: string; displayName: string; createdAt: string }>,
  ): Promise<void> {
    const encrypted = Encrypted.encrypt('synthetic-api-key').unwrap().blob
    const credentials = JSON.stringify({
      type: 'apiKey',
      data: { apiKey: { blob: encrypted } },
    })
    for (const item of items) {
      await db.insert(exchangeAccounts).values({
        id: item.id,
        provider: 'strike',
        displayName: item.displayName,
        encryptedCredentials: credentials,
        balanceSats: '10000',
        balanceAsOf: item.createdAt,
        credentialsConnectedAt: item.createdAt,
        createdAt: item.createdAt,
      })
    }
  }

  return { db, service, logs, pendingCleanups, seedConnectedStrikeAccounts }
}

describe('ExchangeService refreshAllBalances and refreshBalanceForBatch', () => {
  it(
    'does not let a hung first account block refreshing remaining accounts and logs safe timeout metadata',
    { timeout: 5_000 },
    async () => {
      const { service, logs, pendingCleanups, seedConnectedStrikeAccounts } = await setup({
        captureLogs: true,
        logLevel: 'info',
        refreshTimeLimitMs: 50,
      })
      const now = new Date()
      await seedConnectedStrikeAccounts([
        { id: 'ex-1', displayName: 'Strike One', createdAt: new Date(now.getTime() - 1000).toISOString() },
        { id: 'ex-2', displayName: 'Strike Two', createdAt: new Date(now.getTime() - 2000).toISOString() },
        { id: 'ex-3', displayName: 'Strike Three', createdAt: new Date(now.getTime() - 3000).toISOString() },
      ])

      const secretCanary = 'super-secret-token-canary-ex-1'
      const hung = createDeferred<ReturnType<typeof Ok<ExchangeAccountDto>>>()
      pendingCleanups.push(() => {
        hung.resolve(Ok(makeAccountDto('ex-1', 'strike', 'Strike One')))
      })
      const attempted: string[] = []
      vi.spyOn(service, 'refreshBalance').mockImplementation(
        asyncFn(async (accountId) => {
          attempted.push(accountId)
          if (accountId === 'ex-1') {
            return hung.promise
          }
          return Ok(makeAccountDto(accountId, 'strike', `Account ${accountId}`))
        }),
      )

      const result = await service.refreshAllBalances()
      expect(result.isOk()).toBe(true)
      expect(attempted).toEqual(['ex-1', 'ex-2', 'ex-3'])

      const combinedLogs = logs.join('\n')
      expect(combinedLogs).toContain('Exchange balance refresh timed out')
      expect(combinedLogs).toContain('ExchangeRefreshTimeoutError')
      expect(combinedLogs).not.toContain(secretCanary)
    },
  )

  it(
    'returns a sanitized ExchangeUserError and logs safe timeout metadata when all accounts time out',
    { timeout: 5_000 },
    async () => {
      const { service, logs, pendingCleanups, seedConnectedStrikeAccounts } = await setup({
        captureLogs: true,
        logLevel: 'info',
        refreshTimeLimitMs: 30,
      })
      const now = new Date()
      await seedConnectedStrikeAccounts([
        { id: 'ex-1', displayName: 'Primary Strike', createdAt: new Date(now.getTime() - 1000).toISOString() },
        { id: 'ex-2', displayName: 'Backup Strike', createdAt: new Date(now.getTime() - 2000).toISOString() },
      ])

      const hung1 = createDeferred<ReturnType<typeof Ok<ExchangeAccountDto>>>()
      const hung2 = createDeferred<ReturnType<typeof Ok<ExchangeAccountDto>>>()
      pendingCleanups.push(() => {
        hung1.resolve(Ok(makeAccountDto('ex-1', 'strike', 'Primary Strike')))
        hung2.resolve(Ok(makeAccountDto('ex-2', 'strike', 'Backup Strike')))
      })
      vi.spyOn(service, 'refreshBalance').mockImplementation(
        asyncFn(async (accountId) => (accountId === 'ex-1' ? hung1.promise : hung2.promise)),
      )

      const result = await service.refreshAllBalances()
      expect(result.isErr()).toBe(true)
      const err = result.unwrapErr()
      expect(err).toBeInstanceOf(ExchangeUserError)
      if (err instanceof ExchangeUserError) {
        expect(err.code).toBe('INTERNAL_SERVER_ERROR')
      }
      expect(err.message).toBe('Failed to refresh exchange balances. Please try again.')
      expect(err.message).not.toContain('Primary Strike')
      expect(err.message).not.toContain('Backup Strike')

      const combinedLogs = logs.join('\n')
      expect(combinedLogs).toContain('"accountId":"ex-1"')
      expect(combinedLogs).toContain('"accountId":"ex-2"')
      expect(combinedLogs).toContain('ExchangeRefreshTimeoutError')
    },
  )

  it('catches unexpected rejections on one account, logs safely without canary, and refreshes the rest', async () => {
    const { service, logs, seedConnectedStrikeAccounts } = await setup({
      captureLogs: true,
      logLevel: 'info',
      refreshTimeLimitMs: 500,
    })
    const now = new Date()
    await seedConnectedStrikeAccounts([
      { id: 'ex-1', displayName: 'Strike One', createdAt: new Date(now.getTime() - 1000).toISOString() },
      { id: 'ex-2', displayName: 'Strike Two', createdAt: new Date(now.getTime() - 2000).toISOString() },
      { id: 'ex-3', displayName: 'Strike Three', createdAt: new Date(now.getTime() - 3000).toISOString() },
    ])

    const secretCanary = 'leaked-exchange-secret-canary-42'
    const attempted: string[] = []
    vi.spyOn(service, 'refreshBalance').mockImplementation(
      asyncFn(async (accountId) => {
        attempted.push(accountId)
        if (accountId === 'ex-1') {
          throw new Error(`Unexpected crash with ${secretCanary}`)
        }
        return Ok(makeAccountDto(accountId, 'strike', `Account ${accountId}`))
      }),
    )

    const result = await service.refreshAllBalances()
    expect(result.isOk()).toBe(true)
    expect(attempted).toEqual(['ex-1', 'ex-2', 'ex-3'])

    const combinedLogs = logs.join('\n')
    expect(combinedLogs).toContain('Failed to refresh balance')
    expect(combinedLogs).not.toContain(secretCanary)
  })

  it('coalesces overlapping refreshAllBalances calls into a single flight and runs fresh after completion', async () => {
    const { service, pendingCleanups, seedConnectedStrikeAccounts } = await setup({
      refreshTimeLimitMs: 5_000,
    })
    const now = new Date()
    await seedConnectedStrikeAccounts([
      { id: 'ex-1', displayName: 'Strike One', createdAt: new Date(now.getTime() - 1000).toISOString() },
      { id: 'ex-2', displayName: 'Strike Two', createdAt: new Date(now.getTime() - 2000).toISOString() },
    ])

    const gate = createDeferred<undefined>()
    pendingCleanups.push(() => {
      gate.resolve(undefined)
    })
    const listSpy = vi.spyOn(service, 'listAccounts')
    const refreshSpy = vi.spyOn(service, 'refreshBalance').mockImplementation(
      asyncFn(async (accountId) => {
        if (accountId === 'ex-1') {
          await gate.promise
        }
        return Ok(makeAccountDto(accountId, 'strike', `Account ${accountId}`))
      }),
    )

    const first = service.refreshAllBalances()
    const second = service.refreshAllBalances()
    gate.resolve(undefined)
    const [res1, res2] = await Promise.all([first, second])

    expect(res1.isOk()).toBe(true)
    expect(res2.isOk()).toBe(true)
    expect(listSpy).toHaveBeenCalledTimes(1)
    expect(refreshSpy).toHaveBeenCalledTimes(2)

    const third = await service.refreshAllBalances()
    expect(third.isOk()).toBe(true)
    expect(listSpy).toHaveBeenCalledTimes(2)
    expect(refreshSpy).toHaveBeenCalledTimes(4)
  })

  it.each(['resolve', 'reject'] as const)(
    'dedupes persistent hung refreshes, returns timeout immediately on pass 2, and recovers after late %s with no unhandled rejections',
    { timeout: 5_000 },
    async (settlement) => {
      const { service, logs, pendingCleanups } = await setup({
        captureLogs: true,
        logLevel: 'debug',
        refreshTimeLimitMs: 40,
      })

      let unhandledCount = 0
      const onUnhandled = (): void => {
        unhandledCount += 1
      }
      process.on('unhandledRejection', onUnhandled)
      onTestFinished(() => {
        process.off('unhandledRejection', onUnhandled)
      })

      const secretCanary = 'late-rejection-secret-canary-99'
      const hung = createDeferred<ReturnType<typeof Ok<ExchangeAccountDto>>>()
      pendingCleanups.push(() => {
        hung.resolve(Ok(makeAccountDto('ex-1', 'strike', 'Strike One')))
      })
      let callCount = 0
      const refreshSpy = vi.spyOn(service, 'refreshBalance').mockImplementation(
        asyncFn(async (accountId) => {
          callCount += 1
          if (callCount === 1) {
            return hung.promise
          }
          return Ok(makeAccountDto(accountId, 'strike', 'Strike One'))
        }),
      )

      const pass1 = await service.refreshBalanceForBatch({ id: 'ex-1', exchange: 'strike' })
      expect(pass1.isErr()).toBe(true)
      expect(pass1.unwrapErr()).toBeInstanceOf(ExchangeRefreshTimeoutError)
      expect(refreshSpy).toHaveBeenCalledTimes(1)

      const startPass2 = Date.now()
      const pass2 = await service.refreshBalanceForBatch({ id: 'ex-1', exchange: 'strike' })
      const pass2ElapsedMs = Date.now() - startPass2
      expect(pass2.isErr()).toBe(true)
      expect(pass2.unwrapErr()).toBeInstanceOf(ExchangeRefreshTimeoutError)
      expect(refreshSpy).toHaveBeenCalledTimes(1)
      expect(pass2ElapsedMs).toBeLessThan(35)

      if (settlement === 'resolve') {
        hung.resolve(Ok(makeAccountDto('ex-1', 'strike', 'Strike One')))
      } else {
        hung.reject(new Error(`Late failure with ${secretCanary}`))
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 20)
      })

      expect(unhandledCount).toBe(0)
      expect(logs.join('\n')).not.toContain(secretCanary)

      const pass3 = await service.refreshBalanceForBatch({ id: 'ex-1', exchange: 'strike' })
      expect(pass3.isOk()).toBe(true)
      expect(refreshSpy).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['success', 'revoked'] as const)(
    'fences late %s provider settlement so timed-out refresh does not overwrite DB balance, status, or snapshots',
    { timeout: 5_000 },
    async (lateOutcome) => {
      const { db, service, pendingCleanups } = await setup({
        refreshTimeLimitMs: 40,
      })

      let requestNumber = 0
      const hungFetch = createDeferred<Response>()
      pendingCleanups.push(() => {
        hungFetch.resolve(jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }]))
      })

      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          requestNumber += 1
          if (requestNumber === 1) {
            return jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }])
          }
          return hungFetch.promise
        }),
      )

      const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()
      expect(connected.balanceSats).toBe('25000000')

      const beforeSnapshots = await db
        .select()
        .from(exchangeBalanceSnapshots)
        .where(eq(exchangeBalanceSnapshots.accountId, connected.id))
      expect(beforeSnapshots).toHaveLength(1)

      const timedOut = await service.refreshBalanceForBatch({ id: connected.id, exchange: 'strike' })
      expect(timedOut.isErr()).toBe(true)
      expect(timedOut.unwrapErr()).toBeInstanceOf(ExchangeRefreshTimeoutError)

      if (lateOutcome === 'success') {
        hungFetch.resolve(jsonResponse([{ currency: 'BTC', total: '9.99', available: '9.99' }]))
      } else {
        hungFetch.resolve(jsonResponse({ error: 'Unauthorized' }, 401))
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 30)
      })

      const [accountRow] = await db.select().from(exchangeAccounts).where(eq(exchangeAccounts.id, connected.id))
      expect(accountRow?.balanceSats).toBe('25000000')
      expect(accountRow?.encryptedCredentials).not.toContain('credentialsRevoked')

      const listed = (await service.listAccounts('strike')).find((account) => account.id === connected.id)
      expect(listed?.connectionStatus).toBe('connected')
      expect(listed?.balanceSats).toBe('25000000')

      const afterSnapshots = await db
        .select()
        .from(exchangeBalanceSnapshots)
        .where(eq(exchangeBalanceSnapshots.accountId, connected.id))
      expect(afterSnapshots).toHaveLength(1)
      expect(afterSnapshots[0]?.balanceSats).toBe('25000000')
    },
  )

  it('evicts a hung batch refresh entry immediately when the account is reconnected', { timeout: 5_000 }, async () => {
    const { service, pendingCleanups } = await setup({
      refreshTimeLimitMs: 40,
    })

    let key1Calls = 0
    const hungOldKeyFetch = createDeferred<Response>()
    pendingCleanups.push(() => {
      hungOldKeyFetch.resolve(jsonResponse([{ currency: 'BTC', total: '0.01', available: '0.01' }]))
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const auth = extractHeader(input, init, 'Authorization')
        if (auth === 'Bearer strike-key-1') {
          key1Calls += 1
          if (key1Calls === 1) {
            return jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }])
          }
          return hungOldKeyFetch.promise
        }
        return jsonResponse([{ currency: 'BTC', total: '0.75', available: '0.75' }])
      }),
    )

    const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()

    const timedOut = await service.refreshBalanceForBatch({ id: connected.id, exchange: 'strike' })
    expect(timedOut.isErr()).toBe(true)
    expect(timedOut.unwrapErr()).toBeInstanceOf(ExchangeRefreshTimeoutError)

    const reconnected = await service.connectStrike({
      apiKey: 'strike-key-2',
      displayName: 'Strike',
      replaceAccountId: connected.id,
    })
    expect(reconnected.isOk()).toBe(true)

    const refreshed = await service.refreshBalanceForBatch({ id: connected.id, exchange: 'strike' })
    expect(refreshed.isOk()).toBe(true)
    expect(refreshed.unwrap().balanceSats).toBe('75000000')
  })

  it('evicts a hung batch refresh entry immediately when the account is removed', { timeout: 5_000 }, async () => {
    const { service, pendingCleanups } = await setup({
      refreshTimeLimitMs: 40,
    })

    let calls = 0
    const hungFetch = createDeferred<Response>()
    pendingCleanups.push(() => {
      hungFetch.resolve(jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }]))
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls += 1
        if (calls === 1) {
          return jsonResponse([{ currency: 'BTC', total: '0.25', available: '0.25' }])
        }
        return hungFetch.promise
      }),
    )

    const connected = (await service.connectStrike({ apiKey: 'strike-key-1', displayName: 'Strike' })).unwrap()

    const timedOut = await service.refreshBalanceForBatch({ id: connected.id, exchange: 'strike' })
    expect(timedOut.isErr()).toBe(true)
    expect(timedOut.unwrapErr()).toBeInstanceOf(ExchangeRefreshTimeoutError)

    const removed = await service.removeAccount(connected.id)
    expect(removed.isOk()).toBe(true)

    const afterRemove = await service.refreshBalanceForBatch({ id: connected.id, exchange: 'strike' })
    expect(afterRemove.isErr()).toBe(true)
    const err = afterRemove.unwrapErr()
    expect(err).toBeInstanceOf(ExchangeUserError)
    expect(err).not.toBeInstanceOf(ExchangeRefreshTimeoutError)
    expect(err.message).toBe('Exchange account not found')
  })

  it('clears the refresh timeout timer when a batch refresh settles before the deadline', async () => {
    const { service } = await setup({
      refreshTimeLimitMs: 10_000,
    })
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    vi.spyOn(service, 'refreshBalance').mockImplementation(
      asyncFn(async (accountId) => Ok(makeAccountDto(accountId, 'strike', 'Strike'))),
    )

    const result = await service.refreshBalanceForBatch({ id: 'ex-1', exchange: 'strike' })
    expect(result.isOk()).toBe(true)
    expect(clearTimeoutSpy).toHaveBeenCalled()
  })
})
