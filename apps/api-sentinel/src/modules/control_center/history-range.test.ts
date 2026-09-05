import { describe, expect, it } from 'vitest'
import { buildHistoricalData, resolveHistoryRange } from './history-range'

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
      if (originalTimezone === undefined) delete process.env.TZ
      else process.env.TZ = originalTimezone
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
