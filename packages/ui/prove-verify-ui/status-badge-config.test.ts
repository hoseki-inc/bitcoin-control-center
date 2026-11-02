import { expect, it } from 'vitest'
import { getBadgeConfigForClaim } from './status-badge-config'

it('shows a tracked account as unverified, in neutral and without an icon', () => {
  expect(getBadgeConfigForClaim('unverified')).toEqual({ status: 'neutral', label: 'unverified' })
})

it('keeps pending accounts in the warning color with a timer', () => {
  const config = getBadgeConfigForClaim('pending')
  expect(config.status).toBe('warning')
  expect(config.icon).toBeDefined()
})
