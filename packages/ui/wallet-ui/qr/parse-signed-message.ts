import { Err, Ok, type Result } from '@hoseki/packages/result'

const BEGIN_MESSAGE = '-----BEGIN BITCOIN SIGNED MESSAGE-----'
const BEGIN_SIGNATURE = '-----BEGIN BITCOIN SIGNATURE-----'
const END_SIGNATURE = '-----END BITCOIN SIGNATURE-----'

export interface ArmoredSignature {
  message: string
  address: string
  signature: string
}

/**
 * Parse a Bitcoin signed message in RFC armored format or as a plain base64 signature.
 *
 * Supports two formats:
 * 1. RFC armored:
 *    -----BEGIN BITCOIN SIGNED MESSAGE-----
 *    <message>
 *    -----BEGIN BITCOIN SIGNATURE-----
 *    <address>
 *    <base64 signature>
 *    -----END BITCOIN SIGNATURE-----
 *
 * 2. Plain base64 signature string (no armoring).
 */
export function parseArmoredSignature(content: string): Result<ArmoredSignature, Error> {
  const trimmed = content.trim()

  // Check for RFC armored format
  if (trimmed.startsWith(BEGIN_MESSAGE)) {
    return parseArmoredFormat(trimmed)
  }

  // Otherwise treat as plain base64 signature
  if (trimmed.length === 0) {
    return Err(new Error('Empty signature content'))
  }

  // Basic base64 validation — signature should be only base64 characters
  if (!/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
    return Err(new Error('Invalid signature format: not valid base64 or armored message'))
  }

  return Ok({
    message: '',
    address: '',
    signature: trimmed.replace(/\s/g, ''),
  })
}

function parseArmoredFormat(content: string): Result<ArmoredSignature, Error> {
  const beginMsgIdx = content.indexOf(BEGIN_MESSAGE)
  const beginSigIdx = content.indexOf(BEGIN_SIGNATURE)
  const endSigIdx = content.indexOf(END_SIGNATURE)

  if (beginMsgIdx === -1 || beginSigIdx === -1 || endSigIdx === -1) {
    return Err(new Error('Invalid armored format: missing required markers'))
  }

  const message = content.slice(beginMsgIdx + BEGIN_MESSAGE.length, beginSigIdx).trim()
  const sigBlock = content.slice(beginSigIdx + BEGIN_SIGNATURE.length, endSigIdx).trim()
  const sigLines = sigBlock
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  const [address, ...signatureLines] = sigLines
  if (address == null || address === '' || signatureLines.length === 0) {
    return Err(new Error('Invalid armored format: expected address and signature in signature block'))
  }

  const signature = signatureLines.join('')

  return Ok({ message, address, signature })
}
