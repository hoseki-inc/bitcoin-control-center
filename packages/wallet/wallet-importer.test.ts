import { describe, expect, it } from 'vitest'
import {
  DerivationPath,
  KeyExpression,
  type KeyFingerprint,
  KeyOrigin,
  Network,
  type Wallet,
  bs58check,
} from '../bitcoin'
import * as descriptors from '../bitcoin/descriptor_utils'
import { type Result } from '../result'
import * as Slip132 from './slip-132'
import { WalletImporter } from './wallet-importer'

/**
 * Used for descriptors that we could not get a checksum from another source
 */
function withChecksum(str: string) {
  return descriptors.checksum(str).expect('valid checksum')
}

const TEST_XPUB_STR =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'

const TPUB_STR =
  'tpubDD79jZKTZMENaFCfsbnRp3vS3jL4qbrQXUXc8egs34ixe8ovvkUBRx9U1YHkk3aiQfGzLijUEVkjCBSDPT2DxN4NWKzZT9cT3RGkBm7NzcA'

// SLIP-132 keys for singlesig testing
const SLIP132_SINGLESIG_KEYS = {
  xpub: TEST_XPUB_STR,
  ypub: 'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK',
  zpub: 'zpub6njNVV3MN7Ue2nnzmHWJJSm6tEQh8arW5bPNm3iActY6wQrgpbXNsuqewXzJpXJZez6hjZ6U7Bm5scc11Wica21H3LrU8fcVQGuHjMBaFkv',
  tpub: TPUB_STR,
  upub: 'upub5Aa3y9gmchmEnJqQbVaBG1Hb2PgTRUu1W2nGr5EjirehfunYZJhZmbYxqWCNpz2xcnWfzB7foszLTBYBR2eYaqbGheNMD7X43eb4nTMPSAT',
  vpub: 'vpub5VQKGpMgmPJidc2XRrMoU6P6CMpuN6tWR9JVdU8d6s2aj1bmoxs8PfD6ri9xptgt2RdUjeiEGYLtLU9k8j4ZP5GsZz4mo2LYKNeiB1eWbMR',
}

// SLIP-132 keys for multisig testing
const SLIP132_MULTISIG_KEYS = {
  xpub1:
    'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
  xpub2:
    'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
  xpub3:
    'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
  Ypub1:
    'Ypub6eoCK46snPVXc4mFsbBevS1QS4JWQKYbUkWptv5pcezdWVcNLLk6Ly3Sj2zCP3sYUp3srfW2Xjo37VcCb3TYvGSM1UGSxAG12H7Wveierg3',
  Zpub1:
    'Zpub6ydTcimnw531TMxNhwyH8X6uc2SxLwY6Ps33gJyhzfNWZbRbazuey2hakEwnNxXTtTAgc96azQ9aznDmJjsZiW7wsoxsY55VJ1BAKDbQcqw',
  tpub1:
    'tpubD9SUQPXCn2M8bzbcYkv96BuTsRDTEjNZnzwEYoyYCnYEaVtwPW3LnECD9A9vMCwxdcPzrBRDixt2oDsUxyjprz6NNGCveNdkSnNQiB14BAj',
  Upub1:
    'Upub5MU96PRDBfKcCsznYA3A65dPkBiidqabpJRwmLWH6dV7J6MTKi5qriQteD9rPRFrrFaerm7nh6NqaM9wiFoVjKhwY7UkcWz3wNrwNNSoT5x',
  Vpub1:
    'Vpub5gJQQ468LLs64BBuNWpnJAitv9sAaTa6jQxAYjQAUdrzMCAgaNFQUn52fR7SPKunFthTcEiM9kjPTdmWRxDWXZPYQTBBCRoYD6vakuwT5nx',
}

function xpubToTpub(xpub: string) {
  const decoded = bs58check.decode(xpub)
  const versionBytes = Network.Testnet.bip32.publicBuffer
  for (let i = 0; i < 4; i++) {
    const newByte = versionBytes[i]
    if (newByte == null) {
      throw new Error(`did not find testnet version byte at index ${i}`)
    }
    decoded[i] = newByte
  }
  return bs58check.encode(decoded)
}

