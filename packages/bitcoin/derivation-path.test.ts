import { describe, expect, test } from 'vitest'
import { DerivationPath } from './derivation-path'

describe('DerivationPath.fromString', () => {
  test('parses paths with h notation and verifies round-trip', () => {
    const testCases = [
      {
        input: 'm/44h',
        expectedSteps: [{ index: 44, hardened: true }],
      },
      {
        input: 'm/44h/0h/0h',
        expectedSteps: [
          { index: 44, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: true },
        ],
      },
      {
        input: 'm/84h/0h/0h/0/5',
        expectedSteps: [
          { index: 84, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: false },
          { index: 5, hardened: false },
        ],
      },
    ]

    for (const testCase of testCases) {
      // Test fromString parsing
      const result = DerivationPath.fromString(testCase.input)
      expect(result.isOk(), `Should parse: ${testCase.input}`).toBe(true)

      const path = result.expect('valid path')
      expect(path.steps).toEqual(testCase.expectedSteps)

      // Test toString
      const stringResult = path.toString()

      // Test round-trip with from()
      const roundTripPath = DerivationPath.from(stringResult)
      expect(roundTripPath.steps).toEqual(testCase.expectedSteps)
    }
  })

  test('parses paths with apostrophe notation and verifies round-trip', () => {
    const testCases = [
      {
        input: "m/44'",
        expectedSteps: [{ index: 44, hardened: true }],
      },
      {
        input: "m/44'/0'/0'",
        expectedSteps: [
          { index: 44, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: true },
        ],
      },
      {
        input: "m/84'/0'/0'/0/5",
        expectedSteps: [
          { index: 84, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: true },
          { index: 0, hardened: false },
          { index: 5, hardened: false },
        ],
      },
    ]

    for (const testCase of testCases) {
      // Test fromString parsing
      const result = DerivationPath.fromString(testCase.input)
      expect(result.isOk(), `Should parse: ${testCase.input}`).toBe(true)

      const path = result.expect('valid path')
      expect(path.steps).toEqual(testCase.expectedSteps)

      // Test toString (should convert to h notation)
      const stringResult = path.toString()
      expect(stringResult).not.toContain("'") // Should use h notation

      // Test round-trip with from()
      const roundTripPath = DerivationPath.from(stringResult)
      expect(roundTripPath.steps).toEqual(testCase.expectedSteps)
    }
  })

  test('both notations produce identical results', () => {
    const testPairs = [
      { h: 'm/44h', apostrophe: "m/44'" },
      { h: 'm/44h/0h', apostrophe: "m/44'/0'" },
      { h: 'm/84h/0h/0h', apostrophe: "m/84'/0'/0'" },
    ]

    for (const pair of testPairs) {
      const pathWithH = DerivationPath.fromString(pair.h).expect('valid path')
      const pathWithApostrophe = DerivationPath.fromString(pair.apostrophe).expect('valid path')

      // Steps should be identical
      expect(pathWithH.steps).toEqual(pathWithApostrophe.steps)

      // toString should produce identical results (h notation)
      expect(pathWithH.toString()).toBe(pathWithApostrophe.toString())

      // Round-trip with from() should work for both
      const roundTripH = DerivationPath.from(pathWithH.toString())
      const roundTripApostrophe = DerivationPath.from(pathWithApostrophe.toString())

      expect(roundTripH.steps).toEqual(pathWithH.steps)
      expect(roundTripApostrophe.steps).toEqual(pathWithApostrophe.steps)
    }
  })
})

