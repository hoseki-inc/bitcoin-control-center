import { type AsyncResult, Result } from '@hoseki/packages/result'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { type IndexMap, IndexSet } from '../../collection'
import { Wallets } from '../../testing'
import type { Address } from '../address'
import { Network } from '../network'
import { OnchainBitcoinProvider } from './provider'
import type { Block, DiscoveredIndexes, DiscoveryIndexStore, TransactionEntry } from './types'

const account = Wallets.singlesigNativeSegwitAccount

/** Answers from a fixed set of used addresses and counts every address it was asked about. */
class FakeProvider extends OnchainBitcoinProvider {
  public checked = 0
  private readonly used: Set<string>

  public constructor(used: { receive: number[]; change: number[] }, discoveryIndexes?: DiscoveryIndexStore) {
    super(Network.Mainnet, { logger: pino({ level: 'silent' }), discoveryIndexes })
    this.used = new Set([
      ...used.receive.map((index) => account.receiveAddress(index, Network.Mainnet).toString()),
      ...used.change.map((index) => account.changeAddress(index, Network.Mainnet).toString()),
    ])
  }

  public areAddressesUsed(addresses: IndexSet<Address>): AsyncResult<IndexSet<Address>, Error> {
    this.checked += addresses.size
    return Result.fromPromise(
      Promise.resolve(new IndexSet([...addresses].filter((address) => this.used.has(address.toString())))),
    )
  }

  public getBlocksTip(): AsyncResult<Block, Error> {
    throw new Error('Not used by discovery')
  }

  public getConfirmedAddressBalances(): AsyncResult<IndexMap<Address, bigint>, Error> {
    throw new Error('Not used by discovery')
  }

  // oxlint-disable-next-line require-yield -- discovery never reads transactions
  public async *getTransactionEntries(): AsyncGenerator<Result<TransactionEntry, Error>, void> {
    throw new Error('Not used by discovery')
  }
}

function store(saved: DiscoveredIndexes | null): DiscoveryIndexStore & {
  load: ReturnType<typeof vi.fn<DiscoveryIndexStore['load']>>
  save: ReturnType<typeof vi.fn<DiscoveryIndexStore['save']>>
} {
  return {
    load: vi.fn<DiscoveryIndexStore['load']>(() => Result.fromPromise(Promise.resolve(saved))),
    save: vi.fn<DiscoveryIndexStore['save']>(() => Result.fromPromise(Promise.resolve(undefined))),
  }
}

const wallet = { receive: [0, 3, 21, 25], change: [0, 5] }
const found = { lastUsedReceiveIndex: 25, lastUsedChangeIndex: 5 }

describe('account discovery', () => {
  it('finds the last used address on each chain from index 0 without saved indexes', async () => {
    const provider = new FakeProvider(wallet)
    expect((await provider.discoverAccount(account)).unwrap()).toEqual(found)
    // Receive: 0–45 (25 plus a full gap); change: 0–25.
    expect(provider.checked).toBe(46 + 26)
  })

  it('resumes from saved indexes with one check per chain beyond them and saves nothing new', async () => {
    const saved = store(found)
    const provider = new FakeProvider(wallet, saved)
    expect((await provider.discoverAccount(account)).unwrap()).toEqual(found)
    expect(saved.load).toHaveBeenCalledWith(account, Network.Mainnet)
    expect(provider.checked).toBe(21 + 21)
    expect(saved.save).not.toHaveBeenCalled()
  })

  it('finds addresses used since the indexes were saved and raises them', async () => {
    const saved = store(found)
    const provider = new FakeProvider({ receive: [...wallet.receive, 40], change: [...wallet.change, 20] }, saved)
    const discovered = { lastUsedReceiveIndex: 40, lastUsedChangeIndex: 20 }
    expect((await provider.discoverAccount(account)).unwrap()).toEqual(discovered)
    expect(saved.save).toHaveBeenCalledWith(account, Network.Mainnet, discovered, 'raise')
  })

  it('scans a chain again from index 0 when its saved address is no longer used, and replaces the index', async () => {
    const saved = store({ lastUsedReceiveIndex: 60, lastUsedChangeIndex: 5 })
    const provider = new FakeProvider(wallet, saved)
    expect((await provider.discoverAccount(account)).unwrap()).toEqual(found)
    expect(saved.save).toHaveBeenCalledWith(account, Network.Mainnet, found, 'replace')
  })

  it('saves what a first scan found, and nothing for an unused wallet', async () => {
    const first = store(null)
    await new FakeProvider(wallet, first).discoverAccount(account)
    expect(first.save).toHaveBeenCalledWith(account, Network.Mainnet, found, 'raise')

    const unused = store(null)
    const result = await new FakeProvider({ receive: [], change: [] }, unused).discoverAccount(account)
    expect(result.unwrap()).toEqual({ lastUsedReceiveIndex: 0, lastUsedChangeIndex: 0 })
    expect(unused.save).not.toHaveBeenCalled()
  })

  it('still discovers the wallet when saved indexes cannot be read or written', async () => {
    const broken: DiscoveryIndexStore = {
      load: () => Result.fromPromise(Promise.reject(new Error('database is locked'))),
      save: () => Result.fromPromise(Promise.reject(new Error('database is locked'))),
    }
    const provider = new FakeProvider(wallet, broken)
    expect((await provider.discoverAccount(account)).unwrap()).toEqual(found)
    expect(provider.checked).toBe(46 + 26)
  })

  it('fails discovery when the server does, without saving anything', async () => {
    const saved = store(null)
    const provider = new FakeProvider(wallet, saved)
    vi.spyOn(provider, 'areAddressesUsed').mockReturnValue(
      Result.fromPromise(Promise.reject(new Error('Electrum unreachable'))),
    )
    expect((await provider.discoverAccount(account)).unwrapErr().message).toBe('Electrum unreachable')
    expect(saved.save).not.toHaveBeenCalled()
  })
})
