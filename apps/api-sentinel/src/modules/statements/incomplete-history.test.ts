import { describe, expect, it } from 'vitest'
import {
  generateStatementPdf,
  missingTransactionId,
  setupDepositAndWithdrawal,
  setupHistoryFailure,
} from './incomplete-history.fixtures'

describe('statement generation with incomplete transaction history', () => {
  it('includes both a deposit and a withdrawal when all transaction fetches succeed', async () => {
    const statement = await generateStatementPdf(setupDepositAndWithdrawal('success'))

    expect(statement.summary.closingBalance.sats).toBe(75_000_000n)
    expect(statement.statementEntries[0]?.transactions.map((tx) => tx.amount.sats)).toEqual([
      100_000_000n,
      -25_000_000n,
    ])
  })

  it.each(['HTTP 404', 'HTTP 503', 'network rejection', 'invalid JSON'] as const)(
    'rejects partial statement data when a withdrawal fetch fails with %s',
    async (failure) => {
      const { service, input, getDailyRates } = setupDepositAndWithdrawal(failure)
      const result = await service.generateStatementData(input)

      expect(result.isErr(), 'A missing withdrawal must fail generation, not leave a successful 1 BTC balance').toBe(
        true,
      )
      const error = result.expectErr('Missing withdrawal must fail')
      expect(error.message).toContain(missingTransactionId)
      if (failure.startsWith('HTTP')) {
        expect(error.message).toContain(failure)
      } else {
        expect(error.cause).toBeInstanceOf(Error)
      }
      expect(getDailyRates).not.toHaveBeenCalled()
    },
  )

  it('rejects partial statement data when Electrum history fails after an account was fetched', async () => {
    const { service, input, getDailyRates } = setupHistoryFailure()
    const result = await service.generateStatementData(input)

    expect(result.isErr(), 'Failed history must not be treated as an empty wallet').toBe(true)
    expect(result.expectErr('Failed history must fail').message).toContain('Synthetic Electrum history failure')
    expect(getDailyRates).not.toHaveBeenCalled()
  })
})
