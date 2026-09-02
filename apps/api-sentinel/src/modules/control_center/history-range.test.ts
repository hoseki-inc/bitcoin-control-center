import { describe, expect, it } from 'vitest'
import { buildHistoricalData, getHistoryAvailableFrom, resolveHistoryRange } from './history-range'

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
      { timestamp: '2026-01-02T23:59:59.999Z', totalBalance: '150' },
      { timestamp: '2026-01-03T23:59:59.999Z', totalBalance: '125' },
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

  it('reports the earliest available calendar date in the user timezone', () => {
    expect(
      getHistoryAvailableFrom(
        [
          { timestamp: new Date('2026-08-02T02:00:00.000Z'), value: 1n },
          { timestamp: new Date('2026-08-03T02:00:00.000Z'), value: 1n },
        ],
        'America/New_York',
      ),
    ).toBe('2026-08-01')
  })
})
