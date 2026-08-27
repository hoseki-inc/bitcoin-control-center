import { afterEach, describe, expect, it, vi } from 'vitest'
import { SafeHttpErrorKind } from './errors.ts'
import { SafeResponse } from './response.ts'
import { safeHttp } from './safe-http.ts'

const url = 'https://example.com'

describe('SafeHttp', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('returns safe response', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response())
    const response = await safeHttp.get(url)
    expect(response.unwrap()).toBeInstanceOf(SafeResponse)
  })

  it('returns error when network is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))
    const response = await safeHttp.get(url)
    expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.NetworkUnreachable)
  })

  it('returns error when response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const response = await safeHttp.get(url)
    expect(response.expectErr('error missing').kind.value).toEqual(SafeHttpErrorKind.ErrorResponse)
  })
})
