import { describe, expect, it } from 'vitest'
import { setupKrakenRequest } from './client.fixtures'

describe.each([
  { endpoint: 'balance', request: (client: ReturnType<typeof setupKrakenRequest>['client']) => client.getBalance() },
  {
    endpoint: 'ledgers',
    request: (client: ReturnType<typeof setupKrakenRequest>['client']) => client.getLedgers({ asset: 'XBT', ofs: 0 }),
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
