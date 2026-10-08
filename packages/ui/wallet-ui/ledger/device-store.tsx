import { DerivationPath, Network, type SingleSigAccountScriptType } from '@hoseki/packages/bitcoin'
import type { AsyncResult } from '@hoseki/packages/result'
import { Err, Result, tryBlock } from '@hoseki/packages/result'
import { HardwareDeviceError } from '@hoseki/packages/wallet'
import { SCRIPT_TYPE_TO_DERIVATION_PATH } from '@hoseki/packages/wallet/script-type-utils'
import LedgerBtcApp from '@ledgerhq/hw-app-btc'
import { pathStringToArray } from '@ledgerhq/hw-app-btc/lib/bip32'
import { AppClient } from '@ledgerhq/hw-app-btc/lib/newops/appClient'
import type Transport from '@ledgerhq/hw-transport'
import type { StatusCodes } from '@ledgerhq/hw-transport'
import TransportWebHID from '@ledgerhq/hw-transport-webhid'
import type { Logger } from 'pino'
import { type StoreApi, type UseBoundStore, create } from 'zustand'

export type LedgerDeviceModel = {
  productName: string
  id: string
}

export type LedgerBitcoinApp = Pick<LedgerBtcApp, 'getWalletXpub' | 'signMessage'>

type InitializedState = {
  connectionId: number
  isInitialized: true
  isConnected: boolean // Should be true, but if the device is disconnected, it will be false.
  transport: Transport
  btc: LedgerBitcoinApp
  deviceModel: LedgerDeviceModel
}
type UninitializedState = {
  connectionId: number
  isInitialized: false
  isConnected: false
  transport: null
  btc: null
  deviceModel: null
}
type LedgerStoreState = InitializedState | UninitializedState

type LedgerStoreActions = {
  init: (openTransport?: () => Promise<Transport>, signal?: AbortSignal) => Promise<void>
  reset: (closeTransport?: (transport: Transport) => Promise<void>) => Promise<void>
  getBitcoinXpub: (
    scriptType: 'p2pkh' | 'p2sh-p2wpkh' | 'p2wpkh' | 'p2tr',
    account: number,
  ) => AsyncResult<XpubWithPath, HardwareDeviceError>
  getBitcoinXpubFromPath: (path: string) => AsyncResult<XpubWithPath, HardwareDeviceError>
  signMessage: (path: string, message: string) => AsyncResult<{ v: number; r: string; s: string }, HardwareDeviceError>
}

type XpubWithPath = { xpub: string; path: string }

export function createLedgerStore(
  browserLogger: Logger,
  createBitcoinApp: (transport: Transport) => LedgerBitcoinApp = (transport) => new LedgerBtcApp({ transport }),
): UseBoundStore<StoreApi<LedgerStoreState & LedgerStoreActions>> {
  return create<LedgerStoreState & LedgerStoreActions>((set, get, store) => {
    let connectionId = 0
    function notInitializedError() {
      browserLogger.error('Ledger not initialized')
      return Err(new HardwareDeviceError('Ledger not initialized', 'ledger', 'The Ledger device was not initialized.'))
    }

    function onDisconnect() {
      browserLogger.debug('Ledger disconnected')
      set({ isConnected: false })
    }

    function getBitcoinXpubFromPath_INTERNAL(path: string): AsyncResult<XpubWithPath, HardwareDeviceError> {
      return tryBlock(async function* () {
        const { isInitialized, btc, transport } = get()
        if (!isInitialized) {
          return notInitializedError()
        }

        // Start the SDK call in the same turn as reading the connection state.
        // Async yield* here would let reset() close the captured transport first.
        return DerivationPath.fromString(path)
          .mapErr(
            (error) =>
              new HardwareDeviceError(error.message, 'ledger', `The derivation path ${path} is invalid.`, { path }),
          )
          .andThenAsync(async (derivationPath) => {
            let xpubRes: Result<string, HardwareDeviceError>
            if (!derivationPath.isStandardAccount()) {
              const appClient = new AppClient(transport)
              xpubRes = await handleLedgerSdkCall(appClient.getExtendedPubkey(true, pathStringToArray(path)))
              browserLogger.debug('Non-standard path - using legacy appClient.getExtendedPubkey', { path })
            } else {
              xpubRes = await handleLedgerSdkCall(
                btc.getWalletXpub({ path, xpubVersion: Network.Mainnet.bip32.public }),
                {
                  path,
                },
              )
            }

            return xpubRes.map((xpub) => ({ xpub, path }))
          })
      })
    }

    type LedgerCallContext = { path?: string }

    function handleLedgerSdkCall<T>(
      sdkCall: Promise<T>,
      extraContext: LedgerCallContext = {},
    ): AsyncResult<T, HardwareDeviceError> {
      return Result.fromPromise(sdkCall).mapErr((error) => {
        // SAFETY: fromPromise normalizes rejections to Error; Ledger status fields are optional metadata handled below.
        const err = error as LedgerError
        browserLogger.error(err, `Ledger error: ${err.message}`)
        return new HardwareDeviceError(err.message, 'ledger', LedgerErrors.getErrorMessage(err), {
          statusText: err.statusText,
          statusCode: err.statusCode,
          name: err.name,
          message: err.message,
          ...extraContext,
        })
      })
    }

    return {
      connectionId: 0,
      isInitialized: false,
      isConnected: false,
      transport: null,
      btc: null,
      deviceModel: null,

      init: async (openTransport = async () => TransportWebHID.create(), signal) => {
        const { isInitialized } = get()
        browserLogger.debug('Initializing ledger')
        if (isInitialized) {
          browserLogger.debug('Skipping initialization: Transport and ledger.btc already set')
          return
        }
        const newTransport = await openTransport()
        if (signal?.aborted === true) {
          await newTransport.close()
          throw new DOMException('Connection cancelled', 'AbortError')
        }
        const newBtc = createBitcoinApp(newTransport)

        newTransport.on('disconnect', onDisconnect)

        const newState: InitializedState = {
          connectionId: ++connectionId,
          isInitialized: true,
          isConnected: true,
          transport: newTransport,
          btc: newBtc,
          deviceModel: {
            productName: newTransport.deviceModel?.productName ?? 'Unknown',
            id: newTransport.deviceModel?.id ?? 'unknown',
          },
        }
        set(newState)

        browserLogger.debug({ newState }, 'Ledger initialized')
      },

      reset: async (closeTransport) => {
        browserLogger.debug('Resetting ledger')
        const { transport } = get()
        if (transport) {
          transport.off('disconnect', onDisconnect)
        } else {
          browserLogger.debug('Transport not initialized, skipping close')
        }
        set(store.getInitialState())
        if (transport) {
          if (closeTransport) {
            await closeTransport(transport)
          } else {
            void transport.close()
          }
        }
        browserLogger.debug({ newState: store.getInitialState() }, 'Ledger was reset')
      },

      getBitcoinXpub: (scriptType: SingleSigAccountScriptType, account: number) =>
        getBitcoinXpubFromPath_INTERNAL(`${SCRIPT_TYPE_TO_DERIVATION_PATH[scriptType]}/0'/${account}'`),

      getBitcoinXpubFromPath: getBitcoinXpubFromPath_INTERNAL,

      signMessage: (path: string, message: string) =>
        tryBlock(async function* () {
          const { isInitialized, btc } = get()
          if (!isInitialized) {
            return notInitializedError()
          }

          return handleLedgerSdkCall(btc.signMessage(path, Buffer.from(message).toString('hex')), { path })
        }),
    }
  })
}

