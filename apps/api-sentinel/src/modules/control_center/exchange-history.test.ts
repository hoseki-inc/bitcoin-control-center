import { describe, expect, it } from 'vitest'
import { setupExchangeHistory } from './exchange-history.fixtures'

describe.each(['strike', 'robinhood'] as const)('%s portfolio history', (provider) => {
  it.each([
    {
      scenario: 'purchase matching the first snapshot',
      amounts: ['1.0'],
      importedBalance: '100000000',
      snapshot: '100000000',
    },
    {
      scenario: 'purchase and withdrawal',
      amounts: ['1.0', '-0.25'],
      importedBalance: '75000000',
      snapshot: '75000000',
    },
    {
      scenario: 'snapshot differing from imported history',
      amounts: ['1.0'],
      importedBalance: '100000000',
      snapshot: '125000000',
    },
    { scenario: 'snapshots without imported history', amounts: [], importedBalance: '0', snapshot: '100000000' },
  ])('reconciles $scenario across the snapshot transition', async ({ amounts, importedBalance, snapshot }) => {
    const { service, input } = setupExchangeHistory(provider, amounts, snapshot)

    const data = (await service.getData(input)).expect('Portfolio history must load')

    expect(data.currentTotalBalance).toBe('150000000')
    expect(data.historicalData).toEqual([
      { timestamp: '2024-01-01T00:00:00.000Z', totalBalance: '0' },
      { timestamp: '2024-01-01T23:59:59.999Z', totalBalance: amounts.length > 0 ? '100000000' : '0' },
      { timestamp: '2024-01-02T23:59:59.999Z', totalBalance: importedBalance },
      { timestamp: '2024-01-03T23:59:59.999Z', totalBalance: snapshot },
      { timestamp: '2024-01-04T23:59:59.999Z', totalBalance: '150000000' },
    ])
  })
})
