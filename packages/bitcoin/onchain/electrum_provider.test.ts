import { Err, Ok } from '@hoseki/packages/result'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ElectrumClient } from '../../clients/electrum'
import type { HeaderNotification, ScripthashBalance, ScripthashHistoryEntry } from '../../clients/electrum'
import { IndexMap, IndexSet } from '../../collection'
import { Wallets } from '../../testing'
import type { Address } from '../address'
import { bitcoin } from '../lib'
import { Network } from '../network'
import { addressToScripthash } from '../scripthash'
import { ElectrumProvider } from './electrum_provider'
import type { TransactionEntry } from './types'

type RawTransaction = { txid: string; hex: string }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockElectrumClient(overrides: Partial<ElectrumClient> = {}): ElectrumClient {
  return Object.assign(new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' }), {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    serverVersion: vi.fn(),
    headersSubscribe: vi.fn(),
    getBlockHeader: vi.fn(),
    getBalance: vi.fn(),
    getHistory: vi.fn(),
    listUnspent: vi.fn(),
    getTransaction: vi.fn(),
    ...overrides,
  })
}

const mockLogger = pino({ level: 'silent' })

// A real mainnet block header hex (block 0 - genesis block)
const GENESIS_HEADER_HEX =
  '0100000000000000000000000000000000000000000000000000000000000000000000003ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a29ab5f49ffff001d1dac2b7c'
const TX_BLOCK_TIME = 1_700_000_000
const TX_BLOCK_HEADER_HEX = blockHeaderHexWithTimestamp(TX_BLOCK_TIME)

function blockHeaderHexWithTimestamp(timestamp: number): string {
  const header = Buffer.alloc(80)
  header.writeUInt32LE(timestamp, 68)
  return header.toString('hex')
}

function createRawTx(args: {
  inputs?: Array<{ txid: string; vout: number }>
  outputs: Array<{ address: Address; value: number }>
}): RawTransaction {
  const tx = new bitcoin.Transaction()
  tx.version = 2

  const inputs = args.inputs ?? []
  if (inputs.length === 0) {
    tx.addInput(Buffer.alloc(32), 0xffffffff)
  } else {
    for (const input of inputs) {
      tx.addInput(Buffer.from(input.txid, 'hex').reverse(), input.vout)
    }
  }

  for (const output of args.outputs) {
    tx.addOutput(bitcoin.address.toOutputScript(output.address.toString(), bitcoin.networks.bitcoin), output.value)
  }

  return { txid: tx.getId(), hex: tx.toHex() }
}

// ─── addressToScripthash ──────────────────────────────────────────────────────

describe('addressToScripthash', () => {
  it('should compute correct scripthash for a legacy address', () => {
    // Satoshi's address: 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa
    const address = Wallets.satoshiAddress
    const result = addressToScripthash(address)
    expect(result.isOk()).toBe(true)
    const scripthash = result.unwrap()
    // Known scripthash for this address
    expect(scripthash).toMatch(/^[a-f0-9]{64}$/)
    expect(scripthash).toHaveLength(64)
  })

  it('should compute scripthash for all address types', () => {
    for (const address of Wallets.allAddressTypes) {
      const result = addressToScripthash(address)
      expect(result.isOk()).toBe(true)
      const scripthash = result.unwrap()
      expect(scripthash).toMatch(/^[a-f0-9]{64}$/)
    }
  })

  it('should produce different scripthashes for different addresses', () => {
    const hashes = new Set<string>()
    for (const address of Wallets.allAddressTypes) {
      const result = addressToScripthash(address)
      expect(result.isOk()).toBe(true)
      hashes.add(result.unwrap())
    }
    expect(hashes.size).toBe(Wallets.allAddressTypes.length)
  })
})

// ─── ElectrumProvider.getBlocksTip ────────────────────────────────────────────

