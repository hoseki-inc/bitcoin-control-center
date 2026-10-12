import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '@hoseki/packages/bitcoin/account'
import { Address } from '@hoseki/packages/bitcoin/address'
import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import type { TransactionEntry } from '@hoseki/packages/bitcoin/onchain/types'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { ElectrumServerError } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { Wallets } from '@hoseki/packages/testing'
import Decimal from 'decimal.js'
import pino from 'pino'
import { assert, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { openDrizzleDatabase } from '../../db/drizzle'
import { accounts } from '../../db/schema'
import { ExchangeService } from '../exchange/service'
import { DailyRatesService } from '../price/daily_rates'
import { toTransactionEntries } from './entries'
import type { AccountHistory } from './history'
import { lookupTransactions } from './lookup'
import { StatementService } from './service'
import { ElectrumSource } from './sources/electrum'
import { MempoolSource } from './sources/mempool'
import type { LookedUpTx } from './sources/types'

const logger = pino({ level: 'silent' })
const mempoolApiUrl = 'https://example.invalid'

// ─── Shared fakes ───────────────────────────────────────────────────────────

/** The parts of mempool's /api/tx/{txid} answer these tests read; the rest is passed through. */
interface MempoolAnswer {
  txid: string
  status: { block_height: number; block_time: number }
}

/** What each server knows about one transaction. */
interface KnownTx {
  hex: string
  mempool: MempoolAnswer
}

/** A mempool server and an Electrum server that both know the given transactions. */
function servers(known: ReadonlyMap<string, KnownTx>): ElectrumProvider {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const tx = known.get(url.split('/').at(-1) ?? '')
      return tx === undefined ? new Response('Transaction not found', { status: 404 }) : Response.json(tx.mempool)
    }),
  )
  const blockTimes = new Map(
    [...known.values()].map(({ mempool }) => [mempool.status.block_height, mempool.status.block_time]),
  )
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getTransaction').mockImplementation(
    asyncFn(async (txid: string) => {
      const tx = known.get(txid)
      return tx === undefined ? Err(new ElectrumServerError('No such transaction')) : Ok(tx.hex)
    }),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'getBlock').mockImplementation(
    asyncFn(async (height: number) => {
      const time = blockTimes.get(height)
      return time === undefined
        ? Err(new ElectrumServerError('No such block'))
        : Ok({ height, hash: 'block', timestamp: new Date(time * 1000) })
    }),
  )
  onTestFinished(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })
  return onchainProvider
}

// ─── Recorded mainnet transactions ──────────────────────────────────────────

// Every level passes unread fields through, so the fake server answers with the whole recording.
const MempoolTxSchema = z
  .object({
    txid: z.string(),
    vin: z.array(
      z
        .object({ prevout: z.object({ scriptpubkey_address: z.string().optional() }).passthrough().nullable() })
        .passthrough(),
    ),
    vout: z.array(z.object({ scriptpubkey_address: z.string().optional() }).passthrough()),
    status: z.object({ block_height: z.number(), block_time: z.number() }).passthrough(),
  })
  .passthrough()
const RecordedTxSchema = z.object({ hex: z.string(), mempool: MempoolTxSchema })
const RecordingSchema = z.object({
  transactions: z.array(RecordedTxSchema.extend({ label: z.string(), parents: z.array(z.string()) })),
  parents: z.record(z.string(), RecordedTxSchema),
})

const recording = parseUnknown(
  RecordingSchema,
  JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'mainnet-transactions.json'), 'utf8')),
).expect('Recorded transactions must parse')
const recorded = new Map<string, KnownTx>([
  ...recording.transactions.map((tx): [string, KnownTx] => [tx.mempool.txid, tx]),
  ...Object.entries(recording.parents),
])

/** Every address a transaction spends from or pays, as if they all belonged to one wallet. */
function addressesOf(tx: z.infer<typeof MempoolTxSchema>): Address[] {
  const strings = new Set([
    ...tx.vin.flatMap((input) => input.prevout?.scriptpubkey_address ?? []),
    ...tx.vout.flatMap((output) => output.scriptpubkey_address ?? []),
  ])
  return [...strings].flatMap((address) => Address.fromString(address).unwrapOr([]))
}

function entriesFrom(history: AccountHistory, found: Map<string, LookedUpTx>, tip: number): TransactionEntry[] {
  return toTransactionEntries(history, found, tip).unwrap()
}

