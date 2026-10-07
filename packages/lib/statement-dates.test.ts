import { describe, expect, it } from 'vitest'
import { getLatestStatementClosingDate } from './statement-dates'

describe('getLatestStatementClosingDate', () => {
  it.each([
    {
      scenario: 'the end of the day before yesterday in UTC',
      now: '2026-10-05T10:00:00.000Z',
      timezone: 'UTC',
      latest: '2026-10-03T23:59:59.999Z',
    },
    {
      scenario: "the end of that day in the statement's timezone",
      now: '2026-10-05T18:00:00.000Z',
      timezone: 'America/Los_Angeles',
      latest: '2026-10-04T06:59:59.999Z',
    },
    {
      scenario: 'the local day when UTC has already moved to the next day',
      now: '2026-10-05T02:00:00.000Z',
      timezone: 'America/Los_Angeles',
      latest: '2026-10-03T06:59:59.999Z',
    },
    {
      scenario: 'the local day when the timezone is ahead of UTC',
      now: '2026-10-04T23:30:00.000Z',
      timezone: 'Asia/Tokyo',
      latest: '2026-10-03T14:59:59.999Z',
    },
  ])('returns $scenario', ({ now, timezone, latest }) => {
    expect(
      getLatestStatementClosingDate(new Date(now), timezone).expect('Expected successful result').toISOString(),
    ).toBe(latest)
  })

  it('rejects an unrecognized timezone', () => {
    expect(getLatestStatementClosingDate(new Date('2026-10-05T10:00:00.000Z'), 'Mars/Olympus').isErr()).toBe(true)
  })
})
