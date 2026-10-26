import type { AsyncResult } from '../../result'
import type { Account } from '../account'
import type { Address } from '../address'
import type { Network } from '../network'
import type { Txid } from '../txid'

export const CONFIG = {
  /**
   * Configuration for transaction confirmation threshold
   * A transaction is considered confirmed after this many blocks
   */
  CONFIRMATION_THRESHOLD: 6,

  /**
   * The number of addresses without any transactions to find before stopping account discovery
   */
  GAP_LIMIT: 20,
} as const

/**
 * Returns true if the transaction is confirmed.
 *
 * A transaction is confirmed if the block height is within the confirmation threshold of the tip.
 */
export function isConfirmed({ tip, height }: { tip: number; height: number | null }): boolean {
  if (height === null) {
    return false
  }
  return tip - height >= CONFIG.CONFIRMATION_THRESHOLD
}

/**
 * Represents a single ledger entry tracking value movement for an address.
 * A unique entry exists per transaction ID and address combination.
 */
export interface TransactionEntry {
  txid: Txid
  address: Address
  value: bigint
  timestamp: Date
  confirmed: boolean
  blockHeight: number | null
}

export interface Block {
  height: number
  hash: string
  timestamp: Date
}

/** The last address used on each chain of an account, as found by discovery. */
export interface DiscoveredIndexes {
  lastUsedReceiveIndex: number
  lastUsedChangeIndex: number
}

/** Keeps what discovery found, so the next scan of an account can resume from its last used addresses. */
export interface DiscoveryIndexStore {
  load(account: Account, network: Network): AsyncResult<DiscoveredIndexes | null, Error>
  /** `raise` keeps any larger saved index; `replace` overwrites it after a scan from index 0 found less. */
  save(
    account: Account,
    network: Network,
    indexes: DiscoveredIndexes,
    mode: 'raise' | 'replace',
  ): AsyncResult<void, Error>
}
