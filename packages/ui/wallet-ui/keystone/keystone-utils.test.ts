import {
  CryptoAccount,
  CryptoECKey,
  CryptoHDKey,
  CryptoKeypath,
  CryptoOutput,
  PathComponent,
  ScriptExpressions,
} from '@keystonehq/bc-ur-registry'
import { describe, expect, it } from 'vitest'
import { parseKeystoneExport } from './keystone-utils'

const publicKey = Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex')
const fingerprint = Buffer.from('12345678', 'hex')

function encodeAccount(key: CryptoHDKey | CryptoECKey): string {
  const output = new CryptoOutput([ScriptExpressions.WITNESS_PUBLIC_KEY_HASH], key)
  return new CryptoAccount(fingerprint, [output]).toUREncoder(1000).nextPart()
}

describe('Keystone UR account imports', () => {
  it('preserves an HD key, origin, and master fingerprint', () => {
    const key = new CryptoHDKey({
      isMaster: false,
      key: publicKey,
      chainCode: Buffer.alloc(32, 1),
      origin: new CryptoKeypath(
        [84, 0, 0].map((index) => new PathComponent({ index, hardened: true })),
        fingerprint,
      ),
      parentFingerprint: fingerprint,
    })
    const parsed = parseKeystoneExport(encodeAccount(key)).expect('HD account should import')
    expect(parsed.xpub.toString()).toBe(key.getBip32Key())
    expect(parsed.derivationPath?.toString()).toBe('m/84h/0h/0h')
    expect(parsed.masterFingerprint).toBe('12345678')
  })

  it('returns the intended error when a descriptor contains an EC key instead of an HD key', () => {
    const result = parseKeystoneExport(encodeAccount(new CryptoECKey({ data: publicKey })))
    expect(result.expectErr('EC account should fail HD-key validation').message).toBe(
      'No HD key found in output descriptor',
    )
  })
})
