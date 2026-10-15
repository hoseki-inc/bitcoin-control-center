import { describe, expect, it } from 'vitest'
import { ELECTRUM_UNREACHABLE_BALANCE_MESSAGE, balanceErrorMessage } from './balance-error'

describe('balanceErrorMessage', () => {
  const socketError = { message: 'connect ECONNREFUSED 10.21.21.10:50001' }

  it('shows nothing without an error', () => {
    expect(balanceErrorMessage(null, false)).toBeNull()
  })

  it('explains an unreachable server instead of showing the socket error', () => {
    expect(balanceErrorMessage(socketError, false)).toBe(ELECTRUM_UNREACHABLE_BALANCE_MESSAGE)
  })

  it('treats an unknown connection status as unreachable', () => {
    expect(balanceErrorMessage(socketError, undefined)).toBe(ELECTRUM_UNREACHABLE_BALANCE_MESSAGE)
  })

  it("keeps the server's own message when it answered with an error", () => {
    const serverError = { message: 'history too large' }
    expect(balanceErrorMessage(serverError, true)).toBe('history too large')
  })
})
