export const CANONICAL_BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

const CANONICAL_64_BYTE_BASE64_PATTERN = /^[A-Za-z0-9+/]{85}[AQgw]==$/
const LEADING_UNPAIRED_QUOTES = new Set(['"', "'", '\u201c'])
const TRAILING_UNPAIRED_QUOTES = new Set(['"', "'", '\u201d'])

export function cleanPastedText(value: string): string {
  let cleaned = value.trim()
  if (cleaned.endsWith(',')) {
    cleaned = cleaned.slice(0, -1).trim()
  }
  const first = cleaned[0]
  const last = cleaned[cleaned.length - 1]
  if (
    cleaned.length >= 2 &&
    ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '\u201c' && last === '\u201d'))
  ) {
    cleaned = cleaned.slice(1, -1)
  }
  return cleaned
    .replaceAll('\\r\\n', '\n')
    .replaceAll('\\n', '\n')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .trim()
}

export function stripSingleUnpairedQuote(cleaned: string): string | null {
  if (cleaned.length < 2) {
    return null
  }
  const hasLeading = LEADING_UNPAIRED_QUOTES.has(cleaned[0] ?? '')
  const hasTrailing = TRAILING_UNPAIRED_QUOTES.has(cleaned[cleaned.length - 1] ?? '')
  if (hasLeading === hasTrailing) {
    return null
  }
  const stripped = hasLeading ? cleaned.slice(1) : cleaned.slice(0, -1)
  return stripped.trim()
}

export function hasPemBoundary(value: string): boolean {
  return value.includes('-----BEGIN') || value.includes('-----END')
}

export function extractPem(cleaned: string, label: 'EC PRIVATE KEY' | 'PRIVATE KEY'): string | null {
  const header = `-----BEGIN ${label}-----`
  const footer = `-----END ${label}-----`
  if (!cleaned.startsWith(header)) {
    return null
  }
  const end = cleaned.indexOf(footer, header.length)
  if (end === -1) {
    return null
  }
  const lines = cleaned
    .slice(header.length, end)
    .split(/\s+/)
    .filter((part) => part.length > 0)
  if (lines.length === 0) {
    return null
  }
  return `${header}\n${lines.join('\n')}\n${footer}`
}

export type ExtractedPemBlock = {
  kind: 'ecdsa' | 'pkcs8'
  pem: string
}

function extractPemDirect(cleaned: string): ExtractedPemBlock | null {
  const sec1Pem = extractPem(cleaned, 'EC PRIVATE KEY')
  if (sec1Pem !== null) {
    return { kind: 'ecdsa', pem: sec1Pem }
  }
  const pkcs8Pem = extractPem(cleaned, 'PRIVATE KEY')
  if (pkcs8Pem !== null) {
    return { kind: 'pkcs8', pem: pkcs8Pem }
  }
  return null
}

export function extractAnyPem(cleaned: string): ExtractedPemBlock | null {
  const direct = extractPemDirect(cleaned)
  if (direct !== null) {
    return direct
  }
  const unquoted = stripSingleUnpairedQuote(cleaned)
  return unquoted !== null ? extractPemDirect(unquoted) : null
}

export function isCanonical64ByteBase64(value: string): boolean {
  return CANONICAL_64_BYTE_BASE64_PATTERN.test(value)
}
