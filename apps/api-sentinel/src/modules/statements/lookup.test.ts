import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Network } from '@hoseki/packages/bitcoin/network'
import { Err, Ok, type Result } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { expect, it, onTestFinished, vi } from 'vitest'
import { type SentinelDb, openDrizzleDatabase } from '../../db/drizzle'
import { statementTxCache } from '../../db/schema'
import { toTransactionEntries } from './entries'
import { lookupTransactions } from './lookup'
import { mempoolSourceKind } from './sources/mempool'
import { type LookedUpTx, type LookupFailure, TransactionLoadError, type TxSource } from './sources/types'
import { TransactionCache } from './tx_cache'

const logger = pino({ level: 'silent' })
const height = 800_000

function txids(count: number): string[] {
  return Array.from({ length: count }, (_, index) => (index + 1).toString(16).padStart(64, '0'))
}

function confirmedTx(txid: string, blockHeight = height): LookedUpTx {
  return { txid, blockHeight, blockTime: 1_704_153_600, inputs: [], outputs: [{ address: null, value: 1 }] }
}

function source(
  lookup: (txid: string) => Promise<Result<LookedUpTx, LookupFailure>>,
  concurrency = 10,
): TxSource & { lookup: ReturnType<typeof vi.fn<(txid: string) => Promise<Result<LookedUpTx, LookupFailure>>>> } {
  return { kind: 'public_mempool', concurrency, lookup: vi.fn(lookup) }
}

function atHeight(ids: string[], blockHeight = height): Map<string, number> {
  return new Map(ids.map((id) => [id, blockHeight]))
}

async function testDatabase(): Promise<SentinelDb> {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-tx-cache-'))
  const db = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return db
}

async function testCache(): Promise<TransactionCache> {
  return new TransactionCache(await testDatabase())
}

it('never has more lookups in flight than the source allows', async () => {
  let inFlight = 0
  let most = 0
  const slow = source(async (txid) => {
    inFlight += 1
    most = Math.max(most, inFlight)
    await new Promise((resolve) => {
      setTimeout(resolve, 1)
    })
    inFlight -= 1
    return Ok(confirmedTx(txid))
  }, 3)

  const result = await lookupTransactions({
    transactions: atHeight(txids(20)),
    source: slow,
    tipHeight: height,
    logger,
  })

  expect(result.unwrap().size).toBe(20)
  expect(most).toBe(3)
})

it('stops starting lookups once one fails for good', async () => {
  const ids = txids(30)
  const failing = source(async (txid) =>
    txid === ids[0]
      ? Err({ error: new TransactionLoadError('unavailable', 'Not found'), retry: null })
      : Ok(confirmedTx(txid)),
  )

  const result = await lookupTransactions({ transactions: atHeight(ids), source: failing, tipHeight: height, logger })

  expect(result.expectErr('a missing transaction must stop the lookups').kind).toBe('unavailable')
  // Only the first round of 10 started; the other 20 never did.
  expect(failing.lookup).toHaveBeenCalledTimes(10)
})

it('pauses every lookup when the server rate-limits one', async () => {
  const [limited, slow, later] = txids(3)
  let limitedOnce = false
  const rateLimited = source(async (txid) => {
    if (txid === limited && !limitedOnce) {
      limitedOnce = true
      return Err({
        error: new TransactionLoadError('unreachable', 'HTTP 429'),
        retry: { rateLimited: true, retryAfterMs: 5_000 },
      })
    }
    if (txid === slow) {
      // Finishes after the rate limit, so its worker's next lookup has to wait.
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
    }
    return Ok(confirmedTx(txid))
  }, 2)
  const sleep = vi.fn(async (_ms: number) => {})

  const result = await lookupTransactions({
    transactions: atHeight([limited ?? '', slow ?? '', later ?? '']),
    source: rateLimited,
    tipHeight: height,
    logger,
    sleep,
  })

  expect(result.unwrap().size).toBe(3)
  expect(sleep.mock.calls[0]).toEqual([5_000])
  // The other worker waited out the same pause before its next lookup.
  expect(sleep.mock.calls[1]?.[0]).toBeGreaterThan(4_900)
})

