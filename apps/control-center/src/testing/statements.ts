import { act } from 'react'
import { assert } from 'vitest'
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
    txSource: 'public_mempool',
    progress: null,
    user: { name: null, email: null },
    integrator: null,
    userId: 'user',
    ...overrides,
  }
}

/** Confirms the open "Delete statement?" dialog, which renders outside the page container. */
export async function confirmDelete(): Promise<void> {
  const confirm = Array.from(document.querySelectorAll('footer button')).find(
    (button) => button.textContent === 'Delete',
  )
  assert(confirm instanceof window.HTMLButtonElement, 'Expected the confirm button')
  await act(async () => {
    confirm.click()
  })
}
