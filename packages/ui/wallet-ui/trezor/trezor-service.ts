import { AsyncErr, type AsyncResult, Err, Ok, Result } from '@hoseki/packages/result'
import { parseUnknown } from '@hoseki/packages/result/lib/parse'
import TrezorConnectModule, { type Features, type Response } from '@trezor/connect-web'
import type { Logger } from 'pino'
import { z } from 'zod'
import { cjsInterop } from '../../../lib'
import { HardwareDeviceError } from '../../../wallet'

const TrezorConnect = cjsInterop(TrezorConnectModule)

export interface TrezorError {
  message: string
  code: string | undefined
}

// Connect 10 fails with { error: { message, code } }; some Suite hosts still send Connect 9's { payload: { error, code } }
const trezorFailureSchema = z.union([
  z
    .object({ error: z.object({ message: z.string(), code: z.string().optional() }) })
    .transform(({ error }): TrezorError => ({ message: error.message, code: error.code })),
  z
    .object({ payload: z.object({ error: z.string(), code: z.string().optional() }) })
    .transform(({ payload }): TrezorError => ({ message: payload.error, code: payload.code })),
])
const unknownTrezorError: TrezorError = { message: 'Unknown Trezor error', code: undefined }

export type TrezorSelectedAccount = Extract<
  Awaited<ReturnType<typeof TrezorConnect.selectAccount>>,
  { success: true }
>['payload'][number]

type TrezorPublicKeyParams = { path: string; coin: 'btc' }

// Docs: https://connect.trezor.io/10/methods/bitcoin/getPublicKey/#example
// Suite Web opens a new popup for every call, and browsers only allow one popup per click.
// Each user action should therefore make exactly one Trezor call.
export class TrezorService {
  private readonly logger: Logger
  private initialization: AsyncResult<void, TrezorError> | undefined

  public constructor(logger: Logger) {
    this.logger = logger
  }

  /** Lets the user pick a Bitcoin account in Trezor Suite. Taproot is excluded because Trezor can't sign messages for it. */
  public selectBitcoinAccount(): AsyncResult<TrezorSelectedAccount, HardwareDeviceError> {
    return this.call(async () =>
      TrezorConnect.selectAccount({
        coin: 'btc',
        selectionType: 'single',
        addressSelection: 'fullAccount',
        accountType: ['normal', 'segwit', 'legacy'],
      }),
    ).andThen(firstSelectedAccount)
  }

  public getFeatures(): AsyncResult<Features, HardwareDeviceError> {
    // This is a huge object, with these relevant fields: { label: "Alex's Trezor", model: "1" }
    return this.call(async () => TrezorConnect.getFeatures())
  }

  public signCustomMessage(
    path: string,
    message: string,
  ): AsyncResult<{ address: string; signature: string }, HardwareDeviceError> {
    return this.call(async () => TrezorConnect.signMessage({ path, message }))
  }

  /** Reads the public keys for all paths in one request, so the user approves once. */
  public getPublicKeys(paths: string[]): AsyncResult<{ serializedPath: string; xpub: string }[], HardwareDeviceError> {
    const bundle = paths.map((path): TrezorPublicKeyParams => ({ path, coin: 'btc' }))
    return this.call(async () => TrezorConnect.getPublicKey({ bundle }))
  }

  // Initializing connects to Trezor Suite desktop, which makes the browser ask for local network access,
  // so it waits for the first Trezor action instead of running on page load.
  private initialize(): AsyncResult<void, TrezorError> {
    this.initialization ??= this.initializeConnect('auto')
      .orElseAsync(async (error) =>
        // "auto" only falls back to Suite Web when Suite desktop isn't running, not when local network access is denied
        error.code === 'Browser_LocalNetworkPermissionMissing' ? this.initializeConnect('suite-web') : AsyncErr(error),
      )
      .inspectErr(() => {
        // Let the next click retry
        this.initialization = undefined
      })

    return this.initialization
  }

