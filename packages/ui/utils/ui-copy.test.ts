import { describe, expect, test } from 'vitest'
import { convertToOrdinalWords, pluralize } from './ui-copy'

describe('pluralize', () => {
  test('pluralize with tuple format', () => {
    expect(pluralize`You have ${['apple', 'apples', 1]}`).toBe('You have apple')
    expect(pluralize`You have ${['apple', 'apples', 2]}`).toBe('You have apples')
    expect(pluralize`Hey! ${['Your claim is', 'Your claims are', 1]} being shared!`).toBe(
      'Hey! Your claim is being shared!',
    )
    expect(pluralize`Hey! ${['Your claim is', 'Your claims are', 2]} being shared!`).toBe(
      'Hey! Your claims are being shared!',
    )
  })

  test('pluralize with object format', () => {
    expect(pluralize`You have ${{ count: 1, singular: 'claim', plural: 'claims' }}`).toBe('You have claim')
    expect(pluralize`You have ${{ count: 2, singular: 'claim', plural: 'claims' }}`).toBe('You have claims')
    expect(pluralize`You have ${2} ${{ count: 2, singular: 'claim', plural: 'claims' }}`).toBe('You have 2 claims')
    expect(pluralize`You have ${1} ${{ count: 1, singular: 'claim', plural: 'claims' }}`).toBe('You have 1 claim')
  })

  test('pluralize with regular interpolation', () => {
    expect(pluralize`Hello, ${'world'}!`).toBe('Hello, world!')
    expect(pluralize`The number is ${42}`).toBe('The number is 42')
  })
})

describe('convertToOrdinalWords', () => {
  test('convertToOrdinalWords - predefined ordinals (0-20)', () => {
    expect(convertToOrdinalWords(0)).toBe('zeroth')
    expect(convertToOrdinalWords(1)).toBe('first')
    expect(convertToOrdinalWords(2)).toBe('second')
    expect(convertToOrdinalWords(3)).toBe('third')
    expect(convertToOrdinalWords(4)).toBe('fourth')
    expect(convertToOrdinalWords(5)).toBe('fifth')
    expect(convertToOrdinalWords(6)).toBe('sixth')
    expect(convertToOrdinalWords(7)).toBe('seventh')
    expect(convertToOrdinalWords(8)).toBe('eighth')
    expect(convertToOrdinalWords(9)).toBe('ninth')
    expect(convertToOrdinalWords(10)).toBe('tenth')
    expect(convertToOrdinalWords(11)).toBe('eleventh')
    expect(convertToOrdinalWords(12)).toBe('twelfth')
    expect(convertToOrdinalWords(13)).toBe('thirteenth')
    expect(convertToOrdinalWords(14)).toBe('fourteenth')
    expect(convertToOrdinalWords(15)).toBe('fifteenth')
    expect(convertToOrdinalWords(16)).toBe('sixteenth')
    expect(convertToOrdinalWords(17)).toBe('seventeenth')
    expect(convertToOrdinalWords(18)).toBe('eighteenth')
    expect(convertToOrdinalWords(19)).toBe('nineteenth')
    expect(convertToOrdinalWords(20)).toBe('twentieth')
  })

  test('convertToOrdinalWords - numbers ending in 1st', () => {
    expect(convertToOrdinalWords(21)).toBe('21st')
    expect(convertToOrdinalWords(31)).toBe('31st')
    expect(convertToOrdinalWords(41)).toBe('41st')
    expect(convertToOrdinalWords(101)).toBe('101st')
    expect(convertToOrdinalWords(121)).toBe('121st')
  })

  test('convertToOrdinalWords - numbers ending in 2nd', () => {
    expect(convertToOrdinalWords(22)).toBe('22nd')
    expect(convertToOrdinalWords(32)).toBe('32nd')
    expect(convertToOrdinalWords(42)).toBe('42nd')
    expect(convertToOrdinalWords(102)).toBe('102nd')
    expect(convertToOrdinalWords(122)).toBe('122nd')
  })

  test('convertToOrdinalWords - numbers ending in 3rd', () => {
    expect(convertToOrdinalWords(23)).toBe('23rd')
    expect(convertToOrdinalWords(33)).toBe('33rd')
    expect(convertToOrdinalWords(43)).toBe('43rd')
    expect(convertToOrdinalWords(103)).toBe('103rd')
    expect(convertToOrdinalWords(123)).toBe('123rd')
  })

  test('convertToOrdinalWords - numbers ending in th', () => {
    expect(convertToOrdinalWords(24)).toBe('24th')
    expect(convertToOrdinalWords(25)).toBe('25th')
    expect(convertToOrdinalWords(26)).toBe('26th')
    expect(convertToOrdinalWords(27)).toBe('27th')
    expect(convertToOrdinalWords(28)).toBe('28th')
    expect(convertToOrdinalWords(29)).toBe('29th')
    expect(convertToOrdinalWords(30)).toBe('30th')
    expect(convertToOrdinalWords(104)).toBe('104th')
    expect(convertToOrdinalWords(105)).toBe('105th')
  })

  test('convertToOrdinalWords - special cases for 11th, 12th, 13th', () => {
    expect(convertToOrdinalWords(111)).toBe('111th')
    expect(convertToOrdinalWords(112)).toBe('112th')
    expect(convertToOrdinalWords(113)).toBe('113th')
    expect(convertToOrdinalWords(211)).toBe('211th')
    expect(convertToOrdinalWords(212)).toBe('212th')
    expect(convertToOrdinalWords(213)).toBe('213th')
  })

  test('convertToOrdinalWords - large numbers', () => {
    expect(convertToOrdinalWords(100)).toBe('100th')
    expect(convertToOrdinalWords(1000)).toBe('1000th')
    expect(convertToOrdinalWords(10000)).toBe('10000th')
    expect(convertToOrdinalWords(1001)).toBe('1001st')
    expect(convertToOrdinalWords(1002)).toBe('1002nd')
    expect(convertToOrdinalWords(1003)).toBe('1003rd')
  })
})