it.each(recording.transactions)(
  'gives the same entries from both sources for a recorded $label transaction, $mempool.txid',
  async (tx) => {
    const onchainProvider = servers(recorded)
    const addresses = addressesOf(tx.mempool)
    // The transaction and the ones it spends, which hold the wallet's spent coins.
    const ids = [tx.mempool.txid, ...tx.parents]
    const history: AccountHistory = new Map(
      ids.map((id) => [id, { height: recorded.get(id)?.mempool.status.block_height ?? 0, addresses }]),
    )
    const heights = new Map([...history].map(([id, { height }]) => [id, height]))
    const tip = Math.max(...heights.values()) + 100

    const viaMempool = entriesFrom(
      history,
      (await lookupTransactions({ transactions: heights, source: new MempoolSource(mempoolApiUrl), logger })).unwrap(),
      tip,
    )
    const viaElectrum = entriesFrom(
      history,
      (
        await lookupTransactions({ transactions: heights, source: new ElectrumSource(onchainProvider), logger })
      ).unwrap(),
      tip,
    )

    // Only this transaction's entries: its parents' own spent coins weren't recorded.
    const own = (entries: TransactionEntry[]): TransactionEntry[] =>
      entries.filter((entry) => entry.txid.toString() === tx.mempool.txid)
    expect(own(viaMempool).length).toBeGreaterThan(0)
    expect(own(viaElectrum)).toEqual(own(viaMempool))
  },
)

// ─── Built wallets, through whole statements ────────────────────────────────

const outside = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'
const firstBlock = 825_000
const firstBlockTime = Date.parse('2024-01-03T10:00:00Z') / 1000

interface Output {
  address: string | null
  value: number
}

interface Spend {
  txid: string
  vout: number
  /** The coin it spends, which mempool reports with the input. */
  prevout: Output
}

interface BuiltMempoolTx extends MempoolAnswer {
  vin: Array<{
    txid: string
    vout: number
    is_coinbase: false
    prevout: { scriptpubkey_address?: string; value: number }
  }>
  vout: Array<{ scriptpubkey_address?: string; value: number }>
}

interface BuiltTx extends KnownTx {
  txid: string
  outputs: Output[]
  mempool: BuiltMempoolTx
}

/** A confirmed transaction as both servers would describe it. */
function buildTx(spends: Spend[], outputs: Output[], height: number): BuiltTx {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  for (const { txid, vout } of spends) {
    tx.addInput(Buffer.from(txid, 'hex').reverse(), vout)
  }
  for (const { address, value } of outputs) {
    const script =
      address === null
        ? bitcoin.payments.embed({ data: [Buffer.from('statement')] }).output
        : bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
    assert(script !== undefined)
    tx.addOutput(script, value)
  }
  const txid = tx.getId()
  const blockTime = firstBlockTime + (height - firstBlock) * 3_600
  return {
    txid,
    hex: tx.toHex(),
    outputs,
    mempool: {
      txid,
      vin: spends.map(({ txid: spent, vout, prevout }) => ({
        txid: spent,
        vout,
        is_coinbase: false,
        prevout: { scriptpubkey_address: prevout.address ?? undefined, value: prevout.value },
      })),
      vout: outputs.map(({ address, value }) => ({ scriptpubkey_address: address ?? undefined, value })),
      status: { confirmed: true, block_height: height, block_time: blockTime },
    },
  }
}

function spend(tx: BuiltTx, vout: number): Spend {
  const prevout = tx.outputs[vout]
  assert(prevout !== undefined)
  return { txid: tx.txid, vout, prevout }
}

/**
 * Every wallet type is paid from outside; each pays the next with change back to itself; the first
 * then sends its coins out again, with an OP_RETURN.
 */
function buildHistory(wallets: readonly Account[]): BuiltTx[] {
  const receive = (wallet: Account): string => wallet.receiveAddress(0, Network.Mainnet).toString()
  const change = (wallet: Account): string => wallet.changeAddress(0, Network.Mainnet).toString()
  const funding = buildTx(
    [{ txid: 'ee'.repeat(32), vout: 0, prevout: { address: outside, value: 100_000_000 } }],
    wallets.map((wallet, index) => ({ address: receive(wallet), value: 1_000_000 + index * 1_000 })),
    firstBlock,
  )
  const ring = wallets.map((wallet, index) => {
    const next = wallets[(index + 1) % wallets.length]
    assert(next !== undefined)
    const coin = spend(funding, index)
    return buildTx(
      [coin],
      [
        { address: receive(next), value: 400_000 },
        { address: change(wallet), value: coin.prevout.value - 400_000 - 1_000 },
      ],
      firstBlock + 1 + index,
    )
  })
  const [first] = wallets
  const [firstSpend] = ring
  const lastSpend = ring.at(-1)
  assert(first !== undefined && firstSpend !== undefined && lastSpend !== undefined)
  const sweep = buildTx(
    [spend(firstSpend, 1), spend(lastSpend, 0)],
    [
      { address: outside, value: 500_000 },
      { address: null, value: 0 },
      { address: change(first), value: firstSpend.outputs[1]?.value ?? 0 },
    ],
    firstBlock + 20,
  )
  return [funding, ...ring, sweep]
}

