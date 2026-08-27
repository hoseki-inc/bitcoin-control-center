import { expect, test } from 'vitest'
import { unixTimestamp, utcDatetimeString } from './date'

test('utcDateString', () => {
  let str = '2022-06-18'
  let parsed = utcDatetimeString('yyyy-MM-dd HH:mm:ss').safeParse(str)
  expect(parsed.success).toBe(false)

  str = '2022-06-18 07:15:58'
  parsed = utcDatetimeString('yyyy-MM-dd HH:mm:ss').safeParse(str)
  expect(parsed.success && parsed.data).toEqual(new Date('2022-06-18T07:15:58.000Z'))
})

test('unixTimestamp', () => {
  // Test valid timestamp
  const validTimestamp = 1615768450
  const parsed = unixTimestamp().safeParse(validTimestamp)
  expect(parsed.success).toBe(true)
  expect(parsed.data).toEqual(new Date('2021-03-15T00:34:10.000Z'))

  // Test zero timestamp
  const zeroTimestamp = 0
  const parsedZero = unixTimestamp().safeParse(zeroTimestamp)
  expect(parsedZero.success).toBe(true)
  expect(parsedZero.data).toEqual(new Date('1970-01-01T00:00:00.000Z'))

  // Test invalid cases
  const negativeTimestamp = -1
  const parsedNegative = unixTimestamp().safeParse(negativeTimestamp)
  expect(parsedNegative.success).toBe(false)

  const floatTimestamp = 1615766400.5
  const parsedFloat = unixTimestamp().safeParse(floatTimestamp)
  expect(parsedFloat.success).toBe(false)

  const giantTimestamp = 8640000000001 // max a Date constructor can handle is 8640000000000000.5
  const parsedGiant = unixTimestamp().safeParse(giantTimestamp)
  expect(parsedGiant.success).toBe(false)

  // Test with a recent timestamp
  const now = Math.floor(Date.now() / 1000)
  const parsedNow = unixTimestamp().safeParse(now)
  expect(parsedNow.success).toBe(true)
  expect(parsedNow.data).toEqual(new Date(now * 1000))
})
