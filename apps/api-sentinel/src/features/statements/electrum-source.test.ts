import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { ElectrumServerError, ElectrumTimeoutError } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { assert, expect, it, vi } from 'vitest'
import { ElectrumSource } from './sources/electrum'

const logger = pino({ level: 'silent' })
const height = 800_000
const blockTime = 1_704_153_600
const parent = 'ab'.repeat(32)

interface RawTx {
  hex: string
  txid: string
}

interface Output {
  address: string | null
  value: number
}

function walletAddress(): string {
  const [address] = Wallets.singlesigNativeSegwitAccount.receiveAddresses(0, 1, Network.Mainnet)
  assert(address !== undefined, 'Fixture wallet must have an address')
  return address.toString()
}

/** A raw transaction spending the given outputs, or a coinbase, paying the given outputs. */
function rawTx(spends: Array<{ txid: string; vout: number }> | 'coinbase', outputs: Output[]): RawTx {
  const tx = new bitcoin.Transaction()
  tx.version = 2
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
        ? bitcoin.payments.embed({ data: [Buffer.from('statement')] }).output
        : bitcoin.address.toOutputScript(address, bitcoin.networks.bitcoin)
    assert(script !== undefined)
    tx.addOutput(script, value)
  }
  return { hex: tx.toHex(), txid: tx.getId() }
}

interface ElectrumSetup {
  source: ElectrumSource
  onchainProvider: ElectrumProvider
  /** The server's answer to each transaction request. */
  getTransaction: ReturnType<typeof vi.fn<(txid: string) => string | Error>>
  /** The block time for each header request. */
  getBlock: ReturnType<typeof vi.fn<(height: number) => Date | Error>>
}

/** An Electrum source whose server answers with the given raw transactions. */
function setup(transactions: RawTx[]): ElectrumSetup {
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  const getTransaction = vi.fn((txid: string): string | Error => {
    return transactions.find((tx) => tx.txid === txid)?.hex ?? new ElectrumServerError('No such transaction')
  })
  vi.spyOn(electrum, 'getTransaction').mockImplementation(
    asyncFn(async (txid: string) => {
      const answer = getTransaction(txid)
      return answer instanceof Error ? Err(answer) : Ok(answer)
    }),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  const getBlock = vi.fn((_height: number): Date | Error => new Date(blockTime * 1000))
  vi.spyOn(onchainProvider, 'getBlock').mockImplementation(
    asyncFn(async (at: number) => {
      const answer = getBlock(at)
      return answer instanceof Error ? Err(answer) : Ok({ height: at, hash: 'block', timestamp: answer })
    }),
  )
  return { source: new ElectrumSource(onchainProvider), onchainProvider, getTransaction, getBlock }
}

function running(): AbortSignal {
  return new AbortController().signal
}

it('reads the coins a transaction spends and the outputs it pays', async () => {
  const address = walletAddress()
  const tx = rawTx(
    [
      { txid: parent, vout: 1 },
      { txid: parent, vout: 0 },
    ],
    [
      { address, value: 90_000 },
      { address: null, value: 0 },
    ],
  )
  const { source } = setup([tx])

  const looked = (await source.lookup(tx.txid, height, running())).unwrap()

  expect(looked).toEqual({
    txid: tx.txid,
    blockHeight: height,
    blockTime,
    inputs: [
      { spends: { txid: parent, vout: 1 }, prevout: null },
      { spends: { txid: parent, vout: 0 }, prevout: null },
    ],
    // An OP_RETURN output has no address.
    outputs: [
      { address, value: 90_000 },
      { address: null, value: 0 },
    ],
  })
})

it('reads a coinbase input as spending nothing', async () => {
  const tx = rawTx('coinbase', [{ address: walletAddress(), value: 312_500_000 }])
  const { source } = setup([tx])

  const looked = (await source.lookup(tx.txid, height, running())).unwrap()

  expect(looked.inputs).toEqual([{ spends: null, prevout: null }])
})

it('rejects a transaction that does not hash to the txid it was asked for', async () => {
  const tx = rawTx('coinbase', [{ address: walletAddress(), value: 1 }])
  const { source } = setup([{ ...tx, txid: 'cd'.repeat(32) }])

  const failure = (await source.lookup('cd'.repeat(32), height, running())).expectErr('another transaction must fail')

  expect(failure.error.kind).toBe('invalid')
  expect(failure.retry).toBeNull()
})

it('rejects an answer that is not a transaction', async () => {
  const txid = 'cd'.repeat(32)
  const { source } = setup([{ txid, hex: 'not a transaction' }])

  const failure = (await source.lookup(txid, height, running())).expectErr('unreadable data must fail')

  expect(failure.error.kind).toBe('invalid')
  expect(failure.retry).toBeNull()
})

it('does not retry a transaction the server does not have', async () => {
  const { source } = setup([])

  const failure = (await source.lookup('cd'.repeat(32), height, running())).expectErr('a missing transaction must fail')

  expect(failure.error.kind).toBe('unavailable')
  expect(failure.retry).toBeNull()
})

it.each([
  { scenario: 'a dropped connection', error: new Error('Connection closed') },
  { scenario: 'a busy server', error: new ElectrumTimeoutError('Request timed out', false) },
])('makes every lookup wait after $scenario', async ({ error }) => {
  const txid = 'cd'.repeat(32)
  const { source, getTransaction } = setup([])
  getTransaction.mockReturnValue(error)

  const failure = (await source.lookup(txid, height, running())).expectErr('the attempt must fail')

  expect(failure.error.kind).toBe('unreachable')
  expect(failure.retry).toEqual({ kind: 'connection', retryAfterMs: null })
})

it('asks for each block header once', async () => {
  const address = walletAddress()
  const first = rawTx('coinbase', [{ address, value: 1 }])
  const second = rawTx([{ txid: first.txid, vout: 0 }], [{ address, value: 1 }])
  const { source, getBlock } = setup([first, second])

  await Promise.all([source.lookup(first.txid, height, running()), source.lookup(second.txid, height, running())])

  expect(getBlock).toHaveBeenCalledTimes(1)
})

it('asks again for a block header that failed', async () => {
  const tx = rawTx('coinbase', [{ address: walletAddress(), value: 1 }])
  const { source, getBlock } = setup([tx])
  getBlock.mockReturnValueOnce(new Error('Connection closed'))

  const failure = (await source.lookup(tx.txid, height, running())).expectErr('a failed header must fail the attempt')
  const retried = await source.lookup(tx.txid, height, running())

  expect(failure.retry).toEqual({ kind: 'connection', retryAfterMs: null })
  expect(retried.isOk()).toBe(true)
  expect(getBlock).toHaveBeenCalledTimes(2)
})

it('sends no header request once the statement has stopped', async () => {
  const tx = rawTx('coinbase', [{ address: walletAddress(), value: 1 }])
  const { source, getBlock } = setup([tx])
  const stop = new AbortController()
  stop.abort()

  const result = await source.lookup(tx.txid, height, stop.signal)

  expect(result.isErr()).toBe(true)
  expect(getBlock).not.toHaveBeenCalled()
})

it('uses the Electrum server chosen in Settings after the source was made', async () => {
  const tx = rawTx('coinbase', [{ address: walletAddress(), value: 1 }])
  const { source, onchainProvider } = setup([])
  const replacement = new ElectrumClient({ host: 'replacement.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(replacement, 'getTransaction').mockImplementation(asyncFn(async () => Ok(tx.hex)))
  onchainProvider.deps.electrum = replacement

  expect((await source.lookup(tx.txid, height, running())).isOk()).toBe(true)
})
