import { type AsyncResult, Err, Ok, type Result, asyncFn, tryBlockAsync } from '@hoseki/packages/result'
import { sha256 } from '@noble/hashes/sha2.js'
import type { ElectrumClient, ScripthashHistoryEntry } from '../../clients/electrum'
import { IndexMap, IndexSet } from '../../collection'
import type { Account } from '../account'
import type { Address } from '../address'
import { bitcoin } from '../lib'
import type { Network } from '../network'
import { addressToScripthash } from '../scripthash'
import { Txid } from '../txid'
import { OnchainBitcoinProvider, type OnchainBitcoinProviderDeps } from './provider'
import { type Block, type TransactionEntry, isConfirmed } from './types'

/** Max concurrent Electrum requests per batch to avoid overwhelming the server. */
const BATCH_SIZE = 10

export interface ElectrumProviderDeps extends OnchainBitcoinProviderDeps {
  electrum: ElectrumClient
}

/**
 * OnchainBitcoinProvider implementation that connects to an Electrum-compatible server
 * (Electrs or Fulcrum) for local/self-hosted Bitcoin data.
 *
 * No data leaves the local network - addresses are queried via their scripthash,
 * and all derivation happens locally.
 */
export class ElectrumProvider extends OnchainBitcoinProvider {
  public override readonly deps: ElectrumProviderDeps

  public constructor(network: Network, deps: ElectrumProviderDeps) {
    super(network, deps)
    this.deps = deps
  }

  public getBlocksTip(): AsyncResult<Block, Error> {
    return tryBlockAsync(
      async function* (this: ElectrumProvider) {
        const header = yield* this.deps.electrum.headersSubscribe().try()
        return parseBlockHeader(header.height, header.hex)
      }.bind(this),
    )
  }

  public getBlock(height: number): AsyncResult<Block, Error> {
    return tryBlockAsync(
      async function* (this: ElectrumProvider) {
        const header = yield* this.deps.electrum.getBlockHeader(height).try()
        return parseBlockHeader(height, header)
      }.bind(this),
    )
  }

  public areAddressesUsed = asyncFn(async (addresses: IndexSet<Address>): Promise<Result<IndexSet<Address>, Error>> => {
    this.deps.logger.debug({ total: addresses.size }, 'Checking if addresses are used via Electrum')

    const used = new IndexSet<Address>()
    const addressArray = [...addresses]

    // Batch parallel requests to avoid overwhelming the server
    for (let i = 0; i < addressArray.length; i += BATCH_SIZE) {
      const batch = addressArray.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(
        batch.map(async (address) => {
          const scripthash = addressToScripthash(address)
          if (scripthash.isErr()) {
            return { address, err: scripthash.unwrapErr() } as const
          }
          const history = await this.deps.electrum.getHistory(scripthash.unwrap())
          if (history.isErr()) {
            return { address, err: history.unwrapErr() } as const
          }
          return { address, used: history.unwrap().length > 0 } as const
        }),
      )
      for (const r of results) {
        if ('err' in r) {
          return Err(r.err ?? new Error('Electrum history request failed'))
        }
        if (r.used) {
          used.add(r.address)
        }
      }
    }

    this.deps.logger.info({ total: addresses.size, used: used.size }, 'Completed used address check via Electrum')
    return Ok(used)
  })

