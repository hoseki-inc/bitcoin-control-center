import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type SentinelDatabase, initDatabase } from './db'
import { Encrypted, initEncryption } from './lib/encrypted'
import { EtfService } from './modules/etf/service'
import { ExchangeService } from './modules/exchange/service'

const logger = pino({ level: 'silent' })
let directory: string
let database: SentinelDatabase

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sentinel-persisted-data-'))
  database = initDatabase(directory, logger)
  initEncryption('11'.repeat(32))
})

afterEach(() => {
  database.close()
  rmSync(directory, { recursive: true, force: true })
})

function accountWithCredentials(credentials: string) {
  database.db
    .prepare(
      'INSERT INTO exchange_accounts (id, provider, display_name, encrypted_credentials, balance_sats, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('exchange', 'kraken', 'Test account', credentials, '100', new Date().toISOString())
  return new ExchangeService({ db: database.db, logger }).listAccounts()
}

describe('stored exchange credentials', () => {
  it('keeps valid decryptable credentials connected', () => {
    const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
    const accounts = accountWithCredentials(JSON.stringify({ type: 'apiKey', data: { key: { blob } } }))
    expect(accounts).toEqual([expect.objectContaining({ connectionStatus: 'connected', balanceSats: '100' })])
  })

  it.each([
    ['invalid JSON', '{'],
    ['null', 'null'],
    ['unsupported credential type', JSON.stringify({ type: 'oauth', data: {} })],
    ['missing credential data', JSON.stringify({ type: 'apiKey' })],
    ['empty credential data', JSON.stringify({ type: 'apiKey', data: {} })],
    ['non-object credential data', JSON.stringify({ type: 'apiKey', data: 'invalid' })],
    ['missing blob', JSON.stringify({ type: 'apiKey', data: { key: {} } })],
    ['non-string blob', JSON.stringify({ type: 'apiKey', data: { key: { blob: 42 } } })],
    ['malformed ciphertext', JSON.stringify({ type: 'apiKey', data: { key: { blob: 'invalid' } } })],
  ])('requires reconnection for %s without exposing a stale balance', (_label, credentials) => {
    expect(accountWithCredentials(credentials)).toEqual([
      expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null, balanceAsOf: null }),
    ])
  })

  it('rejects an unsupported credential type even when its blobs decrypt', () => {
    const blob = Encrypted.encrypt('synthetic-test-credential').expect('Test credential should encrypt').blob
    expect(accountWithCredentials(JSON.stringify({ type: 'oauth', data: { key: { blob } } }))).toEqual([
      expect.objectContaining({ connectionStatus: 'needs_reconnect', balanceSats: null }),
    ])
  })
})

describe('stored ETF tickers', () => {
  it.each(['UNKNOWN', 'toString'])('preserves supported holdings when a stored ticker is %s', (ticker) => {
    const service = new EtfService({ db: database.db, logger })
    const account = service
      .createAccount({ displayName: 'Test ETF', holdings: [{ ticker: 'IBIT', shares: '10' }] })
      .expect('Test ETF account should be created')
    const expectedBalance = service.computeAccountBalance(account.id)
    expect(expectedBalance).toBeGreaterThan(0n)
    database.db
      .prepare('INSERT INTO etf_holdings (id, account_id, ticker, shares, date_purchased) VALUES (?, ?, ?, ?, ?)')
      .run('unsupported', account.id, ticker, '20', '2020-01-01')

    expect(service.computeAccountBalance(account.id)).toBe(expectedBalance)
    expect(service.getAccumulationEntries([account.id])).toContainEqual({
      timestamp: new Date('2020-01-01'),
      value: 0n,
    })
  })
})
