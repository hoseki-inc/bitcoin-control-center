import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { type AuthClient, type ListQuery, VERIFY_PIN, countAccounts, signIn } from './client'

const list = (count: number): ListQuery => ({
  list: { query: async () => Array.from({ length: count }, (_, index) => index) },
})

describe('countAccounts', () => {
  it('counts every kind of account Home shows, not only wallets', async () => {
    for (const kind of ['exchange', 'manual', 'etf'] as const) {
      const lists = { registry: { claims: list(0) }, exchange: list(0), manual: list(0), etf: list(0), [kind]: list(1) }
      assert.equal(await countAccounts({ portalProve: lists }), 1, kind)
    }
    const all = { registry: { claims: list(2) }, exchange: list(1), manual: list(1), etf: list(1) }
    assert.equal(await countAccounts({ portalProve: all }), 5)
  })
})

interface FakeAuth {
  client: AuthClient
  calls: string[]
}

function authClient(
  status: { platform: string | null; retryAfterMs?: number | null },
  outcome: { ok: true } | { ok: false; reason: 'wrong' | 'wait' },
): FakeAuth {
  const calls: string[] = []
  const mutation = (name: string) => ({
    mutate: async ({ pin }: { pin: string }) => {
      calls.push(`${name} ${pin}`)
      return outcome
    },
  })
  return {
    client: {
      auth: { status: { query: async () => status }, signIn: mutation('signIn'), setFirstPin: mutation('setFirstPin') },
    },
    calls,
  }
}

describe('signIn', () => {
  it('does nothing while PINs are off', async () => {
    const { client, calls } = authClient({ platform: null }, { ok: true })
    await signIn(client)
    assert.deepEqual(calls, [])
  })

  it("signs in with the run's PIN, or sets it first at launch", async () => {
    const { client, calls } = authClient({ platform: 'umbrel', retryAfterMs: null }, { ok: true })
    await signIn(client)
    await signIn(client, true)
    assert.deepEqual(calls, [`signIn ${VERIFY_PIN}`, `setFirstPin ${VERIFY_PIN}`])
  })

  it('fails when Sentinel refuses the PIN, rather than carrying on signed out', async () => {
    const { client } = authClient({ platform: 'umbrel', retryAfterMs: null }, { ok: false, reason: 'wrong' })
    await assert.rejects(signIn(client), /refused the run's PIN/)
  })

  it("doesn't try during a wrong-PIN wait, so it never adds a wrong attempt", async () => {
    const { client, calls } = authClient({ platform: 'umbrel', retryAfterMs: 12_000 }, { ok: true })
    await assert.rejects(signIn(client), /wait 12 seconds/)
    assert.deepEqual(calls, [])
  })
})