  public getConfirmedAddressBalances = asyncFn(
    async (addresses: IndexSet<Address>): Promise<Result<IndexMap<Address, bigint>, Error>> => {
      this.deps.logger.debug({ total: addresses.size }, 'Getting confirmed address balances via Electrum')

      const balances = new IndexMap<Address, bigint>()
      const addressArray = [...addresses]

      for (let i = 0; i < addressArray.length; i += BATCH_SIZE) {
        const batch = addressArray.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(async (address) => {
            const scripthash = addressToScripthash(address)
            if (scripthash.isErr()) {
              return { address, err: scripthash.unwrapErr() } as const
            }
            const balanceRes = await this.deps.electrum.getBalance(scripthash.unwrap())
            if (balanceRes.isErr()) {
              return { address, err: balanceRes.unwrapErr() } as const
            }
            return { address, balance: BigInt(balanceRes.unwrap().confirmed) } as const
          }),
        )
        for (const r of results) {
          if ('err' in r) {
            return Err(r.err ?? new Error('Electrum balance request failed'))
          }
          balances.set(r.address, r.balance)
        }
      }

      this.deps.logger.info(
        { total: addresses.size, withBalance: balances.size },
        'Completed getting confirmed address balances via Electrum',
      )
      return Ok(balances)
    },
  )

  /**
   * Get balance accumulation entries by using UTXOs (listunspent) instead of verbose transactions.
   * This avoids the slow/unsupported verbose tx endpoint on public Electrs servers.
   * Each UTXO provides: value (sats) and block height. Timestamps are estimated from block heights.
   */
  public getUtxoAccumulationEntries = asyncFn(
    async (
      account: Account,
    ): Promise<Result<Array<{ value: bigint; height: number; estimatedTimestamp: Date }>, Error>> => {
      this.deps.logger.debug('Getting UTXO accumulation entries')

      const discoveryResult = await this.discoverAccount(account)
      if (discoveryResult.isErr()) {
        return Err(discoveryResult.unwrapErr())
      }
      const { lastUsedReceiveIndex, lastUsedChangeIndex } = discoveryResult.unwrap()

      // Get current block tip for timestamp estimation
      const blocksTipRes = await this.getBlocksTip()
      if (blocksTipRes.isErr()) {
        return Err(blocksTipRes.unwrapErr())
      }
      const tip = blocksTipRes.unwrap()

      const entries: Array<{ value: bigint; height: number; estimatedTimestamp: Date }> = []
      const seenTxids = new Set<string>()

      // Collect all discovered addresses
      const allAddresses = [
        ...account.receiveAddresses(0, lastUsedReceiveIndex + 1, this.network),
        ...account.changeAddresses(0, lastUsedChangeIndex + 1, this.network),
      ]

      for (let i = 0; i < allAddresses.length; i += BATCH_SIZE) {
        const batch = allAddresses.slice(i, i + BATCH_SIZE)
        const results = await Promise.all(
          batch.map(async (address) => {
            const scripthashRes = addressToScripthash(address)
            if (scripthashRes.isErr()) {
              return []
            }
            const unspentRes = await this.deps.electrum.listUnspent(scripthashRes.unwrap())
            if (unspentRes.isErr()) {
              this.deps.logger.warn({ address, err: unspentRes.unwrapErr() }, 'Failed to list unspent, skipping')
              return []
            }
            return unspentRes.unwrap()
          }),
        )

        for (const utxos of results) {
          for (const utxo of utxos) {
            const key = `${utxo.tx_hash}:${utxo.tx_pos}`
            if (seenTxids.has(key)) {
              continue
            }
            seenTxids.add(key)

            if (utxo.height <= 0) {
              continue
            } // skip unconfirmed

            // Estimate timestamp: ~10 minutes per block from tip
            const blocksBehind = tip.height - utxo.height
            const estimatedTimestamp = new Date(tip.timestamp.getTime() - blocksBehind * 10 * 60 * 1000)

            entries.push({
              value: BigInt(utxo.value),
              height: utxo.height,
              estimatedTimestamp,
            })
          }
        }
      }

      entries.sort((a, b) => a.height - b.height)
      this.deps.logger.info({ count: entries.length }, 'Got UTXO accumulation entries')
      return Ok(entries)
    },
  )

  public async *getTransactionEntries(
    addresses: IndexMap<Address, number | null>,
  ): AsyncGenerator<Result<TransactionEntry, Error>, void> {
    this.deps.logger.debug({ total: addresses.size }, 'Getting transaction entries via Electrum')

    // Get the current tip for confirmation status
    const blocksTipRes = await this.getBlocksTip()
    if (blocksTipRes.isErr()) {
      yield Err(blocksTipRes.unwrapErr())
      return
    }
    const blocksTip = blocksTipRes.unwrap()

    const rawTxCache = new Map<string, Result<bitcoin.Transaction, Error>>()
    const blockTimestampCache = new Map<number, Result<Date, Error>>()
    const walletScriptAddresses = new Map<string, Address>()
    const txAddresses = new Map<string, Array<{ address: Address; historyEntry: ScripthashHistoryEntry }>>()

    for (const [address, stopBeforeBlockHeight] of addresses) {
      const outputScriptRes = addressToOutputScriptHex(address)
      if (outputScriptRes.isErr()) {
        yield Err(outputScriptRes.unwrapErr())
        return
      }
      walletScriptAddresses.set(outputScriptRes.unwrap(), address)

      const scripthashRes = addressToScripthash(address)
      if (scripthashRes.isErr()) {
        yield Err(scripthashRes.unwrapErr())
        return
      }
      const scripthash = scripthashRes.unwrap()

      // Get transaction history for this address
      const historyRes = await this.deps.electrum.getHistory(scripthash)
      if (historyRes.isErr()) {
        yield Err(historyRes.unwrapErr())
        return
      }
      const history = historyRes.unwrap()

      for (const entry of history) {
        // Skip if this tx is at or below the stop height
        if (stopBeforeBlockHeight !== null && entry.height > 0 && entry.height <= stopBeforeBlockHeight) {
          continue
        }

        const relatedAddresses = txAddresses.get(entry.tx_hash) ?? []
        relatedAddresses.push({ address, historyEntry: entry })
        txAddresses.set(entry.tx_hash, relatedAddresses)
      }
    }

    for (const [txHash, relatedAddresses] of txAddresses) {
      const txRes = await this.getRawTransaction(txHash, rawTxCache)
      if (txRes.isErr()) {
        const err = txRes.unwrapErr()
        this.deps.logger.warn({ txHash, err }, 'Failed to fetch raw tx')
        yield Err(err)
        return
      }

      const tx = txRes.unwrap()
      const entriesResult = await this.transactionEntriesFromRawTx({
        txHash,
        tx,
        relatedAddresses,
        walletScriptAddresses,
        rawTxCache,
        blockTimestampCache,
        blocksTipHeight: blocksTip.height,
      })
      if (entriesResult.isErr()) {
        const err = entriesResult.unwrapErr()
        this.deps.logger.warn({ txHash, err }, 'Failed to parse raw tx entries')
        yield Err(err)
        return
      }

      for (const txEntry of entriesResult.unwrap()) {
        yield Ok(txEntry)
      }
    }
  }

  private async getRawTransaction(
    txHash: string,
    cache: Map<string, Result<bitcoin.Transaction, Error>>,
  ): Promise<Result<bitcoin.Transaction, Error>> {
    const cached = cache.get(txHash)
    if (cached !== undefined) {
      return cached
    }

    const rawTxResult = await this.deps.electrum.getTransaction(txHash)
    if (rawTxResult.isErr()) {
      const result = Err(rawTxResult.unwrapErr())
      cache.set(txHash, result)
      return result
    }

    try {
      const result = Ok(bitcoin.Transaction.fromHex(rawTxResult.unwrap()))
      cache.set(txHash, result)
      return result
    } catch (err) {
      const result = Err(err instanceof Error ? err : new Error(String(err)))
      cache.set(txHash, result)
      return result
    }
  }

  private async getBlockTimestamp(
    blockHeight: number | null,
    cache: Map<number, Result<Date, Error>>,
  ): Promise<Result<Date, Error>> {
    if (blockHeight === null) {
      return Ok(new Date())
    }

    const cached = cache.get(blockHeight)
    if (cached !== undefined) {
      return cached
    }

    const headerResult = await this.deps.electrum.getBlockHeader(blockHeight)
    if (headerResult.isErr()) {
      const result = Err(headerResult.unwrapErr())
      cache.set(blockHeight, result)
      return result
    }

    const result = parseBlockHeader(blockHeight, headerResult.unwrap()).map((block) => block.timestamp)
    cache.set(blockHeight, result)
    return result
  }

  private async transactionEntriesFromRawTx(args: {
    txHash: string
    tx: bitcoin.Transaction
    relatedAddresses: Array<{ address: Address; historyEntry: ScripthashHistoryEntry }>
    walletScriptAddresses: Map<string, Address>
    rawTxCache: Map<string, Result<bitcoin.Transaction, Error>>
    blockTimestampCache: Map<number, Result<Date, Error>>
    blocksTipHeight: number
  }): Promise<Result<TransactionEntry[], Error>> {
    const txidRes = Txid.fromString(args.txHash)
    if (txidRes.isErr()) {
      return Err(txidRes.unwrapErr())
    }

    const relatedAddressKeys = new Set(args.relatedAddresses.map(({ address }) => address.key()))
    const valuesByAddressKey = new Map<string, bigint>()
    for (const { address } of args.relatedAddresses) {
      valuesByAddressKey.set(address.key(), 0n)
    }

    for (const output of args.tx.outs) {
      const walletAddress = args.walletScriptAddresses.get(bytesToHex(output.script))
      if (walletAddress === undefined || !relatedAddressKeys.has(walletAddress.key())) {
        continue
      }
      valuesByAddressKey.set(
        walletAddress.key(),
        (valuesByAddressKey.get(walletAddress.key()) ?? 0n) + BigInt(output.value),
      )
    }

    for (const input of args.tx.ins) {
      if (isCoinbaseInput(input)) {
        continue
      }

      const previousTxHash = previousTxidFromInputHash(input.hash)
      const previousTxResult = await this.getRawTransaction(previousTxHash, args.rawTxCache)
      if (previousTxResult.isErr()) {
        return Err(previousTxResult.unwrapErr())
      }

      const previousOutput = previousTxResult.unwrap().outs[input.index]
      if (previousOutput === undefined) {
        return Err(new Error(`Missing previous output ${previousTxHash}:${input.index}`))
      }

      const walletAddress = args.walletScriptAddresses.get(bytesToHex(previousOutput.script))
      if (walletAddress === undefined || !relatedAddressKeys.has(walletAddress.key())) {
        continue
      }
      valuesByAddressKey.set(
        walletAddress.key(),
        (valuesByAddressKey.get(walletAddress.key()) ?? 0n) - BigInt(previousOutput.value),
      )
    }

    const historyEntry = args.relatedAddresses[0]?.historyEntry
    const blockHeight = historyEntry && historyEntry.height > 0 ? historyEntry.height : null
    const timestampResult = await this.getBlockTimestamp(blockHeight, args.blockTimestampCache)
    if (timestampResult.isErr()) {
      return Err(timestampResult.unwrapErr())
    }

    return Ok(
      args.relatedAddresses.map(({ address }) => ({
        txid: txidRes.unwrap(),
        address,
        value: valuesByAddressKey.get(address.key()) ?? 0n,
        timestamp: timestampResult.unwrap(),
        confirmed: isConfirmed({ tip: args.blocksTipHeight, height: blockHeight }),
        blockHeight,
      })),
    )
  }
}

