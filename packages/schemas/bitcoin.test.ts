import { expect, expectTypeOf, test } from 'vitest'
import { z } from 'zod'
import { Network } from '../bitcoin'
import * as descriptors from '../bitcoin/descriptor_utils'
import {
  bitcoinAddressDescriptor,
  bitcoinAddressString,
  bitcoinMultisigAccountDescriptor,
  bitcoinNetwork,
  bitcoinSinglesigAccountDescriptor,
  bitcoinXpubStringSchema,
} from './bitcoin'

const MAINNET_ADDRESSES = [
  '1NjTazSa3aYDABH7U2kaLNAqHZgvFbHBw6',
  '39yG6EqHcwGva1gVB8wicgmu6iPBjLtxCw',
  'bc1qae3yup8ulj732scv3y3k2lr58kuqe7mxhnena8',
  'bc1pxp8gkh6989s3530patyzxa690w8etuqgxdt8exn6hm5c3gy8pavs3uxd2s',
]

const TESTNET_ADDRESSES = [
  'n3FQt3XYrbyTwHkjBbixAHPA9ZHdCqtApC',
  '2N1XU9ymKEPnGmoK2rGZbEdmAK4bMU1txgR',
  'tb1qae3yup8ulj732scv3y3k2lr58kuqe7mxa4zqx5',
  'tb1pxp8gkh6989s3530patyzxa690w8etuqgxdt8exn6hm5c3gy8pavsx5szsl',
]

const REGTEST_ADDRESSES = [
  'bcrt1qae3yup8ulj732scv3y3k2lr58kuqe7mxlumd3a',
  'bcrt1pxp8gkh6989s3530patyzxa690w8etuqgxdt8exn6hm5c3gy8pavstd6y99',
]

const ADDRESS_FIXTURES = [...MAINNET_ADDRESSES, ...TESTNET_ADDRESSES, ...REGTEST_ADDRESSES]

test('bitcoinAddressString', () => {
  for (const fixture of ADDRESS_FIXTURES) {
    const address = bitcoinAddressString.safeParse(fixture)
    expect(address.success, fixture).toEqual(true)
  }
})

test('bitcoinAddressDescriptor', () => {
  for (const fixture of ADDRESS_FIXTURES) {
    const address = bitcoinAddressDescriptor.safeParse(`addr(${fixture})`)
    expect(address.success, fixture).toEqual(true)
  }
})

const XPUB =
  'xpub694qt9hX4kPgLCQm6Zw3tGa6YJ7oFLsWFNLwCFvPrsnLqDEEKHCFdnXNu858phziqhs6EbuMBs3z73Nsa7tayYe5JfTcxqyWrpmzxAgPbcD'
const TPUB =
  'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj'

const XPUB_FIXTURES = [XPUB, TPUB]

test('bitcoinXpubStringSchema - accepts only core xpub/tpub', () => {
  for (const fixture of XPUB_FIXTURES) {
    const xpub = bitcoinXpubStringSchema.safeParse(fixture)
    expect(xpub.success, fixture).toEqual(true)
  }
})

test('bitcoinXpubStringSchema - rejects SLIP-132 extended public keys', () => {
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
    const result = bitcoinXpubStringSchema.safeParse(key)
    expect(result.success, `Should reject SLIP-132 key: ${key}`).toEqual(false)
  }
})

const SINGLESIG_SCRIPT_FIXTURES = ['p2pkh', 'p2sh-p2wpkh', 'p2wpkh', 'p2tr'] as const

const ADDRESS_RANGE_FIXTURES = ['0', '<0;1>']

function wrapScript(script: (typeof SINGLESIG_SCRIPT_FIXTURES)[number], span: string) {
  switch (script) {
    case 'p2pkh':
      return descriptors.pkh(span)
    case 'p2sh-p2wpkh':
      return descriptors.sh(descriptors.wpkh(span))
    case 'p2wpkh':
      return descriptors.wpkh(span)
    case 'p2tr':
      return descriptors.tr(span)
  }
}

test('bitcoinSinglesigAccountDescriptor', () => {
  for (const fixture of XPUB_FIXTURES) {
    for (const script of SINGLESIG_SCRIPT_FIXTURES) {
      for (const range of ADDRESS_RANGE_FIXTURES) {
        const descriptor: string = wrapScript(script, `${fixture}/${range}/*`)
        let account = bitcoinSinglesigAccountDescriptor.safeParse(descriptor)
        expect(account.success, descriptor).toEqual(true)

        const withChecksum = descriptors.checksum(descriptor).expect('valid checksum')
        account = bitcoinSinglesigAccountDescriptor.safeParse(withChecksum)
        expect(account.success, descriptor).toEqual(true)
      }
    }
  }
})

