import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Client } from './client'
import { setupKrakenRequest } from './client.fixtures'

const credentials = {
  apiKey: 'synthetic-api-key',
  secretKey: Buffer.from('public-test-secret').toString('base64'),
}

describe.each([
  { endpoint: 'balance', request: (client: ReturnType<typeof setupKrakenRequest>['client']) => client.getBalance() },
  {
    endpoint: 'ledgers',
    request: (client: ReturnType<typeof setupKrakenRequest>['client']) => client.getLedgers({ asset: 'XBT', ofs: 0 }),
  },
  {
    endpoint: 'api key info',
    request: (client: ReturnType<typeof setupKrakenRequest>['client']) => client.getApiKeyInfo(),
  },
])('Kraken $endpoint request authentication', ({ request }) => {
  it.each([
    { clock: 'advances between nonce creation and signing', step: 1 },
    { clock: 'stays in the same millisecond', step: 0 },
  ])('signs the serialized nonce when the clock $clock', async ({ step }) => {
    const { client, outgoingSignature } = setupKrakenRequest(step)

    const result = await request(client)

    expect(result.isOk()).toBe(true)
    const signature = await outgoingSignature()
    expect(signature.actual).toBe(signature.expected)
  })
})

describe('Kraken getApiKeyInfo', () => {
  it('parses iban and permissions from a valid response', async () => {
    const { client } = setupKrakenRequest(0)

    const result = await client.getApiKeyInfo()

    expect(result.isOk()).toBe(true)
    expect(result.unwrap().data).toEqual({
      iban: 'AA88 N84G WOAK NMOI',
      permissions: ['query-funds', 'query-ledger-entries'],
    })
  })

  it('returns an ErrorResponse when Kraken returns an API error array without result', async () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json({ error: ['EAPI:Invalid key'] })),
    )

    const result = await new Client(credentials).getApiKeyInfo()

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().kind.name).toBe('ErrorResponse')
    expect(result.unwrapErr().message).toBe('EAPI:Invalid key')
  })

  it('returns Unauthorized on HTTP 401/403', async () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => new Response('Forbidden', { status: 403 })),
    )

    const result = await new Client(credentials).getApiKeyInfo()

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().kind.name).toBe('Unauthorized')
  })

  it('returns ResponseNotAcceptable on a malformed payload', async () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => Response.json({ error: [], result: { notAnIban: 123 } })),
    )

    const result = await new Client(credentials).getApiKeyInfo()

    expect(result.isErr()).toBe(true)
    expect(result.unwrapErr().kind.name).toBe('ResponseNotAcceptable')
  })

  it('uses strictly increasing nonces across sequential calls in the same millisecond', async () => {
    onTestFinished(() => {
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    })
    vi.spyOn(Date, 'now').mockReturnValue(1_704_067_200_000)

    const nonces: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (input, init) => {
        const req = new Request(input, init)
        const body = await req.text()
        const nonce = new URLSearchParams(body).get('nonce')
        if (nonce !== null) {
          nonces.push(nonce)
        }
        const path = new URL(req.url).pathname
        return Response.json({
          error: [],
          result: path.endsWith('/Balance') ? { XXBT: '1.0' } : { iban: 'AA88 N84G WOAK NMOI' },
        })
      }),
    )

    const client = new Client(credentials)
    expect((await client.getBalance()).isOk()).toBe(true)
    expect((await client.getApiKeyInfo()).isOk()).toBe(true)
    expect(nonces).toEqual(['1704067200000', '1704067200001'])
  })
})
