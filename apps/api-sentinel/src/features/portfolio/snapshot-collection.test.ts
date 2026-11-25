import type { Account } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { IndexMap } from '@hoseki/packages/collection'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { eq, sql } from 'drizzle-orm'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import {
  accounts,
  balanceSnapshots,
  etfAccounts,
  etfBalanceSnapshots,
  exchangeAccounts,
  exchangeBalanceSnapshots,
  manualAccounts,
  manualBalanceSnapshots,
} from '../../db/schema'
import { setupServiceDatabase } from '../../fixtures/service-database'
import { Encrypted, generateEncryptionKey, initEncryption } from '../../lib/encrypted'
import { WalletBalanceService } from '../../modules/wallet_balances/service'
import { EtfService } from '../etf'
import { ExchangeService } from '../exchanges'
import { ManualService } from '../manual'
import { PriceService } from '../price'
import { ControlCenterService } from './service'

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

const sources = ['on-chain', 'exchange', 'manual', 'ETF'] as const
const snapshotTables = {
  'on-chain': balanceSnapshots,
  exchange: exchangeBalanceSnapshots,
  manual: manualBalanceSnapshots,
  ETF: etfBalanceSnapshots,
}
const wallets = [
  Wallets.singlesigLegacyAccount,
  Wallets.singlesigNestedSegwitAccount,
  Wallets.singlesigNativeSegwitAccount,
]

async function setupCollection(options?: { refreshTimeLimitMs?: number }) {
  const { db, logger } = await setupServiceDatabase()
  for (const [index, wallet] of wallets.entries()) {
    const number = index + 1
    const createdAt = `2024-02-0${3 - index}T12:00:00.000Z`
    await db
      .insert(accounts)
      .values({ id: `on-chain-${number}`, descriptor: wallet.toString(), displayName: 'Wallet', createdAt })
    await db.insert(exchangeAccounts).values({
      id: `exchange-${number}`,
      provider: 'coinbase',
      displayName: 'Exchange',
      encryptedCredentials: 'synthetic-unused-credentials',
      createdAt,
    })
    await db
      .insert(manualAccounts)
      .values({ id: `manual-${number}`, displayName: 'Manual', balanceSats: '300', createdAt })
    await db.insert(etfAccounts).values({ id: `ETF-${number}`, displayName: 'ETF', createdAt })
  }
  const onchainProvider = new ElectrumProvider(Network.Mainnet, {
    logger,
    electrum: new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' }),
  })
  const balances = vi
    .spyOn(onchainProvider, 'getConfirmedAccountBalances')
    .mockImplementation(asyncFn(async () => Ok(new IndexMap<Account, bigint>(wallets.map((wallet) => [wallet, 100n])))))
  const exchangeService = new ExchangeService({ db, logger, refreshTimeLimitMs: options?.refreshTimeLimitMs })
  const refresh = vi.spyOn(exchangeService, 'refreshBalance').mockImplementation(
    asyncFn(async (id) =>
      Ok({
        id,
        exchange: 'coinbase' as const,
        displayName: 'Exchange',
        balanceSats: '200',
        balanceAsOf: new Date().toISOString(),
        createdAt: new Date().toISOString(),
        connectionStatus: 'connected' as const,
      }),
    ),
  )
  const manualService = new ManualService({ db, logger })
  const etfService = new EtfService({ db, logger })
  const service = new ControlCenterService({
    db,
    logger,
    onchainProvider,
    exchangeService,
    manualService,
    etfService,
    priceService: new PriceService({
      logger,
      mempoolApiUrl: 'https://example.invalid',
      settings: () => ({ source: undefined, fallbacks: false }),
    }),
    walletBalances: new WalletBalanceService({ db, logger, onchainProvider }),
  })
  const warn = vi.spyOn(service['logger'], 'warn')
  const info = vi.spyOn(service['logger'], 'info')
  const rows = async (source: (typeof sources)[number]) => {
    const table = snapshotTables[source]
    return db
      .select({ accountId: table.accountId, balanceSats: table.balanceSats, timestamp: table.timestamp })
      .from(table)
      .orderBy(table.accountId)
  }
  return { db, service, balances, refresh, exchangeService, manualService, etfService, warn, info, rows }
}

