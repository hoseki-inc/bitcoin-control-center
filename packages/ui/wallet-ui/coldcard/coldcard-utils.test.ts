import { describe, expect, it } from 'vitest'
import { parseGenericJsonFile, parseSignatureFile } from './coldcard-utils'

// Run: cd packages/ui/wallet-ui && pnpm test:unit --run coldcard/coldcard-utils.test.ts

/*
This is a valid `hoseki-signed.txt` file:

-----BEGIN BITCOIN SIGNED MESSAGE-----
Hoseki Proof message. Nonce: whatever
-----BEGIN BITCOIN SIGNATURE-----
bc1qpe3cnfcrarvw8gwfksl66vg9p0hpu45ltrq3hn
KPtrDURWCLKVKxijWHFj66uc/+zhKhZ7jw0mdQmI5hHIabaMCwc5kI5aOPV0UgkHXgf/sC++nmh1tsgokZpgQMU=
-----END BITCOIN SIGNATURE-----
*/

describe('coldcard-utils', () => {
  describe('parseSignatureFile', () => {
    it('should parse a valid file', () => {
      const result = parseSignatureFile(createSignedFileContents())
      expect(result.isOk()).toBe(true)

      const { message, address, signature } = result.expect('valid file')
      expect(message).toBe('Hoseki Proof message. Nonce: whatever')
      expect(address.toString()).toBe('bc1qpe3cnfcrarvw8gwfksl66vg9p0hpu45ltrq3hn')
      expect(signature).toBe('KPtrDURWCLKVKxijWHFj66uc/+zhKhZ7jw0mdQmI5hHIabaMCwc5kI5aOPV0UgkHXgf/sC++nmh1tsgokZpgQMU=')
    })

    it('should fail when file is empty', () => {
      expect(parseSignatureFile('').isErr()).toBe(true)
    })

    it('should fail when message is empty', () => {
      const result = parseSignatureFile(createSignedFileContents({ message: '' }))
      expect(result.isErr()).toBe(true)
    })

    it("should fail when address isn't valid", () => {
      const result = parseSignatureFile(createSignedFileContents({ address: 'not an address' }))
      expect(result.isErr()).toBe(true)
    })

    it('should fail when signature is empty', () => {
      const result = parseSignatureFile(createSignedFileContents({ signature: '' }))
      expect(result.isErr()).toBe(true)
    })
  })

  describe('parseGenericJsonFile', () => {
    it('should parse valid Coldcard JSON files', () => {
      expect(parseGenericJsonFile(JSON.stringify(coldcardJson_Mk4)).isOk()).toBe(true)
      expect(parseGenericJsonFile(JSON.stringify(coldcardJson_Q)).isOk()).toBe(true)
      expect(parseGenericJsonFile(JSON.stringify(coldcardJson_Minimal)).isOk()).toBe(true)
    })

    it('should fail when JSON is invalid', () => {
      expect(parseGenericJsonFile('invalid json').isErr()).toBe(true)
      expect(parseGenericJsonFile('{}').isErr()).toBe(true)

      const jsonWithBip44Missing = { ...coldcardJson_Mk4 }
      // @ts-expect-error: bip44 is required, so deleting it causes a TS error. But we want to delete it to test an "invalid" JSON file.
      delete jsonWithBip44Missing.bip44
      expect(parseGenericJsonFile(JSON.stringify(jsonWithBip44Missing)).isErr()).toBe(true)

      const jsonWithBip44ScriptTypeMissing = { ...coldcardJson_Mk4 }
      // @ts-expect-error: see above
      delete jsonWithBip44ScriptTypeMissing.bip44.name
      expect(parseGenericJsonFile(JSON.stringify(jsonWithBip44ScriptTypeMissing)).isErr()).toBe(true)

      const jsonWithBip44XpubMissing = { ...coldcardJson_Mk4 }
      // @ts-expect-error: see above
      delete jsonWithBip44XpubMissing.bip44.xpub
      expect(parseGenericJsonFile(JSON.stringify(jsonWithBip44XpubMissing)).isErr()).toBe(true)
    })
  })
})

