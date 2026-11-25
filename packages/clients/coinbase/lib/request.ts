import * as crypto from 'node:crypto'
import { Err, Result, asyncFn, parseUnknown } from '@hoseki/packages/result'
import { SafeHttpErrorKind, type SafeResponse, safeHttp } from '@hoseki/packages/safe-http'
import type { z } from 'zod'
import { type Credentials, parseCdpSigningKey } from './credentials'
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

function sign(args: { timestamp: string; secret: string; method: 'GET' | 'POST'; path: string; body?: string }) {
  const message = args.timestamp + args.method + args.path + (args.body ?? '')
  const signature = crypto.createHmac('sha256', args.secret).update(message).digest('hex')
  return signature
}

function generateNonce(): string {
  return crypto.randomBytes(16).toString('hex')
}

const signCdp = asyncFn(
  async (args: {
    name: string
    secret: string
    method: 'GET' | 'POST'
    url: string
    path: string
  }): Promise<Result<string, Error>> => {
    const parsedKeyRes = parseCdpSigningKey(args.secret)
    if (parsedKeyRes.isErr()) {
      return Err(parsedKeyRes.error())
    }

    const { key: privateKey, alg } = parsedKeyRes.value()
    const nonce = generateNonce()

    const fields = {
      alg,
      kid: args.name,
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
      exp: now + 60,
      uris: [uri],
    }

    return Result.fromThrowable(() => {
      const header = Buffer.from(JSON.stringify(fields)).toString('base64url')
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
      const signingInput = `${header}.${payload}`
      const signature =
        alg === 'EdDSA'
          ? crypto.sign(null, Buffer.from(signingInput), privateKey)
          : crypto.sign('sha256', Buffer.from(signingInput), {
              key: privateKey,
              dsaEncoding: 'ieee-p1363',
            })
      return `${signingInput}.${signature.toString('base64url')}`
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

export const request = asyncFn(
  async <ST extends z.ZodTypeAny, SE extends z.ZodTypeAny>(
    args: RequestArgs<ST, SE>,
  ): Promise<Result<{ data: z.infer<ST>; response: SafeResponse }, ApiError>> => {
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
          return Err(new ApiError(ErrorKind.UnexpectedFailure({ error: token.error() }), 'Failed to sign request'))
        }
        headers.Authorization = `Bearer ${token.value()}`
      }
    }

    let input = args.url + path
    let requestHeaders: Headers
    try {
      requestHeaders = recordToHeaders(headers)
    } catch {
      return Err(
        new ApiError(
          ErrorKind.UnexpectedFailure({ error: new Error('Invalid request headers') }),
          'Invalid request headers',
        ),
      )
    }

    return safeHttp
      .request(input, {
        method: args.method,
        headers: requestHeaders,
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
