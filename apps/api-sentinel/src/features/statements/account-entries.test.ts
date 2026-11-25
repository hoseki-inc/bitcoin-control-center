import type { Address } from '@hoseki/packages/bitcoin/address'
import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { ElectrumServerError } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { assert, describe, expect, it, vi } from 'vitest'
import { loadAccountEntries } from './account-entries'
import type { Sleep } from './lookup'

const logger = pino({ level: 'silent' })
const account = Wallets.singlesigNativeSegwitAccount
const externalAddress = Wallets.singlesigLegacyAccount.receiveAddress(0, Network.Mainnet).toString()
const externalAddress2 = Wallets.singlesigLegacyAccount.receiveAddress(1, Network.Mainnet).toString()

interface RawTx {
  hex: string
  txid: string
}

interface OutputSpec {
  address: string | null
  value: number
}

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function rawTx(spends: Array<{ txid: string; vout: number }> | 'coinbase', outputs: OutputSpec[], locktime = 0): RawTx {
  const tx = new bitcoin.Transaction()
  tx.version = 2
  tx.locktime = locktime
  if (spends === 'coinbase') {
    tx.addInput(Buffer.alloc(32), 0xffffffff, 0xffffffff, Buffer.from('03a08601', 'hex'))
  } else {
    for (const { txid, vout } of spends) {
      tx.addInput(Buffer.from(txid, 'hex').reverse(), vout)
    }
  }
  for (const { address, value } of outputs) {
    const script =
      address === null
        ? bitcoin.payments.embed({ data: [Buffer.from('account-entries')] }).output
        : bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
    assert(script !== undefined)
    tx.addOutput(script, value)
  }
  return { hex: tx.toHex(), txid: tx.getId() }
}

interface HistoryEntry {
  tx_hash: string
  height: number
}

interface SetupOptions {
  histories: ReadonlyMap<Address, HistoryEntry[]>
  transactions: ReadonlyMap<string, string | Error>
  blockTimestamps?: ReadonlyMap<number, number>
  lastUsedReceiveIndex?: number
  lastUsedChangeIndex?: number
}

interface SetupResult {
  onchainProvider: ElectrumProvider
  electrum: ElectrumClient
  getTransaction: ReturnType<
    typeof vi.fn<(txid: string) => Promise<ReturnType<typeof Ok<string>> | ReturnType<typeof Err<Error>>>>
  >
  getBlock: ReturnType<typeof vi.fn<(height: number) => Date | Error>>
  sleep: Sleep
  sleepCalls: number[]
}

function setup(options: SetupOptions): SetupResult {
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  const byScripthash = new Map<string, HistoryEntry[]>()
  for (const [address, entries] of options.histories) {
    byScripthash.set(addressToScripthash(address).expect('Fixture address must be valid'), entries)
  }

  vi.spyOn(electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => Ok(byScripthash.get(scripthash) ?? [])),
  )

  const getTransaction = vi.fn(
    async (txid: string): Promise<ReturnType<typeof Ok<string>> | ReturnType<typeof Err<Error>>> => {
      const answer = options.transactions.get(txid)
      if (answer === undefined) {
        return Err(new ElectrumServerError(`Unknown transaction ${txid}`))
      }
      return answer instanceof Error ? Err(answer) : Ok(answer)
    },
  )
  vi.spyOn(electrum, 'getTransaction').mockImplementation(asyncFn(async (txid: string) => getTransaction(txid)))

  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () =>
      Ok({
        lastUsedReceiveIndex: options.lastUsedReceiveIndex ?? 0,
        lastUsedChangeIndex: options.lastUsedChangeIndex ?? -1,
      }),
    ),
  )

  const getBlock = vi.fn((height: number): Date | Error => {
    const ts = options.blockTimestamps?.get(height) ?? 1_700_000_000 + height
    return new Date(ts * 1000)
  })
  vi.spyOn(onchainProvider, 'getBlock').mockImplementation(
    asyncFn(async (height: number) => {
      const answer = getBlock(height)
      return answer instanceof Error ? Err(answer) : Ok({ height, hash: `hash-${height}`, timestamp: answer })
    }),
  )

  const sleepCalls: number[] = []
  const sleep: Sleep = async (ms: number): Promise<void> => {
    sleepCalls.push(ms)
  }

  return { onchainProvider, electrum, getTransaction, getBlock, sleep, sleepCalls }
}

