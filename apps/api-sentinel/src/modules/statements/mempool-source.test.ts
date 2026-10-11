import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '@hoseki/packages/bitcoin/account'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import type { Logger } from 'pino'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { openDrizzleDatabase } from '../../db/drizzle'
import { accounts } from '../../db/schema'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { toTransactionEntries } from './entries'
import { collectAccountHistory } from './history'
import { type Sleep, lookupTransactions } from './lookup'
import { StatementService } from './service'
import { MempoolSource } from './sources/mempool'

const logger = pino({ level: 'silent' })
const account = Wallets.singlesigNativeSegwitAccount
const txid = '1'.repeat(64)
const timestamp = 1704153600
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/** One account's entries from mempool lookups, composed the way statement generation does it. */
async function accountEntries(deps: {
  account: Account
  onchainProvider: ElectrumProvider
  mempoolApiUrl: string
  logger: Logger
  sleep: Sleep
}): Promise<Result<TransactionEntry[], Error>> {
  const history = await collectAccountHistory(deps.account, deps.onchainProvider)
  if (history.isErr()) {
    return Err(history.unwrapErr())
  }
  const tip = (await deps.onchainProvider.getBlocksTip()).unwrap()
  const heights = new Map([...history.unwrap()].map(([id, { height }]) => [id, height]))
  const found = await lookupTransactions({
    transactions: heights,
    source: new MempoolSource(deps.mempoolApiUrl),
    logger: deps.logger,
    sleep: deps.sleep,
  })
  if (found.isErr()) {
    return Err(found.unwrapErr())
  }
  return toTransactionEntries(history.unwrap(), found.unwrap(), tip.height)
}

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  await run()
}

function setup(body: JsonValue, transactionIds = [txid], pendingIds: { id: string; height: 0 | -1 }[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body)),
  )
  const electrum = new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockResolvedValue(
    Ok([
      ...transactionIds.map((id) => ({ tx_hash: id, height: 800000 })),
      ...pendingIds.map(({ id, height }) => ({ tx_hash: id, height })),
    ]),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: -1 })),
  )
  vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(
    asyncFn(async () => Ok({ height: 900000, hash: 'tip', timestamp: new Date() })),
  )
  // Retries happen without real waits; tests can inspect the requested delays.
  const sleep = vi.fn(async (_ms: number) => {})
  return { account, onchainProvider, logger, mempoolApiUrl: 'https://example.invalid', sleep }
}

it('accepts coinbase inputs and addressless outputs without changing balance calculation', async () => {
  await withTestSetup(async () => {
    const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
    assert(address)
    const result = await accountEntries(
      setup({
        txid,
        vin: [{ prevout: null }, { prevout: { scriptpubkey_address: address.toString(), value: 25 } }],
        vout: [
          { scriptpubkey_address: address.toString(), value: 100 },
          { value: 0, scriptpubkey_type: 'op_return' },
        ],
        status: { confirmed: true, block_height: 800000, block_time: timestamp },
        extra: true,
      }),
    )
    expect(result.unwrap()).toEqual([
      expect.objectContaining({
        value: 75n,
        blockHeight: 800000,
        confirmed: true,
        timestamp: new Date(timestamp * 1000),
      }),
    ])
  })
})

it.each([
  null,
  {},
  { txid, vin: 'invalid', vout: [], status: { confirmed: true } },
  { txid, vin: [], vout: [{ value: '100' }], status: { confirmed: true } },
  { txid, vin: [], status: { confirmed: true, block_height: 800000, block_time: timestamp } },
])('rejects malformed transaction responses: %j', async (body) => {
  await withTestSetup(async () => {
    const result = await accountEntries(setup(body))
    expect(result.expectErr('malformed transaction data must fail').message).toBe(
      `Invalid transaction data returned from the mempool server for ${txid}`,
    )
  })
})

it('rejects a response for a different transaction', async () => {
  await withTestSetup(async () => {
    const result = await accountEntries(setup({ ...confirmedTx, txid: '9'.repeat(64) }))
    expect(result.expectErr('another transaction must not stand in for this one').message).toBe(
      `Invalid transaction data returned from the mempool server for ${txid}`,
    )
  })
})

it('rejects partial history when a later lookup returns a malformed transaction', async () => {
  await withTestSetup(async () => {
    const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
    assert(address)
    const transactionIds = Array.from({ length: 11 }, (_, index) => (index + 1).toString(16).padStart(64, '0'))
    const invalidId = transactionIds.at(-1)
    assert(invalidId != null && invalidId !== '')
    const deps = setup(null, transactionIds)
    for (const id of transactionIds) {
      vi.mocked(fetch).mockResolvedValueOnce(
        Response.json({
          txid: id,
          vin: [{ prevout: null }],
          vout: id === invalidId ? undefined : [{ scriptpubkey_address: address.toString(), value: 100 }],
          status: { confirmed: true, block_height: 800000, block_time: timestamp },
        }),
      )
    }

    const result = await accountEntries(deps)
    expect(fetch).toHaveBeenCalledTimes(11)
    expect(result.expectErr('partial history must fail').message).toBe(
      `Invalid transaction data returned from the mempool server for ${invalidId}`,
    )
  })
})

