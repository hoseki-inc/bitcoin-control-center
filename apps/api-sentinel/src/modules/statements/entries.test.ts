import { Network } from '@hoseki/packages/bitcoin/network'
import { Wallets } from '@hoseki/packages/testing'
import { expect, it } from 'vitest'
import { toTransactionEntries } from './entries'
import type { LookedUpTx } from './sources/types'

const height = 800_000
const receive = '1'.repeat(64)
const spend = '2'.repeat(64)

function confirmedTx(txid: string): LookedUpTx {
  return { txid, blockHeight: height, blockTime: 1_704_153_600, inputs: [], outputs: [] }
}

it('reads a spent amount from the wallet transaction that created it', () => {
  const address = Wallets.singlesigNativeSegwitAccount.receiveAddresses(0, 1, Network.Mainnet)[0]
  if (address === undefined) {
    expect.fail('Fixture wallet must have an address')
  }
  const found = new Map<string, LookedUpTx>([
    [receive, { ...confirmedTx(receive), outputs: [{ address: address.toString(), value: 100_000 }] }],
    // A source without previous outputs, such as Electrum, only says which output an input spends.
    [spend, { ...confirmedTx(spend), inputs: [{ spends: { txid: receive, vout: 0 }, prevout: null }] }],
  ])
  const history = new Map([
    [receive, { height, addresses: [address] }],
    [spend, { height, addresses: [address] }],
  ])

  const entries = toTransactionEntries(history, found, height + 10).unwrap()

  expect(entries.map((entry) => entry.value)).toEqual([100_000n, -100_000n])
})
