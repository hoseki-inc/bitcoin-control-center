import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import { safeHttp } from './safe-http.ts'

const url = 'https://example.com'

describe('SafeHttp', () => {
  const originalFetch = global.fetch
  async function withTestSetup(run: () => Promise<void>): Promise<void> {
    // Vitest owns teardown so it has its own timeout and runs once, even after a test timeout.
    onTestFinished(async () => {
      global.fetch = originalFetch
    })

    await run()
  }

  it('returns safe response', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockResolvedValue(new Response())
      const response = await safeHttp.get(url)
      expect(response.expect('Expected successful result')).toBeInstanceOf(SafeResponse)
    })
  })

  it('returns error when network is unreachable', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
      const response = await safeHttp.get(url)
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
    })
  })

  it('returns error when response is not ok', async () => {
    await withTestSetup(async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false })
      const response = await safeHttp.get(url)
      expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.ErrorResponse)
    })
  })
})
