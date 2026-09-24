import { describe, expect, it } from 'vitest'
import { MultisigDescriptorParser, SinglesigDescriptorParser } from './descriptor_parsers'
import * as descriptors from './descriptor_utils'
import { Network } from './network'
import { Xpub } from './xpub'

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

describe('SinglesigDescriptorParser with core xpub/tpub', () => {
  it('parses descriptor with xpub (mainnet)', () => {
    const descriptor = `wpkh(${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    const expectedXpub = Xpub.fromString(TEST_XPUB_STR).expect('valid xpub')
    expect(result.keyExpression.xpub.toString()).toEqual(expectedXpub.toString())
    expect(result.keyExpression.xpub.network).toEqual(Network.Mainnet)
    expect(result.scriptType).toBe('p2wpkh')
  })

  it('parses descriptor with tpub (testnet)', () => {
    const descriptor = `wpkh(${TPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    const expectedXpub = Xpub.fromString(TPUB_STR).expect('valid xpub')
    expect(result.keyExpression.xpub.toString()).toEqual(expectedXpub.toString())
    expect(result.keyExpression.xpub.network).toEqual(Network.Testnet)
    expect(result.scriptType).toBe('p2wpkh')
  })

  it('parses descriptor with key origin', () => {
    const descriptor = `wpkh([00000000/84h/0h/0h]${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpression.xpub.network).toEqual(Network.Mainnet)
    expect(result.keyExpression.keyOrigin?.fingerprint).toBe('00000000')
    expect(result.scriptType).toBe('p2wpkh')
  })

  it('parses descriptor with address ranges', () => {
    const descriptor = `wpkh(${TEST_XPUB_STR}/<0;1>/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpression.xpub.network).toEqual(Network.Mainnet)
    expect(result.scriptType).toBe('p2wpkh')
  })

  it('parses descriptor with checksum', () => {
    const descriptor = withChecksum(`wpkh(${TEST_XPUB_STR}/0/*)`)
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpression.xpub.network).toEqual(Network.Mainnet)
    expect(result.scriptType).toBe('p2wpkh')
  })

  it('parses P2SH-P2WPKH descriptor', () => {
    const descriptor = `sh(wpkh(${TEST_XPUB_STR}/0/*))`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.scriptType).toBe('p2sh-p2wpkh')
  })

  it('parses descriptor with no key origin (keyOrigin is null)', () => {
    const descriptor = `wpkh(${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpression.keyOrigin).toBeNull()
  })

  it('parses descriptor with fingerprint but no derivation path', () => {
    const descriptor = `wpkh([00000000/]${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpression.keyOrigin?.fingerprint).toBe('00000000')
    expect(result.keyExpression.keyOrigin?.derivationPath).toBeNull()
  })

  it('rejects descriptor containing SLIP-132 ypub/zpub/etc keys', () => {
    const ypub =
      'ypub6Tu7BpNSDRwABVbsvvig6MfbiGGFBxs1AUs9yepHEtADtK3TZwMpFrBWvL2ipceeFLytz5VueXQXzKzSHpJbmnKgB1A3Yko18YqeLgRr4VK'
    const descriptor = `wpkh(${ypub}/0/*)`

    const result = SinglesigDescriptorParser.parse(descriptor)
    expect(result.isErr()).toBe(true)
  })

  it('rejects invalid fingerprint format', () => {
    const descriptor = `wpkh([zzzzzzzz/84h/0h/0h]${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor)
    expect(result.isErr()).toBe(true)
  })

  it('rejects invalid derivation path format', () => {
    const descriptor = `wpkh([00000000/84x/0h/0h]${TEST_XPUB_STR}/0/*)`
    const result = SinglesigDescriptorParser.parse(descriptor)
    expect(result.isErr()).toBe(true)
  })

  it('rejects checksum mismatch', () => {
    const desc = `wpkh(${TEST_XPUB_STR}/0/*)`
    const descriptor = `${desc}#deadbeef` // intentionally wrong
    const result = SinglesigDescriptorParser.parse(descriptor)
    expect(result.isErr()).toBe(true)
  })
})

describe('MultisigDescriptorParser with core xpub/tpub', () => {
  const MULTISIG_XPUB_1 =
    'xpub6DRLRDFmCH8MNwepL9RMBjRv5P2XidDj2uZ9NpFwx33uEu8NcoDHkipwtrZ17iaZmKWMfaBCeaNHWWd7AXN3YaRZrQrzeomF3WUYoeaQeAJ'
  const MULTISIG_XPUB_2 =
    'xpub6C2rutq6jJnZVMQxBtmAEGS9HitPFCsMouoL7FazS8sTojgwJfvv4kehuBqTeAggScs1mPuuWoFZCt1wqFWH5Qrk6edVogQevJbsSSQR92j'
  const MULTISIG_XPUB_3 =
    'xpub6BjX8bohDbdPjr486W3sTVHepnrFwUfeLbVUBCt5BJzYvEGaZ3w3cAWGJ9UTANAvdfythferf1ScXuyRs7oavkqVAbB38ofX4dGx7E9KG7m'

  it('parses P2WSH descriptor with sortedmulti', () => {
    const descriptor = `wsh(sortedmulti(2,${MULTISIG_XPUB_1}/<0;1>/*,${MULTISIG_XPUB_2}/<0;1>/*,${MULTISIG_XPUB_3}/<0;1>/*))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpressions.length).toBe(3)
    expect(result.keyExpressions[0]?.xpub.network).toEqual(Network.Mainnet)
    expect(result.scriptType).toBe('p2wsh')
    expect(result.threshold).toBe(2)
    expect(result.isSorted).toBe(true)
  })

  it('parses P2SH-P2WSH descriptor', () => {
    const descriptor = `sh(wsh(sortedmulti(2,${MULTISIG_XPUB_1}/<0;1>/*,${MULTISIG_XPUB_2}/<0;1>/*,${MULTISIG_XPUB_3}/<0;1>/*)))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.scriptType).toBe('p2sh-p2wsh')
    expect(result.threshold).toBe(2)
    expect(result.isSorted).toBe(true)
  })

  it('parses descriptor with multi (not sorted)', () => {
    const descriptor = `wsh(multi(2,${MULTISIG_XPUB_1}/<0;1>/*,${MULTISIG_XPUB_2}/<0;1>/*,${MULTISIG_XPUB_3}/<0;1>/*))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.isSorted).toBe(false)
  })

  it('parses descriptor with key origins', () => {
    const descriptor = `sh(wsh(sortedmulti(2,[00000000/49/0/0]${MULTISIG_XPUB_1}/<0;1>/*,[11111111/49/0/0]${MULTISIG_XPUB_2}/<0;1>/*,[22222222/49/0/0]${MULTISIG_XPUB_3}/<0;1>/*)))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpressions[0]?.keyOrigin?.fingerprint).toBe('00000000')
    expect(result.keyExpressions[1]?.keyOrigin?.fingerprint).toBe('11111111')
    expect(result.keyExpressions[2]?.keyOrigin?.fingerprint).toBe('22222222')
  })

  it('parses descriptor with checksum', () => {
    const descriptor = withChecksum(
      `wsh(sortedmulti(2,${MULTISIG_XPUB_1}/<0;1>/*,${MULTISIG_XPUB_2}/<0;1>/*,${MULTISIG_XPUB_3}/<0;1>/*))`,
    )
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.scriptType).toBe('p2wsh')
    expect(result.threshold).toBe(2)
  })

  it('parses multisig descriptors with no origin brackets (keyOrigin is null)', () => {
    const descriptor = `wsh(sortedmulti(2,${MULTISIG_XPUB_1}/<0;1>/*,${MULTISIG_XPUB_2}/<0;1>/*,${MULTISIG_XPUB_3}/<0;1>/*))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    for (const ke of result.keyExpressions) {
      expect(ke.keyOrigin).toBeNull()
    }
  })

  it('parses multisig descriptors with fingerprint but no derivation path', () => {
    const descriptor = `wsh(sortedmulti(2,[00000000/]${MULTISIG_XPUB_1}/<0;1>/*,[11111111/]${MULTISIG_XPUB_2}/<0;1>/*,[22222222/]${MULTISIG_XPUB_3}/<0;1>/*))`
    const result = MultisigDescriptorParser.parse(descriptor).expect('valid descriptor')

    expect(result.keyExpressions[0]?.keyOrigin?.fingerprint).toBe('00000000')
    expect(result.keyExpressions[0]?.keyOrigin?.derivationPath).toBeNull()
  })
})