it.each(['HTTP 404', 'HTTP 503', 'network rejection'] as const)(
  'rejects partial history when a later lookup fails with %s',
  async (failure) => {
    await withTestSetup(async () => {
      const transactionIds = Array.from({ length: 21 }, (_, index) => (index + 1).toString(16).padStart(64, '0'))
      const failedId = transactionIds[10]
      assert(failedId != null && failedId !== '')
      const deps = setup(null, transactionIds)
      const connectionError = new Error('Synthetic connection reset')
      vi.mocked(fetch).mockImplementation(async (input) => {
        const id = new Request(input).url.split('/').at(-1)
        if (id === failedId) {
          if (failure === 'network rejection') {
            throw connectionError
          }
          return new Response('Unavailable', { status: failure === 'HTTP 404' ? 404 : 503 })
        }
        return Response.json({
          txid: id,
          vin: [],
          vout: [],
          status: { confirmed: true, block_height: 800000, block_time: timestamp },
        })
      })

      const result = await accountEntries(deps)
      const error = result.expectErr('a failed fetch after a successful batch must discard partial history')
      expect(error.message).toContain(failedId)
      if (failure === 'network rejection') {
        expect(error.cause).toBe(connectionError)
      } else {
        expect(error.message).toContain(failure)
      }
      // A 404 is final; temporary failures are retried three times before the statement stops.
      const failedCalls = vi.mocked(fetch).mock.calls.filter(([input]) => new Request(input).url.endsWith(failedId))
      expect(failedCalls).toHaveLength(failure === 'HTTP 404' ? 1 : 4)
      // Every other transaction is requested at most once.
      expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(transactionIds.length - 1 + failedCalls.length)
    })
  },
)

const confirmedTx = {
  txid,
  vin: [],
  vout: [],
  status: { confirmed: true, block_height: 800000, block_time: timestamp },
}

it('skips unconfirmed transactions, which fall after any statement period', async () => {
  await withTestSetup(async () => {
    const deps = setup(
      confirmedTx,
      [txid],
      [
        { id: '2'.repeat(64), height: 0 },
        { id: '3'.repeat(64), height: -1 },
      ],
    )
    vi.mocked(fetch).mockImplementation(async (input) => {
      const id = new Request(input).url.split('/').at(-1)
      return id === txid ? Response.json(confirmedTx) : new Response('Transaction not found', { status: 404 })
    })

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(vi.mocked(fetch).mock.calls.map(([input]) => new Request(input).url.split('/').at(-1))).toEqual([txid])
  })
})

it.each([
  { scenario: 'a rate limit', status: 429, retryAfter: null, delay: 1_000 },
  { scenario: 'a rate limit with Retry-After', status: 429, retryAfter: '5', delay: 5_000 },
  { scenario: 'a Retry-After above the cap', status: 429, retryAfter: '600', delay: 30_000 },
  { scenario: 'a Retry-After date', status: 503, retryAfter: 'Wed, 21 Oct 2026 07:28:00 GMT', delay: 1_000 },
  { scenario: 'a request timeout', status: 408, retryAfter: null, delay: 1_000 },
  { scenario: 'a server error', status: 500, retryAfter: null, delay: 1_000 },
  { scenario: 'a bad gateway', status: 502, retryAfter: null, delay: 1_000 },
  { scenario: 'a temporary server error', status: 503, retryAfter: null, delay: 1_000 },
  { scenario: 'a gateway timeout', status: 504, retryAfter: null, delay: 1_000 },
])('retries $scenario and then completes', async ({ status, retryAfter, delay }) => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response('Slow down', { status, headers: retryAfter === null ? {} : { 'Retry-After': retryAfter } }),
      )
      .mockResolvedValueOnce(Response.json(confirmedTx))

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([delay])
  })
})

it('stops after three retries of a server error', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    vi.mocked(fetch).mockImplementation(async () => new Response('Unavailable', { status: 503 }))

    const error = (await accountEntries(deps)).expectErr('a server that stays down must fail')

    expect(error.message).toBe(`Failed to fetch transaction ${txid}: HTTP 503`)
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(deps.sleep.mock.calls.map(([ms]) => ms)).toEqual([1_000, 2_000, 4_000])
  })
})

