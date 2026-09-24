import { type AsyncResult, Err, Ok, Result, parseUnknown, tryBlock, tryBlockAsync } from '@hoseki/packages/result'
import { SafeHttpErrorKind, type SafeResponse, safeHttp } from '@hoseki/packages/safe-http'
import { createHash, createHmac } from 'crypto'
import { ApiError, ApiErrorKind } from './errors'
import {
  type BalanceResponse,
  BalanceResponseSchema,
  type BalanceResult,
  type ErrorResponse,
  ErrorResponseSchema,
  type KrakenCredentials,
  type LedgersPayload,
  LedgersPayloadSchema,
  type LedgersResponse,
  LedgersResponseSchema,
  type LedgersResult,
} from './types'

const KRAKEN_API_BASE_URL = 'https://api.kraken.com'

interface KrakenApiHeaders {
  'API-Key': string
  'API-Sign': string
}

interface ParsedData<T> {
  data: T
  response: SafeResponse
}

function serializeKrakenLedgersPayload(payload: LedgersPayload): string {
  const params = new URLSearchParams()
  if (payload.start !== undefined) {
    params.append('start', payload.start.toString())
  }
  if (payload.end !== undefined) {
    params.append('end', payload.end.toString())
  }
  if (payload.ofs !== undefined) {
    params.append('ofs', payload.ofs.toString())
  }
  if (payload.type !== undefined) {
    params.append('type', payload.type)
  }
  if (payload.asset !== undefined) {
    params.append('asset', payload.asset)
  }
  if (payload.aclass !== undefined) {
    params.append('aclass', payload.aclass)
  }
  return params.toString()
}

/**
 * Generate Kraken API authentication headers
 * Kraken uses HMAC-SHA512 with format: API-Sign = HMAC-SHA512(API-Secret, URI path + SHA256(nonce + POST data))
 */
function getKrakenHeaders(
  requestPath: string,
  nonce: string,
  postData: string,
  credentials: KrakenCredentials,
): Result<KrakenApiHeaders, Error> {
  return tryBlock(function* () {
    // Step 1: SHA256(nonce + POST data)
    const sha256Input = nonce + postData
    const sha256Hash = createHash('sha256').update(sha256Input).digest()

    // Step 2: HMAC-SHA512(API-Secret, URI path + SHA256(nonce + POST data))
    const decodedSecretBuffer = yield* Result.fromThrowable(() => Buffer.from(credentials.secretKey, 'base64')).try()
    const decodedSecret = new Uint8Array(decodedSecretBuffer)

    const apiPathUint8 = new Uint8Array(Buffer.from(requestPath))
    const sha256HashUint8 = new Uint8Array(sha256Hash)
    const hmacMessageUint8 = new Uint8Array(apiPathUint8.length + sha256HashUint8.length)
    hmacMessageUint8.set(apiPathUint8, 0)
    hmacMessageUint8.set(sha256HashUint8, apiPathUint8.length)
    const hmacMessage = hmacMessageUint8
    const hmac = createHmac('sha512', decodedSecret)
    hmac.update(hmacMessage)
    const signature = hmac.digest('base64')

    return Ok({
      'API-Key': credentials.apiKey,
      'API-Sign': signature,
    })
  })
}

function parseBalanceResponse(response: SafeResponse): AsyncResult<ParsedData<BalanceResponse>, ApiError> {
  const clone = response.clone()
  return clone
    .json((json) => parseUnknown(BalanceResponseSchema, json))
    .map((data) => ({
      data,
      response,
    }))
    .mapErrAsync(async (error) => {
      return new ApiError(ApiErrorKind.ResponseNotAcceptable(error, response), `Received unexpected response`)
    })
}

function parseLedgersResponse(response: SafeResponse): AsyncResult<ParsedData<LedgersResponse>, ApiError> {
  const clone = response.clone()
  return clone
    .json((json) => parseUnknown(LedgersResponseSchema, json))
    .map((data) => ({
      data,
      response,
    }))
    .mapErrAsync(async (error) => {
      return new ApiError(ApiErrorKind.ResponseNotAcceptable(error, response), `Received unexpected response`)
    })
}

function parseErrorData(response: SafeResponse): AsyncResult<ParsedData<ErrorResponse>, ApiError> {
  const clone = response.clone()
  return clone
    .json((json) => parseUnknown(ErrorResponseSchema, json))
    .map((data) => ({
      data,
      response,
    }))
    .mapErrAsync(async (error) => {
      return new ApiError(ApiErrorKind.ResponseNotAcceptable(error, response), `Received unexpected response`)
    })
}

export class Client {
  private readonly credentials: KrakenCredentials