const SLIP132_MULTISIG_TESTNET_CORE_KEYS = {
  tpub2: xpubToTpub(SLIP132_MULTISIG_KEYS.xpub2),
  tpub3: xpubToTpub(SLIP132_MULTISIG_KEYS.xpub3),
}

/**
 * Asserts that a singlesig wallet uses core xpub/tpub format (not SLIP-132)
 */
function assertSinglesigUsesCore(result: Result<Wallet.Singlesig, Error>, expectedPrefix: 'xpub' | 'tpub') {
  expect(result.isOk()).toBe(true)
  if (result.isOk()) {
    const wallet = result.unwrap()
    const xpubStr = wallet.keyExpression.xpub.toString()
    expect(xpubStr).toMatch(new RegExp(`^${expectedPrefix}`))
    expect(xpubStr).not.toMatch(/^[yYzZuUvV]pub/)
  }
}

/**
 * Asserts that a multisig wallet uses core xpub/tpub format (not SLIP-132)
 */
function assertMultisigUsesCore(result: Result<Wallet.Multisig, Error>, expectedPrefix: 'xpub' | 'tpub') {
  expect(result.isOk()).toBe(true)
  if (result.isOk()) {
    const wallet = result.unwrap()
    for (const ke of wallet.keyExpressions) {
      const xpubStr = ke.xpub.toString()
      expect(xpubStr).toMatch(new RegExp(`^${expectedPrefix}`))
      expect(xpubStr).not.toMatch(/^[yYzZuUvV]pub/)
    }
  }
}

