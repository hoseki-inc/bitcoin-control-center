import { describe, expect, test } from 'vitest'
import { DerivationPath } from './derivation-path'
import { KeyExpression, KeyFingerprint, KeyOrigin } from './key-expression'
import { Xpub } from './xpub'

const TEST_FINGERPRINT = KeyFingerprint('deadbeef').expect('valid fingerprint')
const TEST_DERIVATION_PATH = DerivationPath.fromString("m/44'/0'/0'").expect('valid derivation path')
const TEST_KEY_ORIGIN = KeyOrigin.from(TEST_FINGERPRINT, TEST_DERIVATION_PATH)
const TEST_XPUB_STR =
  'xpub6CoK65dNvMYXaBDCfHautt78ZrbZ3pPL46782nrjJtLXWKHTxYdFEfrionLgaQtUKw8vUeKda4ynE4sUiUgr4rR9nrqjexjUhZVpWkJULVr'
const TEST_XPUB = Xpub.fromString(TEST_XPUB_STR).expect('valid xpub')

describe('KeyFingerprint Schema', () => {
  test('accepts valid 8-character hex strings', () => {
    let res = KeyFingerprint('abcd1234')
    expect(res.isOk()).toBe(true)
    res = KeyFingerprint('ABCD1234')
    expect(res.isOk()).toBe(true)
    res = KeyFingerprint('12345678')
    expect(res.isOk()).toBe(true)
    res = KeyFingerprint('aAbBcCdD')
    expect(res.isOk()).toBe(true)
  })

  test('rejects invalid fingerprints', () => {
    let res = KeyFingerprint('abcd123') // too short
    expect(res.isErr()).toBe(true)
    res = KeyFingerprint('abcd12345') // too long
    expect(res.isErr()).toBe(true)
    res = KeyFingerprint('abcd123g') // invalid hex
    expect(res.isErr()).toBe(true)
    res = KeyFingerprint('abcd 123') // contains space
    expect(res.isErr()).toBe(true)
    res = KeyFingerprint('') // empty
    expect(res.isErr()).toBe(true)
  })
})

describe('KeyOrigin', () => {
  describe('from()', () => {
    test('creates instance with all parameters', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, TEST_DERIVATION_PATH)
      expect(keyOrigin.fingerprint).toEqual(TEST_FINGERPRINT)
      expect(keyOrigin.derivationPath).toEqual(TEST_DERIVATION_PATH)
    })

    test('creates instance with fingerprint only', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, null)

      expect(keyOrigin.fingerprint).toEqual(TEST_FINGERPRINT)
      expect(keyOrigin.derivationPath).toBeNull()
    })
  })

  describe('toString()', () => {
    test('returns fingerprint format when only fingerprint provided', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, null)
      const expected = `[${TEST_FINGERPRINT}]`
      expect(keyOrigin.toString()).toEqual(expected)
    })

    test('returns full format when both fingerprint and derivation path provided', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, TEST_DERIVATION_PATH)
      const expected = `[${TEST_FINGERPRINT}/44h/0h/0h]`
      expect(keyOrigin.toString()).toEqual(expected)
    })
  })

  describe('toJSON()', () => {
    test('returns proper JSON representation with all fields', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, TEST_DERIVATION_PATH)
      const result = keyOrigin.toJSON()
      expect(result).toEqual({
        fingerprint: TEST_FINGERPRINT,
        derivationPath: TEST_DERIVATION_PATH.toString(),
      })
    })

    test('returns proper JSON representation with nulls', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, null)
      const result = keyOrigin.toJSON()
      expect(result).toEqual({
        fingerprint: TEST_FINGERPRINT,
        derivationPath: null,
      })
    })
  })
})

describe('KeyExpression', () => {
  describe('from()', () => {
    test('creates instance with all parameters', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, TEST_KEY_ORIGIN)
      expect(keyExpression.xpub).toEqual(TEST_XPUB)
      expect(keyExpression.keyOrigin).toEqual(TEST_KEY_ORIGIN)
    })

    test('creates instance with xpub only', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, null)
      expect(keyExpression.xpub).toEqual(TEST_XPUB)
      expect(keyExpression.keyOrigin).toBeNull()
    })
  })

  describe('toString()', () => {
    test('returns xpub format when only xpub provided', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, null)
      const expected = TEST_XPUB.toString()
      expect(keyExpression.toString()).toEqual(expected)
    })

    test('returns full format when both xpub and key origin provided', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, TEST_KEY_ORIGIN)
      const expected = TEST_KEY_ORIGIN.toString() + TEST_XPUB.toString()
      expect(keyExpression.toString()).toEqual(expected)
    })

    test('returns fingerprint-only format when key origin has no derivation path', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, null)
      const keyExpression = KeyExpression.from(TEST_XPUB, keyOrigin)
      const expected = keyOrigin.toString() + TEST_XPUB.toString()
      expect(keyExpression.toString()).toEqual(expected)
    })
  })

  describe('toJSON()', () => {
    test('returns proper JSON representation with all fields', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, TEST_KEY_ORIGIN)
      const result = keyExpression.toJSON()
      expect(result).toEqual({
        keyOrigin: {
          fingerprint: TEST_FINGERPRINT,
          derivationPath: TEST_DERIVATION_PATH.toString(),
        },
        xpub: TEST_XPUB.toString(),
      })
    })

    test('returns proper JSON representation with null key origin', () => {
      const keyExpression = KeyExpression.from(TEST_XPUB, null)
      const result = keyExpression.toJSON()
      expect(result).toEqual({
        keyOrigin: null,
        xpub: TEST_XPUB.toString(),
      })
    })

    test('returns proper JSON representation with key origin without derivation path', () => {
      const keyOrigin = KeyOrigin.from(TEST_FINGERPRINT, null)
      const keyExpression = KeyExpression.from(TEST_XPUB, keyOrigin)
      const result = keyExpression.toJSON()
      expect(result).toEqual({
        keyOrigin: {
          fingerprint: TEST_FINGERPRINT,
          derivationPath: null,
        },
        xpub: TEST_XPUB.toString(),
      })
    })
  })
})
