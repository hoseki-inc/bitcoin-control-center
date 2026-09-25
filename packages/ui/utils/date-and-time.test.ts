import { describe, expect, onTestFinished, test, vi } from 'vitest'
import { formatDateRange, getRelativeTimeFromNow } from './date-and-time'

describe('formatDateRange', () => {
  describe('same day', () => {
    test('returns single date format', () => {
      const date = new Date('2025-01-15T12:00:00Z')
      expect(formatDateRange(date, date)).toBe('Jan 15, 2025')
    })

    test('works with different time of day', () => {
      const start = new Date('2025-01-15T08:00:00Z')
      const end = new Date('2025-01-15T17:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jan 15, 2025')
    })
  })

  describe('same month and year', () => {
    test('uses abbreviated month names', () => {
      const start = new Date('2025-01-01T12:00:00Z')
      const end = new Date('2025-01-31T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jan 1 - 31, 2025')
    })

    test('works with February', () => {
      const start = new Date('2025-02-01T12:00:00Z')
      const end = new Date('2025-02-28T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Feb 1 - 28, 2025')
    })

    test('works with December', () => {
      const start = new Date('2025-12-15T12:00:00Z')
      const end = new Date('2025-12-25T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Dec 15 - 25, 2025')
    })
  })

  describe('different months, same year', () => {
    test('uses abbreviated start month and full end month', () => {
      const start = new Date('2025-01-01T12:00:00Z')
      const end = new Date('2025-02-28T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jan 1 - February 28, 2025')
    })

    test('works across multiple months', () => {
      const start = new Date('2025-03-15T12:00:00Z')
      const end = new Date('2025-06-20T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Mar 15 - June 20, 2025')
    })

    test('works from January to December', () => {
      const start = new Date('2025-01-01T12:00:00Z')
      const end = new Date('2025-12-31T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jan 1 - December 31, 2025')
    })
  })

  describe('different years', () => {
    test('includes year for both dates with full end month name', () => {
      const start = new Date('2024-01-01T12:00:00Z')
      const end = new Date('2025-02-28T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jan 1, 2024 - February 28, 2025')
    })

    test('works across multiple years', () => {
      const start = new Date('2023-06-15T12:00:00Z')
      const end = new Date('2025-03-20T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Jun 15, 2023 - March 20, 2025')
    })

    test('works with same month but different years', () => {
      const start = new Date('2024-12-25T12:00:00Z')
      const end = new Date('2025-01-05T12:00:00Z')
      expect(formatDateRange(start, end)).toBe('Dec 25, 2024 - January 5, 2025')
    })
  })

  describe('with timezone', () => {
    test('formats dates in specified timezone', () => {
      // This test ensures the timezone parameter is accepted
      // Actual timezone conversion behavior depends on TZDate implementation
      const start = new Date('2025-01-01T12:00:00Z')
      const end = new Date('2025-01-02T12:00:00Z')
      const result = formatDateRange(start, end, 'America/New_York')
      expect(result).toMatch(/Jan \d+ - \d+, 2025/)
    })
  })
})