// `UNKNOWN_ERROR` is undocumented in Ledger docs and the SDK, but we did see it during development.
type LedgerErrorStatusText = keyof typeof StatusCodes | 'UNKNOWN_ERROR'

export interface LedgerError<T extends LedgerErrorStatusText = LedgerErrorStatusText> extends Error {
  statusText?: T
  statusCode?: number
}

/*
 Ledger error examples:
 { name: "LockedDeviceError", statusCode: 21781, statusText: "LOCKED_DEVICE" }

 When wrong app is open we try and do something like scan:
 { statusCode: 27904, statusText: "INS_NOT_SUPPORTED",}

 When no app is open:
 { name: "TransportStatusError", statusCode: 27913, statusText: "UNKNOWN_ERROR" }

 When passing in a non-standard derivation path and user rejects:
 { name: 'TransportStatusError', statusCode: 27013, statusText: 'CONDITIONS_OF_USE_NOT_SATISFIED', path: 'm/49/0/1' }

See: https://github.com/LedgerHQ/ledger-live/blob/6fdcb0621d601336ddeeffa4bd2f14077f9cfa4f/libs/ledger-live-common/src/socket/index.ts#L146
*/

namespace LedgerErrors {
  function isLockedLedgerDeviceError(error: LedgerError): boolean {
    return error.statusText === 'LOCKED_DEVICE'
  }

  function isBitcoinAppNotOpenError(error: LedgerError): boolean {
    return error.name === 'TransportStatusError' && error.statusText === 'UNKNOWN_ERROR' && error.statusCode === 27913
  }

  function isWrongAppOpenError(error: LedgerError): boolean {
    return error.name === 'TransportStatusError' && error.statusText === 'INS_NOT_SUPPORTED'
  }

  function isUserRejectedError(error: LedgerError): boolean {
    return ['USER_REFUSED_ON_DEVICE', 'CONDITIONS_OF_USE_NOT_SATISFIED'].includes(error.statusText ?? '')
  }

  export function getErrorMessage(error: LedgerError): string {
    if (error.name === 'TransportOpenUserCancelled') {
      return 'The user cancelled the connection.'
    }

    if (isLockedLedgerDeviceError(error)) {
      return 'Locked device. Unlock the device and click retry.'
    }

    if (isUserRejectedError(error)) {
      return 'The user rejected the the action on the device.'
    }

    if (isWrongAppOpenError(error)) {
      return 'Wrong app open. Please open the Bitcoin app on your device and click retry.'
    }

    if (isBitcoinAppNotOpenError(error)) {
      return 'Bitcoin app not open. Please open the Bitcoin app on your device and click retry.'
    }

    if (['InvalidStateError', 'NotAllowedError'].includes(error.name)) {
      return 'Device is not ready. Please open the Bitcoin app on your device and click retry.'
    }

    return 'An unknown error occurred when connecting to your Ledger. Please try again.'
  }
}