  private initializeConnect(coreMode: 'auto' | 'suite-web'): AsyncResult<void, TrezorError> {
    return Result.fromPromise(
      TrezorConnect.init({
        coreMode,
        // The desktop app's window is a sandboxed web page, but Connect sees Electron in its user agent
        // and won't open Suite Web unless told it runs on the web.
        env: 'web',
        manifest: {
          email: 'support@bitcoincontrolcenter.com',
          appName: 'Bitcoin Control Center',
          appUrl: 'https://www.bitcoincontrolcenter.com',
          appIcon: `${window.location.origin}/hoseki-logo-box.svg`,
        },
      }),
    ).mapErr((error) => parseUnknown(trezorFailureSchema, { error: error.cause ?? error }).unwrapOr(unknownTrezorError))
  }

  private unexpectedTrezorError(error: Error): HardwareDeviceError {
    this.logger.error(error, `Unexpected Trezor error: ${error.message}`)
    return new HardwareDeviceError(error.message, 'trezor', 'An unknown error occurred from the Trezor SDK.')
  }

  private expectedTrezorError(error: TrezorError): HardwareDeviceError {
    this.logger.error(error, 'Trezor error')
    return new HardwareDeviceError(error.message, 'trezor', getFriendlyErrorMessage(error), error)
  }

  private payloadContainsError(payload: { error: string }): HardwareDeviceError {
    this.logger.error(payload, 'Trezor payload contains error despite success: true')
    return new HardwareDeviceError(payload.error, 'trezor', `Trezor error: ${payload.error}`, payload)
  }

  private readonly call = <T>(sdkCall: () => Response<T>): AsyncResult<T, HardwareDeviceError> => {
    return this.initialize()
      .mapErr((error) => this.expectedTrezorError(error))
      .andThenAsync(async (): Promise<Result<T, HardwareDeviceError>> => {
        const sdkResult = await Result.fromPromise(sdkCall())

        // An unexpected error was thrown by the Trezor SDK.
        if (sdkResult.isErr()) {
          return Err(this.unexpectedTrezorError(sdkResult.unwrapErr()))
        }

        const sdkResponse = sdkResult.unwrap()

        // Trezor SDK failed gracefully with an error message
        if (!sdkResponse.success) {
          const error = parseUnknown(trezorFailureSchema, sdkResponse).unwrapOr(unknownTrezorError)
          return Err(this.expectedTrezorError(error))
        }

        // Despite Trezor's types disallowing it, a success response can contain an error in the payload
        if (isPayloadWithError(sdkResponse.payload)) {
          return Err(this.payloadContainsError(sdkResponse.payload))
        }

        return Ok(sdkResponse.payload)
      })
  }
}

function firstSelectedAccount(accounts: TrezorSelectedAccount[]): Result<TrezorSelectedAccount, HardwareDeviceError> {
  const account = accounts[0]
  if (account === undefined) {
    return Err(new HardwareDeviceError('No account selected', 'trezor', 'No account was selected.'))
  }
  return Ok(account)
}

// Trezor error example: { message: 'Action cancelled by user', code: 'Failure_ActionCancelled' }

function getFriendlyErrorMessage(error: TrezorError): string {
  switch (error.code) {
    // This seems to happen when the user cancels via Trezor Suite / WebUI
    case 'Method_Cancel':
      return 'The user cancelled the action.'
    // This seems to happen when the user cancels via their hardware wallet
    case 'Failure_ActionCancelled':
      return 'The user cancelled the action on the device.'
    // The Trezor Suite Web window was closed before the action finished
    case 'Method_Interrupted':
      return 'The Trezor Suite window was closed.'
    case 'Method_PermissionsNotGranted':
      return 'The request was declined in Trezor Suite.'
    case 'Handshake_Error':
      return error.message === 'popup-blocked'
        ? 'Allow pop-ups for this site to open Trezor Suite.'
        : 'Could not connect to Trezor Suite.'
    case 'Desktop_ConnectionMissing':
    case 'Popup_ConnectionMissing':
      return 'Could not connect to Trezor Suite.'
    case 'Browser_LocalNetworkPermissionMissing':
      return 'Allow local network access for this site to connect to Trezor Suite.'
    case undefined:
    default:
      return `Trezor error: ${error.message}`
  }
}

function isPayloadWithError(payload: unknown): payload is { error: string } {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
}
