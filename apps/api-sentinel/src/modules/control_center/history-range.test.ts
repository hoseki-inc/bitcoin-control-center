import { describe, expect, it } from 'vitest'
import { buildHistoricalData, resolveHistoryRange } from './history-range'

describe('preset portfolio history ranges', () => {
  const presets = [
    { preset: '7d', days: 7, start: '2026-08-29' },
    { preset: '30d', days: 30, start: '2026-08-06' },
    { preset: '90d', days: 90, start: '2026-06-07' },
    { preset: '1y', days: 365, start: '2025-09-05' },
  ] as const
  const now = new Date('2026-09-05T12:00:00.000Z')

  it.each(presets)('keeps $preset calendar boundaries and current-balance endpoint', ({ preset, days, start }) => {
    const range = resolveHistoryRange(preset, undefined, 'UTC', now).unwrap()
    expect(range.start.toISOString()).toBe(`${start}T00:00:00.000Z`)
    expect(range.end).toEqual(now)
    expect(range.dayStarts).toHaveLength(days + 1)
    expect(range.isCustom).toBe(false)
    expect(range.isAll).toBe(false)
    const data = buildHistoricalData(
      [
        { timestamp: new Date(range.start.getTime() - 1), value: 100n },
        { timestamp: new Date(`${start}T12:00:00.000Z`), value: 50n },
        { timestamp: new Date(now.getTime() + 1), value: 500n },
      ],
      175n,
      range,
      'UTC',
    )
    expect(data).toHaveLength(days + 1)
    expect(data[0]).toEqual({ timestamp: `${start}T23:59:59.999Z`, totalBalance: '150' })
    expect(data.slice(0, -1).every((point) => point.totalBalance === '150')).toBe(true)
    expect(data.at(-1)).toEqual({ timestamp: now.toISOString(), totalBalance: '175' })
  })

  it.each(presets)('preserves the $preset fallback when only a current balance is known', ({ preset, days }) => {
    const range = resolveHistoryRange(preset, undefined, 'UTC', now).unwrap()
    const data = buildHistoricalData([], 100n, range, 'UTC')
    expect(data).toHaveLength(days + 1)
    expect(data.map((point) => point.timestamp)).toEqual(range.dayStarts.map((date) => date.toISOString()))
    expect(data.every((point) => point.totalBalance === '100')).toBe(true)
    expect(buildHistoricalData([], 0n, range, 'UTC')).toEqual([])
  })

  it('uses local calendar dates, not UTC dates, for a preset crossing daylight saving', () => {
    const now = new Date('2026-03-09T02:30:00.000Z')
    const range = resolveHistoryRange('7d', undefined, 'America/New_York', now).unwrap()
    expect(range.start.toISOString()).toBe('2026-03-01T05:00:00.000Z')
    expect(range.dayStarts.at(-1)?.toISOString()).toBe('2026-03-08T05:00:00.000Z')
    const data = buildHistoricalData(
      [{ timestamp: new Date('2026-03-01T12:00:00.000Z'), value: 100n }],
      100n,
      range,
      'America/New_York',
    )
    expect(data).toHaveLength(8)
    expect(data.at(-2)?.timestamp).toBe('2026-03-08T04:59:59.999Z')
    expect(data.at(-1)?.timestamp).toBe(now.toISOString())
  })
})

describe('reused local-day boundaries', () => {
  it.each([
    {
      zone: 'America/New_York',
      day: '2026-03-08',
      next: '2026-03-09',
      start: '2026-03-08T05:00:00.000Z',
      end: '2026-03-09T03:59:59.999Z',
    },
    {
      zone: 'America/New_York',
      day: '2026-11-01',
      next: '2026-11-02',
      start: '2026-11-01T04:00:00.000Z',
      end: '2026-11-02T04:59:59.999Z',
    },
    {
      zone: 'America/Santiago',
      day: '2026-09-06',
      next: '2026-09-07',
      start: '2026-09-06T04:00:00.000Z',
      end: '2026-09-07T02:59:59.999Z',
    },
  ] as const)('keeps exact daily balances at $zone transitions on $day', ({ zone, day, next, start, end }) => {
    const range = resolveHistoryRange('30d', { startDate: day, endDate: next }, zone, new Date('2027-01-01')).unwrap()
    const data = buildHistoricalData(
      [
        { timestamp: new Date(start), value: 100n },
        { timestamp: new Date(end), value: 50n },
        { timestamp: new Date(new Date(end).getTime() + 1), value: 25n },
      ],
      999n,
      range,
      zone,
    )
    expect(data[0]).toEqual({ timestamp: start, totalBalance: '0' })
    expect(data[1]).toEqual({ timestamp: end, totalBalance: '150' })
    expect(data.at(-1)).toEqual({ timestamp: range.end.toISOString(), totalBalance: '175' })
  })

  it('handles duplicate midnights when a timezone skips an entire calendar date', () => {
    const range = resolveHistoryRange(
      '30d',
      { startDate: '2011-12-29', endDate: '2011-12-31' },
      'Pacific/Apia',
      new Date('2012-01-05'),
    ).unwrap()
    expect(range.dayStarts[1]).toEqual(range.dayStarts[2])
    const data = buildHistoricalData(
      [
        { timestamp: new Date('2011-12-29T12:00:00.000Z'), value: 100n },
        { timestamp: new Date('2011-12-30T12:00:00.000Z'), value: 25n },
      ],
      999n,
      range,
      'Pacific/Apia',
    )
    expect(data).toEqual([
      { timestamp: '2011-12-29T10:00:00.000Z', totalBalance: '0' },
      { timestamp: '2011-12-30T09:59:59.999Z', totalBalance: '100' },
      { timestamp: '2011-12-31T09:59:59.999Z', totalBalance: '125' },
    ])
  })
})

