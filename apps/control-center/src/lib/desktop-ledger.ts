import type { LedgerHidApi } from '../../../../desktop/src/ledger-hid-api'

export function getDesktopLedger(): LedgerHidApi | undefined {
  return (window as Window & { desktop?: { ledger?: LedgerHidApi } }).desktop?.ledger
}

type ConnectionMessage = { title: string; detail: string }

export function ledgerConnectionMessage(error: unknown): ConnectionMessage {
  const details = error as { name?: string; statusText?: string; statusCode?: number } | null
  if (details?.name === 'LedgerConnectionTimeout') {
    return {
      title: 'Your Ledger didn’t respond',
      detail: 'Reconnect and unlock your Ledger, open the Bitcoin app, then try again.',
    }
  }
  if (
    details?.name === 'LockedDeviceError' ||
    details?.statusText === 'LOCKED_DEVICE' ||
    details?.statusCode === 21781
  ) {
    return {
      title: 'Unlock your Ledger',
      detail: 'Enter your PIN on the device, open the Bitcoin app, then try again.',
    }
  }
  if (
    details?.name === 'BitcoinAppNotOpen' ||
    details?.statusText === 'INS_NOT_SUPPORTED' ||
    details?.statusCode === 27913
  ) {
    return { title: 'Open the Bitcoin app', detail: 'Open the Bitcoin app on your Ledger, then try again.' }
  }
  if (details?.name?.includes('Disconnected')) {
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
