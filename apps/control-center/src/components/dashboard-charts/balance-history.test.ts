import Decimal from 'decimal.js'
import { describe, expect, it } from 'vitest'
import {
  type BalanceDataPoint,
  type MonthlyChange,
  formatAxisBtc,
  formatAxisDate,
  getAxisDecimals,
  getBalanceAxis,
  getFlowTotals,
  getMonthTickLabel,
  getMonthlyChanges,
  toSatoshisString,
  withCurrentBalancePoint,
} from './balance-history'

const BTC = 100_000_000

describe('balance input normalization', () => {
  it.each([
    ['text', ' 123 ', '123'],
    ['empty text', '  ', '0'],
    ['large integer text', '900719925474099312345', '900719925474099312345'],
    ['positive fraction', 1.9, '1'],
    ['negative fraction', -1.1, '-2'],
    ['NaN', NaN, '0'],
    ['infinity', Infinity, 'Infinity'],
    ['null', null, '0'],
    ['undefined', undefined, '0'],
    ['boolean', true, '0'],
    ['bigint', 1n, '0'],
    ['Decimal', new Decimal('123.45'), '123.45'],
    ['array', ['123'], '123'],
    ['empty array', [], '0'],
    ['non-string method result', { toString: () => 123 }, '0'],
  ] as const)('preserves normalization of %s', (_label, value, expected) => {
    expect(toSatoshisString(value)).toBe(expected)
  })

  it('reads an object stringifier once and preserves its receiver', () => {
    let reads = 0
    const balance = {
      raw: ' 123 ',
      get toString() {
        reads += 1
        return function (this: { raw: string }): string {
          return this.raw
        }
      },
    }
    expect(toSatoshisString(balance)).toBe('123')
    expect(reads).toBe(1)
  })

  it('preserves errors raised by an object stringifier', () => {
    expect(() =>
      toSatoshisString({
        toString: () => {
          throw new Error('balance unreadable')
        },
      }),
    ).toThrow('balance unreadable')
  })
})

function sats(btc: number): string {
  return String(Math.round(btc * BTC))
}

describe('balance history helpers', () => {
  it('uses the prior month-end balance as the monthly baseline', () => {
    const changes = getMonthlyChanges(
      [
        { timestamp: '2026-04-30T12:00:00.000Z', totalBalance: sats(8.0) },
        { timestamp: '2026-05-01T12:00:00.000Z', totalBalance: sats(8.5) },
        { timestamp: '2026-05-31T12:00:00.000Z', totalBalance: sats(8.4) },
      ],
      6,
      'UTC',
    )

    expect(changes.find((change) => change.key === '2026-05')?.change).toBe(0.4)
  })

  it('stitches the selected live balance into the same series used by the charts', () => {
    const data = withCurrentBalancePoint(
      [
        { timestamp: '2026-05-31T12:00:00.000Z', totalBalance: sats(8.4) },
        { timestamp: '2026-06-01T12:00:00.000Z', totalBalance: sats(8.4) },
      ],
      sats(8.55),
      new Date('2026-06-08T12:00:00.000Z'),
      'UTC',
    )

    expect(data[data.length - 1]).toMatchObject({
      timestamp: '2026-06-08T12:00:00.000Z',
      totalBalance: sats(8.55),
    })
    expect(getMonthlyChanges(data, 6, 'UTC').find((change) => change.key === '2026-06')?.change).toBe(0.15)
  })

  it('counts late evening month-end transfers in the user timezone month', () => {
    const changes = getMonthlyChanges(
      [
        // Apr 30 23:59 in New York: baseline before May starts.
        { timestamp: '2026-05-01T03:59:00.000Z', totalBalance: sats(1) },
        // May 31 21:00 in New York, but June 1 in UTC.
        { timestamp: '2026-06-01T01:00:00.000Z', totalBalance: sats(2) },
      ],
      6,
      'America/New_York',
    )

    expect(changes.find((change) => change.key === '2026-05')?.change).toBe(1)
    expect(changes.find((change) => change.key === '2026-06')).toBeUndefined()
  })
})

