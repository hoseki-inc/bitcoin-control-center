import { createHmac, generateKeyPairSync, webcrypto } from 'node:crypto'
import { parseUnknown } from '@hoseki/packages/result'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { request } from './request'

const now = 1_704_067_200_000
const keyName = 'synthetic-api-key'
const url = 'https://api.coinbase.com'
const path = '/api/v3/brokerage/accounts'
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const pem = privateKey.export({ format: 'pem', type: 'sec1' }).toString()

const HeaderSchema = z.object({ alg: z.string(), kid: z.string(), typ: z.string(), nonce: z.string() })
const ClaimsSchema = z.object({
  sub: z.string(),
  iss: z.string(),
  aud: z.array(z.string()),
  nbf: z.number(),
  exp: z.number(),
  uris: z.array(z.string()),
})

function setupFetch() {
  onTestFinished(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  vi.spyOn(Date, 'now').mockReturnValue(now)
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function outgoingRequest(fetchMock: ReturnType<typeof setupFetch>, index = 0): Request {
  const call = fetchMock.mock.calls[index]
  if (call === undefined) {
    expect.fail('Client must send a request')
  }
  return new Request(...call)
}

function tokenParts(outgoing: Request) {
  const authorization = outgoing.headers.get('Authorization')
  if (authorization === null) {
    expect.fail('CDP requests must include authorization')
  }
  const parts = authorization.slice('Bearer '.length).split('.')
  const [header, payload, signature] = parts
  if (parts.length !== 3 || header === undefined || payload === undefined || signature === undefined) {
    expect.fail('CDP authorization must contain a compact JWT')
  }
  return { header, payload, signature }
}

describe.each([
  { format: 'SEC1 PEM', secret: pem },
  { format: 'SEC1 PEM with escaped newlines and surrounding whitespace', secret: `  ${pem.replaceAll('\n', '\\n')}  ` },
])('Coinbase CDP signing with $format', ({ secret }) => {
  it.each(['GET', 'POST'] as const)('sends a verifiable ES256 JWT for %s', async (method) => {
    const fetchMock = setupFetch()
    const result = await request({
      method,
      url,
      path,
      query: { limit: 1 },
      json: method === 'POST' ? { example: 'body' } : undefined,
      credentials: { variant: 'CdpKey', name: keyName, secret },
      schema: z.object({ ok: z.boolean() }),
      errorSchema: z.object({ message: z.string() }),
    })

    expect(result.isOk()).toBe(true)
    const outgoing = outgoingRequest(fetchMock)
    const { header, payload, signature } = tokenParts(outgoing)
    const fields = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(header, 'base64url').toString())).expect(
      'Expected successful result',
    )
    expect(fields).toEqual({ alg: 'ES256', kid: keyName, typ: 'JWT', nonce: fields.nonce })
    expect(fields.nonce).toMatch(/^[0-9a-f]{32}$/)
    const claims = parseUnknown(ClaimsSchema, JSON.parse(Buffer.from(payload, 'base64url').toString())).expect(
      'Expected successful result',
    )
    expect(claims).toEqual({
      sub: keyName,
      iss: 'cdp',
      aud: ['cdp_service'],
      nbf: now / 1000,
      exp: now / 1000 + 60,
      uris: [`${method} api.coinbase.com${path}`],
    })
    expect(outgoing.url).toBe(`${url}${path}?limit=1`)
    expect(outgoing.method).toBe(method)

    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64url'))
    expect(signatureBytes).toHaveLength(64)
    const verificationKey = await webcrypto.subtle.importKey(
      'jwk',
      publicKey.export({ format: 'jwk' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const algorithm = { name: 'ECDSA', hash: 'SHA-256' }
    const signingInput = new TextEncoder().encode(`${header}.${payload}`)
    await expect(webcrypto.subtle.verify(algorithm, verificationKey, signatureBytes, signingInput)).resolves.toBe(true)
    const tamperedInput = new TextEncoder().encode(`${header}.${payload}tampered`)
    await expect(webcrypto.subtle.verify(algorithm, verificationKey, signatureBytes, tamperedInput)).resolves.toBe(
      false,
    )
  })
})

it('generates a fresh nonce for each CDP request', async () => {
  const fetchMock = setupFetch()
  for (let index = 0; index < 2; index++) {
    const result = await request({
      method: 'GET',
      url,
      path,
      credentials: { variant: 'CdpKey', name: keyName, secret: pem },
      schema: z.object({ ok: z.boolean() }),
      errorSchema: z.object({ message: z.string() }),
    })
    expect(result.isOk()).toBe(true)
  }
  const first = tokenParts(outgoingRequest(fetchMock)).header
  const second = tokenParts(outgoingRequest(fetchMock, 1)).header
  const firstNonce = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(first, 'base64url').toString())).expect(
    'Expected successful result',
  ).nonce
  const secondNonce = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(second, 'base64url').toString())).expect(
    'Expected successful result',
  ).nonce
  expect(firstNonce).not.toBe(secondNonce)
})

