import { expect, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { coercedBoolean } from './boolean'

it.each([
  ['true text', 'true', true],
  ['false text', 'false', false],
  ['uppercase false', 'FALSE', false],
  ['mixed case true', 'TrUe', true],
  ['untrimmed text', ' false ', true],
  ['numeric text', '0', true],
  ['empty text', '', false],
  ['zero', 0, false],
  ['nonzero', -1, true],
  ['NaN', NaN, false],
  ['zero bigint', 0n, false],
  ['nonzero bigint', 1n, true],
  ['null', null, false],
  ['undefined', undefined, false],
  ['false', false, false],
  ['true', true, true],
  ['object', {}, true],
  ['array', [], true],
] as const)('preserves boolean coercion for %s', (_label, value, expected) => {
  expect(parseUnknown(coercedBoolean, value).expect('valid boolean input')).toBe(expected)
})
