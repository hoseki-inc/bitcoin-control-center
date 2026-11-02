import { expect, it } from 'vitest'
import { createMultisigClaimInputFromDescriptor } from './multisig-from-descriptor'

const tpubs = [
  'tpubDA5fLNXHCWA66cw48AsL7YzzBxRfTfisx6d56gaYqPhNYGzdQjNYy6w3c26dY1YXc346MtPsuFXfpaaPochNmBVFB7H2gUGjUgorGy7Ntz4',
  'tpubD8TtvT4c31CABVQN8UiwAVGC2SqNLJ9rquQ2dXTvsjpXJx2Dgb6isqZudFN925CDPhW2erxLraNZq1VHLVLdTsiBS7aHhHGMkAMFvuAUqwB',
  'tpubD9cuoeUV5JFyKDvKXHJ4x9rEUSHG37RsSRuoTi1BfeZzghBdc84pnNCXYj3CkLx3KivSVwvnTFKQF6v8f8UUApaqBN6i8L2ck1cWKN6qeHZ',
]

// The track page saves a wallet on its own network, so the multisig import must look it up on the same one.
it('reads a testnet multisig as testnet', () => {
  const keys = tpubs.map((tpub, index) => `[0000000${index}/48h/1h/0h/2h]${tpub}/<0;1>/*`)

  const input = createMultisigClaimInputFromDescriptor(`wsh(sortedmulti(2,${keys.join(',')}))`, 'Test vault')

  expect(input.map((wallet) => wallet.network).unwrapOr(null)).toBe('bitcoin_testnet')
})

it('reads a mainnet multisig as mainnet', () => {
  // As Sparrow exports it, with each key's fingerprint and derivation path.
  const sparrow =
    'wsh(sortedmulti(2,[98950b2a/48h/0h/0h/2h]xpub6FF4wJMrZjWwm8PpJhJJcD3uircG7QKMaijiZhiFmBoaNX2MJiyqZmQ1aYAu59VawDppV25P7PVwtFsnynPjMFq8DNwo1sPyNdher6jFEug/<0;1>/*,[1d25c06f/48h/0h/0h/2h]xpub6DfQuReLSBLxpNjNJsTFDKsA3FpoiRVuymrkmKYG7j7sFxdJdnC3DWZg9bahkxQoNqzq6CmYDZPeQhgpL63sBhMFZPvH2CuR6mnaaSiseNJ/<0;1>/*,[1d177351/48h/0h/0h/2h]xpub6F5dv5ncJreUTNJ89xwAfuzLGJ17CfuQeo9jPwQ5CLqyGoAnkN6QZMWtoMi73MREyJbWh4o521Ye3DFuRDhkigf8ocJtW4DadaSszNieAgr/<0;1>/*))#asdthwfj'

  const input = createMultisigClaimInputFromDescriptor(sparrow, 'Vault')

  expect(input.map((wallet) => wallet.network).unwrapOr(null)).toBe('bitcoin_mainnet')
})