describe('DerivationPath.isStandardAccount', () => {
  describe('Standard singlesig paths (BIP44, BIP49, BIP84, BIP86)', () => {
    test('returns true for standard BIP44 paths', () => {
      const standardPaths = [
        "m/44'/0'/0'",
        "m/44'/0'/1'",
        "m/44'/0'/10'",
        "m/44'/1'/0'", // testnet
        "m/44'/1'/5'", // testnet
        'm/44h/0h/0h',
        'm/44h/0h/100h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })

    test('returns true for standard BIP49 paths', () => {
      const standardPaths = [
        "m/49'/0'/0'",
        "m/49'/0'/1'",
        "m/49'/1'/0'", // testnet
        'm/49h/0h/0h',
        'm/49h/0h/50h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })

    test('returns true for standard BIP84 paths', () => {
      const standardPaths = [
        "m/84'/0'/0'",
        "m/84'/0'/1'",
        "m/84'/1'/0'", // testnet
        'm/84h/0h/0h',
        'm/84h/0h/99h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })

    test('returns true for standard BIP86 paths', () => {
      const standardPaths = [
        "m/86'/0'/0'",
        "m/86'/0'/1'",
        "m/86'/1'/0'", // testnet
        'm/86h/0h/0h',
        'm/86h/0h/42h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })
  })

  describe('Non-standard singlesig paths', () => {
    test('returns false for paths with non-hardened purpose', () => {
      const nonStandardPaths = ['m/44/0/0', 'm/49/0/1', 'm/84/0/0', 'm/86/0/0', 'm/44/0h/0h', 'm/49h/0/0']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (non-hardened purpose)`).toBe(false)
      }
    })

    test('returns false for paths with non-hardened coin type', () => {
      const nonStandardPaths = ["m/44'/0/0'", "m/49'/0/1'", "m/84'/0/0'", "m/86'/0/0'", 'm/44h/0/0h', 'm/49h/0h/0']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (non-hardened coin)`).toBe(false)
      }
    })

    test('returns false for paths with non-hardened account', () => {
      const nonStandardPaths = ["m/44'/0'/0", "m/49'/0'/1", "m/84'/0'/0", "m/86'/0'/0", 'm/44h/0h/0', 'm/49h/0h/0']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (non-hardened account)`).toBe(false)
      }
    })

    test('returns false for paths with invalid coin type', () => {
      const nonStandardPaths = [
        "m/44'/2'/0'", // coin type 2 is invalid
        "m/49'/3'/0'", // coin type 3 is invalid
        "m/84'/99'/0'", // coin type 99 is invalid
        'm/44h/5h/0h', // coin type 5 is invalid
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (invalid coin type)`).toBe(false)
      }
    })

    test('returns false for paths with negative account index', () => {
      // Note: These paths might not parse, but if they do, they should be non-standard
      // In practice, negative indices won't parse due to the regex, but testing the logic
      const nonStandardPath = new DerivationPath([
        { index: 44, hardened: true },
        { index: 0, hardened: true },
        { index: -1, hardened: true },
      ])

      expect(nonStandardPath.isStandardAccount(), 'path with negative account should be non-standard').toBe(false)
    })

    test('returns false for paths with wrong length (too short)', () => {
      const nonStandardPaths = ["m/44'", "m/44'/0'", "m/49'", 'm/84h']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (too short for singlesig)`).toBe(false)
      }
    })

    test('returns false for paths with wrong length (too long)', () => {
      const nonStandardPaths = ["m/44'/0'/0'/0'", "m/49'/0'/0'/1'", "m/84'/0'/0'/0'/5'", 'm/44h/0h/0h/0h']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (too long for singlesig)`).toBe(false)
      }
    })

    test('returns false for paths with non-standard purpose indices', () => {
      const nonStandardPaths = [
        "m/43'/0'/0'", // purpose 43 is not standard
        "m/50'/0'/0'", // purpose 50 is not standard
        "m/100'/0'/0'", // purpose 100 is not standard
        'm/0h/0h/0h', // purpose 0 is not standard
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (non-standard purpose)`).toBe(false)
      }
    })
  })

  describe('Standard multisig paths (BIP45, BIP48)', () => {
    test('returns true for standard BIP45 paths', () => {
      const standardPaths = ["m/45'", 'm/45h']

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })

    test('returns true for standard BIP48 p2sh-p2wsh paths', () => {
      const standardPaths = [
        "m/48'/0'/0'/1'",
        "m/48'/0'/1'/1'",
        "m/48'/1'/0'/1'", // testnet
        'm/48h/0h/0h/1h',
        'm/48h/0h/10h/1h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })

    test('returns true for standard BIP48 p2wsh paths', () => {
      const standardPaths = [
        "m/48'/0'/0'/2'",
        "m/48'/0'/1'/2'",
        "m/48'/1'/0'/2'", // testnet
        'm/48h/0h/0h/2h',
        'm/48h/0h/5h/2h',
      ]

      for (const pathStr of standardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be standard`).toBe(true)
      }
    })
  })

  describe('Non-standard multisig paths', () => {
    test('returns false for BIP45 paths that are not hardened', () => {
      const nonStandardPaths = ['m/45', 'm/45h/0']

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard`).toBe(false)
      }
    })

    test('returns false for BIP48 paths with non-hardened levels', () => {
      const nonStandardPaths = [
        "m/48'/0'/0'/1", // script_type not hardened
        "m/48'/0'/0/1'", // account not hardened
        "m/48'/0/0'/1'", // coin not hardened
        "m/48/0'/0'/1'", // purpose not hardened
        'm/48h/0h/0h/1', // script_type not hardened
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (non-hardened level)`).toBe(false)
      }
    })

    test('returns false for BIP48 paths with invalid coin type', () => {
      const nonStandardPaths = [
        "m/48'/2'/0'/1'", // coin type 2 is invalid
        "m/48'/99'/0'/1'", // coin type 99 is invalid
        'm/48h/5h/0h/1h', // coin type 5 is invalid
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (invalid coin type)`).toBe(false)
      }
    })

    test('returns false for BIP48 paths with invalid script type', () => {
      const nonStandardPaths = [
        "m/48'/0'/0'/0'", // script_type 0 is invalid
        "m/48'/0'/0'/3'", // script_type 3 is invalid
        "m/48'/0'/0'/99'", // script_type 99 is invalid
        'm/48h/0h/0h/0h', // script_type 0 is invalid
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (invalid script type)`).toBe(false)
      }
    })

    test('returns false for BIP48 paths with wrong length', () => {
      const nonStandardPaths = [
        "m/48'", // too short
        "m/48'/0'", // too short
        "m/48'/0'/0'", // too short
        "m/48'/0'/0'/1'/5'", // too long
        'm/48h/0h', // too short
      ]

      for (const pathStr of nonStandardPaths) {
        const path = DerivationPath.fromString(pathStr).expect('valid path')
        expect(path.isStandardAccount(), `${pathStr} should be non-standard (wrong length)`).toBe(false)
      }
    })
  })

  describe('Invalid paths', () => {
    test('cannot be tested as instance method (invalid paths cannot be parsed)', () => {
      // Invalid paths cannot be parsed into DerivationPath instances,
      // so they cannot be tested with the instance method.
      // This test is kept for documentation but will be skipped.
      const invalidPaths = ['invalid', 'm', 'm/', 'not/a/path', '', 'm/abc', 'm/44.5']

      for (const pathStr of invalidPaths) {
        const result = DerivationPath.fromString(pathStr)
        expect(result.isErr(), `${pathStr} should fail to parse`).toBe(true)
      }
    })
  })

  describe('Edge cases', () => {
    test('returns false for empty path', () => {
      const emptyPath = new DerivationPath([])
      expect(emptyPath.isStandardAccount(), 'empty path should be non-standard').toBe(false)
    })

    test('works with DerivationPath instances', () => {
      const pathString = "m/44'/0'/0'"
      const pathInstance = DerivationPath.fromString(pathString).expect('valid path')

      expect(pathInstance.isStandardAccount()).toBe(true)
    })

    test('handles large account indices', () => {
      const largeAccountPathStr = "m/44'/0'/2147483647'" // max 32-bit signed int
      const largeAccountPath = DerivationPath.fromString(largeAccountPathStr).expect('valid path')
      expect(largeAccountPath.isStandardAccount(), 'large account index should still be standard').toBe(true)
    })
  })
})
