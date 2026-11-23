import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Client } from './client'

function stubFetch(handler: typeof fetch): void {
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(handler))
}

describe('Coinbase advancedTrade.keyPermissions.get', () => {
  it('fetches and parses portfolio_uuid from /api/v3/brokerage/key_permissions', async () => {
    let requestedPath = ''
    stubFetch(async (input, init) => {
      const req = new Request(input, init)
      requestedPath = new URL(req.url).pathname
      return Response.json({
        can_view: true,
        can_trade: false,
        can_transfer: false,
        portfolio_uuid: 'portfolio-uuid-1111',
        portfolio_type: 'DEFAULT',
      })
    })

    const client = Client({ credentials: { variant: 'ApiKey', key: 'k', secret: 's' } })
    const result = await client.advancedTrade.keyPermissions.get()

    expect(requestedPath).toBe('/api/v3/brokerage/key_permissions')
    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toEqual({
      can_view: true,
      can_trade: false,
      can_transfer: false,
      portfolio_uuid: 'portfolio-uuid-1111',
      portfolio_type: 'DEFAULT',
    })
  })

  it('returns Unauthorized on HTTP 403', async () => {
    stubFetch(async () => new Response('Forbidden', { status: 403, statusText: 'Forbidden' }))

    const client = Client({ credentials: { variant: 'ApiKey', key: 'k', secret: 's' } })
    const result = await client.advancedTrade.keyPermissions.get()

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().kind.name).toBe('Unauthorized')
  })

  it('returns ApiError without throwing or leaking the key when apiKey has invalid header characters', async () => {
    const fetchSpy = vi.fn<typeof fetch>(async () => {
      throw new Error('fetch should not be called for invalid header characters')
    })
    stubFetch(fetchSpy)

    const keyCanary = 'CB_HEADER_KEY_CANARY_481516'
    for (const badKey of [`${keyCanary}\r\ninjected`, `${keyCanary}\u0100`]) {
      const client = Client({ credentials: { variant: 'ApiKey', key: badKey, secret: 's' } })
      const result = await client.advancedTrade.accounts.list({ limit: 10 })

      expect(result.isErr()).toBe(true)
      const err = result.unwrapErr()
      expect(err.kind.name).toBe('UnexpectedFailure')
      expect(err.message).not.toContain(keyCanary)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