describe('custom portfolio history ranges', () => {
  it('validates calendar dates and ordering', () => {
    const now = new Date('2026-08-27T16:00:00.000Z')

    expect(resolveHistoryRange('30d', { startDate: '2026-02-30', endDate: '2026-03-01' }, 'UTC', now).isErr()).toBe(
      true,
    )
    expect(resolveHistoryRange('30d', { startDate: '2026-08-10', endDate: '2026-08-09' }, 'UTC', now).isErr()).toBe(
      true,
    )
    expect(resolveHistoryRange('30d', { startDate: '2026-08-10', endDate: '2026-08-28' }, 'UTC', now).isErr()).toBe(
      true,
    )
  })

  it('uses inclusive calendar days in the requested timezone across daylight saving changes', () => {
    const range = resolveHistoryRange(
      '30d',
      { startDate: '2026-03-07', endDate: '2026-03-09' },
      'America/New_York',
      new Date('2026-03-15T16:00:00.000Z'),
    ).unwrap()

    expect(range.start.toISOString()).toBe('2026-03-07T05:00:00.000Z')
    expect(range.end.toISOString()).toBe('2026-03-10T03:59:59.999Z')
    expect(range.dayStarts.map((date) => date.toISOString())).toEqual([
      '2026-03-07T05:00:00.000Z',
      '2026-03-08T05:00:00.000Z',
      '2026-03-09T04:00:00.000Z',
    ])
  })

  it('filters chart points to the exact custom start and end dates', () => {
    const range = resolveHistoryRange(
      '30d',
      { startDate: '2026-01-02', endDate: '2026-01-03' },
      'UTC',
      new Date('2026-01-10T12:00:00.000Z'),
    ).unwrap()

    const data = buildHistoricalData(
      [
        { timestamp: new Date('2026-01-01T12:00:00.000Z'), value: 100n },
        { timestamp: new Date('2026-01-02T12:00:00.000Z'), value: 50n },
        { timestamp: new Date('2026-01-03T12:00:00.000Z'), value: -25n },
        { timestamp: new Date('2026-01-04T12:00:00.000Z'), value: 500n },
      ],
      999n,
      range,
      'UTC',
    )

    expect(data).toEqual([
      { timestamp: '2026-01-02T00:00:00.000Z', totalBalance: '100' },
      { timestamp: '2026-01-02T23:59:59.999Z', totalBalance: '150' },
      { timestamp: '2026-01-03T23:59:59.999Z', totalBalance: '125' },
    ])
  })

  it('includes a start-of-day baseline for a single-day custom range', () => {
    const range = resolveHistoryRange(
      '30d',
      { startDate: '2026-01-02', endDate: '2026-01-02' },
      'UTC',
      new Date('2026-01-10T12:00:00.000Z'),
    ).unwrap()

    expect(
      buildHistoricalData(
        [
          { timestamp: new Date('2026-01-01T12:00:00.000Z'), value: 100n },
          { timestamp: new Date('2026-01-02T12:00:00.000Z'), value: 50n },
        ],
        150n,
        range,
        'UTC',
      ),
    ).toEqual([
      { timestamp: '2026-01-02T00:00:00.000Z', totalBalance: '100' },
      { timestamp: '2026-01-02T23:59:59.999Z', totalBalance: '150' },
    ])
  })

  it('does not fabricate custom history when no entries are available', () => {
    const range = resolveHistoryRange(
      '30d',
      { startDate: '2026-01-02', endDate: '2026-01-03' },
      'UTC',
      new Date('2026-01-10T12:00:00.000Z'),
    ).unwrap()

    expect(buildHistoricalData([], 100n, range, 'UTC')).toEqual([])
  })

  it('resolves target-zone midnight independently of the server timezone', () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'Australia/Sydney'

    try {
      const range = resolveHistoryRange(
        '30d',
        { startDate: '2026-04-04', endDate: '2026-04-06' },
        'America/Santiago',
        new Date('2026-04-10T12:00:00.000Z'),
      ).unwrap()

      expect(range.dayStarts.map((date) => date.toISOString())).toEqual([
        '2026-04-04T03:00:00.000Z',
        '2026-04-05T04:00:00.000Z',
        '2026-04-06T04:00:00.000Z',
      ])
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTimezone
      }
    }
  })

  it('allows custom ranges longer than 20 years', () => {
    const now = new Date('2035-01-04T12:00:00.000Z')
    const customRange = resolveHistoryRange(
      '30d',
      { startDate: '2009-01-03', endDate: '2035-01-03' },
      'UTC',
      now,
    ).unwrap()

    expect(customRange.start.toISOString()).toBe('2009-01-03T00:00:00.000Z')
  })
})

