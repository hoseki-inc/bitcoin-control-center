// Checks the Umbrel release image at each handoff: the per-architecture OCI archives the build jobs
// produce, the registry tag before publishing, and the multi-arch index after publishing. Uses only
// Node built-ins, because the publish job runs it with registry write access.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ARCHES = ['amd64', 'arm64']
const DIGEST_RE = /^sha256:[a-f0-9]{64}$/
const OCI_MANIFEST = 'application/vnd.oci.image.manifest.v1+json'
const INDEX_MEDIA_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
]
const MANIFEST_ACCEPT = [...INDEX_MEDIA_TYPES, OCI_MANIFEST, 'application/vnd.docker.distribution.manifest.v2+json']

/**
 * Reads one field of a manifest, failing if it's missing.
 * @param {unknown} value
 * @param {string} key
 * @returns {unknown}
 */
function field(value, key) {
  if (!(value instanceof Object) || !Object.hasOwn(value, key)) {
    throw new Error(`Image manifest is missing ${key}`)
  }
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

/**
 * @param {unknown} value
 * @returns {unknown[]}
 */
function manifests(value) {
  const result = field(value, 'manifests')
  if (!Array.isArray(result)) {
    throw new Error('Image manifest list must be an array')
  }
  return result
}

/**
 * @param {unknown} descriptor
 * @returns {string}
 */
function digestField(descriptor) {
  // An object stringifies to "[object Object]", which the anchored pattern rejects.
  const match = DIGEST_RE.exec(String(field(descriptor, 'digest')))
  if (match === null) {
    throw new Error('Image manifest digest must be a sha256 digest')
  }
  return match[0]
}

/**
 * Returns linux/amd64 or linux/arm64, rejecting every other platform. Registries may record arm64
 * with its v8 variant.
 * @param {unknown} descriptor
 * @returns {string}
 */
function platform(descriptor) {
  const value = field(descriptor, 'platform')
  const architecture = field(value, 'architecture')
  const arch = ARCHES.find((candidate) => candidate === architecture)
  const variant = value instanceof Object && Object.hasOwn(value, 'variant') ? field(value, 'variant') : undefined
  if (
    field(value, 'os') !== 'linux' ||
    arch === undefined ||
    !(variant === undefined || (arch === 'arm64' && variant === 'v8'))
  ) {
    throw new Error(`Unexpected image platform ${JSON.stringify(value)}`)
  }
  return `linux/${arch}`
}

/** @param {string} arch */
function requireArch(arch) {
  if (!ARCHES.includes(arch)) {
    throw new Error(`Expected an amd64 or arm64 image, not ${arch}`)
  }
}

/** @param {string} digest */
function requireDigest(digest) {
  if (!DIGEST_RE.test(digest)) {
    throw new Error(`Expected a sha256 digest, not ${digest}`)
  }
}

/**
 * Returns the digest of the single image manifest in an OCI archive's index.json, checking it was
 * built for the expected architecture without buildx attestations.
 * @param {string} indexJson Contents of the archive's index.json.
 * @param {string} arch amd64 or arm64.
 * @returns {string}
 */
export function archiveManifestDigest(indexJson, arch) {
  requireArch(arch)
  /** @type {unknown} */
  const archiveIndex = JSON.parse(indexJson)
  const entries = manifests(archiveIndex)
  if (entries.length !== 1) {
    throw new Error(`Expected one image manifest in the ${arch} archive, found ${entries.length}`)
  }
  const [entry] = entries
  if (field(entry, 'mediaType') !== OCI_MANIFEST) {
    throw new Error(`The ${arch} archive must hold an OCI image manifest`)
  }
  if (platform(entry) !== `linux/${arch}`) {
    throw new Error(`The ${arch} archive was built for ${platform(entry)}`)
  }
  return digestField(entry)
}

/**
 * Checks a published multi-arch index lists exactly the two release images, and returns its digest.
 * @param {Buffer} indexBytes The index exactly as the registry serves it.
 * @param {{ amd64: string, arm64: string }} expected Image manifest digest for each architecture.
 * @returns {string}
 */
export function verifyPlatformIndex(indexBytes, expected) {
  requireDigest(expected.amd64)
  requireDigest(expected.arm64)
  /** @type {unknown} */
  const index = JSON.parse(indexBytes.toString('utf8'))
  const mediaType = field(index, 'mediaType')
  if (!INDEX_MEDIA_TYPES.some((type) => type === mediaType)) {
    throw new Error('The published image is not a multi-arch index')
  }
  const found = manifests(index)
    .map((entry) => `${platform(entry)} ${digestField(entry)}`)
    .sort()
  const wanted = [`linux/amd64 ${expected.amd64}`, `linux/arm64 ${expected.arm64}`]
  if (found.length !== wanted.length || found.some((entry, i) => entry !== wanted[i])) {
    throw new Error(`The published index lists ${found.join(', ') || 'no images'}; expected ${wanted.join(', ')}`)
  }
  return `sha256:${createHash('sha256').update(indexBytes).digest('hex')}`
}

/**
 * Splits ghcr.io/<owner>/<name> into the registry host and repository path.
 * @param {string} repository
 * @returns {{ host: string, name: string }}
 */
function parseRepository(repository) {
  const match = /^(ghcr\.io)\/([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+)$/.exec(repository)
  if (!match) {
    throw new Error(`Expected a ghcr.io image repository, not ${repository}`)
  }
  return { host: match[1], name: match[2] }
}

/**
 * Formats the image line for the Umbrel app's docker-compose.yml.
 * @param {string} repository Image repository, such as ghcr.io/hoseki-inc/bitcoin-control-center.
 * @param {string} version Umbrel version from start9/scripts/version.mjs umbrel.
 * @param {string} digest Multi-arch index digest.
 * @returns {string}
 */
export function imageReference(repository, version, digest) {
  parseRepository(repository)
  if (!/^\d+\.\d+\.\d+(?:-\d+)?$/.test(version)) {
    throw new Error(`Expected an Umbrel version like 1.0.0 or 1.0.0-1, not ${version}`)
  }
  requireDigest(digest)
  return `${repository}:${version}@${digest}`
}

/**
 * Reports whether a tag exists. Without read access, GHCR answers "denied" for both a private
 * package and one that does not exist yet.
 * @param {string} repository Image repository, such as ghcr.io/hoseki-inc/bitcoin-control-center.
 * @param {string} tag
 * @param {{ user: string, token: string } | undefined} credentials GitHub user and token with packages: read, or undefined for anonymous access.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<'absent' | 'present' | 'denied'>}
 */
export async function tagStatus(repository, tag, credentials, fetchImpl = fetch) {
  const { host, name } = parseRepository(repository)
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(tag)) {
    throw new Error(`Invalid image tag ${tag}`)
  }
  /** @type {Record<string, string>} */
  const tokenHeaders = credentials
    ? { Authorization: `Basic ${Buffer.from(`${credentials.user}:${credentials.token}`).toString('base64')}` }
    : {}
  const tokenResponse = await fetchImpl(
    `https://${host}/token?scope=${encodeURIComponent(`repository:${name}:pull`)}&service=${host}`,
    { headers: tokenHeaders },
  )
  if (tokenResponse.status === 401 || tokenResponse.status === 403) {
    return 'denied'
  }
  if (!tokenResponse.ok) {
    throw new Error(`The registry token request failed with HTTP ${tokenResponse.status}`)
  }
  /** @type {unknown} */
  const tokenBody = await tokenResponse.json()
  // Registry tokens are opaque; an object stringifies to "[object Object]", which this rejects.
  const registryToken = /^[A-Za-z0-9._~+/=-]+$/.exec(String(field(tokenBody, 'token')))?.[0]
  if (registryToken === undefined) {
    throw new Error('The registry returned no usable token')
  }

  const response = await fetchImpl(`https://${host}/v2/${name}/manifests/${tag}`, {
    method: 'HEAD',
    headers: { Authorization: `Bearer ${registryToken}`, Accept: MANIFEST_ACCEPT.join(', ') },
  })
  switch (response.status) {
    case 200:
      return 'present'
    case 404:
      return 'absent'
    case 401:
    case 403:
      return 'denied'
    default:
      throw new Error(`The registry tag lookup failed with HTTP ${response.status}`)
  }
}

const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href) {
  const [command, ...args] = process.argv.slice(2)
  const usage = `Usage:
  umbrel-image.mjs archive-digest <index.json> <amd64|arm64>
  umbrel-image.mjs verify-index <index file> <amd64 digest> <arm64 digest>
  umbrel-image.mjs image-reference <repository> <version> <digest>
  umbrel-image.mjs tag-status <repository> <tag>   (signs in with REGISTRY_USER and REGISTRY_TOKEN when set)`
  const [first, second, third] = args
  if (command === 'archive-digest' && args.length === 2 && first !== undefined && second !== undefined) {
    console.log(archiveManifestDigest(readFileSync(first, 'utf8'), second))
  } else if (
    command === 'verify-index' &&
    args.length === 3 &&
    first !== undefined &&
    second !== undefined &&
    third !== undefined
  ) {
    console.log(verifyPlatformIndex(readFileSync(first), { amd64: second, arm64: third }))
  } else if (
    command === 'image-reference' &&
    args.length === 3 &&
    first !== undefined &&
    second !== undefined &&
    third !== undefined
  ) {
    console.log(imageReference(first, second, third))
  } else if (command === 'tag-status' && args.length === 2 && first !== undefined && second !== undefined) {
    const { REGISTRY_USER: user, REGISTRY_TOKEN: token } = process.env
    const credentials =
      user !== undefined && user !== '' && token !== undefined && token !== '' ? { user, token } : undefined
    console.log(await tagStatus(first, second, credentials))
  } else {
    throw new Error(usage)
  }
}
