import { describe, expect, it } from 'vitest'
import { Network, Xpub } from '../bitcoin'
import * as Slip132 from './slip-132'

const XPUB =
  'xpub694qt9hX4kPgLCQm6Zw3tGa6YJ7oFLsWFNLwCFvPrsnLqDEEKHCFdnXNu858phziqhs6EbuMBs3z73Nsa7tayYe5JfTcxqyWrpmzxAgPbcD'

const TPUB_STR =
  'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'

describe('SLIP-132 conversion', () => {
  it('converts all SLIP-132 prefixes to core xpub/tpub', () => {
    // These are all encoding the same key as XPUB
    const fixtures = [
      {
        key: XPUB,
        network: Network.Mainnet,
      },
      {
        key: 'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK',
        network: Network.Mainnet,
      },
      {
        key: 'Ypub6eoCK46snPVXc4mFsbBevS1QS4JWQKYbUkWptv5pcezdWVcNLLk6Ly3Sj2zCP3sYUp3srfW2Xjo37VcCb3TYvGSM1UGSxAG12H7Wveierg3',
        network: Network.Mainnet,
      },
      {
        key: 'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
        network: Network.Mainnet,
      },
      {
        key: 'Zpub6ydTcimnw531TMxNhwyH8X6uc2SxLwY6Ps33gJyhzfNWZbRbazuey2hakEwnNxXTtTAgc96azQ9aznDmJjsZiW7wsoxsY55VJ1BAKDbQcqw',
        network: Network.Mainnet,
      },
      {
        key: 'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj',
        network: Network.Testnet,
      },
      {
        key: 'upub5Aa3y9gmchmEnJqQbVaBG1Hb2PgTRUu1W2nGr5EjirehfunYZJhZmbYxqWCNpz2xcnWfzB7foszLTBYBR2eYaqbGheNMD7X43eb4nTMPSAT',
        network: Network.Testnet,
      },
      {
        key: 'Upub5MU96PRDBfKcCsznYA3A65dPkBiidqabpJRwmLWH6dV7J6MTKi5qriQteD9rPRFrrFaerm7nh6NqaM9wiFoVjKhwY7UkcWz3wNrwNNSoT5x',
        network: Network.Testnet,
      },
      {
        key: 'vpub5VQKGpMgmPJidc2XRrMoU6P6CMpuN6tWR9JVdU8d6s2aj1bmoxs8PfD6ri9xptgt2RdUjeiEGYLtLU9k8j4ZP5GsZz4mo2LYKNeiB1eWbMR',
        network: Network.Testnet,
      },
      {
        key: 'Vpub5gJQQ468LLs64BBuNWpnJAitv9sAaTa6jQxAYjQAUdrzMCAgaNFQUn52fR7SPKunFthTcEiM9kjPTdmWRxDWXZPYQTBBCRoYD6vakuwT5nx',
        network: Network.Testnet,
      },
    ] as const

    const expectedMainnetCore = Slip132.toCoreXpubString(XPUB).expect('valid xpub')
    const expectedTestnetCore = Slip132.toCoreXpubString(
      'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj',
    ).expect('valid xpub')

    for (const fixture of fixtures) {
      const coreString = Slip132.toCoreXpubString(fixture.key).expect('valid conversion')
      const expectedCore = fixture.network === Network.Mainnet ? expectedMainnetCore : expectedTestnetCore
      expect(coreString, `Failed for ${fixture.key}`).toEqual(expectedCore)

      // Verify the core string can be parsed by Xpub.fromString
      const xpub = Xpub.fromString(coreString).expect('core xpub should parse')
      expect(xpub.network).toEqual(fixture.network)
    }
  })

  it('getXpubFromString parses both SLIP-132 and core', () => {
    const slip132Keys = [
      'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK',
      'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
      XPUB,
      TPUB_STR,
    ]

    for (const key of slip132Keys) {
      const result = Slip132.getXpubFromString(key)
      expect(result.isOk(), `Should parse ${key}`).toBe(true)
      if (result.isOk()) {
        const xpub = result.unwrap()
        // Verify it's a valid Xpub instance
        expect(xpub.toString().length).toBeGreaterThan(0)
      }
    }
  })

  it('xpubStringSchema schema accepts both SLIP-132 and core', () => {
    const testKeys = [
      XPUB,
      TPUB_STR,
      'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK',
      'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
    ]

    for (const key of testKeys) {
      const result = Slip132.xpubStringSchema.safeParse(key)
      expect(result.success, `Should accept ${key}`).toBe(true)
      if (result.success) {
        // Should output a Xpub object (not a string)
        expect(result.data).toBeInstanceOf(Xpub)
        // When converted to string, should be in core xpub/tpub format
        expect(result.data.toString()).toMatch(/^[xt]pub/)
      }
    }
  })
})

describe('SLIP-132 size limit', () => {
  it('rejects an oversized string before decoding it', () => {
    // Base58 decoding grows quadratically; a 1 MiB string would block for minutes.
    expect(Slip132.toCoreXpubString('z' + '1'.repeat(1_048_576)).unwrapErr().message).toBe(
      'xpub string is longer than 112 characters',
    )
    expect(Slip132.toCoreXpubString('z' + '1'.repeat(111)).unwrapErr().message).not.toContain('longer than')
  })
})
