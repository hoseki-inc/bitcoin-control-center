import {
  cleanPastedText,
  extractAnyPem,
  hasPemBoundary,
  isCanonical64ByteBase64,
  stripSingleUnpairedQuote,
} from '@hoseki/packages/clients/coinbase/lib/paste'
import { parseUnknown } from '@hoseki/packages/result'
import { z } from 'zod'

const CoinbaseJsonKeySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  privateKey: z.string().min(1),
})

export type DetectedCoinbaseKeyKind = 'ed25519' | 'ecdsa' | 'pem' | 'invalid' | null

export function trySplitCoinbaseKeyJson(raw: string): { apiKey: string; secretKey: string } | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return null
  }
  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(trimmed)
  } catch {
    return null
  }
  const validated = parseUnknown(CoinbaseJsonKeySchema, parsedJson)
  if (validated.isErr()) {
    return null
  }
  const data = validated.unwrap()
  const apiKey = data.id ?? data.name
  if (apiKey === undefined) {
    return null
  }
  return { apiKey, secretKey: data.privateKey }
}

export function detectCoinbaseKeyKind(raw: string): DetectedCoinbaseKeyKind {
  const cleaned = cleanPastedText(raw)
  if (cleaned === '') {
    return null
  }
  if (hasPemBoundary(cleaned)) {
    const pem = extractAnyPem(cleaned)
    if (pem === null) {
      return 'invalid'
    }
    return pem.kind === 'ecdsa' ? 'ecdsa' : 'pem'
  }
  if (isCanonical64ByteBase64(cleaned)) {
    return 'ed25519'
  }
  const unquoted = stripSingleUnpairedQuote(cleaned)
  if (unquoted !== null && isCanonical64ByteBase64(unquoted)) {
    return 'ed25519'
  }
  return null
}
