import { type AsyncResult, Err, Ok, type Result, asyncFn, tryBlockAsync } from '@hoseki/packages/result'
import type { Logger } from 'pino'
import { IndexMap, IndexSet } from '../../collection'
import { asyncResultAll } from '../../result'
import type { Account } from '../account'
import type { Address } from '../address'
import type { Network } from '../network'
import { type Block, CONFIG, type DiscoveredIndexes, type DiscoveryIndexStore, type TransactionEntry } from './types'

export interface OnchainBitcoinProviderDeps {
  logger: Logger
  /** Lets discovery resume from the last used addresses it found before, instead of from index 0. */
  discoveryIndexes?: DiscoveryIndexStore
}

/** One chain (receive or change) of an account while discovery checks its addresses. */
interface ChainScan {
  change: boolean
  checkFrom: number
  checkUpTo: number
  unusedCount: number
  lastUsed: number
  /** A saved last used index that hasn't been confirmed as still used. */
  unconfirmed: number | null
  /** Whether the saved index turned out unused, so the chain was scanned again from index 0. */
  rescanned: boolean
}

function startChainScan(change: boolean, saved: number): ChainScan {
  // A saved 0 can't tell "address 0 is used" from "nothing is used", so it starts from the beginning.
  if (saved > 0) {
    // Check the saved address itself, then a full gap after it.
    return {
      change,
      checkFrom: saved,
      checkUpTo: saved + CONFIG.GAP_LIMIT + 1,
      unusedCount: 0,
      lastUsed: 0,
      unconfirmed: saved,
      rescanned: false,
    }
  }
  return {
    change,
    checkFrom: 0,
    checkUpTo: CONFIG.GAP_LIMIT,
    unusedCount: 0,
    lastUsed: 0,
    unconfirmed: null,
    rescanned: false,
  }
}

/** Records one batch of checked addresses, in index order, and moves the chain's window on. */
function advanceChainScan(chain: ChainScan, checked: Array<{ index: number; used: boolean }>): void {
  if (chain.unconfirmed !== null) {
    if (checked[0]?.index !== chain.unconfirmed || !checked[0].used) {
      // The saved address has no history now, such as after a reorg, a dropped transaction or a
      // change of server, so nothing below it can be assumed: scan the chain again from index 0.
      Object.assign(chain, startChainScan(chain.change, 0), { rescanned: true })
      return
    }
    chain.unconfirmed = null
  }
  for (const { index, used } of checked) {
    if (used) {
      chain.lastUsed = index
      chain.unusedCount = 0
    } else {
      chain.unusedCount += 1
    }
  }
  chain.checkFrom = chain.checkUpTo
  chain.checkUpTo = chain.checkFrom + (CONFIG.GAP_LIMIT - chain.unusedCount)
}

export abstract class OnchainBitcoinProvider {
  public readonly network: Network
  public readonly deps: OnchainBitcoinProviderDeps

  public constructor(network: Network, deps: OnchainBitcoinProviderDeps) {
    this.network = network
    this.deps = deps
  }

  /**
   * Returns the tip of the chain.
   */
  public abstract getBlocksTip(): AsyncResult<Block, Error>

  /**
   * Returns a generator of entries for the given addresses.
   *
   * Stops when an error occurs.
   *
   * Paginates through transactions in descending order, but the order of yielded entries is not guaranteed.
   *
   * @param addresses.key - The addresses to get transactions for.
   * @param addresses.value - The block to stop at for the address. If null, the generator will continue until transactions are exhausted.
   */
  public abstract getTransactionEntries(
    addresses: IndexMap<Address, number | null>,
  ): AsyncGenerator<Result<TransactionEntry, Error>, void>

  /**
   * Returns a set of addresses that have had any transactions.
   */
  public abstract areAddressesUsed(addresses: IndexSet<Address>): AsyncResult<IndexSet<Address>, Error>

  /**
   * Returns confirmed balances for the given addresses.
   */
  public abstract getConfirmedAddressBalances(
    addresses: IndexSet<Address>,
  ): AsyncResult<IndexMap<Address, bigint>, Error>

