import { MAX_TRANSACTION_INPUTS, MAX_TRANSACTION_OUTPUTS } from '@hoseki/packages/bitcoin/limits'
import { expect, it } from 'vitest'
import {
  ElectrumVerboseTransactionSchema,
  MAX_ELECTRUM_LIST_ITEMS,
  ScripthashHistorySchema,
  ScripthashUnspentSchema,
} from './schemas'

const txHash = 'a'.repeat(64)
const transaction = { txid: txHash, version: 2, locktime: 0, vin: [], vout: [] }

it.each([
  { name: 'history', schema: ScripthashHistorySchema, length: MAX_ELECTRUM_LIST_ITEMS + 1 },
  { name: 'unspent outputs', schema: ScripthashUnspentSchema, length: MAX_ELECTRUM_LIST_ITEMS + 1 },
])('stops at the first issue for $name longer than a response can hold', ({ schema, length }) => {
  const result = schema.safeParse(Array.from({ length }, () => 0))

  expect(result.error?.issues).toEqual([expect.objectContaining({ code: 'too_big', path: [] })])
})

it.each([
  { list: 'vin', length: MAX_TRANSACTION_INPUTS + 1 },
  { list: 'vout', length: MAX_TRANSACTION_OUTPUTS + 1 },
])('stops at the first issue for a transaction $list longer than a transaction can have', ({ list, length }) => {
  const result = ElectrumVerboseTransactionSchema.safeParse({
    ...transaction,
    [list]: Array.from({ length }, () => 0),
  })

  expect(result.error?.issues).toEqual([expect.objectContaining({ code: 'too_big', path: [list] })])
})

it('accepts a history as long as a response can hold', () => {
  const history = Array.from({ length: MAX_ELECTRUM_LIST_ITEMS }, () => ({ tx_hash: txHash, height: 1 }))

  expect(ScripthashHistorySchema.safeParse(history).success).toBe(true)
})
