import { type AsyncResult, Err, Ok, type Result, asyncFn, tryBlockAsync } from '@patina/core'
import { type Logger } from 'pino'
import { IndexMap, IndexSet } from '../../collection'
import { asyncResultAll } from '../../result'
import type { Account } from '../account'
import type { Address } from '../address'
import type { Network } from '../network'
import { type Block, CONFIG, type TransactionEntry } from './types'

export abstract class OnchainBitcoinProvider {
  public readonly network: Network
  public readonly deps: { logger: Logger }

  public constructor(network: Network, deps: { logger: Logger }) {
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
      this.deps.logger.debug({ accounts }, 'Getting confirmed account balances')
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
      this.deps.logger.debug({ discoveredAccounts }, 'Discovered accounts')

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

  protected abstract getLastKnownIndexes(
    account: Account,
  ): AsyncResult<{ lastUsedReceiveIndex: number; lastUsedChangeIndex: number }, Error>

  /**
   * Discovers the receive and change addresses for the given account.
   *
   * It'll return every address that has had any transactions plus GAP_LIMIT number of unused addresses.
   */
  public discoverAccount(
    account: Account,
  ): AsyncResult<{ lastUsedReceiveIndex: number; lastUsedChangeIndex: number }, Error> {
    const self = this
    return tryBlockAsync(async function* () {
      const { lastUsedReceiveIndex, lastUsedChangeIndex } = yield* self
        .getLastKnownIndexes(account)
        .inspectErr((err) => {
          self.deps.logger.error({ err }, 'Error getting last known indexes')
        })
        .try()

      self.deps.logger.debug({ account, lastUsedReceiveIndex, lastUsedChangeIndex }, 'Discovering account')

      let newLastUsedReceiveIndex = 0
      let newLastUsedChangeIndex = 0

      let receiveUnusedCount = 0
      let changeUnusedCount = 0

      let receiveCheckFrom = 0
      let receiveCheckUpTo = lastUsedReceiveIndex + CONFIG.GAP_LIMIT

      let changeCheckFrom = 0
      let changeCheckUpTo = lastUsedChangeIndex + CONFIG.GAP_LIMIT

      while (receiveUnusedCount < CONFIG.GAP_LIMIT || changeUnusedCount < CONFIG.GAP_LIMIT) {
        const addresses: Array<{ address: Address; change: boolean; index: number }> = []

        if (receiveUnusedCount < CONFIG.GAP_LIMIT) {
          for (let i = receiveCheckFrom; i < receiveCheckUpTo; i++) {
            const address = account.receiveAddress(i, self.network)
            addresses.push({ address, change: false, index: i })
          }
        }

        if (changeUnusedCount < CONFIG.GAP_LIMIT) {
          for (let i = changeCheckFrom; i < changeCheckUpTo; i++) {
            const address = account.changeAddress(i, self.network)
            addresses.push({ address, change: true, index: i })
          }
        }

        self.deps.logger.debug({ addresses }, 'Checking if addresses are used')
        const usedMap = yield* self
          .areAddressesUsed(new IndexSet(addresses.map((a) => a.address)))
          .inspectErr((err) => {
            self.deps.logger.error({ err }, 'Error checking if addresses are used')
          })
          .try()

        for (const address of addresses) {
          if (usedMap.has(address.address)) {
            if (address.change) {
              newLastUsedChangeIndex = address.index
              changeUnusedCount = 0
            } else {
              newLastUsedReceiveIndex = address.index
              receiveUnusedCount = 0
            }
          } else {
            if (address.change) {
              changeUnusedCount += 1
            } else {
              receiveUnusedCount += 1
            }
          }
        }

        receiveCheckFrom = receiveCheckUpTo
        receiveCheckUpTo = receiveCheckFrom + (CONFIG.GAP_LIMIT - receiveUnusedCount)

        changeCheckFrom = changeCheckUpTo
        changeCheckUpTo = changeCheckFrom + (CONFIG.GAP_LIMIT - changeUnusedCount)
      }

      return Ok({
        lastUsedReceiveIndex: newLastUsedReceiveIndex,
        lastUsedChangeIndex: newLastUsedChangeIndex,
      })
    })
  }

  public getTransactionEntriesByAccount(account: Account): AsyncResult<TransactionEntry[], Error> {
    this.deps.logger.debug({ account }, 'Getting transaction entries for account')
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
      this.deps.logger.debug({ address }, 'Getting transaction entries for address')
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
