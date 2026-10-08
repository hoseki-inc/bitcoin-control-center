import type { StatementDto } from '../trpc/server-types'

/** A completed statement created at noon local time on 1 September 2026, so its dates read the same in any time zone. */
export function statementFixture(overrides: Partial<StatementDto> = {}): StatementDto {
  const createdAt = new Date(2026, 8, 1, 12)
  return {
    id: 'statement',
    createdAt,
    updatedAt: createdAt,
    openingDate: new Date(2026, 7, 1),
    closingDate: new Date(2026, 7, 31, 23, 59, 59),
    counter: 1,
    timezone: 'UTC',
    status: 'completed',
    quoteCurrency: 'USD',
    errorMessage: null,
    user: { name: null, email: null },
    integrator: null,
    userId: 'user',
    ...overrides,
  }
}
