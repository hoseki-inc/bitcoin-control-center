import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearFlowSource, getFlowSource, setIsInGenerateStatementFlow } from './flow-tracker'

const storage = new Map<string, string>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value)
    },
    removeItem: (key: string) => {
      storage.delete(key)
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('flow source', () => {
  it('returns null when no flow is saved', () => {
    expect(getFlowSource()).toBeNull()
  })

  it('round-trips and clears a statement flow', () => {
    setIsInGenerateStatementFlow()
    expect(getFlowSource()).toEqual({ type: 'statement' })
    clearFlowSource()
    expect(getFlowSource()).toBeNull()
  })

  it.each(['', '{', 'null', '[]', '{}', '"statement"', '{"type":"other"}', '{"type":true}'])(
    'returns null for invalid saved data (%j)',
    (source) => {
      storage.set('flowSource', source)
      expect(getFlowSource()).toBeNull()
    },
  )

  it('accepts a statement flow with additional saved fields', () => {
    storage.set('flowSource', '{"type":"statement","extra":true}')
    expect(getFlowSource()).toEqual({ type: 'statement' })
  })
})
