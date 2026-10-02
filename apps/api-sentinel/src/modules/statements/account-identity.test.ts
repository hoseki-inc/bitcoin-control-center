import { describe, expect, it } from 'vitest'
import {
  generateStatementPdf,
  setupDistinctWalletNames,
  setupDuplicateWalletNames,
  setupEmptyNamedWallet,
  setupTwoCoinbaseAccounts,
  setupTwoExchangeAccounts,
  setupWalletAndExchangeWithSameName,
} from './service.fixtures'

describe('statement account identity', () => {
  it.each([
    { scenario: 'distinct wallet names', setup: setupDistinctWalletNames, names: ['Savings', 'Spending'] },
    { scenario: 'duplicate wallet names', setup: setupDuplicateWalletNames, names: ['Savings', 'Savings'] },
    {
      scenario: 'wallet name matching an exchange provider',
      setup: setupWalletAndExchangeWithSameName,
      names: ['Strike', 'Strike'],
    },
    {
      scenario: 'two accounts at the same exchange',
      setup: setupTwoExchangeAccounts,
      names: ['Strike – Savings', 'Strike – Trading'],
    },
    {
      scenario: 'two Coinbase accounts',
      setup: setupTwoCoinbaseAccounts,
      names: ['Coinbase – Savings', 'Coinbase – Trading'],
    },
  ])('retains both accounts and their 3 BTC combined balance: $scenario', async ({ setup, names }) => {
    const statement = await generateStatementPdf(setup())

    expect.soft(statement.summary.closingBalance.sats).toBe(300_000_000n)
    expect.soft(statement.summary.entries).toHaveLength(2)
    expect.soft(statement.summary.entries.map((account) => account.displayName)).toEqual(names)
    expect
      .soft(statement.summary.entries.map((account) => account.closingBalance.sats))
      .toEqual([100_000_000n, 200_000_000n])
  })

  it('keeps the name of an account with no transactions', async () => {
    const statement = await generateStatementPdf(setupEmptyNamedWallet())

    expect(statement.summary.entries.map((account) => account.displayName)).toEqual(['Savings', 'Savings'])
    expect(statement.summary.entries.map((account) => account.closingBalance.sats)).toEqual([0n, 200_000_000n])
  })
})
