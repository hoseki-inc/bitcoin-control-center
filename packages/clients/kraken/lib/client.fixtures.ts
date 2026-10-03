import { createHash, createHmac } from 'node:crypto'
import { expect, onTestFinished, vi } from 'vitest'
import { Client } from './client'

const credentials = {
  apiKey: 'synthetic-api-key',
  secretKey: Buffer.from('public-test-secret').toString('base64'),
}

interface SignatureScenario {
  client: Client
  outgoingSignature: () => Promise<{ actual: string | null; expected: string }>
}

function signSerializedRequest(path: string, body: string): string {
  const nonce = new URLSearchParams(body).get('nonce')
  if (nonce === null) {
    expect.fail('Outgoing request must contain a nonce')
  }
  expect(nonce, 'Outgoing request must contain a nonce').toMatch(/^\d+$/)

  const digest = createHash('sha256')
    .update(nonce + body)
    .digest()

  return createHmac('sha512', Buffer.from(credentials.secretKey, 'base64')).update(path).update(digest).digest('base64')
}

export function setupKrakenRequest(clockStep: number): SignatureScenario {
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  let now = 1_704_067_200_000
  vi.spyOn(Date, 'now').mockImplementation(() => {
    const timestamp = now
    now += clockStep

    return timestamp
  })

  let outgoing: Request | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      outgoing = new Request(input, init)
      const path = new URL(outgoing.url).pathname
      expect(['/0/private/Balance', '/0/private/Ledgers'], 'Unexpected Kraken endpoint').toContain(path)

      return Response.json({
        error: [],
        result: path.endsWith('/Balance') ? { XXBT: '1.0' } : { ledger: {}, count: 0 },
      })
    }),
  )

  return {
    client: new Client(credentials),
    outgoingSignature: async () => {
      const request = outgoing
      if (request === undefined) {
        expect.fail('Client must send a request')
      }
      expect(request.method, 'Private requests must use POST').toBe('POST')
      const body = await request.text()

      return {
        actual: request.headers.get('API-Sign'),
        expected: signSerializedRequest(new URL(request.url).pathname, body),
      }
    },
  }
}