describe('loadAccountEntries', () => {
  it('resolves cross-boundary wallet spends in Pass 2 without fetching parent block headers or emitting parent entries', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    const [change0] = account.changeAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined && change0 !== undefined)

    const h0 = 800_000
    const h1 = 805_000
    const tipHeight = 805_010
    const funding = rawTx([{ txid: 'aa'.repeat(32), vout: 0 }], [{ address: receive0.toString(), value: 100_000 }])
    const spend = rawTx(
      [{ txid: funding.txid, vout: 0 }],
      [
        { address: externalAddress, value: 30_000 },
        { address: change0.toString(), value: 69_000 },
      ],
    )

    const { onchainProvider, getTransaction, getBlock, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: funding.txid, height: h0 },
            { tx_hash: spend.txid, height: h1 },
          ],
        ],
        [change0, [{ tx_hash: spend.txid, height: h1 }]],
      ]),
      transactions: new Map([
        [funding.txid, funding.hex],
        [spend.txid, spend.hex],
      ]),
      lastUsedReceiveIndex: 0,
      lastUsedChangeIndex: 0,
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 800_000,
        tipHeight,
        logger,
        sleep,
      })
    ).unwrap()

    expect(entries).toHaveLength(2)
    expect(entries.map((e) => ({ txid: e.txid.toString(), address: e.address.toString(), value: e.value }))).toEqual([
      { txid: spend.txid, address: receive0.toString(), value: -100_000n },
      { txid: spend.txid, address: change0.toString(), value: 69_000n },
    ])
    const netDelta = entries.reduce((sum, e) => sum + e.value, 0n)
    expect(netDelta).toBe(-31_000n)

    const fetchedTxids = getTransaction.mock.calls.map(([txid]) => txid)
    expect(fetchedTxids.filter((id) => id === funding.txid)).toHaveLength(1)
    expect(fetchedTxids.filter((id) => id === spend.txid)).toHaveLength(1)
    expect(getBlock).toHaveBeenCalledWith(h1)
    expect(getBlock).not.toHaveBeenCalledWith(h0)
  })

  it('never fetches external sender prevouts for incoming transactions', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const ext1 = '11'.repeat(32)
    const ext2 = '22'.repeat(32)
    const ext3 = '33'.repeat(32)
    const receiveTx = rawTx(
      [
        { txid: ext1, vout: 0 },
        { txid: ext2, vout: 1 },
        { txid: ext3, vout: 2 },
      ],
      [{ address: receive0.toString(), value: 250_000 }],
    )

    const { onchainProvider, getTransaction, sleep } = setup({
      histories: new Map([[receive0, [{ tx_hash: receiveTx.txid, height: 805_000 }]]]),
      transactions: new Map([[receiveTx.txid, receiveTx.hex]]),
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 800_000,
        tipHeight: 805_010,
        logger,
        sleep,
      })
    ).unwrap()

    expect(entries.map((e) => e.value)).toEqual([250_000n])
    expect(getTransaction.mock.calls.map(([txid]) => txid)).toEqual([receiveTx.txid])
  })

  it('handles mixed-output / payjoin pre-window parents by debiting only wallet-owned outputs', async () => {
    const [receive0, receive1] = account.receiveAddresses(0, 2, Network.Mainnet)
    assert(receive0 !== undefined && receive1 !== undefined)

    const payjoinParent = rawTx(
      [{ txid: '44'.repeat(32), vout: 0 }],
      [
        { address: receive0.toString(), value: 80_000 },
        { address: externalAddress, value: 40_000 },
      ],
    )
    // Spend only the wallet output (vout 0) and receive into receive1.
    const spendWalletOut = rawTx(
      [{ txid: payjoinParent.txid, vout: 0 }],
      [{ address: externalAddress2, value: 79_000 }],
    )
    // A separate tx that spends the external output (vout 1) of the same parent and pays receive1.
    const spendExternalOut = rawTx(
      [{ txid: payjoinParent.txid, vout: 1 }],
      [{ address: receive1.toString(), value: 39_000 }],
    )

    const { onchainProvider, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: payjoinParent.txid, height: 800_000 },
            { tx_hash: spendWalletOut.txid, height: 805_000 },
          ],
        ],
        [receive1, [{ tx_hash: spendExternalOut.txid, height: 805_001 }]],
      ]),
      transactions: new Map([
        [payjoinParent.txid, payjoinParent.hex],
        [spendWalletOut.txid, spendWalletOut.hex],
        [spendExternalOut.txid, spendExternalOut.hex],
      ]),
      lastUsedReceiveIndex: 1,
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 800_000,
        tipHeight: 805_010,
        logger,
        sleep,
      })
    ).unwrap()

    const walletSpendEntry = entries.find((e) => e.txid.toString() === spendWalletOut.txid)
    const externalSpendEntry = entries.find((e) => e.txid.toString() === spendExternalOut.txid)
    expect(walletSpendEntry?.value).toBe(-80_000n)
    // Spending the external output must debit 0 from the wallet (only +39_000 receive).
    expect(externalSpendEntry?.value).toBe(39_000n)
  })

  it('skips unconfirmed transactions and transactions above tipHeight with zero getTransaction calls', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const unconf0 = '55'.repeat(32)
    const unconfNeg = '66'.repeat(32)
    const aboveTip = '77'.repeat(32)

    const { onchainProvider, getTransaction, getBlock, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: unconf0, height: 0 },
            { tx_hash: unconfNeg, height: -1 },
            { tx_hash: aboveTip, height: 805_011 },
          ],
        ],
      ]),
      transactions: new Map(),
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 0,
        tipHeight: 805_010,
        logger,
        sleep,
      })
    ).unwrap()

    expect(entries).toEqual([])
    expect(getTransaction).not.toHaveBeenCalled()
    expect(getBlock).not.toHaveBeenCalled()
  })

  it('fails with invalid and does not retry when Pass 1 tx bytes do not match txid', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const wrongTx = rawTx('coinbase', [{ address: receive0.toString(), value: 1_000 }])
    const expectedTxid = '88'.repeat(32)

    const { onchainProvider, getTransaction, sleep, sleepCalls } = setup({
      histories: new Map([[receive0, [{ tx_hash: expectedTxid, height: 805_000 }]]]),
      transactions: new Map([[expectedTxid, wrongTx.hex]]),
    })

    const result = await loadAccountEntries({
      account,
      onchainProvider,
      afterHeight: 0,
      tipHeight: 805_010,
      logger,
      sleep,
    })

    expect(result.expectErr('mismatched Pass 1 tx must fail').kind).toBe('invalid')
    expect(getTransaction).toHaveBeenCalledTimes(1)
    expect(sleepCalls).toEqual([])
  })

  it('fails with invalid and does not retry when Pass 2 parent tx bytes do not match txid', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const parentTxid = '99'.repeat(32)
    const wrongParent = rawTx('coinbase', [{ address: receive0.toString(), value: 1_000 }])
    const spend = rawTx([{ txid: parentTxid, vout: 0 }], [{ address: externalAddress, value: 900 }])

    const { onchainProvider, getTransaction, sleep, sleepCalls } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: parentTxid, height: 800_000 },
            { tx_hash: spend.txid, height: 805_000 },
          ],
        ],
      ]),
      transactions: new Map([
        [spend.txid, spend.hex],
        [parentTxid, wrongParent.hex],
      ]),
    })

    const result = await loadAccountEntries({
      account,
      onchainProvider,
      afterHeight: 800_000,
      tipHeight: 805_010,
      logger,
      sleep,
    })

    expect(result.expectErr('mismatched Pass 2 parent must fail').kind).toBe('invalid')
    expect(getTransaction.mock.calls.filter(([id]) => id === parentTxid)).toHaveLength(1)
    expect(sleepCalls).toEqual([])
  })

  it('retries a transient dropped connection without re-fetching already completed transactions', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const tx1 = rawTx([{ txid: 'a1'.repeat(32), vout: 0 }], [{ address: receive0.toString(), value: 10_000 }], 1)
    const tx2 = rawTx([{ txid: 'a2'.repeat(32), vout: 0 }], [{ address: receive0.toString(), value: 20_000 }], 2)

    const { onchainProvider, getTransaction, sleep, sleepCalls } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: tx1.txid, height: 805_000 },
            { tx_hash: tx2.txid, height: 805_001 },
          ],
        ],
      ]),
      transactions: new Map([
        [tx1.txid, tx1.hex],
        [tx2.txid, tx2.hex],
      ]),
    })

    let tx2FailedOnce = false
    getTransaction.mockImplementation(async (txid: string) => {
      if (txid === tx2.txid && !tx2FailedOnce) {
        tx2FailedOnce = true
        return Err(new Error('Connection closed'))
      }
      if (txid === tx1.txid) {
        return Ok(tx1.hex)
      }
      if (txid === tx2.txid) {
        return Ok(tx2.hex)
      }
      return Err(new ElectrumServerError(`Unknown ${txid}`))
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 800_000,
        tipHeight: 805_010,
        logger,
        sleep,
      })
    ).unwrap()

    expect(entries.map((e) => e.value)).toEqual([10_000n, 20_000n])
    expect(sleepCalls).toEqual([2_000])
    expect(getTransaction.mock.calls.filter(([id]) => id === tx1.txid)).toHaveLength(1)
    expect(getTransaction.mock.calls.filter(([id]) => id === tx2.txid)).toHaveLength(2)
  })

  it('fails closed when a Pass 2 wallet parent cannot be read from Electrum', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const missingParent = 'b1'.repeat(32)
    const spend = rawTx([{ txid: missingParent, vout: 0 }], [{ address: externalAddress, value: 49_000 }])

    const { onchainProvider, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: missingParent, height: 800_000 },
            { tx_hash: spend.txid, height: 805_000 },
          ],
        ],
      ]),
      transactions: new Map([
        [spend.txid, spend.hex],
        [missingParent, new ElectrumServerError('No such transaction')],
      ]),
    })

    const result = await loadAccountEntries({
      account,
      onchainProvider,
      afterHeight: 800_000,
      tipHeight: 805_010,
      logger,
      sleep,
    })

    expect(result.expectErr('unreadable wallet parent must fail closed').kind).toBe('unavailable')
  })

  it('fails closed when a spent wallet parent is missing the referenced vout index', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const parent = rawTx('coinbase', [{ address: receive0.toString(), value: 100_000 }])
    const badSpend = rawTx([{ txid: parent.txid, vout: 3 }], [{ address: externalAddress, value: 90_000 }])

    const { onchainProvider, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: parent.txid, height: 800_000 },
            { tx_hash: badSpend.txid, height: 805_000 },
          ],
        ],
      ]),
      transactions: new Map([
        [parent.txid, parent.hex],
        [badSpend.txid, badSpend.hex],
      ]),
    })

    const result = await loadAccountEntries({
      account,
      onchainProvider,
      afterHeight: 800_000,
      tipHeight: 805_010,
      logger,
      sleep,
    })

    expect(result.expectErr('missing spent wallet output index must fail closed').kind).toBe('invalid')
  })

  it('handles coinbase receives and internal wallet-to-wallet self-transfers accurately', async () => {
    const [receive0, receive1] = account.receiveAddresses(0, 2, Network.Mainnet)
    assert(receive0 !== undefined && receive1 !== undefined)

    const coinbase = rawTx('coinbase', [{ address: receive0.toString(), value: 312_500_000 }])
    const selfTransfer = rawTx(
      [{ txid: coinbase.txid, vout: 0 }],
      [{ address: receive1.toString(), value: 312_499_000 }],
    )

    const { onchainProvider, getTransaction, sleep } = setup({
      histories: new Map([
        [
          receive0,
          [
            { tx_hash: coinbase.txid, height: 805_000 },
            { tx_hash: selfTransfer.txid, height: 805_001 },
          ],
        ],
        [receive1, [{ tx_hash: selfTransfer.txid, height: 805_001 }]],
      ]),
      transactions: new Map([
        [coinbase.txid, coinbase.hex],
        [selfTransfer.txid, selfTransfer.hex],
      ]),
      lastUsedReceiveIndex: 1,
    })

    const entries = (
      await loadAccountEntries({
        account,
        onchainProvider,
        afterHeight: 0,
        tipHeight: 805_010,
        logger,
        sleep,
      })
    ).unwrap()

    const coinbaseEntries = entries.filter((e) => e.txid.toString() === coinbase.txid)
    const selfEntries = entries.filter((e) => e.txid.toString() === selfTransfer.txid)
    expect(coinbaseEntries.map((e) => e.value)).toEqual([312_500_000n])
    expect(selfEntries.map((e) => ({ address: e.address.toString(), value: e.value }))).toEqual([
      { address: receive0.toString(), value: -312_500_000n },
      { address: receive1.toString(), value: 312_499_000n },
    ])
    expect(selfEntries.reduce((sum, e) => sum + e.value, 0n)).toBe(-1_000n)
    // Full range (afterHeight = 0) fetches each tx once in Pass 1 with zero Pass 2 lookups.
    expect(getTransaction).toHaveBeenCalledTimes(2)
  })

  it('runs up to 16 in-range transaction lookups concurrently', async () => {
    const [receive0] = account.receiveAddresses(0, 1, Network.Mainnet)
    assert(receive0 !== undefined)

    const txs = Array.from({ length: 20 }, (_, i) =>
      rawTx(
        [{ txid: i.toString(16).padStart(2, '0').repeat(32), vout: 0 }],
        [{ address: receive0.toString(), value: 1_000 + i }],
      ),
    )
    const gates = new Map(txs.map((tx) => [tx.txid, deferred<string>()]))
    let inFlight = 0
    let maxInFlight = 0
    const started: string[] = []

    const { onchainProvider, getTransaction, sleep } = setup({
      histories: new Map([[receive0, txs.map((tx, i) => ({ tx_hash: tx.txid, height: 805_000 + i }))]]),
      transactions: new Map(txs.map((tx) => [tx.txid, tx.hex])),
    })
    getTransaction.mockImplementation(async (txid: string) => {
      started.push(txid)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const gate = gates.get(txid)
      assert(gate !== undefined)
      const hex = await gate.promise
      inFlight -= 1
      return Ok(hex)
    })

    const pending = loadAccountEntries({
      account,
      onchainProvider,
      afterHeight: 800_000,
      tipHeight: 805_100,
      logger,
      sleep,
    })

    try {
      for (let tick = 0; tick < 15; tick += 1) {
        await Promise.resolve()
      }
      expect(maxInFlight).toBe(16)
      expect(started).toHaveLength(16)

      const first = started[0]
      assert(first !== undefined)
      const firstTx = txs.find((t) => t.txid === first)
      assert(firstTx !== undefined)
      gates.get(first)?.resolve(firstTx.hex)

      for (let tick = 0; tick < 15; tick += 1) {
        await Promise.resolve()
      }
      expect(started).toHaveLength(17)
      expect(maxInFlight).toBe(16)
    } finally {
      for (const tx of txs) {
        gates.get(tx.txid)?.resolve(tx.hex)
      }
    }

    const entries = (await pending).unwrap()
    expect(entries).toHaveLength(20)
  })
})