const MULTISIG_XPUB_1 =
  'xpub6CtjWkC5yoLM9Ch2t3uizXEA3FX1tVHnRNqERyTR9eQFzB8xFBDY8XREyjfrHNvX3jrg2nDzi6NEUX2PC1hFKHY5JU1vHPwsBBm9ECjmJo5'
const MULTISIG_XPUB_2 =
  'xpub6CDzRgxbbJwUSn6wkhVepiHoSQ68K1cV3kkZvg3SZR926R2n2VBUJb9feW8duhgbFvTWxzjEv5TpzRop2sNyiQfAStWv4aAwKhzDCrHNwfe'
const MULTISIG_XPUB_3 =
  'xpub6DFvDdFakAWiAXz6At8B66TadzP7S8f8Wrm2VcNtjeXQUMKZDTBEZUaS7KpnkpvbNRAsMaoab1YMPGcCxcxQWmWpMPwiNBvkzvHifDzq2Vi'

const MULTISIG_TPUB_1 =
  'tpubDA5fLNXHCWA66cw48AsL7YzzBxRfTfisx6d56gaYqPhNYGzdQjNYy6w3c26dY1YXc346MtPsuFXfpaaPochNmBVFB7H2gUGjUgorGy7Ntz4'
const MULTISIG_TPUB_2 =
  'tpubD8TtvT4c31CABVQN8UiwAVGC2SqNLJ9rquQ2dXTvsjpXJx2Dgb6isqZudFN925CDPhW2erxLraNZq1VHLVLdTsiBS7aHhHGMkAMFvuAUqwB'
const MULTISIG_TPUB_3 =
  'tpubD9cuoeUV5JFyKDvKXHJ4x9rEUSHG37RsSRuoTi1BfeZzghBdc84pnNCXYj3CkLx3KivSVwvnTFKQF6v8f8UUApaqBN6i8L2ck1cWKN6qeHZ'

const MULTISIG_THRESHOLD = 2

const MULTISIG_SCRIPT_FIXTURES = ['p2sh', 'p2sh-p2wsh', 'p2wsh'] as const

const MULTI_FIXTURES = ['multi', 'sortedmulti'] as const

function wrapMultiScript(
  script: (typeof MULTISIG_SCRIPT_FIXTURES)[number],
  multi: (typeof MULTI_FIXTURES)[number],
  span: string[],
) {
  switch (script) {
    case 'p2sh':
      return descriptors.sh(descriptors[multi](MULTISIG_THRESHOLD, span))
    case 'p2sh-p2wsh':
      return descriptors.sh(descriptors.wsh(descriptors[multi](MULTISIG_THRESHOLD, span)))
    case 'p2wsh':
      return descriptors.wsh(descriptors[multi](MULTISIG_THRESHOLD, span))
  }
}

const MULTISIG_XPUB_FIXTURES = [
  [MULTISIG_XPUB_1, MULTISIG_XPUB_2, MULTISIG_XPUB_3],
  [MULTISIG_TPUB_1, MULTISIG_TPUB_2, MULTISIG_TPUB_3],
]

test('bitcoinMultisigAccountDescriptor', () => {
  for (const fixture of MULTISIG_XPUB_FIXTURES) {
    for (const script of MULTISIG_SCRIPT_FIXTURES) {
      for (const multi of MULTI_FIXTURES) {
        for (const range of ADDRESS_RANGE_FIXTURES) {
          const accountRanges = fixture.map((xpub) => `${xpub}/${range}/*`)
          const descriptor: string = wrapMultiScript(script, multi, accountRanges)
          let account = bitcoinMultisigAccountDescriptor.safeParse(descriptor)
          expect(account.success, descriptor).toEqual(true)
        }
      }
    }
  }
})

test('bitcoinNetwork', () => {
  // Make a generic schema that accepts a dummy object
  const dummy = z.object({
    dummy: z.literal(true),
    network: z.custom<Network | (() => Network)>((value) => value),
  })
  const schema = bitcoinNetwork(dummy, [Network.Mainnet])

  // Check that the schema outputs the inferred type
  let typeCheck = schema.parse({
    dummy: true,
    network: Network.Mainnet,
  })
  expectTypeOf(typeCheck).toEqualTypeOf<z.infer<typeof schema>>()

  // Check that the schema accepts a Network
  let parsed = schema.safeParse({
    dummy: true,
    network: Network.Mainnet,
  })
  expect(parsed.success).toEqual(true)

  // Check that the schema accepts a function that returns the network
  parsed = schema.safeParse({
    dummy: true,
    network: () => Network.Mainnet,
  })
  expect(parsed.success).toEqual(true)

  // Check that the schema rejects a different Network
  parsed = schema.safeParse({
    dummy: true,
    network: Network.Testnet,
  })
  expect(parsed.success).toEqual(false)
})