function createSignedFileContents({
  message = 'Hoseki Proof message. Nonce: whatever',
  address = 'bc1qpe3cnfcrarvw8gwfksl66vg9p0hpu45ltrq3hn',
  signature = 'KPtrDURWCLKVKxijWHFj66uc/+zhKhZ7jw0mdQmI5hHIabaMCwc5kI5aOPV0UgkHXgf/sC++nmh1tsgokZpgQMU=',
} = {}) {
  return `-----BEGIN BITCOIN SIGNED MESSAGE-----
${message}
-----BEGIN BITCOIN SIGNATURE-----
${address}
${signature}
-----END BITCOIN SIGNATURE-----`
}

// This structure is similar to the one returned by the Coldcard Mk4 Alex has
const coldcardJson_Mk4 = {
  chain: 'BTC',
  xfp: 'EDB96AC7',
  account: 0,
  xpub: 'xpub661MyMwAqRbcEvRJTTnwAQh2ZUbCiW34CXh54ymLpais2t7BywXwPTJMRziLkq4ojy6LLzP5LhSVuyUQWNGG5qDngbKN4PqweGCiVmvnWDZ',
  bip44: {
    name: 'p2pkh',
    xfp: 'B0773031',
    deriv: "m/44'/0'/0'",
    xpub: 'xpub6CRWpUWi2XwNArzzK1vQSJLsA9u5AY38PHxQW5hqxgXobYPpnFw8J1n4kPDK12k1YCA9kritvLF6s9cQorFfKeS7t2G3tHqe62QKwxRmHd8',
    desc: 'pkh([edb96ac7/44h/0h/0h]xpub6CRWpUWi2XwNArzzK1vQSJLsA9u5AY38PHxQW5hqxgXobYPpnFw8J1n4kPDK12k1YCA9kritvLF6s9cQorFfKeS7t2G3tHqe62QKwxRmHd8/<0;1>/*)#8tqzc66w',
    first: '17FwE4mruer6CbvbZc8bYC911hm4mQ7fHj',
  },
  bip49: {
    name: 'p2sh-p2wpkh',
    xfp: '2E8B3E20',
    deriv: "m/49'/0'/0'",
    xpub: 'xpub6CCmAbq5HNJKAFgN54sTdd9sBoTaRvbjxk5ceajuGfX3zHhvUHi52MEmGfAi1koH2XLzojc6DFTQdG7nSGFyprzzPF5CEKe3KZfTBvUoRM2',
    desc: 'sh(wpkh([edb96ac7/49h/0h/0h]xpub6CCmAbq5HNJKAFgN54sTdd9sBoTaRvbjxk5ceajuGfX3zHhvUHi52MEmGfAi1koH2XLzojc6DFTQdG7nSGFyprzzPF5CEKe3KZfTBvUoRM2/<0;1>/*))#agfrc0u3',
    _pub: 'ypub6X32UGVzS3qo1YsUuRf5qiFNMmc2NYbEsrbqRydneftw3PX9iwsdeQtuHs8J1fTCSAToZDCefuoxWYjM9xfzd6gbFamcpETXbHj6aadzBix',
    first: '3LrU29MLFbqPhfCcVaQF5nFENq2YfYFrND',
  },
  bip84: {
    name: 'p2wpkh',
    xfp: '4B6CC155',
    deriv: "m/84'/0'/0'",
    xpub: 'xpub6CkevFFTpYk65GvGvQ6XoSDLMjKozZmnKEfth8CsPaMFczCMA2KLVuVQXn4osb8rp7wmohCuDm9AnrSiL1y4KYyXScmmivLYpsqpDH5Ahib',
    desc: 'wpkh([edb96ac7/84h/0h/0h]xpub6CkevFFTpYk65GvGvQ6XoSDLMjKozZmnKEfth8CsPaMFczCMA2KLVuVQXn4osb8rp7wmohCuDm9AnrSiL1y4KYyXScmmivLYpsqpDH5Ahib/<0;1>/*)#s9jrc5u3',
    _pub: 'zpub6rRBXabJ7uq3msJWb7fnDcQLhfchsokn9TiLFuze9b71jBpofLeTk2ogaByysQShdQBPJeQ295rGZRfqmQo5v2LjBJActjyXNKy6zT2t1zC',
    first: 'bc1qpe3cnfcrarvw8gwfksl66vg9p0hpu45ltrq3hn',
  },
  bip48_1: {
    name: 'p2sh-p2wsh',
    xfp: 'C79C987F',
    deriv: "m/48'/0'/0'/1'",
    xpub: 'xpub6DnAvkgCABsaVeRMqQ9ExiQNkYpWqgiPna9BWiLZUofgqGkupiukfzGT12ZnetYpKWXi5vsrB4wc2Q77tRVpRELDSWzjj4r8Pwev99vSnMt',
    desc: "sh(wsh(sortedmulti(M,[edb96ac7/48'/0'/0'/1']xpub6DnAvkgCABsaVeRMqQ9ExiQNkYpWqgiPna9BWiLZUofgqGkupiukfzGT12ZnetYpKWXi5vsrB4wc2Q77tRVpRELDSWzjj4r8Pwev99vSnMt/0/*,...)))",
    _pub: 'Ypub6jWXMf5YspyRmWmrcRPqzsqgeK1DzfPV1xK5DNVzEasyWZ93qnTbPAnWpwUrDERdxciVhzUXWwgf2rLSuM4nMx8V9KoZiP8cZPzS7ggnYH8',
  },
  bip48_2: {
    name: 'p2wsh',
    xfp: '66939A68',
    deriv: "m/48'/0'/0'/2'",
    xpub: 'xpub6DnAvkgCABsaXgxw2qfFAHoN1eFtjpm6oPxUxMad97C6YLwykZUUkgsN3E5dWn1fAwfB1wQhL5NLFyYiTwUVsrh1w9pvTZgL9uzFwVNKxFL',
    desc: "wsh(sortedmulti(M,[edb96ac7/48'/0'/0'/2']xpub6DnAvkgCABsaXgxw2qfFAHoN1eFtjpm6oPxUxMad97C6YLwykZUUkgsN3E5dWn1fAwfB1wQhL5NLFyYiTwUVsrh1w9pvTZgL9uzFwVNKxFL/0/*,...))",
    _pub: 'Zpub74LnfKkU2WWuerWYeDhUQYLB5Nb3qRRgwtebSQdwGtnGGj9M2HBt5w3ZtLxH52YQDgxmPUbw8cTw9iPcCZTUcpAtWJLB2nnJb6PRJXShDaH',
  },
  bip45: {
    name: 'p2sh',
    xfp: '8D5740F2',
    deriv: "m/45'",
    xpub: 'xpub69dqoaCo8eZQW9j5xvfvWw7BqBSH7Mbm86dUxfDS4PDMg44rrzZAacgpumGBHEtxe9DURBsThZ7Gmb3bjXH37Ns6e9qibRGttC9QFHAbhmj',
    desc: "sh(sortedmulti(M,[edb96ac7/45']xpub69dqoaCo8eZQW9j5xvfvWw7BqBSH7Mbm86dUxfDS4PDMg44rrzZAacgpumGBHEtxe9DURBsThZ7Gmb3bjXH37Ns6e9qibRGttC9QFHAbhmj/0/*,...))",
  },
}