it.each(sources)(
  'keeps earlier snapshots and processes later accounts/sources after a %s write fails',
  async (source) => {
    const { db, service, rows, warn, info } = await setupCollection()
    await db.run(sql`CREATE TEMP TRIGGER fail_snapshot BEFORE INSERT ON ${snapshotTables[source]}
    WHEN NEW.account_id LIKE '%-2'
    BEGIN SELECT RAISE(ABORT, 'Synthetic snapshot failure'); END`)

    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    for (const kind of sources) {
      expect((await rows(kind)).map((row) => row.accountId)).toEqual(
        kind === source ? [`${kind}-1`, `${kind}-3`] : [`${kind}-1`, `${kind}-2`, `${kind}-3`],
      )
      const label = kind === 'manual' || kind === 'ETF' ? `${kind} account` : kind
      expect(info).toHaveBeenCalledWith({ count: kind === source ? 2 : 3 }, `Recorded ${label} balance snapshots`)
    }
    expect(warn).toHaveBeenCalledWith({ source, accountId: `${source}-2` }, 'Failed to collect balance snapshot')
    await db.run(sql`DROP TRIGGER fail_snapshot`)
    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    await expect(rows(source)).resolves.toHaveLength(3)
  },
)

it.each(sources)('continues other sources when %s account discovery fails', async (source) => {
  const { service, exchangeService, manualService, etfService, rows, warn } = await setupCollection()
  const failure = new Error('Synthetic discovery failure')
  if (source === 'on-chain') {
    vi.spyOn(service['walletBalances'], 'refreshAll').mockRejectedValueOnce(failure)
  } else if (source === 'exchange') {
    vi.spyOn(exchangeService, 'listAccounts').mockRejectedValueOnce(failure)
  } else if (source === 'manual') {
    vi.spyOn(manualService, 'listAccounts').mockRejectedValueOnce(failure)
  } else {
    vi.spyOn(etfService, 'listAccounts').mockRejectedValueOnce(failure)
  }

  expect((await service.recordAllSnapshots()).isOk()).toBe(true)
  for (const kind of sources) {
    await expect(rows(kind)).resolves.toHaveLength(kind === source ? 0 : 3)
  }
  expect(warn).toHaveBeenCalledWith({ source }, 'Failed to collect balance snapshots for source')
})

it.each(['returned', 'thrown'] as const)(
  'continues other sources after a %s on-chain provider error',
  async (failure) => {
    const { service, balances, rows } = await setupCollection()
    if (failure === 'returned') {
      balances.mockImplementation(asyncFn(async () => Err(new Error('Synthetic provider failure'))))
    } else {
      balances.mockImplementation(
        asyncFn(async () => {
          throw new Error('Synthetic provider failure')
        }),
      )
    }

    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    await expect(rows('on-chain')).resolves.toEqual([])
    for (const source of sources.slice(1)) {
      await expect(rows(source)).resolves.toHaveLength(3)
    }
  },
)

it.each(['returned', 'thrown'] as const)(
  'records the other wallets when one wallet’s balance scan fails (%s)',
  async (failure) => {
    const { service, balances, rows, warn } = await setupCollection()
    const original = balances.getMockImplementation()
    assert(original)
    balances.mockImplementation(
      asyncFn(async (requested) => {
        if ([...requested].some((account) => account.toString() === wallets[1]?.toString())) {
          if (failure === 'thrown') {
            throw new Error('synthetic-sensitive-provider-response')
          }
          return Err(new Error('synthetic-sensitive-provider-response'))
        }
        return original(requested)
      }),
    )

    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    expect((await rows('on-chain')).map((row) => row.accountId)).toEqual(['on-chain-1', 'on-chain-3'])
    expect(warn).toHaveBeenCalledWith(
      { source: 'on-chain', accountId: 'on-chain-2' },
      'Failed to collect balance snapshot',
    )
    expect(JSON.stringify(warn.mock.calls)).not.toContain('synthetic-sensitive-provider-response')
  },
)

it('collects every source with the same timestamp and preserves legitimate zero balances', async () => {
  const { service, rows, warn } = await setupCollection()

  expect((await service.recordAllSnapshots()).isOk()).toBe(true)
  const expectedBalances = { 'on-chain': '100', exchange: '200', manual: '300', ETF: '0' }
  for (const source of sources) {
    await expect(rows(source)).resolves.toEqual(
      [1, 2, 3].map((number) => ({
        accountId: `${source}-${number}`,
        balanceSats: expectedBalances[source],
        timestamp: new Date().toISOString(),
      })),
    )
  }
  expect(warn).not.toHaveBeenCalled()
})

