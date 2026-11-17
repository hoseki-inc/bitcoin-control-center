import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { type ListQuery, countAccounts } from './client'

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