  /**
   * Returns confirmed balances for the given accounts. Uses the associated provider's max account depth.
   */
  public getConfirmedAccountBalances = asyncFn(
    async (accounts: IndexSet<Account>): Promise<Result<IndexMap<Account, bigint>, Error>> => {
      this.deps.logger.debug({ accounts: accounts.size }, 'Getting confirmed account balances')
      const addressesToAccounts = new IndexMap<Address, Account>()

      // Collect all the accounts that we need to discover
      const results: Array<
        AsyncResult<{ account: Account; lastUsedReceiveIndex: number; lastUsedChangeIndex: number }, Error>
      > = []
      for (const account of accounts) {
        const result = this.discoverAccount(account).map(({ lastUsedReceiveIndex, lastUsedChangeIndex }) => ({
          account,
          lastUsedReceiveIndex,
          lastUsedChangeIndex,
        }))
        results.push(result)
      }

      // Run discovery in parallel
      const combined = await asyncResultAll(results)
      if (combined.isErr()) {
        this.deps.logger.error({ err: combined.unwrapErr() }, 'Error getting confirmed account balances')
        return Err(combined.unwrapErr())
      }
      const discoveredAccounts = combined.unwrap()
      this.deps.logger.debug({ accounts: discoveredAccounts.length }, 'Discovered accounts')

      // Collect all the addresses that we need to check
      for (const { account, lastUsedReceiveIndex, lastUsedChangeIndex } of discoveredAccounts) {
        const receiveAddresses = account.receiveAddresses(0, lastUsedReceiveIndex + 1, this.network)
        for (const address of receiveAddresses) {
          addressesToAccounts.set(address, account)
        }
        const changeAddresses = account.changeAddresses(0, lastUsedChangeIndex + 1, this.network)
        for (const address of changeAddresses) {
          addressesToAccounts.set(address, account)
        }
      }

      return this.getConfirmedAddressBalances(new IndexSet(addressesToAccounts.keys()))
        .map((addressBalances) => {
          const map = new IndexMap<Account, bigint>()
          for (const [address, account] of addressesToAccounts.entries()) {
            const currentBalance = map.get(account) ?? 0n
            const addressBalance = addressBalances.get(address) ?? 0n
            map.set(account, currentBalance + addressBalance)
          }
          return map
        })
        .inspectErr((err) => {
          this.deps.logger.error({ err }, 'Error getting confirmed account balances')
        })
    },
  )

  /**
   * Discovers the receive and change addresses for the given account.
   *
   * It'll return every address that has had any transactions plus GAP_LIMIT number of unused addresses.
   * With indexes saved by an earlier scan, each chain resumes from its saved last used address once
   * that address is confirmed as still used; otherwise the chain is scanned again from index 0.
   */
  public discoverAccount(account: Account): AsyncResult<DiscoveredIndexes, Error> {
    return tryBlockAsync(
      async function* (this: OnchainBitcoinProvider) {
        const saved = await this.loadDiscoveredIndexes(account)
        const receive = startChainScan(false, saved?.lastUsedReceiveIndex ?? 0)
        const change = startChainScan(true, saved?.lastUsedChangeIndex ?? 0)
        this.deps.logger.debug({ resumed: saved !== null }, 'Discovering account')

        for (;;) {
          const scanning = [receive, change].filter((chain) => chain.unusedCount < CONFIG.GAP_LIMIT)
          if (scanning.length === 0) {
            break
          }
          const batch = scanning.map((chain) => {
            const addresses: Array<{ address: Address; index: number }> = []
            for (let index = chain.checkFrom; index < chain.checkUpTo; index++) {
              const address = chain.change
                ? account.changeAddress(index, this.network)
                : account.receiveAddress(index, this.network)
              addresses.push({ address, index })
            }
            return { chain, addresses }
          })

          const allAddresses = batch.flatMap(({ addresses }) => addresses.map(({ address }) => address))
          this.deps.logger.debug({ addresses: allAddresses.length }, 'Checking if addresses are used')
          const usedMap = yield* this.areAddressesUsed(new IndexSet(allAddresses))
            .inspectErr((err) => {
              this.deps.logger.error({ err }, 'Error checking if addresses are used')
            })
            .try()

          for (const { chain, addresses } of batch) {
            advanceChainScan(
              chain,
              addresses.map(({ address, index }) => ({ index, used: usedMap.has(address) })),
            )
          }
        }

        const found = { lastUsedReceiveIndex: receive.lastUsed, lastUsedChangeIndex: change.lastUsed }
        await this.saveDiscoveredIndexes(account, saved, found, receive.rescanned || change.rescanned)
        return Ok(found)
      }.bind(this),
    )
  }

