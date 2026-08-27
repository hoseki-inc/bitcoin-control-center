import type { Decimal } from 'decimal.js'

export interface BalanceValue {
  current: Decimal
  usd: Decimal | null
}

export type BalanceWithStatus = { status: 'loading' } | { status: 'success'; value: BalanceValue } | { status: 'fail' }
