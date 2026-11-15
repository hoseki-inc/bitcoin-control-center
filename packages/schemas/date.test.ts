import { expect, test } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { unixTimestamp, utcDatetimeString } from './date'

test('utcDateString', () => {
  let str = '2022-06-18'
  let parsed = parseUnknown(utcDatetimeString('yyyy-MM-dd HH:mm:ss'), str)
  expect(parsed.isOk()).toBe(false)

  str = '2022-06-18 07:15:58'
  parsed = parseUnknown(utcDatetimeString('yyyy-MM-dd HH:mm:ss'), str)
  expect(parsed.isOk() && parsed.expect('valid input')).toEqual(new Date('2022-06-18T07:15:58.000Z'))
})

test('unixTimestamp', () => {
  // Test valid timestamp
  const validTimestamp = 1615768450
  const parsed = parseUnknown(unixTimestamp(), validTimestamp)
  expect(parsed.isOk()).toBe(true)
  expect(parsed.expect('valid input')).toEqual(new Date('2021-03-15T00:34:10.000Z'))

  // Test zero timestamp
  const zeroTimestamp = 0
  const parsedZero = parseUnknown(unixTimestamp(), zeroTimestamp)
  expect(parsedZero.isOk()).toBe(true)
  expect(parsedZero.expect('valid input')).toEqual(new Date('1970-01-01T00:00:00.000Z'))

  // Test invalid cases
  const negativeTimestamp = -1
  const parsedNegative = parseUnknown(unixTimestamp(), negativeTimestamp)
  expect(parsedNegative.isOk()).toBe(false)

  const floatTimestamp = 1615766400.5
  const parsedFloat = parseUnknown(unixTimestamp(), floatTimestamp)
  expect(parsedFloat.isOk()).toBe(false)

  const giantTimestamp = 8640000000001 // max a Date constructor can handle is 8640000000000000.5
  const parsedGiant = parseUnknown(unixTimestamp(), giantTimestamp)
  expect(parsedGiant.isOk()).toBe(false)

  // Test with a recent timestamp
  const now = Math.floor(Date.now() / 1000)
  const parsedNow = parseUnknown(unixTimestamp(), now)
  expect(parsedNow.isOk()).toBe(true)
  expect(parsedNow.expect('valid input')).toEqual(new Date(now * 1000))
})