it.each([
  { name: 'non-PEM input', secret: 'invalid-key' },
  { name: 'malformed SEC1 PEM', secret: '-----BEGIN EC PRIVATE KEY-----\ninvalid\n-----END EC PRIVATE KEY-----' },
  { name: 'public key', secret: publicKey.export({ format: 'pem', type: 'spki' }).toString() },
  {
    name: 'P-384 private key',
    secret: generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
      .privateKey.export({ format: 'pem', type: 'sec1' })
      .toString(),
  },
  {
    name: 'secp256k1 private key',
    secret: generateKeyPairSync('ec', { namedCurve: 'secp256k1' })
      .privateKey.export({ format: 'pem', type: 'sec1' })
      .toString(),
  },
  {
    name: 'RSA private key',
    secret: generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ format: 'pem', type: 'pkcs1' })
      .toString(),
  },
])('rejects $name without sending an authenticated request', async ({ secret }) => {
  const fetchMock = setupFetch()
  const result = await request({
    method: 'GET',
    url,
    path,
    credentials: { variant: 'CdpKey', name: keyName, secret },
    schema: z.object({ ok: z.boolean() }),
    errorSchema: z.object({ message: z.string() }),
  })
  expect(result.isErr()).toBe(true)
  expect(result.expectErr('Expected failed result').message).toBe('Failed to sign request')
  expect(fetchMock).not.toHaveBeenCalled()
})

it('preserves legacy API-key HMAC authentication over the transmitted path and body', async () => {
  const fetchMock = setupFetch()
  const secret = 'synthetic-test-secret'
  const result = await request({
    method: 'POST',
    url,
    path,
    query: { limit: 1 },
    json: { example: 'body' },
    credentials: { variant: 'ApiKey', key: keyName, secret },
    schema: z.object({ ok: z.boolean() }),
    errorSchema: z.object({ message: z.string() }),
  })
  expect(result.isOk()).toBe(true)
  const outgoing = outgoingRequest(fetchMock)
  const timestamp = String(now / 1000)
  const body = await outgoing.text()
  const expected = createHmac('sha256', secret).update(`${timestamp}POST${path}?limit=1${body}`).digest('hex')
  expect(outgoing.headers.get('CB-ACCESS-SIGN')).toBe(expected)
  expect(outgoing.headers.get('CB-ACCESS-KEY')).toBe(keyName)
  expect(outgoing.headers.get('CB-ACCESS-TIMESTAMP')).toBe(timestamp)
  expect(outgoing.headers.has('Authorization')).toBe(false)
})

it('preserves access-token authentication', async () => {
  const fetchMock = setupFetch()
  const result = await request({
    method: 'GET',
    url,
    path,
    credentials: { variant: 'AccessToken', accessToken: 'synthetic-access-token' },
    schema: z.object({ ok: z.boolean() }),
    errorSchema: z.object({ message: z.string() }),
  })
  expect(result.isOk()).toBe(true)
  expect(outgoingRequest(fetchMock).headers.get('Authorization')).toBe('Bearer synthetic-access-token')
})