function toBitcoinjsNetwork(network: Network): typeof bitcoin.networks.bitcoin {
  switch (network.kind) {
    case 'Mainnet':
      return bitcoin.networks.bitcoin
    case 'Testnet':
      return bitcoin.networks.testnet
    case 'Regtest':
      return bitcoin.networks.regtest
  }
}

function addressToOutputScriptHex(address: Address): Result<string, Error> {
  try {
    return Ok(bytesToHex(bitcoin.address.toOutputScript(address.toString(), toBitcoinjsNetwork(address.network()))))
  } catch (err) {
    return Err(err instanceof Error ? err : new Error(String(err)))
  }
}

function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function previousTxidFromInputHash(hash: ArrayLike<number>): string {
  return bytesToHex(Array.from(hash).reverse())
}

function isCoinbaseInput(input: bitcoin.TxInput): boolean {
  return input.index === 0xffffffff && Array.from(input.hash).every((byte) => byte === 0)
}

function parseBlockHeader(height: number, hex: string): Result<Block, Error> {
  try {
    const headerBuf = Buffer.from(hex, 'hex')
    if (headerBuf.length < 80) {
      return Err(new Error(`Invalid block header length: ${headerBuf.length}`))
    }

    // Parse the block header hex to extract the hash and timestamp.
    const inner = sha256(new Uint8Array(headerBuf))
    const hash = sha256(inner)
    hash.reverse()

    const view = new DataView(headerBuf.buffer, headerBuf.byteOffset, headerBuf.byteLength)
    const timestamp = view.getUint32(68, true)

    return Ok({
      height,
      hash: Buffer.from(hash).toString('hex'),
      timestamp: new Date(timestamp * 1000),
    })
  } catch (err) {
    return Err(err instanceof Error ? err : new Error(String(err)))
  }
}