describe('approximate in and out from balances', () => {
  const point = (day: number, balanceSats: number): BalanceDataPoint => ({
    timestamp: `2026-09-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    totalBalance: String(balanceSats),
  })

  it('adds rises as in and drops as out, so in minus out is the net change', () => {
    const { inBtc, outBtc } = getFlowTotals([
      point(1, 10_000_000),
      point(2, 30_000_000),
      point(3, 25_000_000),
      point(4, 40_000_000),
    ])
    expect(inBtc.toString()).toBe('0.35')
    expect(outBtc.toString()).toBe('0.05')
    expect(inBtc.minus(outBtc).toString()).toBe('0.3')
  })

  it('orders points by time before comparing them', () => {
    const { inBtc, outBtc } = getFlowTotals([point(3, 25_000_000), point(1, 10_000_000), point(2, 30_000_000)])
    expect(inBtc.toString()).toBe('0.2')
    expect(outBtc.toString()).toBe('0.05')
  })

  it('reports nothing for a single point or no history', () => {
    for (const data of [[], [point(1, 10_000_000)]]) {
      const { inBtc, outBtc } = getFlowTotals(data)
      expect(inBtc.isZero()).toBe(true)
      expect(outBtc.isZero()).toBe(true)
    }
  })
})

describe('month labels under the bars', () => {
  const months = (count: number, firstYear: number, firstMonth: number): MonthlyChange[] =>
    Array.from({ length: count }, (_, index) => {
      const date = new Date(Date.UTC(firstYear, firstMonth - 1 + index, 1))
      return {
        key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`,
        label: date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
        labelWithYear: date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
        change: 0,
      }
    })

  it('labels every month up to a year and gives January its year', () => {
    const year = months(12, 2025, 11)
    expect(year.map((_, index) => getMonthTickLabel(year, index))).toEqual([
      'Nov',
      'Dec',
      'Jan \u201926',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
    ])
  })

  it('labels every third month beyond a year, counting back from the latest', () => {
    const twoYears = months(24, 2024, 11)
    const labels = twoYears.map((_, index) => getMonthTickLabel(twoYears, index))
    expect(labels.at(-1)).toBe('Oct')
    expect(labels.filter((label) => label !== null)).toEqual([
      'Jan \u201925',
      'Apr',
      'Jul',
      'Oct',
      'Jan \u201926',
      'Apr',
      'Jul',
      'Oct',
    ])
  })

  it.each([
    ['November', 11, ['Nov \u201925', 'Feb \u201926', 'May', 'Aug', 'Nov']],
    ['December', 12, ['Dec \u201925', 'Mar \u201926', 'Jun', 'Sep', 'Dec']],
  ] as const)('marks each year when a range of over a year ends in %s', (_name, lastMonth, expected) => {
    // Thirteen months, as the one-year range shows, so January itself is unlabeled; the first label gives the year.
    const range = months(13, 2025, lastMonth)
    expect(range.map((_, index) => getMonthTickLabel(range, index)).filter((label) => label !== null)).toEqual(expected)
  })

  it.each([
    // Four years still fit every third month; longer histories thin out so labels never overlap.
    [48, 3, 16],
    [60, 6, 10],
    [121, 12, 11],
    [400, 24, 17],
  ] as const)('labels %i months every %i, %i labels in all', (count, step, labelCount) => {
    const range = months(count, 2000, 1)
    const labels = range.map((_, index) => getMonthTickLabel(range, index))
    expect(labels.filter((label) => label !== null)).toHaveLength(labelCount)
    expect(labels.at(-1)).not.toBeNull()
    expect(labels.at(-1 - step)).not.toBeNull()
    expect(labels.slice(-step, -1).every((label) => label === null)).toBe(true)
  })

  it('gives every label its year when labels are a year apart', () => {
    const decade = months(121, 2016, 10)
    expect(decade.map((_, index) => getMonthTickLabel(decade, index)).filter((label) => label !== null)).toEqual(
      Array.from({ length: 11 }, (_, index) => `Oct \u2019${String(16 + index)}`),
    )
  })

  it('leaves an unknown month blank', () => {
    expect(getMonthTickLabel(months(3, 2026, 1), 5)).toBeNull()
  })
})

describe('balance chart edge dates', () => {
  const now = new Date('2026-10-07T12:00:00.000Z')

  it('drops the year only within the current year', () => {
    expect(formatAxisDate(Date.parse('2026-07-09T12:00:00.000Z'), 'UTC', 'day', now)).toBe('Jul 9')
    expect(formatAxisDate(Date.parse('2025-10-07T12:00:00.000Z'), 'UTC', 'day', now)).toBe('Oct 7, 2025')
  })

  it('shows a month and year for the start of all-time history', () => {
    expect(formatAxisDate(Date.parse('2024-01-08T12:00:00.000Z'), 'UTC', 'month', now)).toBe('Jan 2024')
  })

  it('uses the given time zone for the calendar date', () => {
    expect(formatAxisDate(Date.parse('2026-07-10T02:00:00.000Z'), 'America/Chicago', 'day', now)).toBe('Jul 9')
  })

  it("compares years in the given time zone, not UTC's", () => {
    // Still December 31, 2026 in Chicago, though already 2027 in UTC.
    const newYearUtc = new Date('2027-01-01T03:00:00.000Z')
    expect(formatAxisDate(Date.parse('2026-12-15T12:00:00.000Z'), 'America/Chicago', 'day', newYearUtc)).toBe('Dec 15')
  })

  it('compares years in a time zone ahead of UTC', () => {
    // Already January 1, 2027 in Tokyo, though still 2026 in UTC. With the case
    // above, one fails whatever the machine's own zone if its year is compared.
    const newYearTokyo = new Date('2026-12-31T20:00:00.000Z')
    expect(formatAxisDate(Date.parse('2027-01-05T12:00:00.000Z'), 'Asia/Tokyo', 'day', newYearTokyo)).toBe('Jan 5')
  })
})