  /** Saved indexes are only a starting point: without them, or if they can't be read, discovery starts at 0. */
  private async loadDiscoveredIndexes(account: Account): Promise<DiscoveredIndexes | null> {
    const store = this.deps.discoveryIndexes
    if (store === undefined) {
      return null
    }
    const loaded = await store.load(account, this.network)
    if (loaded.isErr()) {
      // The error may quote the account's descriptor, so only its kind is logged.
      this.deps.logger.warn({ error: loaded.unwrapErr().name }, 'Could not read saved address indexes')
      return null
    }
    return loaded.unwrap()
  }

  private async saveDiscoveredIndexes(
    account: Account,
    saved: DiscoveredIndexes | null,
    found: DiscoveredIndexes,
    rescanned: boolean,
  ): Promise<void> {
    const store = this.deps.discoveryIndexes
    const unchanged =
      saved === null
        ? found.lastUsedReceiveIndex === 0 && found.lastUsedChangeIndex === 0
        : saved.lastUsedReceiveIndex === found.lastUsedReceiveIndex &&
          saved.lastUsedChangeIndex === found.lastUsedChangeIndex
    if (store === undefined || unchanged) {
      return
    }
    const result = await store.save(account, this.network, found, rescanned ? 'replace' : 'raise')
    if (result.isErr()) {
      this.deps.logger.warn({ error: result.unwrapErr().name }, 'Could not save address indexes')
    }
  }

  public getTransactionEntriesByAccount(account: Account): AsyncResult<TransactionEntry[], Error> {
    this.deps.logger.debug('Getting transaction entries for account')
    return this.discoverAccount(account)
      .andThenAsync(async ({ lastUsedReceiveIndex, lastUsedChangeIndex }) => {
        this.deps.logger.debug({ lastUsedReceiveIndex, lastUsedChangeIndex }, 'Got discovered indexes')

        const addresses = new IndexMap<Address, number | null>()
        for (const address of account.receiveAddresses(0, lastUsedReceiveIndex + 1, this.network)) {
          addresses.set(address, null)
        }
        for (const address of account.changeAddresses(0, lastUsedChangeIndex + 1, this.network)) {
          addresses.set(address, null)
        }

        const entries: TransactionEntry[] = []
        const gen = this.getTransactionEntries(addresses)
        for await (const entry of gen) {
          if (entry.isErr()) {
            this.deps.logger.error({ err: entry.unwrapErr() }, 'Error getting transaction entries for account')
            return Err(entry.unwrapErr())
          }
          entries.push(entry.unwrap())
        }

        return Ok(entries)
      })
      .inspectErr((err) => {
        this.deps.logger.error({ err }, 'Error getting transaction entries for account')
      })
  }

  public getTransactionEntriesByAddress = asyncFn(
    async (address: Address): Promise<Result<TransactionEntry[], Error>> => {
      this.deps.logger.debug('Getting transaction entries for address')
      const entries: TransactionEntry[] = []
      const gen = this.getTransactionEntries(new IndexMap([[address, null]]))
      for await (const entry of gen) {
        if (entry.isErr()) {
          this.deps.logger.error({ err: entry.unwrapErr() }, 'Error getting transaction entries for address')
          return Err(entry.unwrapErr())
        }
        entries.push(entry.unwrap())
      }
      return Ok(entries)
    },
  )
}
