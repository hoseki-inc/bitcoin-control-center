import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'vitest'
import { archiveManifestDigest, imageReference, tagStatus, verifyPlatformIndex } from './umbrel-image.mjs'

const repository = 'ghcr.io/hoseki-inc/bitcoin-control-center'
const amd64 = `sha256:${'a'.repeat(64)}`
const arm64 = `sha256:${'b'.repeat(64)}`
const oci = {
  manifest: 'application/vnd.oci.image.manifest.v1+json',
  index: 'application/vnd.oci.image.index.v1+json',
}

/**
 * @param {string} arch
 * @param {string} digest
 */
function descriptor(arch, digest) {
  return { mediaType: oci.manifest, digest, size: 668, platform: { architecture: arch, os: 'linux' } }
}

/** @param {unknown[]} manifests */
function index(manifests) {
  return JSON.stringify({ schemaVersion: 2, mediaType: oci.index, manifests })
}

test('reads the image digest from a single-architecture OCI archive', () => {
  assert.equal(archiveManifestDigest(index([descriptor('arm64', arm64)]), 'arm64'), arm64)
})

test('rejects an archive for the wrong architecture or with buildx attestations', () => {
  assert.throws(() => archiveManifestDigest(index([descriptor('amd64', amd64)]), 'arm64'), /built for linux\/amd64/)
  const attestation = {
    mediaType: oci.manifest,
    digest: `sha256:${'c'.repeat(64)}`,
    size: 100,
    annotations: { 'vnd.docker.reference.type': 'attestation-manifest' },
  }
  assert.throws(() => archiveManifestDigest(index([descriptor('arm64', arm64), attestation]), 'arm64'), /found 2/)
  assert.throws(() => archiveManifestDigest(index([descriptor('arm64', 'sha256:short')]), 'arm64'), /sha256 digest/)
  assert.throws(() => archiveManifestDigest(index([descriptor('riscv64', arm64)]), 'riscv64'), /amd64 or arm64/)
})

test('returns the digest of the exact published index bytes', () => {
  const bytes = Buffer.from(index([descriptor('amd64', amd64), descriptor('arm64', arm64)]))
  const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  assert.equal(verifyPlatformIndex(bytes, { amd64, arm64 }), digest)
})

test('accepts the arm64 v8 variant some registries record', () => {
  const arm64v8 = { ...descriptor('arm64', arm64), platform: { architecture: 'arm64', os: 'linux', variant: 'v8' } }
  const bytes = Buffer.from(index([descriptor('amd64', amd64), arm64v8]))
  assert.match(verifyPlatformIndex(bytes, { amd64, arm64 }), /^sha256:[a-f0-9]{64}$/)
  const armv7 = { ...descriptor('arm', arm64), platform: { architecture: 'arm', os: 'linux', variant: 'v7' } }
  assert.throws(
    () => verifyPlatformIndex(Buffer.from(index([descriptor('amd64', amd64), armv7])), { amd64, arm64 }),
    /Unexpected image platform/,
  )
})

test('rejects an index with a missing, extra, or different image', () => {
  const expected = { amd64, arm64 }
  const only = Buffer.from(index([descriptor('amd64', amd64)]))
  assert.throws(() => verifyPlatformIndex(only, expected), /expected linux\/amd64/)
  const extra = Buffer.from(
    index([descriptor('amd64', amd64), descriptor('arm64', arm64), descriptor('arm64', `sha256:${'d'.repeat(64)}`)]),
  )
  assert.throws(() => verifyPlatformIndex(extra, expected), /lists/)
  const swapped = Buffer.from(index([descriptor('amd64', arm64), descriptor('arm64', amd64)]))
  assert.throws(() => verifyPlatformIndex(swapped, expected), /lists/)
  const single = Buffer.from(JSON.stringify({ ...descriptor('amd64', amd64), schemaVersion: 2 }))
  assert.throws(() => verifyPlatformIndex(single, expected), /not a multi-arch index/)
})

test('formats the image line for the Umbrel app', () => {
  assert.equal(imageReference(repository, '1.0.0', amd64), `${repository}:1.0.0@${amd64}`)
  assert.equal(imageReference(repository, '1.0.0-1', amd64), `${repository}:1.0.0-1@${amd64}`)
  assert.throws(() => imageReference(repository, '1.0.0:0', amd64), /Umbrel version/)
  assert.throws(() => imageReference('docker.io/hoseki/app', '1.0.0', amd64), /ghcr.io/)
})

/**
 * Serves a token response and then a manifest status, recording each request.
 * @param {number} tokenStatus
 * @param {number} manifestStatus
 */
function registry(tokenStatus, manifestStatus) {
  /** @type {{ url: string, init: RequestInit | undefined }[]} */
  const requests = []
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    requests.push({ url: url instanceof Request ? url.url : url.toString(), init })
    if (requests.length === 1) {
      return new Response(JSON.stringify({ token: 'registry-token' }), { status: tokenStatus })
    }
    return new Response(null, { status: manifestStatus })
  }
  return { requests, fetchImpl }
}

test('reports whether the release tag exists', async () => {
  const absent = registry(200, 404)
  assert.equal(await tagStatus(repository, '1.0.0', { user: 'cory', token: 'gh' }, absent.fetchImpl), 'absent')
  assert.equal(
    absent.requests[0].url,
    'https://ghcr.io/token?scope=repository%3Ahoseki-inc%2Fbitcoin-control-center%3Apull&service=ghcr.io',
  )
  assert.deepEqual(absent.requests[0].init?.headers, {
    Authorization: `Basic ${Buffer.from('cory:gh').toString('base64')}`,
  })
  assert.equal(absent.requests[1].url, 'https://ghcr.io/v2/hoseki-inc/bitcoin-control-center/manifests/1.0.0')
  assert.equal(absent.requests[1].init?.method, 'HEAD')

  assert.equal(await tagStatus(repository, '1.0.0', undefined, registry(200, 200).fetchImpl), 'present')
  assert.equal(await tagStatus(repository, '1.0.0', undefined, registry(403, 404).fetchImpl), 'denied')
  assert.equal(await tagStatus(repository, '1.0.0', undefined, registry(200, 401).fetchImpl), 'denied')
})

test('fails instead of guessing when the registry errors', async () => {
  await assert.rejects(tagStatus(repository, '1.0.0', undefined, registry(500, 404).fetchImpl), /HTTP 500/)
  await assert.rejects(tagStatus(repository, '1.0.0', undefined, registry(200, 502).fetchImpl), /HTTP 502/)
  await assert.rejects(tagStatus(repository, '../1.0.0', undefined, registry(200, 404).fetchImpl), /Invalid image tag/)
})
