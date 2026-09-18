import { type AsyncResult, Err, Ok, Result, asyncFn } from '@patina/core'
import TrezorConnectModule, {
  type AccountInfo,
  type Features,
  type Response,
  type Unsuccessful,
} from '@trezor/connect-web'
import type { Logger } from 'pino'
import { cjsInterop } from '../../../lib'
import { HardwareDeviceError } from '../../../wallet'

const TrezorConnect = cjsInterop(TrezorConnectModule)

// Docs: https://connect.trezor.io/9/methods/bitcoin/getPublicKey/#example
export class TrezorService {
  private readonly logger: Logger

  public constructor(logger: Logger) {
    this.logger = logger

    TrezorConnect.init({
      lazyLoad: true,
      debug: false,
      coreMode: 'popup',
      manifest: {
        email: 'support@hoseki.app',
        appName: 'Bitcoin Control Center',
        appUrl: 'https://www.hoseki.app',
      },
    })
  }

  public getAccountInfo(): AsyncResult<AccountInfo, HardwareDeviceError> {
    return this.handleTrezorSdkCall(TrezorConnect.getAccountInfo({ coin: 'btc' }))
  }

  public getFeatures(): AsyncResult<Features, HardwareDeviceError> {
    // This is a huge object, with these relevant fields: { label: "Alex's Trezor", model: "1" }
    return this.handleTrezorSdkCall(TrezorConnect.getFeatures())
  }

  public signCustomMessage(
    path: string,
    message: string,
  ): AsyncResult<{ address: string; signature: string }, HardwareDeviceError> {
    return this.handleTrezorSdkCall(TrezorConnect.signMessage({ path, message }))
  }

  public getPublicKey(path: string): AsyncResult<
    {
      path: number[]
      serializedPath: string
      xpub: string
      xpubSegwit?: string
      chainCode: string
      childNum: number
      publicKey: string
      fingerprint: number
      depth: number
    },
    HardwareDeviceError
  > {
    return this.handleTrezorSdkCall(TrezorConnect.getPublicKey({ path, coin: 'btc' }))
  }

  private unexpectedTrezorError(error: Error): HardwareDeviceError {
    this.logger.error(error, `Unexpected Trezor error: ${error.message}`)
    return new HardwareDeviceError(error.message, 'trezor', 'An unknown error occurred from the Trezor SDK.')
  }

  private expectedTrezorError(unsuccessful: Unsuccessful): HardwareDeviceError {
    this.logger.error(unsuccessful.payload, 'Trezor error')

    const friendlyMessage = getFriendlyErrorMessage(unsuccessful)
    return new HardwareDeviceError(unsuccessful.payload.error, 'trezor', friendlyMessage, unsuccessful.payload)
  }

  private payloadContainsError(payload: { error: string }): HardwareDeviceError {
    this.logger.error(payload, 'Trezor payload contains error despite success: true')
    return new HardwareDeviceError(payload.error, 'trezor', `Trezor error: ${payload.error}`, payload)
  }

  private handleTrezorSdkCall = asyncFn(async <T>(sdkCall: Response<T>): Promise<Result<T, HardwareDeviceError>> => {
    const sdkResult = await Result.fromPromise(sdkCall)

    // An unexpected error was thrown by the Trezor SDK.
    if (sdkResult.isErr()) {
      return Err(this.unexpectedTrezorError(sdkResult.unwrapErr()))
    }

    const sdkResponse = sdkResult.unwrap()

    // Trezor SDK failed gracefully with an error message
    if (!sdkResponse.success) {
      return Err(this.expectedTrezorError(sdkResponse))
    }

    // Despite Trezor's types disallowing it, a success response can contain an error in the payload
    if (isPayloadWithError(sdkResponse.payload)) {
      return Err(this.payloadContainsError(sdkResponse.payload))
    }

    return Ok(sdkResponse.payload)
  })
}

// Trezor error example: { error: 'Action cancelled by user', code: 'Failure_ActionCancelled' }

function getFriendlyErrorMessage(unsuccessful: Unsuccessful): string {
  switch (unsuccessful.payload.code) {
    // This seems to happen when the user cancels via Trezor Suite / WebUI
    case 'Method_Cancel':
      return 'The user cancelled the action.'
    // This seems to happen when the user cancels via their hardware wallet
    case 'Failure_ActionCancelled':
      return 'The user cancelled the action on the device.'
    default:
      return `Trezor error: ${unsuccessful.payload.error}`
  }
}

function isPayloadWithError(payload: unknown): payload is { error: string } {
  return typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string'
}
