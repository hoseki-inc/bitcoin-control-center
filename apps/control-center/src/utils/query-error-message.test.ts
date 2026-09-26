import { describe, expect, it } from 'vitest'
import { queryErrorMessage } from './query-error-message'

describe('queryErrorMessage', () => {
  it.each(['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed'])(
    'explains an unreachable server for %s',
    (message) => {
      expect(queryErrorMessage({ message }, 'Fallback')).toContain("Control Center's local server")
    },
  )
  it('preserves the page-specific message for server errors', () => {
    expect(queryErrorMessage({ message: 'Internal server error' }, 'Accounts unavailable')).toBe('Accounts unavailable')
    expect(queryErrorMessage(undefined, 'Accounts unavailable')).toBe('Accounts unavailable')
  })
})
