import type { Address } from '@hoseki/packages/bitcoin/address'
import { Network } from '@hoseki/packages/bitcoin/network'
import { Wallets } from '@hoseki/packages/testing'
import { assert, expect, it } from 'vitest'
import { toTransactionEntries } from './entries'
import type { LookedUpTx } from './sources/types'

const height = 800_000
const receive = '1'.repeat(64)
const spend = '2'.repeat(64)

function confirmedTx(txid: string): LookedUpTx {
  return { txid, blockHeight: height, blockTime: 1_704_153_600, inputs: [], outputs: [] }
}

function walletAddress(): Address {
  const [address] = Wallets.singlesigNativeSegwitAccount.receiveAddresses(0, 1, Network.Mainnet)
  assert(address !== undefined, 'Fixture wallet must have an address')
  return address
}

it('reads a spent amount from the wallet transaction that created it', () => {
  const address = walletAddress()
  const found = new Map<string, LookedUpTx>([
    [
      receive,
      {
        ...confirmedTx(receive),
        outputs: [
          { address: null, value: 5 },
          { address: address.toString(), value: 100_000 },
        ],
      },
    ],
    // A source without previous outputs, such as Electrum, only says which output an input spends.
    [spend, { ...confirmedTx(spend), inputs: [{ spends: { txid: receive, vout: 1 }, prevout: null }] }],
  ])
  const history = new Map([
    [receive, { height, addresses: [address] }],
    [spend, { height, addresses: [address] }],
  ])

  const entries = toTransactionEntries(history, found, height + 10).unwrap()

  expect(entries.map((entry) => entry.value)).toEqual([100_000n, -100_000n])
})

it('marks a transaction confirmed only once it has enough confirmations', () => {
  const address = walletAddress()
  const recent = '3'.repeat(64)
  const found = new Map<string, LookedUpTx>([
    [receive, confirmedTx(receive)],
    [recent, { ...confirmedTx(recent), blockHeight: height + 8 }],
  ])
  const history = new Map([
    [receive, { height, addresses: [address] }],
    [recent, { height: height + 8, addresses: [address] }],
  ])

  const entries = toTransactionEntries(history, found, height + 10).unwrap()

  expect(entries.map((entry) => entry.confirmed)).toEqual([true, false])
})

it('fails rather than skipping a transaction whose txid does not parse', () => {
  const found = new Map([['not-a-txid', confirmedTx('not-a-txid')]])
  const history = new Map([['not-a-txid', { height, addresses: [walletAddress()] }]])

  const result = toTransactionEntries(history, found, height + 10)

  expect(result.expectErr('a transaction must not silently drop out of the statement').kind).toBe('invalid')
})
