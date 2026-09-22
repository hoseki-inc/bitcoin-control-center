import { describe, expect, it } from 'vitest'
import { parseNavigationState } from './navigation-state'

describe('navigation state', () => {
  it('preserves reconnect details and statement selections', () => {
    const state = {
      returnTo: '/dashboard',
      displayName: 'My exchange',
      replaceAccountId: 'exchange-1',
      preSelectedClaimIds: ['re_clmx_first', 're_clmx_second'],
    }
    expect(parseNavigationState(state)).toEqual(state)
  })

  it('accepts empty state and ignores unrelated fields', () => {
    expect(parseNavigationState({})).toEqual({})
    expect(parseNavigationState({ returnTo: '/dashboard', unrelated: true })).toEqual({ returnTo: '/dashboard' })
  })

  it.each([
    null,
    undefined,
    '/dashboard',
    { returnTo: 123 },
    { displayName: false },
    { replaceAccountId: [] },
    { preSelectedClaimIds: [123] },
  ])('rejects malformed state: %j', (state) => {
    expect(parseNavigationState(state)).toBeNull()
  })
})