it.each(['archive', 'delete'] as const)('skips an account that is %sd while fetching balances', async (action) => {
  const { db, service, balances, rows, info } = await setupCollection()
  const original = balances.getMockImplementation()
  assert(original)
  balances.mockImplementationOnce(
    asyncFn(async (...args) => {
      if (action === 'archive') {
        await db.update(accounts).set({ deletedAt: new Date().toISOString() }).where(eq(accounts.id, 'on-chain-2'))
      } else {
        await db.delete(accounts).where(eq(accounts.id, 'on-chain-2'))
      }
      return original(...args)
    }),
  )

  expect((await service.recordAllSnapshots()).isOk()).toBe(true)
  expect((await rows('on-chain')).map((row) => row.accountId)).toEqual(['on-chain-1', 'on-chain-3'])
  expect(info).toHaveBeenCalledWith({ count: 2 }, 'Recorded on-chain balance snapshots')
  for (const source of sources.slice(1)) {
    await expect(rows(source)).resolves.toHaveLength(3)
  }
})

it('logs failure context without leaking raw provider exception details', async () => {
  const { service, refresh, warn } = await setupCollection()
  refresh.mockImplementationOnce(
    asyncFn(async () => {
      throw new Error('synthetic-sensitive-provider-response')
    }),
  )

  expect((await service.recordAllSnapshots()).isOk()).toBe(true)
  expect(warn.mock.calls).toEqual([
    [{ source: 'exchange', accountId: 'exchange-1' }, 'Failed to collect balance snapshot'],
  ])
})

it.each(['returned', 'thrown'] as const)(
  'continues after a %s exchange refresh error without saving a false zero',
  async (failure) => {
    const { service, refresh, rows } = await setupCollection()
    const original = refresh.getMockImplementation()
    assert(original)
    refresh.mockImplementation(
      asyncFn(async (id) => {
        if (id === 'exchange-2') {
          if (failure === 'thrown') {
            throw new Error('Synthetic refresh failure')
          }
          return Err(new Error('Synthetic refresh failure'))
        }
        return original(id)
      }),
    )

    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(['exchange-1', 'exchange-2', 'exchange-3'])
    await expect(rows('exchange')).resolves.toEqual([
      { accountId: 'exchange-1', balanceSats: '200', timestamp: new Date().toISOString() },
      { accountId: 'exchange-3', balanceSats: '200', timestamp: new Date().toISOString() },
    ])
    await expect(rows('manual')).resolves.toHaveLength(3)
    await expect(rows('ETF')).resolves.toHaveLength(3)
  },
)

it(
  'times out a hung exchange account and still records remaining exchange, manual, ETF, and on-chain snapshots without fabricating zero',
  { timeout: 5_000 },
  async () => {
    const { service, refresh, rows } = await setupCollection({ refreshTimeLimitMs: 40 })
    const original = refresh.getMockImplementation()
    assert(original)
    const hung = createDeferred<Awaited<ReturnType<typeof original>>>()
    onTestFinished(() => {
      hung.resolve(
        Ok({
          id: 'exchange-1',
          exchange: 'coinbase',
          displayName: 'Exchange',
          balanceSats: '200',
          balanceAsOf: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          connectionStatus: 'connected',
        }),
      )
    })
    refresh.mockImplementation(
      asyncFn(async (id) => {
        if (id === 'exchange-1') {
          return hung.promise
        }
        return original(id)
      }),
    )

    expect((await service.recordAllSnapshots()).isOk()).toBe(true)
    expect(refresh.mock.calls.map(([id]) => id)).toEqual(['exchange-1', 'exchange-2', 'exchange-3'])
    await expect(rows('exchange')).resolves.toEqual([
      { accountId: 'exchange-2', balanceSats: '200', timestamp: new Date().toISOString() },
      { accountId: 'exchange-3', balanceSats: '200', timestamp: new Date().toISOString() },
    ])
    await expect(rows('manual')).resolves.toHaveLength(3)
    await expect(rows('ETF')).resolves.toHaveLength(3)
    await expect(rows('on-chain')).resolves.toHaveLength(3)
  },
)

it('records manual and ETF snapshots before exchange-1 even unblocks at the provider', { timeout: 5_000 }, async () => {
  const { service, refresh, rows } = await setupCollection({ refreshTimeLimitMs: 5_000 })
  const original = refresh.getMockImplementation()
  assert(original)
  const enteredExchange1 = createDeferred<undefined>()
  const releaseExchange1 = createDeferred<undefined>()
  onTestFinished(() => {
    releaseExchange1.resolve(undefined)
  })
  refresh.mockImplementation(
    asyncFn(async (id) => {
      if (id === 'exchange-1') {
        enteredExchange1.resolve(undefined)
        await releaseExchange1.promise
      }
      return original(id)
    }),
  )

  const passPromise = service.recordAllSnapshots()
  await enteredExchange1.promise

  await expect(rows('manual')).resolves.toHaveLength(3)
  await expect(rows('ETF')).resolves.toHaveLength(3)

  releaseExchange1.resolve(undefined)
  expect((await passPromise).isOk()).toBe(true)
  await expect(rows('exchange')).resolves.toHaveLength(3)
})

