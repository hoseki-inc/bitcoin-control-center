import { createHmac, generateKeyPairSync, verify, webcrypto } from 'node:crypto'
import { parseUnknown } from '@hoseki/packages/result'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { z } from 'zod'
import { CoinbaseKeyFormatError, apiKeyCredentials } from './credentials'
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
    const fields = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(header, 'base64url').toString())).unwrap()
    expect(fields).toEqual({ alg: 'ES256', kid: keyName, typ: 'JWT', nonce: fields.nonce })
    expect(fields.nonce).toMatch(/^[0-9a-f]{32}$/)
    const claims = parseUnknown(ClaimsSchema, JSON.parse(Buffer.from(payload, 'base64url').toString())).unwrap()
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
  const firstNonce = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(first, 'base64url').toString())).unwrap().nonce
  const secondNonce = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(second, 'base64url').toString())).unwrap().nonce
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
  expect(result.unwrapErr().message).toBe('Failed to sign request')
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

describe('Coinbase Ed25519, PKCS#8, and apiKeyCredentials classification', () => {
  const edPair = generateKeyPairSync('ed25519')
  const edPkcs8Der = edPair.privateKey.export({ format: 'der', type: 'pkcs8' })
  const edSpkiDer = edPair.publicKey.export({ format: 'der', type: 'spki' })
  const edSeed = edPkcs8Der.subarray(16)
  const edRawPublic = edSpkiDer.subarray(12)
  const ed64Base64 = Buffer.concat([edSeed, edRawPublic]).toString('base64')
  const edPkcs8Pem = edPair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
  const ecPkcs8Pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()

  it.each([
    { label: 'raw 64-byte base64 Ed25519', secret: ed64Base64 },
    { label: 'quoted Ed25519 with trailing comma', secret: `  "${ed64Base64}",  ` },
    { label: 'Ed25519 with trailing quote', secret: `${ed64Base64}"` },
    { label: 'Ed25519 with trailing quote and comma', secret: `${ed64Base64}",` },
    { label: 'Ed25519 with leading quote', secret: `"${ed64Base64}` },
    { label: 'Ed25519 with trailing typographic quote', secret: `${ed64Base64}\u201d` },
    { label: 'PKCS#8 Ed25519 PEM', secret: edPkcs8Pem },
  ])('signs a verifiable EdDSA JWT for $label', async ({ secret }) => {
    const credsRes = apiKeyCredentials(`"${keyName}",`, secret)
    expect(credsRes.isOk()).toBe(true)
    const creds = credsRes.unwrap()
    expect(creds.variant).toBe('CdpKey')

    for (const method of ['GET', 'POST'] as const) {
      const fetchMock = setupFetch()
      const result = await request({
        method,
        url,
        path,
        query: { limit: 1 },
        json: method === 'POST' ? { example: 'body' } : undefined,
        credentials: creds,
        schema: z.object({ ok: z.boolean() }),
        errorSchema: z.object({ message: z.string() }),
      })

      expect(result.isOk()).toBe(true)
      const outgoing = outgoingRequest(fetchMock)
      const { header, payload, signature } = tokenParts(outgoing)
      const fields = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(header, 'base64url').toString())).unwrap()
      expect(fields).toEqual({ alg: 'EdDSA', kid: keyName, typ: 'JWT', nonce: fields.nonce })
      expect(fields.nonce).toMatch(/^[0-9a-f]{32}$/)
      const claims = parseUnknown(ClaimsSchema, JSON.parse(Buffer.from(payload, 'base64url').toString())).unwrap()
      expect(claims).toEqual({
        sub: keyName,
        iss: 'cdp',
        aud: ['cdp_service'],
        nbf: now / 1000,
        exp: now / 1000 + 60,
        uris: [`${method} api.coinbase.com${path}`],
      })

      const signatureBytes = Buffer.from(signature, 'base64url')
      expect(signatureBytes).toHaveLength(64)
      expect(verify(null, Buffer.from(`${header}.${payload}`), edPair.publicKey, signatureBytes)).toBe(true)
      expect(verify(null, Buffer.from(`${header}.${payload}tampered`), edPair.publicKey, signatureBytes)).toBe(false)
    }
  })

  it.each([
    { variant: 'quoted with escaped newlines', secret: `"${pem.replaceAll('\n', '\\n')}"` },
    { variant: 'single-quoted with escaped newlines', secret: `'${pem.replaceAll('\n', '\\n')}'` },
    { variant: 'curly-quoted PEM', secret: `\u201c${pem.replaceAll('\n', '\\n')}\u201d` },
    { variant: 'quoted with trailing comma', secret: `"${pem.replaceAll('\n', '\\n')}",` },
    { variant: 'newlines turned into spaces', secret: pem.trim().replaceAll('\n', ' ') },
    { variant: 'CRLF newlines', secret: pem.replaceAll('\n', '\r\n') },
    { variant: 'escaped CRLF newlines', secret: `"${pem.replaceAll('\n', '\\r\\n')}",` },
    { variant: 'leading quote without trailing quote', secret: `"${pem.replaceAll('\n', '\\n')}` },
    { variant: 'trailing quote without leading quote', secret: `${pem.replaceAll('\n', '\\n')}"` },
    { variant: 'missing leading quote with trailing quote and comma', secret: `${JSON.stringify(pem).slice(1)},` },
    { variant: 'PKCS#8 P-256 PEM', secret: ecPkcs8Pem },
  ])('normalizes pasted ECDSA key ($variant) and signs a verifiable ES256 JWT', async ({ secret }) => {
    const credsRes = apiKeyCredentials(`  "${keyName}",  `, secret)
    expect(credsRes.isOk()).toBe(true)
    const creds = credsRes.unwrap()
    expect(creds).toMatchObject({ variant: 'CdpKey', name: keyName })

    const fetchMock = setupFetch()
    const result = await request({
      method: 'GET',
      url,
      path,
      credentials: creds,
      schema: z.object({ ok: z.boolean() }),
      errorSchema: z.object({ message: z.string() }),
    })

    expect(result.isOk()).toBe(true)
    const { header, payload, signature } = tokenParts(outgoingRequest(fetchMock))
    const fields = parseUnknown(HeaderSchema, JSON.parse(Buffer.from(header, 'base64url').toString())).unwrap()
    expect(fields.alg).toBe('ES256')
    expect(fields.kid).toBe(keyName)
    const verificationKey = await webcrypto.subtle.importKey(
      'jwk',
      publicKey.export({ format: 'jwk' }),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    )
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64url'))
    await expect(
      webcrypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        verificationKey,
        signatureBytes,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ).resolves.toBe(true)
  })

  it('extracts and stores only the first PEM block when two PEMs are concatenated', async () => {
    const secondPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
    const secondPem = secondPair.privateKey.export({ format: 'pem', type: 'sec1' }).toString()
    const credsRes = apiKeyCredentials(keyName, `${pem}\n${secondPem}`)
    expect(credsRes.isOk()).toBe(true)
    const creds = credsRes.unwrap()
    expect(creds.variant).toBe('CdpKey')
    if (creds.variant !== 'CdpKey') {
      throw new Error('Expected CdpKey')
    }
    expect(creds.secret).toBe(pem.trim())
    expect(creds.secret.match(/-----END EC PRIVATE KEY-----/g)).toHaveLength(1)

    const fetchMock = setupFetch()
    const result = await request({
      method: 'GET',
      url,
      path,
      credentials: creds,
      schema: z.object({ ok: z.boolean() }),
      errorSchema: z.object({ message: z.string() }),
    })
    expect(result.isOk()).toBe(true)
    const { header, payload, signature } = tokenParts(outgoingRequest(fetchMock))
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true)
  })

  it('fails fast on PEM header followed by 16_000 spaces and no footer', () => {
    const start = performance.now()
    const credsRes = apiKeyCredentials(keyName, `-----BEGIN EC PRIVATE KEY-----${' '.repeat(16_000)}x`)
    const elapsedMs = performance.now() - start

    expect(credsRes.isErr()).toBe(true)
    expect(credsRes.unwrapErr()).toBeInstanceOf(CoinbaseKeyFormatError)
    expect(elapsedMs).toBeLessThan(50)
  })

  it.each([
    {
      label: 'JSON key export in apiKey',
      badApiKey: JSON.stringify({ id: keyName, privateKey: ed64Base64 }),
      secret: ed64Base64,
    },
    {
      label: 'concatenated retry JSON in apiKey',
      badApiKey: `old-key-id${JSON.stringify({ id: keyName, privateKey: ed64Base64 })}`,
      secret: 'some-secret',
    },
    {
      label: 'PEM pasted into apiKey',
      badApiKey: pem,
      secret: ed64Base64,
    },
    {
      label: 'multiline apiKey with CDP secret',
      badApiKey: 'line-one\nline-two',
      secret: ed64Base64,
    },
  ])('rejects key-looking apiKey ($label) with CoinbaseKeyFormatError', ({ badApiKey, secret }) => {
    const credsRes = apiKeyCredentials(badApiKey, secret)
    expect(credsRes.isErr()).toBe(true)
    expect(credsRes.unwrapErr()).toBeInstanceOf(CoinbaseKeyFormatError)
  })

  it.each([
    {
      label: 'mismatched Ed25519 halves',
      secret: Buffer.concat([edSeed, Buffer.alloc(32, 0xab)]).toString('base64'),
    },
    {
      label: 'truncated PEM',
      secret: '-----BEGIN EC PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEH',
    },
    {
      label: 'P-384 PKCS#8 PEM',
      secret: generateKeyPairSync('ec', { namedCurve: 'secp384r1' })
        .privateKey.export({ format: 'pem', type: 'pkcs8' })
        .toString(),
    },
    {
      label: 'RSA PKCS#8 PEM',
      secret: generateKeyPairSync('rsa', { modulusLength: 2048 })
        .privateKey.export({ format: 'pem', type: 'pkcs8' })
        .toString(),
    },
  ])('returns CoinbaseKeyFormatError for invalid CDP candidate ($label)', ({ secret }) => {
    const credsRes = apiKeyCredentials(keyName, secret)
    expect(credsRes.isErr()).toBe(true)
    expect(credsRes.unwrapErr()).toBeInstanceOf(CoinbaseKeyFormatError)
  })

  it.each([
    { label: 'legacy secret with whitespace and punctuation', key: '  legacy-key  ', secret: ' "legacy-secret", ' },
    { label: 'legacy secret with trailing quote', key: 'legacy-key', secret: 'legacy-hmac-secret"' },
    {
      label: 'mismatched 64-byte base64 with trailing quote',
      key: keyName,
      secret: `${Buffer.concat([edSeed, Buffer.alloc(32, 0xab)]).toString('base64')}"`,
    },
    { label: '32-byte base64 seed', key: keyName, secret: edSeed.toString('base64') },
    { label: '48-byte base64 secret', key: keyName, secret: Buffer.alloc(48, 0x11).toString('base64') },
    { label: '65-byte base64 secret', key: keyName, secret: Buffer.alloc(65, 0x22).toString('base64') },
    {
      label: 'non-canonical 64-byte base64 without padding',
      key: keyName,
      secret: ed64Base64.slice(0, -2),
    },
    {
      label: 'non-canonical 64-byte base64 with non-zero pad bits',
      key: keyName,
      secret: `${ed64Base64.slice(0, -3)}B==`,
    },
  ])('keeps $label as legacy ApiKey byte for byte', ({ key, secret }) => {
    const credsRes = apiKeyCredentials(key, secret)
    expect(credsRes.isOk()).toBe(true)
    expect(credsRes.unwrap()).toEqual({ variant: 'ApiKey', key, secret })
  })
})
