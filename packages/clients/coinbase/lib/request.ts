import * as crypto from 'node:crypto'
import type { AsyncResult } from '@hoseki/packages/result'
import { Err, Ok, Result, parseUnknown, tryBlock } from '@hoseki/packages/result'
import { SafeHttpErrorKind, type SafeResponse, safeHttp } from '@hoseki/packages/safe-http'
import type { z } from 'zod'
import type { Credentials } from './credentials'
import { ApiError, ErrorKind } from './errors'
import { type JsonRecord, recordToHeaders, recordToSearchParams } from './util'

type CoinbaseRequestHeaders = {
  'CB-VERSION': string | undefined
  Accept: string
  'Content-Type': string
  Authorization?: string
  'CB-ACCESS-SIGN'?: string
  'CB-ACCESS-TIMESTAMP'?: string
  'CB-ACCESS-KEY'?: string
}

/** https://docs.cdp.coinbase.com/sign-in-with-coinbase/docs/api-key-auth-legacy */
function sign(args: { timestamp: string; secret: string; method: 'GET' | 'POST'; path: string; body?: string }) {
  const message = args.timestamp + args.method + args.path + (args.body ?? '')
  const signature = crypto.createHmac('sha256', args.secret).update(message).digest('hex')
  return signature
}

const PEM_HEADER = '-----BEGIN EC PRIVATE KEY-----'
const PEM_FOOTER = '-----END EC PRIVATE KEY-----'

/**
 * Extracts and normalizes the PEM key from the given private key string.
 * Handles escaped newlines and normalizes whitespace.
 */
