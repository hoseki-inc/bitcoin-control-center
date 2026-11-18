import { bitcoin } from '@hoseki/packages/bitcoin/lib'
import type { Network } from '@hoseki/packages/bitcoin/network'
import type { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { ElectrumServerError } from '@hoseki/packages/clients/electrum/lib/protocol'
import { Err, Ok } from '@hoseki/packages/result'
import type { Result } from '@hoseki/packages/result'
import { type LookedUpTx, type LookupFailure, TransactionLoadError, type TxSource } from './types'

/**
 * Lookups in flight on the one Electrum connection. They hide round trips, which matters most over
 * Tor: 85 lookups took 13 s at 8 and 6 s at 16. Electrs answers a connection's requests in order and
 * times each from when it was sent, so more could time out on a slow home node.
 */
const TX_CONCURRENCY = 16

/** Longer than mempool's, so a dropped connection, possibly over Tor, has time to come back. */
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

function toBitcoinjsNetwork(network: Network): bitcoin.Network {
  switch (network.kind) {
    case 'Mainnet':
      return bitcoin.networks.bitcoin
    case 'Testnet':
      return bitcoin.networks.testnet
    case 'Regtest':
      return bitcoin.networks.regtest
  }
}

function bytesToHex(bytes: ArrayLike<number>): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function isCoinbaseInput(input: bitcoin.TxInput): boolean {
  return input.index === 0xffffffff && Array.from(input.hash).every((byte) => byte === 0)
}

/**
 * A server's error answer, such as an unknown transaction, is final. Anything else, such as a
 * timeout or a dropped connection, affects every lookup on the connection, so they all wait.
 */
function failure(error: Error, message: string): LookupFailure {
  if (error instanceof ElectrumServerError) {
    return { error: new TransactionLoadError('unavailable', message, { cause: error }), retry: null }
  }
  return {
    error: new TransactionLoadError('unreachable', message, { cause: error }),
    retry: { kind: 'connection', retryAfterMs: null },
  }
}

/**
 * Transaction details from the connected Electrum server: the raw transaction and its block's
 * header. Spent amounts aren't fetched; they're read from the wallet's own transactions.
 *
 * Make one per statement: block times are remembered for as long as the source lives.
 */
export class ElectrumSource implements TxSource {
  public readonly kind = 'electrum'
  public readonly concurrency = TX_CONCURRENCY
  public readonly retryDelaysMs = RETRY_DELAYS_MS
  private readonly onchainProvider: ElectrumProvider
  private readonly network: bitcoin.Network
  /** Block times by height, so transactions in the same block share one header request. */
  private readonly blockTimes = new Map<number, Promise<Result<number, Error>>>()

  public constructor(onchainProvider: ElectrumProvider) {
    this.onchainProvider = onchainProvider
    this.network = toBitcoinjsNetwork(onchainProvider.network)
  }

  public async lookup(txid: string, height: number, signal: AbortSignal): Promise<Result<LookedUpTx, LookupFailure>> {
    // Read the client on each lookup, so a server changed in Settings is used from then on.
    const raw = await this.onchainProvider.deps.electrum.getTransaction(txid)
    if (raw.isErr()) {
      return Err(failure(raw.unwrapErr(), `Failed to fetch transaction ${txid}`))
    }

    let tx: bitcoin.Transaction
    try {
      tx = bitcoin.Transaction.fromHex(raw.unwrap())
    } catch (cause) {
      return Err({ error: new TransactionLoadError('invalid', `Invalid transaction ${txid}`, { cause }), retry: null })
    }
    // The raw bytes hash to the txid, which proves the server sent exactly this transaction.
    if (tx.getId() !== txid) {
      return Err({ error: new TransactionLoadError('invalid', `Transaction data does not match ${txid}`), retry: null })
    }

    // Another lookup has failed; don't send a header request for a statement that has stopped.
    if (signal.aborted) {
      return Err({ error: new TransactionLoadError('unreachable', 'Lookups stopped'), retry: null })
    }
    const blockTime = await this.blockTime(height)
    if (blockTime.isErr()) {
      return Err(failure(blockTime.unwrapErr(), `Failed to fetch the block header at ${height}`))
    }

    return Ok({
      txid,
      blockHeight: height,
      blockTime: blockTime.unwrap(),
      inputs: tx.ins.map((input) => ({
        spends: isCoinbaseInput(input)
          ? null
          : { txid: bytesToHex(Array.from(input.hash).reverse()), vout: input.index },
        prevout: null,
      })),
      outputs: tx.outs.map((output) => ({ address: this.addressOf(output.script), value: output.value })),
    })
  }

  /** The output's address; scripts without one, such as OP_RETURN, have none. */
  private addressOf(script: Buffer): string | null {
    try {
      return bitcoin.address.fromOutputScript(script, this.network)
    } catch {
      return null
    }
  }

  private async blockTime(height: number): Promise<Result<number, Error>> {
    const known = this.blockTimes.get(height)
    if (known !== undefined) {
      return known
    }
    const pending = (async (): Promise<Result<number, Error>> =>
      (await this.onchainProvider.getBlock(height)).map(({ timestamp }) => Math.floor(timestamp.getTime() / 1000)))()
    this.blockTimes.set(height, pending)
    const result = await pending
    if (result.isErr()) {
      // A failed header request is retried with the lookup, not remembered.
      this.blockTimes.delete(height)
    }
    return result
  }
}
