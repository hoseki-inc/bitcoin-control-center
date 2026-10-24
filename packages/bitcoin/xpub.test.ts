import { expect, test } from 'vitest'
import { Network } from './network'
import { Xpub } from './xpub'

const XPUB =
  'xpub694qt9hX4kPgLCQm6Zw3tGa6YJ7oFLsWFNLwCFvPrsnLqDEEKHCFdnXNu858phziqhs6EbuMBs3z73Nsa7tayYe5JfTcxqyWrpmzxAgPbcD'

test('fromString - accepts only core xpub/tpub', () => {
  const fixtures = [
    {
      key: XPUB,
      network: Network.Mainnet,
    },
    {
      key: 'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj',
      network: Network.Testnet,
    },
  ] as const
  for (const fixture of fixtures) {
    const xpub = Xpub.fromString(fixture.key).expect('valid xpub')
    expect(xpub.network).toEqual(fixture.network)
    expect(xpub.toString()).toEqual(fixture.key)
  }
})

test('fromString - rejects SLIP-132 extended public keys', () => {
  const slip132Keys = [
    'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK',
    'Ypub6eoCK46snPVXc4mFsbBevS1QS4JWQKYbUkWptv5pcezdWVcNLLk6Ly3Sj2zCP3sYUp3srfW2Xjo37VcCb3TYvGSM1UGSxAG12H7Wveierg3',
    'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
    'Zpub6ydTcimnw531TMxNhwyH8X6uc2SxLwY6Ps33gJyhzfNWZbRbazuey2hakEwnNxXTtTAgc96azQ9aznDmJjsZiW7wsoxsY55VJ1BAKDbQcqw',
    'upub5Aa3y9gmchmEnJqQbVaBG1Hb2PgTRUu1W2nGr5EjirehfunYZJhZmbYxqWCNpz2xcnWfzB7foszLTBYBR2eYaqbGheNMD7X43eb4nTMPSAT',
    'Upub5MU96PRDBfKcCsznYA3A65dPkBiidqabpJRwmLWH6dV7J6MTKi5qriQteD9rPRFrrFaerm7nh6NqaM9wiFoVjKhwY7UkcWz3wNrwNNSoT5x',
    'vpub5VQKGpMgmPJidc2XRrMoU6P6CMpuN6tWR9JVdU8d6s2aj1bmoxs8PfD6ri9xptgt2RdUjeiEGYLtLU9k8j4ZP5GsZz4mo2LYKNeiB1eWbMR',
    'Vpub5gJQQ468LLs64BBuNWpnJAitv9sAaTa6jQxAYjQAUdrzMCAgaNFQUn52fR7SPKunFthTcEiM9kjPTdmWRxDWXZPYQTBBCRoYD6vakuwT5nx',
  ]
  for (const key of slip132Keys) {
    const result = Xpub.fromString(key)
    expect(result.isErr(), `Should reject SLIP-132 key: ${key}`).toBe(true)
    if (result.isErr()) {
      expect(result.unwrapErr().message).toContain('only accepts core xpub/tpub strings')
    }
  }
})

test('address', () => {
  const xpub = Xpub.fromString(XPUB).expect('valid xpub').derive(0)
  const addresses = [
    [xpub.address('p2pkh', Network.Mainnet), '1CqbkfcUn2wDWs13xEncHPuwc3ki6QGCxT'],
    [xpub.address('p2sh-p2wpkh', Network.Mainnet), '3AQTQNPrFamNBQCpqvpaZD6fiU8pjumLfw'],
    [xpub.address('p2wpkh', Network.Mainnet), 'bc1qs8d9c2d6yklezcm75c7a096dvnylnma2efstm6'],
    [xpub.address('p2tr', Network.Mainnet), 'bc1ppgmf4lp6qgs6ve3tys6rxrys8mznatg4qaap3jkuwahv34gnm6nqgj28pc'],

    [xpub.address('p2pkh', Network.Testnet), 'msMZ3ihTb4NUHyUffokz7K8GU3MQyqdqHC'],
    [xpub.address('p2sh-p2wpkh', Network.Testnet), '2N1xfU7Kss3GiPBqNX4STBA5vvpLzYcLbob'],
    [xpub.address('p2wpkh', Network.Testnet), 'tb1qs8d9c2d6yklezcm75c7a096dvnylnma2n0tcqf'],
    [xpub.address('p2tr', Network.Testnet), 'tb1ppgmf4lp6qgs6ve3tys6rxrys8mznatg4qaap3jkuwahv34gnm6nql6ugmh'],

    [xpub.address('p2pkh', Network.Regtest), 'msMZ3ihTb4NUHyUffokz7K8GU3MQyqdqHC'],
    [xpub.address('p2sh-p2wpkh', Network.Regtest), '2N1xfU7Kss3GiPBqNX4STBA5vvpLzYcLbob'],
    [xpub.address('p2wpkh', Network.Regtest), 'bcrt1qs8d9c2d6yklezcm75c7a096dvnylnma23xj4hq'],
    [xpub.address('p2tr', Network.Regtest), 'bcrt1ppgmf4lp6qgs6ve3tys6rxrys8mznatg4qaap3jkuwahv34gnm6nqjrkwwd'],
  ] as const
  for (const [address, expected] of addresses) {
    expect(address.toString()).toEqual(expected)
  }
})

test('fromString - rejects an oversized string before decoding it', () => {
  // Base58 decoding grows quadratically; a 1 MiB string would block for minutes.
  const result = Xpub.fromString('x' + '1'.repeat(1_048_576))
  expect(result.unwrapErr().message).toBe('Extended public key is longer than 112 characters')
  expect(Xpub.fromString(XPUB.padEnd(112, '1')).unwrapErr().message).not.toContain('longer than')
})
