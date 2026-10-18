import Decimal from 'decimal.js'
import { expect, it } from 'vitest'
import { resolveWalletBalance } from './wallet-balance'

const stored = { balanceSats: '200000000', timestamp: '2026-10-14T12:00:00Z' }
const storedAt = Date.parse(stored.timestamp)
const live = { current: new Decimal(100_000_000), usd: new Decimal(50_000) }

it('leaves a never-loaded wallet unknown, including after failure', () => {
  expect(resolveWalletBalance({ live: null, updatedAt: 0, balancesFailed: true })).toEqual({
    balance: null,
    updatedAt: null,
    fromStorage: false,
  })
})

it('keeps the snapshot amount and original date while live balances load', () => {
  const result = resolveWalletBalance({ live: null, stored, updatedAt: 0, balancesFailed: false })
  expect(result.balance?.current.toString()).toBe('200000000')
  expect(result.updatedAt).toBe(storedAt)
  expect(result.fromStorage).toBe(true)
})

it('uses the newer known amount after a failed refresh', () => {
  const newerStored = resolveWalletBalance({ live, stored, updatedAt: storedAt - 60_000, balancesFailed: true })
  expect(newerStored.balance?.current.toString()).toBe('200000000')
  expect(newerStored.updatedAt).toBe(storedAt)
  const newerLive = resolveWalletBalance({ live, stored, updatedAt: storedAt + 60_000, balancesFailed: true })
  expect(newerLive.balance).toBe(live)
  expect(newerLive.updatedAt).toBe(storedAt + 60_000)
})

it('uses a fresh confirmed zero instead of an older positive snapshot', () => {
  const zero = { current: new Decimal(0), usd: null }
  const result = resolveWalletBalance({ live: zero, stored, updatedAt: storedAt + 60_000, balancesFailed: false })
  expect(result.balance).toBe(zero)
  expect(result.fromStorage).toBe(false)
})