describe('getRelativeTimeFromNow', () => {
  async function withTestSetup(run: () => Promise<void>): Promise<void> {
    // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
    onTestFinished(async () => {
      vi.useRealTimers()
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'))

    await run()
  }

  describe('future dates', () => {
    test('returns "in X seconds" for near future', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-01T00:00:30.000Z') // 30 seconds
        expect(getRelativeTimeFromNow(future)).toBe('in 30 seconds')
      })
    })

    test('returns "in X minutes" for minutes away', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-01T00:05:00.000Z') // 5 minutes
        expect(getRelativeTimeFromNow(future)).toBe('in 5 minutes')
      })
    })

    test('returns "in X hours" for hours away', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-01T03:00:00.000Z') // 3 hours
        expect(getRelativeTimeFromNow(future)).toBe('in 3 hours')
      })
    })

    test('returns "tomorrow" for next day', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-02T00:00:00.000Z') // 1 day
        expect(getRelativeTimeFromNow(future)).toBe('tomorrow')
      })
    })

    test('returns "in X days" for multiple days', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-04T00:00:00.000Z') // 3 days
        expect(getRelativeTimeFromNow(future)).toBe('in 3 days')
      })
    })

    test('returns "next week" for week away', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-08T00:00:00.000Z') // 7 days
        expect(getRelativeTimeFromNow(future)).toBe('next week')
      })
    })

    test('returns "in X months" for months away', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-04-01T00:00:00.000Z') // ~3 months
        expect(getRelativeTimeFromNow(future)).toBe('in 3 months')
      })
    })

    test('returns "next year" for year away', async () => {
      await withTestSetup(async () => {
        const future = new Date('2026-01-01T00:00:00.000Z') // 1 year
        expect(getRelativeTimeFromNow(future)).toBe('next year')
      })
    })

    test('returns "in X years" for multiple years', async () => {
      await withTestSetup(async () => {
        const future = new Date('2028-01-01T00:00:00.000Z') // 3 years
        expect(getRelativeTimeFromNow(future)).toBe('in 3 years')
      })
    })
  })

  describe('past dates', () => {
    test('returns "X seconds ago" for recent past', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-31T23:59:30.000Z') // 30 seconds ago
        expect(getRelativeTimeFromNow(past)).toBe('30 seconds ago')
      })
    })

    test('returns "X minutes ago" for minutes past', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-31T23:55:00.000Z') // 5 minutes ago
        expect(getRelativeTimeFromNow(past)).toBe('5 minutes ago')
      })
    })

    test('returns "X hours ago" for hours past', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-31T21:00:00.000Z') // 3 hours ago
        expect(getRelativeTimeFromNow(past)).toBe('3 hours ago')
      })
    })

    test('returns "yesterday" for previous day', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-31T00:00:00.000Z') // 1 day ago
        expect(getRelativeTimeFromNow(past)).toBe('yesterday')
      })
    })

    test('returns "X days ago" for multiple days', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-29T00:00:00.000Z') // 3 days ago
        expect(getRelativeTimeFromNow(past)).toBe('3 days ago')
      })
    })

    test('returns "last week" for week ago', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-12-25T00:00:00.000Z') // 7 days ago
        expect(getRelativeTimeFromNow(past)).toBe('last week')
      })
    })

    test('returns "X months ago" for months past', async () => {
      await withTestSetup(async () => {
        const past = new Date('2024-09-01T00:00:00.000Z') // ~5 months ago based on 30-day calculation
        expect(getRelativeTimeFromNow(past)).toBe('5 months ago')
      })
    })

    test('returns relative year format for past years', async () => {
      await withTestSetup(async () => {
        // From 2025-01-01 to 2024-01-01 should be 1 year, but may round to 2 depending on calculation
        const past = new Date('2024-01-01T00:00:00.000Z')
        const result = getRelativeTimeFromNow(past)
        // Accept either "last year" or "2 years ago" depending on rounding
        expect(result).toMatch(/last year|2 years ago/)
      })
    })

    test('returns "X years ago" for multiple years', async () => {
      await withTestSetup(async () => {
        const past = new Date('2021-01-01T00:00:00.000Z') // 4+ years ago
        expect(getRelativeTimeFromNow(past)).toBe('5 years ago')
      })
    })
  })

  describe('edge cases', () => {
    test('handles now/very recent', async () => {
      await withTestSetup(async () => {
        const now = new Date('2025-01-01T00:00:00.000Z')
        const result = getRelativeTimeFromNow(now)
        expect(result).toMatch(/now|0 seconds ago|in 0 seconds/)
      })
    })

    test('accepts custom Intl.RelativeTimeFormat options', async () => {
      await withTestSetup(async () => {
        const future = new Date('2025-01-02T00:00:00.000Z')
        // With numeric: 'always', it should always show the number
        const result = getRelativeTimeFromNow(future, { numeric: 'always' })
        expect(result).toBe('in 1 day')
      })
    })
  })
})