it('retries a rate limit for longer than a server error before it stops', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    vi.mocked(fetch).mockImplementation(async () => new Response('Too many requests', { status: 429 }))

    const error = (await accountEntries(deps)).expectErr('a rate limit that never lifts must fail')

    expect(error.message).toBe(`Failed to fetch transaction ${txid}: HTTP 429`)
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(4)
    expect(deps.sleep.mock.calls.reduce((total, [ms]) => total + ms, 0)).toBeLessThanOrEqual(5 * 60_000)
  })
})

it.each([400, 404, 410])('does not retry an HTTP %i', async (status) => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    vi.mocked(fetch).mockImplementation(async () => new Response('Transaction not found', { status }))

    expect((await accountEntries(deps)).isErr()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(deps.sleep).not.toHaveBeenCalled()
  })
})

it('does not retry a response that is not JSON', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    vi.mocked(fetch).mockImplementation(async () => new Response('<html>Not JSON</html>', { status: 200 }))

    const error = (await accountEntries(deps)).expectErr('a malformed response must fail')

    expect(error.message).toBe(`Invalid transaction data returned from the mempool server for ${txid}`)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

it('retries a response whose body stops partway', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    const interrupted = new ReadableStream({
      start(controller) {
        controller.error(new DOMException('The operation timed out.', 'TimeoutError'))
      },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(interrupted, { status: 200 }))
      .mockResolvedValueOnce(Response.json(confirmedTx))

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

it('retries a temporary failure whose connection dropped before its body was released', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    const dropped = new ReadableStream({
      cancel() {
        throw new TypeError('terminated')
      },
    })
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(dropped, { status: 503 }))
      .mockResolvedValueOnce(Response.json(confirmedTx))

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})

it('releases a failed response before retrying', async () => {
  await withTestSetup(async () => {
    const deps = setup(confirmedTx)
    const cancel = vi.fn()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status: 503 }))
      .mockResolvedValueOnce(Response.json(confirmedTx))

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })
})

it('gives each request a 15 s timeout and cancels it when the statement stops', async () => {
  await withTestSetup(async () => {
    const timeout = new AbortController()
    const timeoutFor = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(confirmedTx)),
    )
    const run = new AbortController()

    await new MempoolSource('https://example.invalid').lookup(txid, 800000, run.signal)
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal

    expect(timeoutFor).toHaveBeenCalledWith(15_000)
    expect(signal?.aborted).toBe(false)
    run.abort()
    expect(signal?.aborted).toBe(true)
  })
})

it('times out a request even when the statement keeps going', async () => {
  await withTestSetup(async () => {
    const timeout = new AbortController()
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(confirmedTx)),
    )

    await new MempoolSource('https://example.invalid').lookup(txid, 800000, new AbortController().signal)
    const signal = vi.mocked(fetch).mock.calls[0]?.[1]?.signal
    timeout.abort()

    expect(signal?.aborted).toBe(true)
  })
})

it.each([
  { scenario: 'a 429', status: 429, headers: {}, rateLimited: true, retryAfterMs: null },
  {
    scenario: 'a 503 with Retry-After',
    status: 503,
    headers: { 'Retry-After': '5' },
    rateLimited: true,
    retryAfterMs: 5_000,
  },
  {
    scenario: 'a 503 with a Retry-After date',
    status: 503,
    headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
    rateLimited: true,
    retryAfterMs: null,
  },
  { scenario: 'a plain 503', status: 503, headers: {}, rateLimited: false, retryAfterMs: null },
])('holds back every lookup only for $scenario', async ({ status, headers, rateLimited, retryAfterMs }) => {
  await withTestSetup(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Busy', { status, headers })),
    )

    const result = await new MempoolSource('https://example.invalid').lookup(txid, 800000, new AbortController().signal)

    expect(result.expectErr('a busy server must fail this attempt').retry).toEqual({ rateLimited, retryAfterMs })
  })
})

it.each(['../../admin?x=', `${'a'.repeat(64)}/../x`, `../${'a'.repeat(64)}`])(
  'stops the statement when Electrum returns %s as a txid',
  async (txHash) => {
    await withTestSetup(async () => {
      const deps = setup(confirmedTx)
      vi.spyOn(deps.onchainProvider.deps.electrum, 'getHistory').mockResolvedValue(
        Ok([{ tx_hash: txHash, height: 800000 }]),
      )

      const result = await accountEntries(deps)

      expect(result.expectErr('an invalid txid must not reach a lookup URL').message).toBe(
        'Electrum returned an invalid txid',
      )
      expect(fetch).not.toHaveBeenCalled()
    })
  },
)