describe('ElectrumProvider', () => {
  describe('getBlocksTip', () => {
    it('reads a historical block anchor for history-scan verification', async () => {
      const getBlockHeader = vi.fn().mockReturnValue(Ok(GENESIS_HEADER_HEX))
      const client = mockElectrumClient({ getBlockHeader })
      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const block = (await provider.getBlock(0)).unwrap()
      expect(getBlockHeader).toHaveBeenCalledWith(0)
      expect(block.height).toBe(0)
      expect(block.hash).toBe('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
    })

    it('propagates failures when reading a historical anchor', async () => {
      const failure = new Error('Header unavailable')
      const client = mockElectrumClient({ getBlockHeader: vi.fn().mockReturnValue(Err(failure)) })
      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      expect((await provider.getBlock(0)).unwrapErr()).toBe(failure)
    })

    it('should parse block header and return tip info', async () => {
      const headerNotification: HeaderNotification = {
        height: 0,
        hex: GENESIS_HEADER_HEX,
      }

      const client = mockElectrumClient({
        headersSubscribe: vi.fn().mockReturnValue(Ok(headerNotification)),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const result = await provider.getBlocksTip()

      expect(result.isOk()).toBe(true)
      const block = result.unwrap()
      expect(block.height).toBe(0)
      expect(block.hash).toMatch(/^[a-f0-9]{64}$/)
      // Genesis block hash
      expect(block.hash).toBe('000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f')
      expect(block.timestamp).toBeInstanceOf(Date)
    })
  })

  describe('areAddressesUsed', () => {
    it('should return addresses that have transaction history', async () => {
      const usedAddress = Wallets.legacyAddress
      const unusedAddress = Wallets.segwitAddress

      const client = mockElectrumClient({
        getHistory: vi.fn().mockImplementation((scripthash: string) => {
          const usedScripthash = addressToScripthash(usedAddress).unwrap()
          if (scripthash === usedScripthash) {
            return Ok([{ tx_hash: 'abc'.padEnd(64, '0'), height: 100 }] satisfies ScripthashHistoryEntry[])
          }
          return Ok(Array<ScripthashHistoryEntry>())
        }),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexSet([usedAddress, unusedAddress])
      const result = await provider.areAddressesUsed(addresses)

      expect(result.isOk()).toBe(true)
      const used = result.unwrap()
      expect(used.size).toBe(1)
      expect(used.has(usedAddress)).toBe(true)
      expect(used.has(unusedAddress)).toBe(false)
    })

    it('should return empty set when no addresses are used', async () => {
      const client = mockElectrumClient({
        getHistory: vi.fn().mockReturnValue(Ok([])),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexSet([Wallets.legacyAddress])
      const result = await provider.areAddressesUsed(addresses)

      expect(result.isOk()).toBe(true)
      expect(result.unwrap().size).toBe(0)
    })
  })

  describe('getConfirmedAddressBalances', () => {
    it('should return balances for addresses', async () => {
      const address = Wallets.segwitAddress

      const client = mockElectrumClient({
        getBalance: vi
          .fn()
          .mockReturnValue(Ok({ confirmed: 150_000, unconfirmed: 10_000 } satisfies ScripthashBalance)),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexSet([address])
      const result = await provider.getConfirmedAddressBalances(addresses)

      expect(result.isOk()).toBe(true)
      const balances = result.unwrap()
      expect(balances.get(address)).toBe(150_000n) // Only confirmed, not unconfirmed
    })

    it('should handle zero balances', async () => {
      const address = Wallets.legacyAddress

      const client = mockElectrumClient({
        getBalance: vi.fn().mockReturnValue(Ok({ confirmed: 0, unconfirmed: 0 } satisfies ScripthashBalance)),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const result = await provider.getConfirmedAddressBalances(new IndexSet([address]))

      expect(result.isOk()).toBe(true)
      expect(result.unwrap().get(address)).toBe(0n)
    })
  })

  describe('getTransactionEntries', () => {
    it('returns an error instead of certifying partial history when one address fails', async () => {
      const failure = new Error('Electrum history unavailable')
      const getTransaction = vi.fn()
      const client = mockElectrumClient({
        getTransaction,
        headersSubscribe: vi.fn().mockReturnValue(Ok({ height: 800_000, hex: GENESIS_HEADER_HEX })),
        getHistory: vi
          .fn()
          .mockReturnValueOnce(Ok([{ tx_hash: '1'.repeat(64), height: 700_000 }]))
          .mockReturnValueOnce(Err(failure)),
      })
      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const results = []
      for await (const result of provider.getTransactionEntries(
        new IndexMap<Address, number | null>([
          [Wallets.legacyAddress, null],
          [Wallets.segwitAddress, null],
        ]),
      )) {
        results.push(result)
      }
      expect(results).toHaveLength(1)
      expect(results[0]?.unwrapErr()).toBe(failure)
      expect(getTransaction).not.toHaveBeenCalled()
    })

    it('should return transaction entries for addresses', async () => {
      const address = Wallets.segwitAddress
      const externalFundingTx = createRawTx({ outputs: [{ address: Wallets.legacyAddress, value: 100_000 }] })
      const tx = createRawTx({
        inputs: [{ txid: externalFundingTx.txid, vout: 0 }],
        outputs: [
          { address, value: 90_000 },
          { address: Wallets.legacyAddress, value: 9_000 },
        ],
      })

      const headerNotification: HeaderNotification = { height: 800_000, hex: GENESIS_HEADER_HEX }

      const client = mockElectrumClient({
        headersSubscribe: vi.fn().mockReturnValue(Ok(headerNotification)),
        getBlockHeader: vi.fn().mockReturnValue(Ok(TX_BLOCK_HEADER_HEX)),
        getHistory: vi.fn().mockReturnValue(Ok([{ tx_hash: tx.txid, height: 799_991 }])),
        getTransaction: vi.fn().mockImplementation((txHash: string) => {
          if (txHash === tx.txid) {
            return Ok(tx.hex)
          }
          if (txHash === externalFundingTx.txid) {
            return Ok(externalFundingTx.hex)
          }
          return Err(new Error(`unexpected tx ${txHash}`))
        }),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexMap<Address, number | null>([[address, null]])
      const entries: TransactionEntry[] = []

      for await (const entry of provider.getTransactionEntries(addresses)) {
        expect(entry.isOk()).toBe(true)
        entries.push(entry.unwrap())
      }

      expect(entries).toHaveLength(1)
      expect(entries[0].txid.toString()).toBe(tx.txid)
      expect(entries[0].address.toString()).toBe(address.toString())
      expect(entries[0].value).toBe(90_000n) // Received 90,000 sats
      expect(entries[0].confirmed).toBe(true)
      expect(entries[0].timestamp).toEqual(new Date(TX_BLOCK_TIME * 1000))
    })

    it('should handle spending transactions (negative value)', async () => {
      const address = Wallets.segwitAddress
      const fundingTx = createRawTx({ outputs: [{ address, value: 100_000 }] })
      const tx = createRawTx({
        inputs: [{ txid: fundingTx.txid, vout: 0 }],
        outputs: [
          { address: Wallets.legacyAddress, value: 50_000 },
          { address, value: 49_000 },
        ],
      })

      const headerNotification: HeaderNotification = { height: 800_000, hex: GENESIS_HEADER_HEX }

      const client = mockElectrumClient({
        headersSubscribe: vi.fn().mockReturnValue(Ok(headerNotification)),
        getBlockHeader: vi.fn().mockReturnValue(Ok(TX_BLOCK_HEADER_HEX)),
        getHistory: vi.fn().mockReturnValue(Ok([{ tx_hash: tx.txid, height: 799_981 }])),
        getTransaction: vi.fn().mockImplementation((txHash: string) => {
          if (txHash === tx.txid) {
            return Ok(tx.hex)
          }
          if (txHash === fundingTx.txid) {
            return Ok(fundingTx.hex)
          }
          return Err(new Error(`unexpected tx ${txHash}`))
        }),
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexMap<Address, number | null>([[address, null]])
      const entries: TransactionEntry[] = []

      for await (const entry of provider.getTransactionEntries(addresses)) {
        entries.push(entry.unwrap())
      }

      expect(entries).toHaveLength(1)
      // -100,000 (spent) + 49,000 (change) = -51,000
      expect(entries[0].value).toBe(-51_000n)
    })

    it('should include all wallet address entries for a transaction seen on multiple addresses', async () => {
      const receiveAddress = Wallets.singlesigNativeSegwitAccount.receiveAddress(0)
      const changeAddress = Wallets.singlesigNativeSegwitAccount.changeAddress(0)
      const fundingTx = createRawTx({ outputs: [{ address: receiveAddress, value: 100_000 }] })
      const tx = createRawTx({
        inputs: [{ txid: fundingTx.txid, vout: 0 }],
        outputs: [
          { address: Wallets.legacyAddress, value: 50_000 },
          { address: changeAddress, value: 49_000 },
        ],
      })

      const receiveScripthash = addressToScripthash(receiveAddress).unwrap()
      const changeScripthash = addressToScripthash(changeAddress).unwrap()
      const headerNotification: HeaderNotification = { height: 800_000, hex: GENESIS_HEADER_HEX }

      const getTransaction = vi.fn().mockImplementation((txHash: string) => {
        if (txHash === tx.txid) {
          return Ok(tx.hex)
        }
        if (txHash === fundingTx.txid) {
          return Ok(fundingTx.hex)
        }
        return Err(new Error(`unexpected tx ${txHash}`))
      })
      const client = mockElectrumClient({
        headersSubscribe: vi.fn().mockReturnValue(Ok(headerNotification)),
        getBlockHeader: vi.fn().mockReturnValue(Ok(TX_BLOCK_HEADER_HEX)),
        getHistory: vi.fn().mockImplementation((scripthash: string) => {
          if (scripthash === receiveScripthash || scripthash === changeScripthash) {
            return Ok([{ tx_hash: tx.txid, height: 799_981 }])
          }
          return Ok([])
        }),
        getTransaction,
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexMap<Address, number | null>([
        [receiveAddress, null],
        [changeAddress, null],
      ])
      const entries: TransactionEntry[] = []

      for await (const entry of provider.getTransactionEntries(addresses)) {
        entries.push(entry.unwrap())
      }

      expect(getTransaction).toHaveBeenCalledTimes(2)
      expect(entries).toHaveLength(2)
      expect(entries.reduce((sum, entry) => sum + entry.value, 0n)).toBe(-51_000n)
      expect(entries.find((entry) => entry.address.toString() === receiveAddress.toString())?.value).toBe(-100_000n)
      expect(entries.find((entry) => entry.address.toString() === changeAddress.toString())?.value).toBe(49_000n)
    })

    it('should stop with an error when raw transaction fetch fails', async () => {
      const address = Wallets.segwitAddress
      const txid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const headerNotification: HeaderNotification = { height: 800_000, hex: GENESIS_HEADER_HEX }

      const getTransaction = vi.fn().mockReturnValue(Err(new Error('timeout')))
      const client = mockElectrumClient({
        headersSubscribe: vi.fn().mockReturnValue(Ok(headerNotification)),
        getHistory: vi.fn().mockReturnValue(Ok([{ tx_hash: txid, height: 799_990 }])),
        getTransaction,
      })

      const provider = new ElectrumProvider(Network.Mainnet, { logger: mockLogger, electrum: client })
      const addresses = new IndexMap<Address, number | null>([[address, null]])
      const gen = provider.getTransactionEntries(addresses)

      const first = await gen.next()
      expect(first.done).toBe(false)
      expect(first.value?.isErr()).toBe(true)
      expect(getTransaction).toHaveBeenCalledTimes(1)

      const second = await gen.next()
      expect(second.done).toBe(true)
    })
  })
})