describe('all portfolio history', () => {
  it('starts on the first day of activity, ignoring earlier zero-balance snapshots', () => {
    const now = new Date('2026-01-04T12:00:00.000Z')
    const range = resolveHistoryRange('all', undefined, 'UTC', now).unwrap()
    expect(range.dayStarts).toEqual([])

    expect(
      buildHistoricalData(
        [
          { timestamp: new Date('2026-01-04T10:00:00.000Z'), value: 20n },
          { timestamp: new Date('2009-01-03T00:00:00.000Z'), value: 0n },
          { timestamp: new Date('2026-01-02T12:00:00.000Z'), value: 100n },
        ],
        120n,
        range,
        'UTC',
      ),
    ).toEqual([
      { timestamp: '2026-01-02T00:00:00.000Z', totalBalance: '0' },
      { timestamp: '2026-01-02T23:59:59.999Z', totalBalance: '100' },
      { timestamp: '2026-01-03T23:59:59.999Z', totalBalance: '100' },
      { timestamp: now.toISOString(), totalBalance: '120' },
    ])
  })

  it('uses the first activity day in the requested timezone', () => {
    const now = new Date('2026-01-03T12:00:00.000Z')
    const range = resolveHistoryRange('all', undefined, 'America/New_York', now).unwrap()
    const history = buildHistoricalData(
      [{ timestamp: new Date('2026-01-02T01:00:00.000Z'), value: 100n }],
      100n,
      range,
      'America/New_York',
    )

    expect(history[0]).toEqual({ timestamp: '2026-01-01T05:00:00.000Z', totalBalance: '0' })
    expect(history[1]).toEqual({ timestamp: '2026-01-02T04:59:59.999Z', totalBalance: '100' })
    expect(history.at(-1)?.timestamp).toBe(now.toISOString())
  })

  it('retains the first activity day even when all Bitcoin was spent that day', () => {
    const now = new Date('2026-01-04T12:00:00.000Z')
    const range = resolveHistoryRange('all', undefined, 'UTC', now).unwrap()
    const history = buildHistoricalData(
      [
        { timestamp: new Date('2026-01-02T12:00:00.000Z'), value: 100n },
        { timestamp: new Date('2026-01-02T13:00:00.000Z'), value: -100n },
      ],
      0n,
      range,
      'UTC',
    )
    expect(history[0]?.timestamp).toBe('2026-01-02T00:00:00.000Z')
    expect(history.at(-1)?.totalBalance).toBe('0')
  })

  it('does not invent historical dates when no activity is known', () => {
    const now = new Date('2026-01-04T12:00:00.000Z')
    const range = resolveHistoryRange('all', undefined, 'UTC', now).unwrap()
    expect(buildHistoricalData([], 100n, range, 'UTC')).toEqual([])
    expect(
      buildHistoricalData(
        [
          { timestamp: new Date('2009-01-03T00:00:00.000Z'), value: 0n },
          { timestamp: new Date('2027-01-01T00:00:00.000Z'), value: 100n },
        ],
        100n,
        range,
        'UTC',
      ),
    ).toEqual([])
  })

  it('keeps explicit custom dates even when the timeRange parameter is all', () => {
    const now = new Date('2026-01-04T12:00:00.000Z')
    const range = resolveHistoryRange('all', { startDate: '2026-01-01', endDate: '2026-01-03' }, 'UTC', now).unwrap()
    const history = buildHistoricalData(
      [{ timestamp: new Date('2026-01-02T12:00:00.000Z'), value: 100n }],
      100n,
      range,
      'UTC',
    )
    expect(history[0]?.timestamp).toBe('2026-01-01T00:00:00.000Z')
    expect(history.at(-1)?.timestamp).toBe('2026-01-03T23:59:59.999Z')
  })
})
