import { getAppAndVersion } from '@ledgerhq/hw-app-btc/lib/getAppAndVersion'
import type Transport from '@ledgerhq/hw-transport'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'

export async function closeDesktopLedger(transport: Transport): Promise<void> {
  if (transport instanceof TransportWebHID) {
    // The SDK's close waits for an APDU that may never finish after unplugging.
    // Detach the reader and release the underlying HID handle before retrying.
    transport.device.removeEventListener('inputreport', transport.onInputReport)
    await transport.device.close().catch(() => undefined)
  } else {
    await transport.close()
  }
}

export async function openDesktopLedger(signal: AbortSignal): Promise<TransportWebHID> {
  // Request the intended device even if another Ledger was previously authorized.
  const transport = await TransportWebHID.request()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort = (): void => {}
  let onDisconnect = (): void => {}
  try {
    const app = await new Promise<{ name: string }>((resolve, reject) => {
      onAbort = () => reject(new DOMException('Connection cancelled', 'AbortError'))
      onDisconnect = () => {
        const error = new Error('Ledger disconnected')
        error.name = 'DisconnectedDevice'
        reject(error)
      }
      if (signal.aborted) {
        return onAbort()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      transport.on('disconnect', onDisconnect)
      timer = setTimeout(() => {
        const error = new Error('Ledger did not respond')
        error.name = 'LedgerConnectionTimeout'
        reject(error)
      }, 10_000)
      void getAppAndVersion(transport).then(resolve, reject)
    })
    if (signal.aborted) {
      throw new DOMException('Connection cancelled', 'AbortError')
    }
    if (app.name !== 'Bitcoin' && app.name !== 'Bitcoin Legacy') {
      const error = new Error('Open the Bitcoin app')
      error.name = 'BitcoinAppNotOpen'
      throw error
    }
    return transport
  } catch (error) {
    await closeDesktopLedger(transport)
    throw error
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
    transport.off('disconnect', onDisconnect)
  }
}
