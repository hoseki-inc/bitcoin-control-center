import type { Address } from '@hoseki/packages/bitcoin/address'
import { Network } from '@hoseki/packages/bitcoin/network'
import { ElectrumProvider } from '@hoseki/packages/bitcoin/onchain/electrum_provider'
import { addressToScripthash } from '@hoseki/packages/bitcoin/scripthash'
import { ElectrumClient } from '@hoseki/packages/clients/electrum'
import { Err, Ok, asyncFn } from '@hoseki/packages/result'
import { Wallets } from '@hoseki/packages/testing'
import pino from 'pino'
import { assert, expect, it, vi } from 'vitest'
import { collectAccountHistory } from './history'

const logger = pino({ level: 'silent' })
const account = Wallets.singlesigNativeSegwitAccount
const funding = '1'.repeat(64)
const spend = '2'.repeat(64)

/** A provider whose Electrum history lists the given txids for each address, and nothing for the rest. */
function mockProvider(histories: ReadonlyMap<Address, string[]>, lastUsedChangeIndex: number): ElectrumProvider {
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => {
      const txids = [...histories].find(
        ([address]) => addressToScripthash(address).expect('Fixture address must be valid') === scripthash,
      )?.[1]
      return Ok((txids ?? []).map((txid) => ({ tx_hash: txid, height: 800_000 })))
    }),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 0, lastUsedChangeIndex })),
  )
  return onchainProvider
}

it('lists every wallet address a transaction touches, including the last used change address', async () => {
  const [receive] = account.receiveAddresses(0, 1, Network.Mainnet)
  const [change] = account.changeAddresses(0, 1, Network.Mainnet)
  assert(receive !== undefined && change !== undefined)
  // A spend from the receive address, with change back to the wallet.
  const onchainProvider = mockProvider(
    new Map([
      [receive, [funding, spend]],
      [change, [spend]],
    ]),
    0,
  )

  const history = (await collectAccountHistory(account, onchainProvider)).unwrap()

  expect(history.get(funding)?.addresses.map((address) => address.toString())).toEqual([receive.toString()])
  expect(history.get(spend)?.addresses.map((address) => address.toString())).toEqual([
    receive.toString(),
    change.toString(),
  ])
})

it('reports progress after finding the addresses, then after each address', async () => {
  const onchainProvider = mockProvider(new Map(), 0)
  const progress: number[] = []

  ;(
    await collectAccountHistory(account, onchainProvider, (fraction) => {
      progress.push(fraction)
    })
  ).unwrap()

  // One receive and one change address.
  expect(progress).toEqual([0.5, 0.75, 1])
})

it('fails rather than returning an empty wallet when the wallet scan fails', async () => {
  const onchainProvider = mockProvider(new Map(), -1)
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Err(new Error('Connection closed'))),
  )

  const result = await collectAccountHistory(account, onchainProvider)

  expect(result.expectErr('a failed scan must stop the statement').kind).toBe('history')
})

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

it('fetches address histories concurrently up to 10 at a time', async () => {
  const receiveAddresses = account.receiveAddresses(0, 12, Network.Mainnet)
  const gates = new Map<string, Deferred<Array<{ tx_hash: string; height: number }>>>()
  for (const address of receiveAddresses) {
    gates.set(addressToScripthash(address).expect('Fixture address must be valid'), deferred())
  }

  let inFlight = 0
  let maxInFlight = 0
  const started: string[] = []
  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => {
      started.push(scripthash)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      const gate = gates.get(scripthash)
      assert(gate !== undefined)
      const entries = await gate.promise
      inFlight -= 1
      return Ok(entries)
    }),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 11, lastUsedChangeIndex: -1 })),
  )

  const pending = collectAccountHistory(account, onchainProvider)
  try {
    // Allow workers to launch initial concurrent requests.
    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }

    expect(maxInFlight).toBe(10)
    expect(started).toHaveLength(10)

    const firstStarted = started[0]
    assert(firstStarted !== undefined)
    gates.get(firstStarted)?.resolve([])

    for (let tick = 0; tick < 10; tick += 1) {
      await Promise.resolve()
    }
    expect(started).toHaveLength(11)
    expect(maxInFlight).toBe(10)
  } finally {
    for (const gate of gates.values()) {
      gate.resolve([])
    }
  }

  expect((await pending).isOk()).toBe(true)
})

it('preserves discovery order for transactions and addresses regardless of response order', async () => {
  const receiveAddresses = account.receiveAddresses(0, 3, Network.Mainnet)
  const [addr0, addr1, addr2] = receiveAddresses
  assert(addr0 !== undefined && addr1 !== undefined && addr2 !== undefined)
  const txA = 'a'.repeat(64)
  const txB = 'b'.repeat(64)
  const txShared = 'c'.repeat(64)

  const scripthashes = receiveAddresses.map((address) =>
    addressToScripthash(address).expect('Fixture address must be valid'),
  )
  const gates = scripthashes.map(() => deferred<Array<{ tx_hash: string; height: number }>>())
  const byScripthash = new Map(scripthashes.map((sh, index) => [sh, gates[index]]))

  const electrum = new ElectrumClient({ host: 'example.invalid', port: 50001, protocol: 'tcp' })
  vi.spyOn(electrum, 'getHistory').mockImplementation(
    asyncFn(async (scripthash: string) => {
      const gate = byScripthash.get(scripthash)
      assert(gate !== undefined)
      return Ok(await gate.promise)
    }),
  )
  const onchainProvider = new ElectrumProvider(Network.Mainnet, { logger, electrum })
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Ok({ lastUsedReceiveIndex: 2, lastUsedChangeIndex: -1 })),
  )

  const pending = collectAccountHistory(account, onchainProvider)
  // Resolve in reverse discovery order: addr2, then addr1, then addr0.
  gates[2]?.resolve([
    { tx_hash: txShared, height: 800_003 },
    { tx_hash: txB, height: 800_004 },
  ])
  await Promise.resolve()
  gates[1]?.resolve([{ tx_hash: txShared, height: 800_003 }])
  await Promise.resolve()
  gates[0]?.resolve([
    { tx_hash: txA, height: 800_001 },
    { tx_hash: txShared, height: 800_003 },
  ])

  const history = (await pending).unwrap()
  expect([...history.keys()]).toEqual([txA, txShared, txB])
  expect(history.get(txShared)?.addresses.map((address) => address.toString())).toEqual([
    addr0.toString(),
    addr1.toString(),
    addr2.toString(),
  ])
})
