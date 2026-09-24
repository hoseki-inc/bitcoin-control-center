import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { clearFlowSource, getFlowSource, setIsInGenerateStatementFlow } from './flow-tracker'

const storage = new Map<string, string>()

async function withTestSetup(run: () => Promise<void>): Promise<void> {
  // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
  onTestFinished(async () => {
    vi.unstubAllGlobals()
  })
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

  await run()
}

describe('flow source', () => {
  it('returns null when no flow is saved', async () => {
    await withTestSetup(async () => {
      expect(getFlowSource()).toBeNull()
    })
  })

  it('round-trips and clears a statement flow', async () => {
    await withTestSetup(async () => {
      setIsInGenerateStatementFlow()
      expect(getFlowSource()).toEqual({ type: 'statement' })
      clearFlowSource()
      expect(getFlowSource()).toBeNull()
    })
  })

  it.each(['', '{', 'null', '[]', '{}', '"statement"', '{"type":"other"}', '{"type":true}'])(
    'returns null for invalid saved data (%j)',
    async (source) => {
      await withTestSetup(async () => {
        storage.set('flowSource', source)
        expect(getFlowSource()).toBeNull()
      })
    },
  )

  it('accepts a statement flow with additional saved fields', async () => {
    await withTestSetup(async () => {
      storage.set('flowSource', '{"type":"statement","extra":true}')
      expect(getFlowSource()).toEqual({ type: 'statement' })
    })
  })
})