it('builds the same statement from both sources for every wallet type', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sentinel-source-parity-'))
  const db = await openDrizzleDatabase(directory, logger)
  onTestFinished(() => {
    db.$client.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const wallets = Wallets.allSingleAndMultiSigAccounts
  const transactions = buildHistory(wallets)
  const onchainProvider = servers(new Map(transactions.map((tx) => [tx.txid, tx])))

  // Electrum's history: every confirmed transaction that pays or spends from each address.
  const touching = new Map<string, Array<{ tx_hash: string; height: number }>>()
  for (const tx of transactions) {
    const addresses = [
      ...tx.outputs.flatMap(({ address }) => address ?? []),
      ...tx.mempool.vin.flatMap(({ prevout }) => prevout.scriptpubkey_address ?? []),
    ]
    for (const address of new Set(addresses)) {
      const scripthash = addressToScripthash(Address.fromString(address).expect('built address')).expect('scripthash')
      touching.set(scripthash, [
        ...(touching.get(scripthash) ?? []),
        { tx_hash: tx.txid, height: tx.mempool.status.block_height },
      ])
    }
  }
  vi.spyOn(onchainProvider.deps.electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => Ok(touching.get(scripthash) ?? [])),
  )
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: 0 })),
  )
  vi.spyOn(onchainProvider, 'getBlocksTip').mockImplementation(
    asyncFn(async () => Ok({ height: firstBlock + 1_000, hash: 'tip', timestamp: new Date() })),
  )

  const dailyRatesService = new DailyRatesService({ db, logger, mempoolApiUrl })
  vi.spyOn(dailyRatesService, 'getDailyRates').mockImplementation(
    asyncFn(async (openingDate: Date, closingDate: Date) => {
      const rate = new Decimal(42_000)
      const rates: Record<string, { timestamp: Date; open: Decimal; high: Decimal; low: Decimal; close: Decimal }> = {}
      for (let day = new Date(openingDate); day <= closingDate; day = new Date(day.getTime() + 86_400_000)) {
        rates[day.toISOString().slice(0, 10)] = { timestamp: day, open: rate, high: rate, low: rate, close: rate }
      }
      return Ok({ source: 'mempool' as const, quoteCurrency: 'USD' as const, rates })
    }),
  )
  const service = new StatementService({
    db,
    logger,
    onchainProvider,
    dailyRatesService,
    exchangeService: new ExchangeService({ db, logger }),
    mempoolApiUrl,
    sourceSelectable: true,
  })
  const claimIds = await Promise.all(
    wallets.map(async (wallet, index) => {
      const id = `wallet-${index}`
      await db.insert(accounts).values({ id, descriptor: wallet.toString(), displayName: id, status: 'verified' })
      return id
    }),
  )
  const input = {
    claimIds,
    openingDate: new Date('2024-01-01T00:00:00Z'),
    closingDate: new Date('2024-01-31T23:59:59.999Z'),
    timezone: 'UTC',
  }

  const generate = async () => {
    const id = (await service.create(input)).unwrap()
    return (await service.generateStatementData(input, id)).unwrap()
  }
  const viaMempool = await generate()
  ;(await service.setSourceChoice('electrum')).unwrap()
  // The same fake server; spying again only gives this test a handle on it.
  const getTransaction = vi.spyOn(onchainProvider.deps.electrum, 'getTransaction')
  const viaElectrum = await generate()

  expect(getTransaction).toHaveBeenCalled()
  expect(viaElectrum).toEqual(viaMempool)
  // Each wallet's funding, its own payment and the one it received; the first also sent coins out.
  const counts = Object.values(viaMempool.transactionMap).map(({ transactions: rows }) => rows.length)
  expect(counts).toEqual([4, 3, 3, 3, 3, 3, 3])
})
