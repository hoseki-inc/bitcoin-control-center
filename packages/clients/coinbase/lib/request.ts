import { Err, Ok, Result, asyncFn, parseUnknown } from '@hoseki/packages/result'
import { SafeHttpErrorKind, type SafeResponse, safeHttp } from '@hoseki/packages/safe-http'
import * as crypto from 'crypto'
import jose from 'node-jose'
import type { z } from 'zod'
import type { Credentials } from './credentials'
import { ApiError, ErrorKind } from './errors'
import { type JsonRecord, recordToHeaders, recordToSearchParams } from './util'

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

/**
 * Copied from Coinbase SDK, I'm not sure using random numbers is the best way to generate a nonce.
 *
 * See https://github.com/coinbase/coinbase-sdk-nodejs/blob/ffdd6962c4236878d324cd709f22d35faf90f50a/src/coinbase/authenticator.ts#L121-L130
 */
function generateNonce() {
  const range = '0123456789'
  let nonce = ''
  for (let i = 0; i < 16; i++) {
    nonce += range.charAt(Math.floor(Math.random() * range.length))
  }
  return nonce
}

/**
 * TODO: This is not working as expected, it's returning a 401.
 *
 * But I tried the official authenticator, and that does not work either: https://github.com/coinbase/coinbase-sdk-nodejs/blob/master/src/coinbase/authenticator.ts
 */
const signCdp = asyncFn(
  async (args: { name: string; secret: string; method: 'GET' | 'POST'; url: string; path: string }) => {
    const pemPrivateKey = extractPemKey(args.secret)
    if (pemPrivateKey.isErr()) {
      return Err(pemPrivateKey.error())
    }

    const pemKey = pemPrivateKey.value()

    // Parse as PEM format (the normalization handles escaped newlines and whitespace)
    const privateKeyRes = await Result.fromPromise(jose.JWK.asKey(pemKey, 'pem')).andThen((key) =>
      key.kty === 'EC' ? Ok(key) : Err(new Error('Invalid key type: expected EC key')),
    )

    if (privateKeyRes.isErr()) {
      return Err(privateKeyRes.error())
    }

    const privateKey = privateKeyRes.value()
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

    async function createSign() {
      const payload = Buffer.from(JSON.stringify(claims)).toString('utf8')
      return jose.JWS.createSign({ format: 'compact', fields }, privateKey).update(payload).final()
    }

    return Result.fromPromise(createSign()).andThen((signed) => {
      // Need a type guard here because the library exports invalid types 👍
      const unk = signed as unknown
      if (typeof unk === 'string') {
        return Ok(unk)
      }
      return Err(new Error('Invalid signature'))
    })
  },
)

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

function parseErrorData<S extends z.ZodTypeAny>(response: SafeResponse, schema: S) {
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

export const request = asyncFn(
  async <ST extends z.ZodTypeAny, SE extends z.ZodTypeAny, T = z.infer<ST>>(
    args: RequestArgs<ST, SE>,
  ): Promise<Result<{ data: T; response: SafeResponse }, ApiError>> => {
    const headers: Record<string, string | undefined> = {
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
      if (args.credentials?.variant === 'AccessToken') {
        headers['Authorization'] = `Bearer ${args.credentials.accessToken}`
      } else if (args.credentials?.variant === 'ApiKey') {
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
          return Err(new ApiError(ErrorKind.UnexpectedFailure({ error: token.error() }), 'Failed to sign request'))
        }
        headers['Authorization'] = `Bearer ${token.value()}`
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
  },
)