it('uses saved lookups instead of asking the source again', async () => {
  const cache = await testCache()
  const ids = txids(2)
  const first = source(async (txid) => Ok(confirmedTx(txid)))
  await lookupTransactions({ transactions: atHeight(ids), source: first, tipHeight: height + 10, cache, logger })

  const second = source(async (txid) => Ok(confirmedTx(txid)))
  const onProgress = vi.fn<(done: number, total: number) => void>()
  const result = await lookupTransactions({
    transactions: atHeight(ids),
    source: second,
    tipHeight: height + 10,
    cache,
    logger,
    onProgress,
  })

  expect([...result.unwrap().values()]).toEqual(ids.map((id) => confirmedTx(id)))
  expect(second.lookup).not.toHaveBeenCalled()
  // Saved transactions count as done straight away.
  expect(onProgress.mock.calls).toEqual([[2, 2]])
})

it.each([
  { confirmations: 5, saved: false },
  { confirmations: 6, saved: true },
])('saves a transaction with $confirmations confirmations: $saved', async ({ confirmations, saved }) => {
  const cache = await testCache()
  const [txid = ''] = txids(1)
  const lookups = source(async (id) => Ok(confirmedTx(id)))

  await lookupTransactions({
    transactions: atHeight([txid]),
    source: lookups,
    tipHeight: height + confirmations - 1,
    cache,
    logger,
  })

  expect((await cache.find([txid])).has(txid)).toBe(saved)
})

it('looks up a saved transaction again when its block changed', async () => {
  const cache = await testCache()
  const [txid = ''] = txids(1)
  await cache.save({ ...confirmedTx(txid), blockHeight: height, blockTime: 1 }, 'public_mempool')
  const lookups = source(async (id) => Ok(confirmedTx(id, height + 1)))

  const result = await lookupTransactions({
    transactions: atHeight([txid], height + 1),
    source: lookups,
    tipHeight: height + 10,
    cache,
    logger,
  })

  expect(result.unwrap().get(txid)?.blockHeight).toBe(height + 1)
  expect(lookups.lookup).toHaveBeenCalledOnce()
  expect((await cache.find([txid])).get(txid)?.blockHeight).toBe(height + 1)
})

it('looks up a saved transaction again when its row no longer reads', async () => {
  const db = await testDatabase()
  const cache = new TransactionCache(db)
  const [txid = ''] = txids(1)
  await cache.save({ ...confirmedTx(txid), blockHeight: height, blockTime: 1 }, 'public_mempool')
  await db.update(statementTxCache).set({ outputs: '{not json' }).where(eq(statementTxCache.txid, txid))
  const lookups = source(async (id) => Ok(confirmedTx(id)))

  const result = await lookupTransactions({
    transactions: atHeight([txid]),
    source: lookups,
    tipHeight: height + 10,
    cache,
    logger,
  })

  expect(result.isOk()).toBe(true)
  expect(lookups.lookup).toHaveBeenCalledOnce()
})

it('finishes the statement when a lookup cannot be saved', async () => {
  const cache = await testCache()
  vi.spyOn(cache, 'save').mockRejectedValue(new Error('Disk full'))
  const lookups = source(async (id) => Ok(confirmedTx(id)))

  const result = await lookupTransactions({
    transactions: atHeight(txids(2)),
    source: lookups,
    tipHeight: height + 10,
    cache,
    logger,
  })

  expect(result.unwrap().size).toBe(2)
})

it('reads a spent amount from the wallet transaction that created it', () => {
  const address = Wallets.singlesigNativeSegwitAccount.receiveAddresses(0, 1, Network.Mainnet)[0]
  if (address === undefined) {
    expect.fail('Fixture wallet must have an address')
  }
  const [receive = '', spend = ''] = txids(2)
  const found = new Map<string, LookedUpTx>([
    [receive, { ...confirmedTx(receive), outputs: [{ address: address.toString(), value: 100_000 }] }],
    // A source without previous outputs, such as Electrum, only says which output an input spends.
    [spend, { ...confirmedTx(spend), inputs: [{ spends: { txid: receive, vout: 0 }, prevout: null }], outputs: [] }],
  ])
  const history = new Map([
    [receive, { height, addresses: [address] }],
    [spend, { height, addresses: [address] }],
  ])

  const entries = toTransactionEntries(history, found, height + 10).unwrap()

  expect(entries.map((entry) => entry.value)).toEqual([100_000n, -100_000n])
})

it.each([
  { url: 'https://mempool.space', kind: 'public_mempool' },
  { url: 'https://mempool.space/', kind: 'public_mempool' },
  { url: 'http://mempool.embassy:8080', kind: 'node_mempool' },
  { url: 'http://umbrel.local:3006', kind: 'node_mempool' },
])('treats $url as $kind', ({ url, kind }) => {
  expect(mempoolSourceKind(url)).toBe(kind)
})