it('looks up an uppercase txid from Electrum in lowercase', async () => {
  await withTestSetup(async () => {
    const lettered = 'ab'.repeat(32)
    const deps = setup({ ...confirmedTx, txid: lettered }, [lettered.toUpperCase()])

    expect((await accountEntries(deps)).isOk()).toBe(true)
    expect(new Request(vi.mocked(fetch).mock.calls[0]?.[0] ?? '').url).toMatch(new RegExp(`/api/tx/${lettered}$`))
  })
})

it.each([
  { apiUrl: 'https://example.invalid/', url: `https://example.invalid/api/tx/${txid}` },
  { apiUrl: 'https://example.invalid/mempool', url: `https://example.invalid/mempool/api/tx/${txid}` },
  { apiUrl: 'https://example.invalid/mempool/', url: `https://example.invalid/mempool/api/tx/${txid}` },
])('looks up transactions under $apiUrl', async ({ apiUrl, url }) => {
  await withTestSetup(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(confirmedTx)),
    )

    await new MempoolSource(apiUrl).lookup(txid, 800000, new AbortController().signal)

    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(url)
  })
})

it('fails rather than skipping an address whose history lookup fails', async () => {
  await withTestSetup(async () => {
    const deps = setup(null)
    vi.spyOn(deps.onchainProvider.deps.electrum, 'getHistory').mockResolvedValue(Err(new Error('Connection closed')))
    const result = await accountEntries(deps)
    expect(result.expectErr('a missing history must fail').message).toBe(
      'Could not fetch transaction history: Connection closed',
    )
  })
})

it('stops statement generation when a known transaction fails validation', async () => {
  await withTestSetup(async () => {
    const deps = setup({ txid, vin: [], status: { confirmed: true } })
    const directory = mkdtempSync(join(tmpdir(), 'sentinel-statement-validation-'))
    const database = await openDrizzleDatabase(directory, logger)
    try {
      await database
        .insert(accounts)
        .values({ id: 're_clmx_test', descriptor: account.toString(), displayName: 'Test wallet', status: 'verified' })
      const dailyRatesService = new DailyRatesService({ ...deps, db: database })
      const rates = vi
        .spyOn(dailyRatesService, 'getDailyRates')
        .mockImplementation(
          asyncFn(async () => Ok({ rates: {}, source: 'mempool' as const, quoteCurrency: 'USD' as const })),
        )
      const service = new StatementService({
        ...deps,
        db: database,
        dailyRatesService,
        exchangeService: new ExchangeService({ db: database, logger }),
      })

      const result = await service.generateStatementData({
        claimIds: ['re_clmx_test'],
        openingDate: new Date('2024-01-01'),
        closingDate: new Date('2024-01-31'),
        timezone: 'UTC',
      })
      expect(result.expectErr('incomplete statement data must fail').message).toBe(
        `Invalid transaction data returned from the mempool server for ${txid}`,
      )
      expect(rates).not.toHaveBeenCalled()
    } finally {
      database.$client.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

it.each([
  { blockTime: undefined, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: 0, expected: '2024-06-01T00:00:00.000Z' },
  { blockTime: -1, expected: '1969-12-31T23:59:59.000Z' },
])('preserves the timestamp fallback for block_time=$blockTime', async ({ blockTime, expected }) => {
  await withTestSetup(async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2024-06-01T00:00:00.000Z'))
    const address = account.receiveAddresses(0, 1, Network.Mainnet)[0]
    assert(address)
    const result = await accountEntries(
      setup({
        txid,
        vin: [{ prevout: null }],
        vout: [{ scriptpubkey_address: address.toString(), value: 100 }],
        status: { confirmed: true, block_height: 800000, block_time: blockTime },
      }),
    )
    expect(result.unwrap()).toEqual([expect.objectContaining({ timestamp: new Date(expected) })])
  })
})

it.each([
  { url: 'https://mempool.space', kind: 'public_mempool' },
  { url: 'https://www.mempool.space/', kind: 'public_mempool' },
  { url: 'https://blockstream.info', kind: 'public_mempool' },
  { url: 'http://10.0.3.5:8080', kind: 'node_mempool' },
  { url: 'http://mempool.embassy:8080', kind: 'node_mempool' },
  { url: 'http://umbrel.local:3006', kind: 'node_mempool' },
  { url: 'http://localhost:3006', kind: 'node_mempool' },
  { url: 'http://127.0.0.1:8999', kind: 'node_mempool' },
  { url: 'http://[::1]:8999', kind: 'node_mempool' },
  { url: 'http://mempoolhqx4isw62xs7abwphsq7ldayuidyx2v2oethdhhj6mlo2r6ad.onion', kind: 'public_mempool' },
  { url: 'not a url', kind: 'public_mempool' },
])('records $url as $kind', ({ url, kind }) => {
  expect(new MempoolSource(url).kind).toBe(kind)
})
