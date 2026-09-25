import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import { z } from 'zod'
import type { LedgerHidApi } from '../../../../desktop/src/ledger-hid-api'

export function getDesktopLedger(): LedgerHidApi | undefined {
  return (window as Window & { desktop?: { ledger?: LedgerHidApi } }).desktop?.ledger
}

type ConnectionMessage = { title: string; detail: string }

const ledgerErrorDetails = z.object({
  name: z.string().optional().catch(undefined),
  statusText: z.string().optional().catch(undefined),
  statusCode: z.number().optional().catch(undefined),
})

export function ledgerConnectionMessage(error: unknown): ConnectionMessage {
  const details = parseUnknown(ledgerErrorDetails, error).unwrapOr(null)
  const name = details?.name
  const statusText = details?.statusText
  const statusCode = details?.statusCode
  if (name === 'LedgerConnectionTimeout') {
    return {
      title: 'Your Ledger didn’t respond',
      detail: 'Reconnect and unlock your Ledger, open the Bitcoin app, then try again.',
    }
  }
  if (name === 'LockedDeviceError' || statusText === 'LOCKED_DEVICE' || statusCode === 21781) {
    return {
      title: 'Unlock your Ledger',
      detail: 'Enter your PIN on the device, open the Bitcoin app, then try again.',
    }
  }
  if (name === 'BitcoinAppNotOpen' || statusText === 'INS_NOT_SUPPORTED' || statusCode === 27913) {
    return { title: 'Open the Bitcoin app', detail: 'Open the Bitcoin app on your Ledger, then try again.' }
  }
  if (name?.includes('Disconnected') === true) {
    return {
      title: 'Your Ledger was disconnected',
      detail: 'Reconnect and unlock your Ledger, then open the Bitcoin app to continue.',
    }
  }
  return {
    title: 'Couldn’t connect to your Ledger',
    detail:
      'Check the USB connection and unlock your device. Another wallet app may be using it, or device access may be blocked.',
  }
}
