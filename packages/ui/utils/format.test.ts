import { expect, test } from 'vitest'
import { formatUsd } from './format'

test('formatUsd', () => {
  expect(formatUsd(1)).toBe('$1.00')
  expect(formatUsd('69')).toBe('$69.00')
  expect(formatUsd(69.42)).toBe('$69.42')
  expect(formatUsd(69.123456)).toBe('$69.12')
  expect(formatUsd(123)).toBe('$123.00')
  expect(formatUsd(1234)).toBe('$1,234.00')
  expect(formatUsd(1222333.66)).toBe('$1,222,333.66')
  expect(formatUsd('nope')).toBe('$0.00')
})
