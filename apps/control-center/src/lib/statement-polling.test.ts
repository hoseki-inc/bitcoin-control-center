import { describe, expect, it } from 'vitest'
import { statementFixture } from '../testing/statements'
import { refetchWhileGenerating } from './statement-polling'

describe('refetchWhileGenerating', () => {
  it('refreshes only while a statement is generating', () => {
    expect(refetchWhileGenerating(undefined)).toBe(false)
    expect(
      refetchWhileGenerating([statementFixture({ status: 'completed' }), statementFixture({ status: 'failed' })]),
    ).toBe(false)
    expect(
      refetchWhileGenerating([statementFixture({ status: 'completed' }), statementFixture({ status: 'pending' })]),
    ).toBe(2000)
  })
})