function extractPemKey(string: string): Result<string, Error> {
  // Replace escaped newlines with actual newlines (handles environment variables)
  const normalized = string.replace(/\\n/g, '\n').trim()

  // Validate PEM format
  if (!normalized.startsWith(PEM_HEADER) || !normalized.includes(PEM_FOOTER)) {
    return Err(
      new Error(
        'Invalid private key format: must start with -----BEGIN EC PRIVATE KEY----- and contain -----END EC PRIVATE KEY-----',
      ),
    )
  }

  // Return normalized PEM (libraries handle formatting flexibly)
  return Ok(normalized)
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

/**
 * TODO: This is not working as expected, it's returning a 401.
 *
 * But I tried the official authenticator, and that does not work either: https://github.com/coinbase/coinbase-sdk-nodejs/blob/master/src/coinbase/authenticator.ts
 */
const signCdp = (args: {
  name: string
  secret: string
  method: 'GET' | 'POST'
  url: string
  path: string
}): AsyncResult<string, Error> =>
  tryBlock(async function* () {
    const pemKey = yield* extractPemKey(args.secret)

    // Parse as PEM format (the normalization handles escaped newlines and whitespace)
    const privateKey = yield* Result.fromThrowable(() => crypto.createPrivateKey(pemKey)).andThen((key) =>
      key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
        ? Ok(key)
        : Err(new Error('Invalid key: expected a P-256 EC private key')),
    )

    const nonce = generateNonce()

    const fields = {
      alg: 'ES256',
      kid: args.name, // API key name/ID used as key identifier in JWT header
      typ: 'JWT',
      nonce,
    }

    const url = new URL(args.url + args.path)
    const uri = `${args.method} ${url.host}${url.pathname}`

    const now = Math.floor(Date.now() / 1000)

    const claims = {
      sub: args.name,
      iss: 'cdp',
      aud: ['cdp_service'],
      nbf: now,
      exp: now + 60, // +1 minute
      uris: [uri],
    }

    return Result.fromThrowable(() => {
      const header = Buffer.from(JSON.stringify(fields)).toString('base64url')
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const signingInput = `${header}.${payload}`
      // ES256 JWTs encode the 32-byte r and s values directly, rather than using DER.
      const signature = crypto.sign('sha256', Buffer.from(signingInput), {
        key: privateKey,
        dsaEncoding: 'ieee-p1363',
      })
      return `${signingInput}.${signature.toString('base64url')}`
    })
  })

function parseData<S extends z.ZodTypeAny>(response: SafeResponse, schema: S) {
  const clone = response.clone()
  return clone
    .json((json) => parseUnknown(schema, json))
    .map((data) => ({
      data,
      response,
    }))
    .mapErrAsync(async (error) => {
      return new ApiError(ErrorKind.ResponseNotAcceptable(error, response), `Received unexpected response`)
    })
}

async function parseErrorData(response: SafeResponse, schema: z.ZodTypeAny) {
  return (
    parseData(response, schema)
      .andThen((errorData) => {
        return Err(new ApiError(ErrorKind.ErrorResponse(errorData.data, errorData.response), 'Received error response'))
      })
      .err()
      // Following should be unreachable, but let's handle it just in case
      .unwrapOr(new ApiError(ErrorKind.UnexpectedFailure({ response }), 'Failed to unwrap error response'))
  )
}

export interface RequestArgs<T extends z.ZodTypeAny, E extends z.ZodTypeAny> {
  method: 'GET' | 'POST'
  path: string
  schema: T
  errorSchema: E
  url: string
  credentials?: Credentials
  version?: string
  query?: JsonRecord
  params?: JsonRecord
  json?: JsonRecord
}

export const request = <ST extends z.ZodTypeAny, SE extends z.ZodTypeAny>(
  args: RequestArgs<ST, SE>,
): AsyncResult<{ data: z.infer<ST>; response: SafeResponse }, ApiError> =>
  tryBlock(async function* () {
    const headers: CoinbaseRequestHeaders = {
      'CB-VERSION': args.version,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    }

    let body: string | undefined
    if (args.params) {
      // Override the default content type
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
      body = recordToSearchParams(args.params).toString()
    }
    if (args.json) {
      body = JSON.stringify(args.json)
    }

    let path = args.path
    if (args.query) {
      path += '?' + recordToSearchParams(args.query).toString()
    }

    if (args.credentials) {
      if (args.credentials.variant === 'AccessToken') {
        headers.Authorization = `Bearer ${args.credentials.accessToken}`
      } else if (args.credentials.variant === 'ApiKey') {
        const bodyForSign = body ?? ''
        const timestamp = Math.floor(Date.now() / 1000).toString()
        const signature = sign({
          body: bodyForSign,
          path,
          method: args.method,
          secret: args.credentials.secret,
          timestamp,
        })
        headers['CB-ACCESS-SIGN'] = signature
        headers['CB-ACCESS-TIMESTAMP'] = timestamp
        headers['CB-ACCESS-KEY'] = args.credentials.key
      } else {
        const token = await signCdp({
          path,
          url: args.url,
          name: args.credentials.name,
          secret: args.credentials.secret,
          method: args.method,
        })
        if (token.isErr()) {
          return Err(new ApiError(ErrorKind.UnexpectedFailure({ error: token.unwrapErr() }), 'Failed to sign request'))
        }
        headers.Authorization = `Bearer ${token.unwrap()}`
      }
    }

    let input = args.url + path

    return safeHttp
      .request(input, {
        method: args.method,
        headers: recordToHeaders(headers),
        body,
      })
      .mapErrAsync(async (error) => {
        if (error.kind.value === SafeHttpErrorKind.NetworkUnreachable) {
          return new ApiError(ErrorKind.NetworkUnreachable(error.kind.cause), 'Network unreachable')
        }

        // If a request is unauthorized, Coinbase will not return a structured error response,
        // so `parseErrorData` will always fail. We need to handle this case separately.
        if (
          error.kind.value === SafeHttpErrorKind.ErrorResponse &&
          (error.kind.cause.status === 401 || error.kind.cause.status === 403)
        ) {
          return new ApiError(ErrorKind.Unauthorized(error.kind.cause), error.kind.cause.statusText)
        }

        return parseErrorData(error.kind.cause, args.errorSchema)
      })
      .andThenAsync(async (response) => parseData<ST>(response, args.schema))
  })
