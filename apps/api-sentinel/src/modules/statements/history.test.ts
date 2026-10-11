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

it('fails rather than returning an empty wallet when the wallet scan fails', async () => {
  const onchainProvider = mockProvider(new Map(), -1)
  vi.spyOn(onchainProvider, 'discoverAccount').mockImplementation(
    asyncFn(async () => Err(new Error('Connection closed'))),
  )

  const result = await collectAccountHistory(account, onchainProvider)

  expect(result.expectErr('a failed scan must stop the statement').kind).toBe('history')
})
