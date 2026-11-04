import { describe, expect, it } from 'vitest'
import { validateBitcoinStringInput } from './form-utils'

// Run: cd apps/control-center && pnpm test:unit --run src/utils/form-utils.test.ts

describe('validateBitcoinStringInput', () => {
  it('should not parse addresses', () => {
    const addresses = [
      '1DEHepkTv7vix38wQoRb7e16oZ3wU5BzBz',
      '3NkucHdjn2MnqYoG5tgVwqeFiqUd1HTT8f',
      'bc1qscjdzs2wgjcnwsdaeddtv7dr88a5qq4hmwn3dt',
      'bc1pzqwutd8tckudavxnc4g3h6mdz34wv4vxk9u4hxpql84perarckcsq9p58z',
    ]
    addresses.forEach((address) => {
      expect(validateBitcoinStringInput(address).isOk()).toBe(false)
    })
  })

  it('should parse xpubs', () => {
    const xpubs = [
      'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr',
      'ypub6XdaPkJJ5361RUQKVeNY6yCdjpjzzSNpyCdLpBkcgtiQZR6hDCnorjWrpzJGaKYPjaFjE7vC2jLL7MV3SB6rs66kfCYAEsYxyHZTuKRxKNu',
      'zpub6rTqhQyDDidVGmbSL1AAK4J8untSw4NKtK9ZbaeW4u6HcWuvTrxNUoAzrCFraECK9DNXybWkVPgsze6c9sWsfKnMXYEapnNTF1d7Hv5PP31',
      'Ypub6iXfWz2jdzeNr3ZhSJqWw3YSTcnGCo4RHUH1jT2A4fYpBbfbycB5wrNndhFk8kmHy3Ki6hvJuwiqEX6ojQFp1aDRVfeZeH1xs1qLVKb5G4r',
      'Zpub73MvpehengBrhLkpGfd998dwdavi9R3vCaoEWqv3SfvhEhUqEGLeZv2veuDL8fRDNgSWrBWsNc5P7oiNT6fpoou2N1LzEBqT8jtysu74t6Y',
    ]
    xpubs.forEach((xpub) => {
      expect(validateBitcoinStringInput(xpub).isOk()).toBe(true)
    })
  })

  it('should parse xpub descriptors', () => {
    const xpubDescriptors = [
      // Descriptors I found elsewhere in the codebase:
      'pkh(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)#kdnywuy7',
      'sh(wpkh(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*))#una0ueqx',
      'wpkh(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)#l3xcgp8q',
      'tr(xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr/<0;1>/*)#40y9k7ac',

      // Cory's test descriptors:
      'wpkh([3e6bae7c/84h/0h/0h]xpub6CgLXnBK8dLAT8icUHZsExdvy56yAqB9MS4aRwNyYvQjndS735FLj1nxYgTEXtHvfRroGEzWB5BULt7TjpyWnhRb72PkTtLpv9o2mgBhFtJ/<0;1>/*)#9gdugsd3',
      'wpkh([4ba23434/84h/0h/0h]xpub6CuqJBKbFCUtFN7LzSTudQDcqmLRNqkRc3Vqh2GpV22Dqwng1mqt2Cpa2VCsZzKDG9WyDtZDnyUZETwQEVkeZw6TE5aKh1hyKE5gNKe6Lum/<0;1>/*)#srgtdj8q',
      'wpkh([819ce748/84h/0h/0h]xpub6C5oJL7HGMwxy573YBa2WTDkNAvTnTCfZ1i7E5NLKJAYN6mpTsyywwCA1Q62zsTfN2DVCFzsw9K98WnoYPuBxW1f7orRxHcmGRiUXh2AenY/<0;1>/*)#z6kkc5pu',

      // Ben's test descriptors:
      'wpkh([3f4f4355/84h/0h/0h]xpub6C7d2pydYV48ygeZ2FYAywzkU6gBzVdSXyUHpf9wyuFmKkkLAbicWUzwSNDKH9sDGhn3DaVY3cLBwFBwnS4jTBJ7ZFbjXVJmBcdjvQQ7xke/<0;1>/*)#36272g6r',
    ]
    xpubDescriptors.forEach((xpubDescriptor) => {
      expect(validateBitcoinStringInput(xpubDescriptor).isOk()).toBe(true)
    })
  })

  describe('private keys', () => {
    const privateKeyError = "That's a private key. Paste the public key (xpub) or a watch-only descriptor."
    // BIP32 test vectors 1 (m, m/0H): published vectors, not real wallets.
    const xprv =
      'xprv9s21ZrQH143K3QTDL4LXw2F7HEK3wJUD2nW2nRk4stbPy6cq3jPPqjiChkVvvNKmPGJxWUtg6LnF5kejMRNNU3TGtRBeJgk33yuGBxrMPHi'
    const xpub =
      'xpub69H7F5d8KSRgmmdJg2KhpAK8SR3DjMwAdkxj3ZuxV27CprR9LgpeyGmXUbC6wb7ERfvrnKZjXoUmmDznezpbZb7ap6r1D3tgFxHmwMkQTPH'

    it.each(['xprv', 'yprv', 'zprv', 'tprv', 'uprv', 'vprv', 'Yprv', 'Zprv', 'Uprv', 'Vprv'])(
      'should reject a %s key as the only input',
      (prefix) => {
        const result = validateBitcoinStringInput(`${prefix}${xprv.slice(4)}`)
        expect(result.isErr() && result.unwrapErr()).toBe(privateKeyError)
      },
    )

    it.each([
      ['a singlesig descriptor', `wpkh([3442193e/84h/0h/0h]${xprv}/<0;1>/*)`],
      ['a later key of a singlesig descriptor', `tr(${xpub}/<0;1>/*,pk(${xprv}/<0;1>/*))`],
      ['the first key of a multisig descriptor', `wsh(sortedmulti(2,${xprv}/<0;1>/*,${xpub}/<0;1>/*))`],
      ['a later key of a multisig descriptor', `wsh(sortedmulti(2,${xpub}/<0;1>/*,${xprv}/<0;1>/*))`],
    ])('should reject a private key in %s', (_, descriptor) => {
      const result = validateBitcoinStringInput(descriptor)
      expect(result.isErr() && result.unwrapErr()).toBe(privateKeyError)
    })

    it('should keep the generic error for other invalid input', () => {
      const result = validateBitcoinStringInput(`wsh(sortedmulti(2,${xpub}/<0;1>/*,${xpub}/<0;1>/*))`)
      expect(result.isErr() && result.unwrapErr()).toBe(
        'Invalid input, please enter a valid account descriptor or xPub/yPub/zPub key',
      )
    })
  })
})
