import { describe, expect, it } from 'vitest'
import { getMonthlyChanges, withCurrentBalancePoint } from './balance-history'

const BTC = 100_000_000

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