  public constructor(credentials: KrakenCredentials) {
    this.credentials = credentials
  }

  private makeRequest(path: string, postData: string): AsyncResult<SafeResponse, ApiError> {
    return tryBlockAsync(
      async function* (this: Client) {
        // Generate authentication headers
        const authHeaders = yield* getKrakenHeaders(path, Date.now().toString(), postData, this.credentials)
          .mapErr((err) => {
            return new ApiError(
              ApiErrorKind.InvalidCredentials(err.message),
              'Failed to generate authentication headers',
            )
          })
          .try()

        const headers = {
          ...authHeaders,
          'Content-Type': 'application/x-www-form-urlencoded',
        } satisfies Record<string, string>

        const url = `${KRAKEN_API_BASE_URL}${path}`

        return safeHttp
          .request(url, {
            method: 'POST',
            headers,
            body: postData,
          })
          .mapErrAsync(async (error) => {
            if (error.kind.value === SafeHttpErrorKind.NetworkUnreachable) {
              return new ApiError(ApiErrorKind.NetworkUnreachable(error.kind.cause), 'Network unreachable')
            }

            if (
              error.kind.value === SafeHttpErrorKind.ErrorResponse &&
              (error.kind.cause.status === 401 || error.kind.cause.status === 403)
            ) {
              return new ApiError(ApiErrorKind.Unauthorized(error.kind.cause), 'Unauthorized')
            }

            // Try to parse error response
            const errorParseResult = await parseErrorData(error.kind.cause)
            if (errorParseResult.isOk()) {
              const errorData = errorParseResult.unwrap()
              return new ApiError(
                ApiErrorKind.ErrorResponse(errorData.data.error, errorData.response),
                errorData.data.error.join(', '),
              )
            }

            return new ApiError(ApiErrorKind.UnexpectedFailure({ response: error.kind.cause }), 'Request failed')
          })
      }.bind(this),
    )
  }

  /**
   * Get account balance.
   *
   * Retrieves the current balance, asset-by-asset, for the account associated with your API key.
   *
   * This endpoint requires the "Query Funds" API key permission.
   *
   * @see https://docs.kraken.com/api/docs/rest-api/get-account-balance
   */
  public getBalance(): AsyncResult<ParsedData<BalanceResult>, ApiError> {
    return tryBlockAsync(
      async function* (this: Client) {
        // Generate nonce
        const nonce = Date.now().toString()
        const postData = `nonce=${nonce}`

        const response = yield* this.makeRequest('/0/private/Balance', postData).try()

        const { data, response: originalResponse } = yield* parseBalanceResponse(response).try()

        // Check for Kraken API errors in the response
        if (data.error.length > 0) {
          return Err(new ApiError(ApiErrorKind.ErrorResponse(data.error, originalResponse), data.error.join(', ')))
        }

        return Ok({
          data: data.result,
          response: originalResponse,
        })
      }.bind(this),
    )
  }

  /**
   * Get account ledgers info
   *
   * Returns an array of ledger entries, which record movements of funds into, out of, or between a user's accounts.
   *
   * This endpoint requires "Query Ledgers" permission on the API key.
   *
   * @see https://docs.kraken.com/api/docs/rest-api/get-ledgers-info
   */
  public getLedgers(payload: LedgersPayload = {}): AsyncResult<ParsedData<LedgersResult>, ApiError> {
    return tryBlockAsync(
      async function* (this: Client) {
        // Validate payload
        const ledgersPayload = yield* parseUnknown(LedgersPayloadSchema, payload)
          .mapErr((err) => {
            return new ApiError(ApiErrorKind.ValidationError(err), `Invalid payload: ${err.message}`)
          })
          .try()

        // Generate nonce and serialize payload
        const nonce = Date.now().toString()
        const payloadString = serializeKrakenLedgersPayload(ledgersPayload)

        let postData: string
        if (payloadString) {
          const postDataParams = new URLSearchParams()
          postDataParams.append('nonce', nonce)
          const payloadParams = new URLSearchParams(payloadString)
          for (const [key, value] of payloadParams.entries()) {
            postDataParams.append(key, value)
          }
          postData = postDataParams.toString()
        } else {
          postData = `nonce=${nonce}`
        }

        const response = yield* this.makeRequest('/0/private/Ledgers', postData).try()
        const { data, response: originalResponse } = yield* parseLedgersResponse(response).try()

        // Check for Kraken API errors in the response
        if (data.error.length > 0) {
          return Err(new ApiError(ApiErrorKind.ErrorResponse(data.error, originalResponse), data.error.join(', ')))
        }

        return Ok({
          data: data.result,
          response: originalResponse,
        })
      }.bind(this),
    )
  }
}
