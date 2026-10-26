import { expect, it } from 'vitest'
import { getFlowTotals, getMonthlyChanges } from '../dashboard-charts/balance-history'
import { sampleBalanceHistory } from './sample-history'

const now = new Date('2026-10-19T09:30:00.000Z')

it('covers twelve calendar months ending today', () => {
  const points = sampleBalanceHistory(now)
  expect(points[0]?.timestamp).toBe('2025-11-01T12:00:00.000Z')
  expect(points.at(-1)?.timestamp).toBe('2026-10-19T12:00:00.000Z')
  expect(getMonthlyChanges(points, Number.POSITIVE_INFINITY, 'UTC')).toHaveLength(12)
})

it('adds to the stack in most months and takes from it in two', () => {
  const points = sampleBalanceHistory(now)
  const changes = getMonthlyChanges(points, Number.POSITIVE_INFINITY, 'UTC')
  expect(changes.filter((month) => month.change < 0)).toHaveLength(2)
  expect(changes.filter((month) => month.change > 0)).toHaveLength(10)
  expect(getFlowTotals(points).inBtc.gt(getFlowTotals(points).outBtc)).toBe(true)
})
