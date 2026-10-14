import { describe, expect, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { TimezoneSchema } from './timezone'

describe('TimezoneSchema', () => {
  // Browsers report aliases and fixed offsets that Intl.supportedValuesOf omits.
  it.each([
    'UTC',
    'Asia/Kolkata',
    'Asia/Calcutta',
    'Europe/Kyiv',
    'Europe/Kiev',
    'America/Nuuk',
    'Etc/UTC',
    'Etc/GMT+8',
  ])('accepts %s', (timezone) => {
    expect(parseUnknown(TimezoneSchema, timezone).unwrap()).toBe(timezone)
  })

  it.each(['', 'Not/AZone', 'Mars/Olympus'])('rejects %j', (timezone) => {
    expect(parseUnknown(TimezoneSchema, timezone).isErr()).toBe(true)
  })
})
