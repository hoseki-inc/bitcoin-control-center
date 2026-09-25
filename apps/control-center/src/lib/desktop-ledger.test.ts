import { expect, it } from 'vitest'
import { ledgerConnectionMessage } from './desktop-ledger'

it.each([
  ['timeout', { name: 'LedgerConnectionTimeout' }, 'Your Ledger didn’t respond'],
  ['locked name', { name: 'LockedDeviceError' }, 'Unlock your Ledger'],
  ['locked text', { statusText: 'LOCKED_DEVICE' }, 'Unlock your Ledger'],
  ['locked status', { statusCode: 21781 }, 'Unlock your Ledger'],
  ['app name', { name: 'BitcoinAppNotOpen' }, 'Open the Bitcoin app'],
  ['app text', { statusText: 'INS_NOT_SUPPORTED' }, 'Open the Bitcoin app'],
  ['app status', { statusCode: 27913 }, 'Open the Bitcoin app'],
  ['disconnect', { name: 'DisconnectedDeviceDuringOperation' }, 'Your Ledger was disconnected'],
  ['invalid name with valid status', { name: 123, statusCode: 21781 }, 'Unlock your Ledger'],
  ['invalid status with valid name', { name: 'BitcoinAppNotOpen', statusCode: {} }, 'Open the Bitcoin app'],
  ['timeout priority', { name: 'LedgerConnectionTimeout', statusCode: 21781 }, 'Your Ledger didn’t respond'],
  ['string status', { statusCode: '21781' }, 'Couldn’t connect to your Ledger'],
  ['null', null, 'Couldn’t connect to your Ledger'],
  ['text', 'LOCKED_DEVICE', 'Couldn’t connect to your Ledger'],
  ['missing fields', {}, 'Couldn’t connect to your Ledger'],
] as const)('selects the Ledger connection message for %s', (_label, error, title) => {
  expect(ledgerConnectionMessage(error).title).toBe(title)
})

it('reads non-enumerable fields on Error instances', () => {
  const error = new Error('Device locked')
  Object.defineProperty(error, 'statusCode', { value: 21781 })
  expect(ledgerConnectionMessage(error).title).toBe('Unlock your Ledger')
})

it('reads inherited error names', () => {
  class DisconnectedError extends Error {}
  DisconnectedError.prototype.name = 'DisconnectedDevice'
  expect(ledgerConnectionMessage(new DisconnectedError('Lost device')).title).toBe('Your Ledger was disconnected')
})
