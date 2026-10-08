import { isResult } from '@hoseki/packages/result'
import { expect } from 'vitest'

type EqualityTester = Parameters<typeof expect.addEqualityTesters>[0][number]

// Result iterators implement short-circuiting, not collection traversal. Compare
// variants and payloads before Vitest's iterable equality consumes the iterator.
expect.addEqualityTesters([
  function <T>(
    this: ThisParameterType<EqualityTester>,
    actual: T,
    expected: T,
    customTesters: Parameters<EqualityTester>[2],
  ): boolean | undefined {
    const actualIsResult = isResult(actual)
    const expectedIsResult = isResult(expected)
    if (actualIsResult && expectedIsResult) {
      if (actual.isOk() && expected.isOk()) {
        return this.equals(actual.unwrap(), expected.unwrap(), customTesters)
      }
      if (actual.isErr() && expected.isErr()) {
        return this.equals(actual.unwrapErr(), expected.unwrapErr(), customTesters)
      }
      return false
    }
    if (actualIsResult || expectedIsResult) {
      return false
    }
    return undefined
  },
])