describe('balance axis labels', () => {
  const labels = (ticks: number[]): string[] => ticks.map((tick) => formatAxisBtc(tick, getAxisDecimals(ticks)))

  it('stays short when the ticks already read differently', () => {
    expect(labels([0.0634, 0.1426, 0.2218])).toEqual(['0.0634', '0.1426', '0.2218'])
    expect(labels([1, 2.5, 4])).toEqual(['1.00', '2.50', '4.00'])
  })

  it('adds decimals until close ticks read differently', () => {
    expect(labels([1.49985, 1.5005, 1.50115])).toEqual(['1.4999', '1.5005', '1.5012'])
    expect(labels([0.00000014, 0.00000016, 0.00000018])).toEqual(['0.00000014', '0.00000016', '0.00000018'])
  })

  it('gives ticks a few satoshis apart every decimal they need, compared as drawn', () => {
    // At seven decimals toFixed reads these apart, but the drawn labels repeat 0.0500001.
    expect(labels([0.05000005, 0.05000011, 0.05000016])).toEqual(['0.05000005', '0.05000011', '0.05000016'])
  })

  it('uses one precision across 1 BTC and groups thousands', () => {
    expect(labels([0.987, 1, 1.013])).toEqual(['0.987', '1.000', '1.013'])
    expect(labels([1200, 1500])).toEqual(['1,200.00', '1,500.00'])
  })

  it('adds decimals until even gridlines read as even steps', () => {
    // At four decimals a flat 123,456 sats reads 0.0011, 0.0012, 0.0014.
    expect(labels(getBalanceAxis([0.00123456]).ticks)).toEqual(['0.00111', '0.00123', '0.00136'])
    // At four decimals an 8,367-sat move reads 0.5118, 0.5119, 0.5120: twice the axis's real span.
    expect(labels(getBalanceAxis([0.51186167, 0.51194534]).ticks)).toEqual(['0.51185', '0.51190', '0.51196'])
  })

  it('allows a label up to a tenth of a step from its tick', () => {
    // 0.0018 is 9.5% of a step from 0.00184.
    expect(labels([0.001, 0.00142, 0.00184])).toEqual(['0.0010', '0.0014', '0.0018'])
    // 0.0013 is 11.8% of a step from 0.00134.
    expect(labels([0.001, 0.00134, 0.00168])).toEqual(['0.00100', '0.00134', '0.00168'])
  })

  it('labels a lone zero tick', () => {
    expect(labels([0])).toEqual(['0.0000'])
  })
})

describe('balance axis ticks', () => {
  it('clamps the bottom tick to zero and keeps the middle tick midway, to the satoshi', () => {
    // The padded bottom would be below zero; the midpoint of 0 and 14,047,531 sats rounds up.
    expect(getBalanceAxis([0.01, 0.12345679])).toEqual({
      ticks: [0, 0.07023766, 0.14047531],
      domain: [0, 0.14047531],
    })
  })

  it.each([
    ['a rising balance', [0.01, 0.12345679]],
    ['a balance well above zero', [0.1, 0.2]],
    ['a flat balance', [0.5, 0.5, 0.5]],
    ['a flat single satoshi', [0.00000001, 0.00000001]],
  ])('draws three ticks, none below zero, spanning exactly the domain for %s', (_label, values) => {
    const { ticks, domain } = getBalanceAxis(values)
    expect(new Set(ticks).size).toBe(3)
    expect(ticks.every((tick) => tick >= 0)).toBe(true)
    expect(ticks[0]).toBeLessThanOrEqual(Math.min(...values))
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(Math.max(...values))
    expect(domain).toEqual([ticks[0], ticks.at(-1)])
  })

  it('draws only the zero line for a balance that is zero throughout', () => {
    const { ticks, domain } = getBalanceAxis([0, 0])
    expect(ticks).toEqual([0])
    // Still a positive height, so the chart can place the line.
    expect(domain[0]).toBe(0)
    expect(domain[1]).toBeGreaterThan(0)
  })
})