it('coalesces overlapping recordAllSnapshots calls into a single pass and runs again after completion', async () => {
  const { service, balances, refresh } = await setupCollection({ refreshTimeLimitMs: 5_000 })
  const original = refresh.getMockImplementation()
  assert(original)
  const gate = createDeferred<undefined>()
  onTestFinished(() => {
    gate.resolve(undefined)
  })
  refresh.mockImplementation(
    asyncFn(async (id) => {
      if (id === 'exchange-1') {
        await gate.promise
      }
      return original(id)
    }),
  )

  const first = service.recordAllSnapshots()
  const second = service.recordAllSnapshots()
  gate.resolve(undefined)
  const [res1, res2] = await Promise.all([first, second])

  expect(res1.isOk()).toBe(true)
  expect(res2.isOk()).toBe(true)
  expect(balances).toHaveBeenCalledTimes(3)
  expect(refresh).toHaveBeenCalledTimes(3)

  const third = await service.recordAllSnapshots()
  expect(third.isOk()).toBe(true)
  expect(balances).toHaveBeenCalledTimes(6)
  expect(refresh).toHaveBeenCalledTimes(6)
})

it.each(['resolve', 'reject'] as const)(
  'shares per-account dedupe across refreshAllBalances and recordAllSnapshots and produces no stray row or unhandled rejection on late %s',
  { timeout: 5_000 },
  async (settlement) => {
    const { db, service, exchangeService, refresh, rows } = await setupCollection({ refreshTimeLimitMs: 40 })
    initEncryption(generateEncryptionKey())
    const apiKeyBlob = Encrypted.encrypt('synthetic-api-key').unwrap().blob
    const secretBlob = Encrypted.encrypt('synthetic-secret-key').unwrap().blob
    const credentials = JSON.stringify({
      type: 'apiKey',
      data: { apiKey: { blob: apiKeyBlob }, secretKey: { blob: secretBlob } },
    })
    for (const number of [1, 2, 3]) {
      await db
        .update(exchangeAccounts)
        .set({ encryptedCredentials: credentials, credentialsConnectedAt: '2024-02-05T12:00:00.000Z' })
        .where(eq(exchangeAccounts.id, `exchange-${number}`))
    }

    let unhandledCount = 0
    const onUnhandled = (): void => {
      unhandledCount += 1
    }
    process.on('unhandledRejection', onUnhandled)
    onTestFinished(() => {
      process.off('unhandledRejection', onUnhandled)
    })

    const original = refresh.getMockImplementation()
    assert(original)
    const hung = createDeferred<Awaited<ReturnType<typeof original>>>()
    onTestFinished(() => {
      hung.resolve(
        Ok({
          id: 'exchange-1',
          exchange: 'coinbase',
          displayName: 'Exchange',
          balanceSats: '999999',
          balanceAsOf: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          connectionStatus: 'connected',
        }),
      )
    })
    refresh.mockImplementation(
      asyncFn(async (id) => {
        if (id === 'exchange-1') {
          return hung.promise
        }
        return original(id)
      }),
    )

    expect((await exchangeService.refreshAllBalances()).isOk()).toBe(true)
    expect((await service.recordAllSnapshots()).isOk()).toBe(true)

    expect(refresh.mock.calls.filter(([id]) => id === 'exchange-1')).toHaveLength(1)
    await expect(rows('exchange')).resolves.toEqual([
      { accountId: 'exchange-2', balanceSats: '200', timestamp: new Date().toISOString() },
      { accountId: 'exchange-3', balanceSats: '200', timestamp: new Date().toISOString() },
    ])

    if (settlement === 'resolve') {
      hung.resolve(
        Ok({
          id: 'exchange-1',
          exchange: 'coinbase',
          displayName: 'Exchange',
          balanceSats: '999999',
          balanceAsOf: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          connectionStatus: 'connected',
        }),
      )
    } else {
      hung.reject(new Error('late-rejection-secret-canary'))
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })

    expect(unhandledCount).toBe(0)
    await expect(rows('exchange')).resolves.toEqual([
      { accountId: 'exchange-2', balanceSats: '200', timestamp: new Date().toISOString() },
      { accountId: 'exchange-3', balanceSats: '200', timestamp: new Date().toISOString() },
    ])
  },
)