// This structure is similar to the one returned by the Coldcard Q Cory has
const coldcardJson_Q = {
  chain: 'BTC',
  xfp: '76785419',
  account: 0,
  xpub: 'xpub661MyMwAqRbcEvRJTTnwAQh2ZUbCiW34CXh54ymLpais2t7BywXwPTJMRziLkq4ojy6LLzP5LhSVuyUQWNGG5qDngbKN4PqweGCiVmvnWDZ',
  bip44: {
    name: 'p2pkh',
    xfp: '104421C6',
    deriv: "m/44'/0'/0'",
    xpub: 'xpub6CRWpUWi2XwNArzzK1vQSJLsA9u5AY38PHxQW5hqxgXobYPpnFw8J1n4kPDK12k1YCA9kritvLF6s9cQorFfKeS7t2G3tHqe62QKwxRmHd8',
    first: '17FwE4mruer6CbvbZc8bYC911hm4mQ7fHj',
  },
  bip49: {
    name: 'p2sh-p2wpkh',
    xfp: '7736F97A',
    deriv: "m/49'/0'/0'",
    xpub: 'xpub6CCmAbq5HNJKAFgN54sTdd9sBoTaRvbjxk5ceajuGfX3zHhvUHi52MEmGfAi1koH2XLzojc6DFTQdG7nSGFyprzzPF5CEKe3KZfTBvUoRM2',
    _pub: 'ypub6X32UGVzS3qo1YsUuRf5qiFNMmc2NYbEsrbqRydneftw3PX9iwsdeQtuHs8J1fTCSAToZDCefuoxWYjM9xfzd6gbFamcpETXbHj6aadzBix',
    first: '3LrU29MLFbqPhfCcVaQF5nFENq2YfYFrND',
  },
  bip84: {
    name: 'p2wpkh',
    xfp: '65565617',
    deriv: "m/84'/0'/0'",
    xpub: 'xpub6CkevFFTpYk65GvGvQ6XoSDLMjKozZmnKEfth8CsPaMFczCMA2KLVuVQXn4osb8rp7wmohCuDm9AnrSiL1y4KYyXScmmivLYpsqpDH5Ahib',
    _pub: 'zpub6rRBXabJ7uq3msJWb7fnDcQLhfchsokn9TiLFuze9b71jBpofLeTk2ogaByysQShdQBPJeQ295rGZRfqmQo5v2LjBJActjyXNKy6zT2t1zC',
    first: 'bc1qpe3cnfcrarvw8gwfksl66vg9p0hpu45ltrq3hn',
  },
  bip48_1: {
    name: 'p2sh-p2wsh',
    xfp: 'C79C987F',
    deriv: "m/48'/0'/0'/1'",
    xpub: 'xpub6DnAvkgCABsaVeRMqQ9ExiQNkYpWqgiPna9BWiLZUofgqGkupiukfzGT12ZnetYpKWXi5vsrB4wc2Q77tRVpRELDSWzjj4r8Pwev99vSnMt',
    _pub: 'Ypub6jWXMf5YspyRmWmrcRPqzsqgeK1DzfPV1xK5DNVzEasyWZ93qnTbPAnWpwUrDERdxciVhzUXWwgf2rLSuM4nMx8V9KoZiP8cZPzS7ggnYH8',
  },
  bip48_2: {
    name: 'p2wsh',
    xfp: '66939A68',
    deriv: "m/48'/0'/0'/2'",
    xpub: 'xpub6DnAvkgCABsaXgxw2qfFAHoN1eFtjpm6oPxUxMad97C6YLwykZUUkgsN3E5dWn1fAwfB1wQhL5NLFyYiTwUVsrh1w9pvTZgL9uzFwVNKxFL',
    _pub: 'Zpub74LnfKkU2WWuerWYeDhUQYLB5Nb3qRRgwtebSQdwGtnGGj9M2HBt5w3ZtLxH52YQDgxmPUbw8cTw9iPcCZTUcpAtWJLB2nnJb6PRJXShDaH',
  },
  bip45: {
    name: 'p2sh',
    xfp: '8D5740F2',
    deriv: "m/45'",
    xpub: 'xpub69dqoaCo8eZQW9j5xvfvWw7BqBSH7Mbm86dUxfDS4PDMg44rrzZAacgpumGBHEtxe9DURBsThZ7Gmb3bjXH37Ns6e9qibRGttC9QFHAbhmj',
    _pub: 'xpub69dqoaCo8eZQW9j5xvfvWw7BqBSH7Mbm86dUxfDS4PDMg44rrzZAacgpumGBHEtxe9DURBsThZ7Gmb3bjXH37Ns6e9qibRGttC9QFHAbhmj',
  },
}

// This structure is the the theoretical minimal structure of a Coldcard JSON file
const coldcardJson_Minimal = {
  chain: 'BTC',
  account: 69,
  xpub: 'xpub661MyMwAqRbcEvRJTTnwAQh2ZUbCiW34CXh54ymLpais2t7BywXwPTJMRziLkq4ojy6LLzP5LhSVuyUQWNGG5qDngbKN4PqweGCiVmvnWDZ',
  bip44: {
    name: 'p2pkh',
    deriv: "m/44'/0'/0'",
    xpub: 'xpub6CRWpUWi2XwNArzzK1vQSJLsA9u5AY38PHxQW5hqxgXobYPpnFw8J1n4kPDK12k1YCA9kritvLF6s9cQorFfKeS7t2G3tHqe62QKwxRmHd8',
  },
}