describe('WalletImporter', () => {
  describe('Multisig', () => {
    describe('multisigFromDescriptor()', () => {
      it('accepts Casa descriptor with sufficient derivation paths (2 of 3, threshold 2)', () => {
        // Casa export with 2 of 3 keys having derivation paths (threshold is 2, so this should pass)
        const casaDescriptor = `sh(wsh(sortedmulti(2,[af29b904/]Ypub6ihJP1GWiGzh4wgcmx1n8azoWxa8rsvDjmXLEz9Mk1z64xPFj1cyqBiwtTtvUaiWQJnkuEra7Mo9iZVbgxj8be6M9vmGwwbKixUW9C6GoFD/<0;1>/*,[a6713122/49/0/9]Ypub6iPSKFEXk26Jdhwbahm7fXQRws41PLG7hUaeCRCJQZmU7cdraZ5mBFgSbJUwfBJ6jTKuRvjdACAnU4ufr1h6vwiYyFFngkGgfiCaTPv2eME/<0;1>/*,[e699b76c/49/0/9]Ypub6igtCKM336QNjeE57irwVReUTogipbtuX9pEk2a8Vhz838D7YrXBFiwR9QGrMhD2xqLHrf7yZNRwbAf1Hrijym7oaxj6CqRckGRG3xuseqe/<0;1>/*))`

        const result = WalletImporter.multisigFromDescriptor(casaDescriptor)

        // This should succeed because 2 of 3 keys have derivation paths, which meets the threshold of 2
        expect(result.isOk()).toBe(true)
      })

      it('rejects descriptor with only 1 derivation path when threshold is 2', () => {
        // Create a descriptor with only 1 of 3 keys having derivation path (threshold 2)
        const xpub1 =
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ'
        const xpub2 =
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j'
        const xpub3 =
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m'

        // Only first key has derivation path
        const descriptor = `sh(wsh(sortedmulti(2,[00000000/49/0/0]${xpub1}/<0;1>/*,[11111111/]${xpub2}/<0;1>/*,[22222222/]${xpub3}/<0;1>/*)))`

        const result = WalletImporter.multisigFromDescriptor(descriptor)

        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('only 1 of 3 keystores have derivation paths')
          expect(result.unwrapErr().message).toContain('minimum 2 required for signing')
        }
      })

      it('rejects descriptor with no derivation paths when threshold is 2', () => {
        // Create a descriptor with 0 of 3 keys having derivation path (threshold 2)
        const xpub1 =
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ'
        const xpub2 =
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j'
        const xpub3 =
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m'

        // None of the keys have derivation paths
        const descriptor = `sh(wsh(sortedmulti(2,[00000000/]${xpub1}/<0;1>/*,[11111111/]${xpub2}/<0;1>/*,[22222222/]${xpub3}/<0;1>/*)))`

        const result = WalletImporter.multisigFromDescriptor(descriptor)

        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('none of 3 keystores have derivation paths')
          expect(result.unwrapErr().message).toContain('minimum 2 required for signing')
        }
      })

      it('accepts descriptor with all keys having derivation paths', () => {
        const fingerprint = '00000000' as KeyFingerprint
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin = KeyOrigin.from(fingerprint, derivationPath)

        const xpub1 = Slip132.getXpubFromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const keyExpression1 = KeyExpression.from(xpub1, origin)

        const xpub2 = Slip132.getXpubFromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const keyExpression2 = KeyExpression.from(xpub2, origin)

        const xpub3 = Slip132.getXpubFromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')
        const keyExpression3 = KeyExpression.from(xpub3, origin)

        const descriptor = `sh(wsh(sortedmulti(2,${keyExpression1.toString()}/<0;1>/*,${keyExpression2.toString()}/<0;1>/*,${keyExpression3.toString()}/<0;1>/*)))`

        const result = WalletImporter.multisigFromDescriptor(descriptor)

        expect(result.isOk()).toBe(true)
      })
    })

    describe('multisigFromProps()', () => {
      it('rejects multisig with insufficient derivation paths', () => {
        const fingerprint1 = '00000000' as KeyFingerprint
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin1 = KeyOrigin.from(fingerprint1, derivationPath)

        const fingerprint2 = '11111111' as KeyFingerprint
        const origin2 = KeyOrigin.from(fingerprint2, null) // No derivation path

        const fingerprint3 = '22222222' as KeyFingerprint
        const origin3 = KeyOrigin.from(fingerprint3, null) // No derivation path

        const xpub1 = Slip132.getXpubFromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const xpub2 = Slip132.getXpubFromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const xpub3 = Slip132.getXpubFromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')

        const result = WalletImporter.multisigFromProps({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [
            KeyExpression.from(xpub1, origin1),
            KeyExpression.from(xpub2, origin2),
            KeyExpression.from(xpub3, origin3),
          ],
        })

        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('only 1 of 3 keystores have derivation paths')
          expect(result.unwrapErr().message).toContain('minimum 2 required for signing')
        }
      })

      it('rejects multisig with no derivation paths', () => {
        const fingerprint1 = '00000000' as KeyFingerprint
        const origin1 = KeyOrigin.from(fingerprint1, null) // No derivation path

        const fingerprint2 = '11111111' as KeyFingerprint
        const origin2 = KeyOrigin.from(fingerprint2, null) // No derivation path

        const fingerprint3 = '22222222' as KeyFingerprint
        const origin3 = KeyOrigin.from(fingerprint3, null) // No derivation path

        const xpub1 = Slip132.getXpubFromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const xpub2 = Slip132.getXpubFromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const xpub3 = Slip132.getXpubFromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')

        const result = WalletImporter.multisigFromProps({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [
            KeyExpression.from(xpub1, origin1),
            KeyExpression.from(xpub2, origin2),
            KeyExpression.from(xpub3, origin3),
          ],
        })

        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('none of 3 keystores have derivation paths')
          expect(result.unwrapErr().message).toContain('minimum 2 required for signing')
        }
      })

      it('accepts multisig with sufficient derivation paths', () => {
        const fingerprint = '00000000' as KeyFingerprint
        const derivationPath = new DerivationPath([
          { index: 49, hardened: false },
          { index: 0, hardened: false },
          { index: 0, hardened: false },
        ])
        const origin = KeyOrigin.from(fingerprint, derivationPath)

        const xpub1 = Slip132.getXpubFromString(
          'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ',
        ).expect('valid xpub')
        const xpub2 = Slip132.getXpubFromString(
          'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j',
        ).expect('valid xpub')
        const xpub3 = Slip132.getXpubFromString(
          'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m',
        ).expect('valid xpub')

        const result = WalletImporter.multisigFromProps({
          scriptType: 'p2sh-p2wsh',
          threshold: 2,
          isSorted: true,
          keyExpressions: [
            KeyExpression.from(xpub1, origin),
            KeyExpression.from(xpub2, origin),
            KeyExpression.from(xpub3, origin),
          ],
        })

        expect(result.isOk()).toBe(true)
      })
    })
  })

  describe('Singlesig', () => {
    describe('singlesigFromDescriptor()', () => {
      it('rejects singlesig without key origin', () => {
        const descriptor = `wpkh(${TEST_XPUB_STR}/0/*)`

        const result = WalletImporter.singlesigFromDescriptor(descriptor)
        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('keystore must have derivation path for signing')
        }
      })

      it('accepts singlesig with derivation path', () => {
        const descriptor = `wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)`

        const result = WalletImporter.singlesigFromDescriptor(descriptor)

        expect(result.isOk()).toBe(true)
      })

      it('rejects singlesig with fingerprint but no derivation path', () => {
        const descriptor = `wpkh([00000000/]${TEST_XPUB_STR}/<0;1>/*)`

        const result = WalletImporter.singlesigFromDescriptor(descriptor)

        expect(result.isErr()).toBe(true)
        if (result.isErr()) {
          expect(result.unwrapErr().message).toContain('keystore must have derivation path for signing')
        }
      })
    })
  })

  describe('Checksum validation', () => {
    it('rejects descriptor with invalid checksum', () => {
      const descriptor = `wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)#wrongsum`
      const result = WalletImporter.singlesigFromDescriptor(descriptor)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.unwrapErr().message).toContain('Invalid descriptor checksum')
      }
    })

    it('accepts descriptor with valid checksum', () => {
      const descriptorWithChecksum = withChecksum(`wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)`)
      const result = WalletImporter.singlesigFromDescriptor(descriptorWithChecksum)

      expect(result.isOk()).toBe(true)
    })

    it('accepts descriptor without checksum', () => {
      const result = WalletImporter.singlesigFromDescriptor(`wpkh([00000000/84/0/0]${TEST_XPUB_STR}/<0;1>/*)`)

      expect(result.isOk()).toBe(true)
    })

    it('validates checksum before normalizing SLIP-132 keys', () => {
      const validChecksum = withChecksum(`wpkh([00000000/84/0/0]${SLIP132_SINGLESIG_KEYS.zpub}/<0;1>/*)`)
      const result = WalletImporter.singlesigFromDescriptor(validChecksum)
      assertSinglesigUsesCore(result, 'xpub')
    })

    it('rejects SLIP-132 descriptor with invalid checksum', () => {
      const zpubDescriptor = `wpkh([00000000/84/0/0]${SLIP132_SINGLESIG_KEYS.zpub}/<0;1>/*)#wrongsum`
      const result = WalletImporter.singlesigFromDescriptor(zpubDescriptor)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.unwrapErr().message).toContain('Invalid descriptor checksum')
      }
    })
  })

  describe('SLIP-132 key normalization', () => {
    describe('Singlesig descriptors', () => {
      it('accepts ypub (P2WPKH-in-P2SH) keys and normalizes to xpub', () => {
        const descriptor = `sh(wpkh([00000000/49/0/0]${SLIP132_SINGLESIG_KEYS.ypub}/<0;1>/*))`
        const result = WalletImporter.singlesigFromDescriptor(descriptor)
        assertSinglesigUsesCore(result, 'xpub')
      })

      it('accepts zpub (native segwit) keys and normalizes to xpub', () => {
        const descriptor = `wpkh([00000000/84/0/0]${SLIP132_SINGLESIG_KEYS.zpub}/<0;1>/*)`
        const result = WalletImporter.singlesigFromDescriptor(descriptor)
        assertSinglesigUsesCore(result, 'xpub')
      })

      it('accepts upub (testnet P2WPKH-in-P2SH) keys and normalizes to tpub', () => {
        const descriptor = `sh(wpkh([00000000/49/0/0]${SLIP132_SINGLESIG_KEYS.upub}/<0;1>/*))`
        const result = WalletImporter.singlesigFromDescriptor(descriptor)
        assertSinglesigUsesCore(result, 'tpub')
      })

      it('accepts vpub (testnet native segwit) keys and normalizes to tpub', () => {
        const descriptor = `wpkh([00000000/84/0/0]${SLIP132_SINGLESIG_KEYS.vpub}/<0;1>/*)`
        const result = WalletImporter.singlesigFromDescriptor(descriptor)
        assertSinglesigUsesCore(result, 'tpub')
      })
    })

    describe('Multisig descriptors', () => {
      it('accepts Ypub (P2WSH-in-P2SH multisig) keys and normalizes to xpub', () => {
        const descriptor = `sh(wsh(sortedmulti(2,[00000000/49/0/0]${SLIP132_MULTISIG_KEYS.Ypub1}/<0;1>/*,[11111111/49/0/0]${SLIP132_MULTISIG_KEYS.xpub2}/<0;1>/*,[22222222/49/0/0]${SLIP132_MULTISIG_KEYS.xpub3}/<0;1>/*)))`
        const result = WalletImporter.multisigFromDescriptor(descriptor)
        assertMultisigUsesCore(result, 'xpub')
      })

      it('accepts Zpub (native segwit multisig) keys and normalizes to xpub', () => {
        const descriptor = `wsh(sortedmulti(2,[00000000/84/0/0]${SLIP132_MULTISIG_KEYS.Zpub1}/<0;1>/*,[11111111/84/0/0]${SLIP132_MULTISIG_KEYS.xpub2}/<0;1>/*,[22222222/84/0/0]${SLIP132_MULTISIG_KEYS.xpub3}/<0;1>/*))`
        const result = WalletImporter.multisigFromDescriptor(descriptor)
        assertMultisigUsesCore(result, 'xpub')
      })

      it('accepts Upub (testnet P2WSH-in-P2SH multisig) keys and normalizes to core format', () => {
        const descriptor = `sh(wsh(sortedmulti(2,[00000000/49/0/0]${SLIP132_MULTISIG_KEYS.Upub1}/<0;1>/*,[11111111/49/0/0]${SLIP132_MULTISIG_TESTNET_CORE_KEYS.tpub2}/<0;1>/*,[22222222/49/0/0]${SLIP132_MULTISIG_TESTNET_CORE_KEYS.tpub3}/<0;1>/*)))`
        const result = WalletImporter.multisigFromDescriptor(descriptor)
        assertMultisigUsesCore(result, 'tpub')
      })

      it('accepts Vpub (testnet native segwit multisig) keys and normalizes to core format', () => {
        const descriptor = `wsh(sortedmulti(2,[00000000/84/0/0]${SLIP132_MULTISIG_KEYS.Vpub1}/<0;1>/*,[11111111/84/0/0]${SLIP132_MULTISIG_TESTNET_CORE_KEYS.tpub2}/<0;1>/*,[22222222/84/0/0]${SLIP132_MULTISIG_TESTNET_CORE_KEYS.tpub3}/<0;1>/*))`
        const result = WalletImporter.multisigFromDescriptor(descriptor)
        assertMultisigUsesCore(result, 'tpub')
      })

      it('accepts mixed SLIP-132 and xpub keys', () => {
        const descriptor = `wsh(sortedmulti(2,[00000000/84/0/0]${SLIP132_MULTISIG_KEYS.Zpub1}/<0;1>/*,[11111111/84/0/0]${SLIP132_MULTISIG_KEYS.xpub2}/<0;1>/*,[22222222/84/0/0]${SLIP132_MULTISIG_KEYS.xpub3}/<0;1>/*))`
        const result = WalletImporter.multisigFromDescriptor(descriptor)
        assertMultisigUsesCore(result, 'xpub')
      })

      it('accepts SLIP-132 keys with valid checksum', () => {
        const descriptorBody = `wsh(sortedmulti(2,[00000000/84/0/0]${SLIP132_MULTISIG_KEYS.Zpub1}/<0;1>/*,[11111111/84/0/0]${SLIP132_MULTISIG_KEYS.xpub2}/<0;1>/*,[22222222/84/0/0]${SLIP132_MULTISIG_KEYS.xpub3}/<0;1>/*))`
        const descriptorWithChecksum = withChecksum(descriptorBody)
        const result = WalletImporter.multisigFromDescriptor(descriptorWithChecksum)
        assertMultisigUsesCore(result, 'xpub')
      })
    })
  })
})
