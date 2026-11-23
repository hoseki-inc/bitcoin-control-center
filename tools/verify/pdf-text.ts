import { inflateSync } from 'node:zlib'

export interface PdfVerification {
  validHeader: boolean
  byteLength: number
  text: string
}

interface PdfObject {
  id: number
  header: string
  stream: string | null
}

type ToUnicodeMap = {
  codeHexLength: number
  entries: Map<string, string>
}

function decodeUtf16Hex(hex: string): string {
  const clean = hex.replace(/\s+/g, '')
  if (clean.length === 0 || clean.length % 2 !== 0) {
    return ''
  }
  if (clean.length === 2) {
    return String.fromCharCode(Number.parseInt(clean, 16))
  }
  let out = ''
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    out += String.fromCharCode(Number.parseInt(clean.slice(i, i + 4), 16))
  }
  return out
}

function parseToUnicodeCmap(cmap: string): ToUnicodeMap {
  const entries = new Map<string, string>()
  let codeHexLength = 4

  const bfcharBlocks = cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)
  for (const block of bfcharBlocks) {
    const body = block[1] ?? ''
    for (const pair of body.matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const src = (pair[1] ?? '').toUpperCase()
      const dst = pair[2] ?? ''
      if (src.length > 0 && dst.length > 0) {
        codeHexLength = src.length
        entries.set(src, decodeUtf16Hex(dst))
      }
    }
  }

  const bfrangeBlocks = cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)
  for (const block of bfrangeBlocks) {
    const body = block[1] ?? ''
    const rangePattern = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g
    for (const match of body.matchAll(rangePattern)) {
      const startHex = match[1]
      const endHex = match[2]
      const dstHex = match[3]
      const dstArray = match[4]
      if (startHex === undefined || endHex === undefined) {
        continue
      }
      const start = Number.parseInt(startHex, 16)
      const end = Number.parseInt(endHex, 16)
      codeHexLength = startHex.length
      if (dstHex !== undefined) {
        const dstStart = Number.parseInt(dstHex, 16)
        for (let code = start; code <= end; code += 1) {
          const key = code.toString(16).toUpperCase().padStart(codeHexLength, '0')
          entries.set(key, String.fromCodePoint(dstStart + (code - start)))
        }
      } else if (dstArray !== undefined) {
        const targets = Array.from(dstArray.matchAll(/<([0-9a-fA-F]+)>/g), (m) => m[1] ?? '')
        for (let offset = 0; offset < targets.length; offset += 1) {
          const target = targets[offset]
          if (target !== undefined && target.length > 0) {
            const key = (start + offset).toString(16).toUpperCase().padStart(codeHexLength, '0')
            entries.set(key, decodeUtf16Hex(target))
          }
        }
      }
    }
  }

  return { codeHexLength, entries }
}

function extractStreamBytes(raw: Buffer, startIndex: number, endIndex: number): Buffer {
  let start = startIndex
  if (raw[start] === 0x0d && raw[start + 1] === 0x0a) {
    start += 2
  } else if (raw[start] === 0x0a || raw[start] === 0x0d) {
    start += 1
  }
  let end = endIndex
  while (end > start && (raw[end - 1] === 0x0a || raw[end - 1] === 0x0d)) {
    end -= 1
  }
  return raw.subarray(start, end)
}

function parsePdfObjects(pdf: Buffer): Map<number, PdfObject> {
  const latin1 = pdf.toString('latin1')
  const objects = new Map<number, PdfObject>()
  const objPattern = /(\d+)\s+\d+\s+obj\b([\s\S]*?)endobj/g

  for (const match of objPattern[Symbol.matchAll](latin1)) {
    const id = Number.parseInt(match[1] ?? '0', 10)
    const body = match[2] ?? ''
    const streamRel = body.indexOf('stream')
    const endstreamRel = body.lastIndexOf('endstream')
    if (streamRel === -1 || endstreamRel === -1 || endstreamRel <= streamRel) {
      objects.set(id, { id, header: body, stream: null })
      continue
    }
    const header = body.slice(0, streamRel)
    const objStart = match.index
    const bodyOffset = latin1.indexOf(body, objStart)
    const bytes = extractStreamBytes(pdf, bodyOffset + streamRel + 'stream'.length, bodyOffset + endstreamRel)
    let decoded: Buffer = bytes
    if (header.includes('/FlateDecode')) {
      try {
        decoded = inflateSync(bytes)
      } catch {
        decoded = bytes
      }
    }
    objects.set(id, { id, header, stream: decoded.toString('latin1') })
  }
  return objects
}

function decodePdfLiteralString(raw: string): string {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (ch !== '\\') {
      out += ch ?? ''
      continue
    }
    i += 1
    const next = raw[i]
    if (next === undefined) {
      break
    }
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 'r':
        out += '\r'
        break
      case 't':
        out += '\t'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case '(':
      case ')':
      case '\\':
        out += next
        break
      default: {
        if (next >= '0' && next <= '7') {
          let octal = next
          for (let k = 0; k < 2 && i + 1 < raw.length; k += 1) {
            const digit = raw[i + 1]
            if (digit !== undefined && digit >= '0' && digit <= '7') {
              octal += digit
              i += 1
            } else {
              break
            }
          }
          out += String.fromCharCode(Number.parseInt(octal, 8))
        } else {
          out += next
        }
      }
    }
  }
  return out
}

function decodeHexToken(hex: string, cmap: ToUnicodeMap | undefined): string {
  const clean = hex.replace(/\s+/g, '').toUpperCase()
  if (clean.length === 0) {
    return ''
  }
  if (cmap !== undefined && cmap.entries.size > 0) {
    const step = cmap.codeHexLength
    let out = ''
    for (let i = 0; i + step <= clean.length; i += step) {
      const glyph = clean.slice(i, i + step)
      out += cmap.entries.get(glyph) ?? ''
    }
    return out
  }
  let ascii = ''
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    const byte = Number.parseInt(clean.slice(i, i + 2), 16)
    if (byte >= 32 && byte <= 126) {
      ascii += String.fromCharCode(byte)
    }
  }
  return ascii
}

function extractTextFromContentStream(
  content: string,
  fontCmaps: Map<string, ToUnicodeMap>,
  fallbackCmap: ToUnicodeMap | undefined,
): string {
  const chunks: string[] = []
  let activeFont = ''
  let i = 0

  const decodeLiteralWithCmap = (decoded: string): string => {
    const cmap = fontCmaps.get(activeFont) ?? fallbackCmap
    if (cmap === undefined || cmap.entries.size === 0) {
      return decoded
    }
    const bytesPerCode = Math.max(1, Math.floor(cmap.codeHexLength / 2))
    if (decoded.length < bytesPerCode || decoded.length % bytesPerCode !== 0) {
      return decoded
    }
    let mapped = ''
    let hits = 0
    const total = decoded.length / bytesPerCode
    for (let offset = 0; offset < decoded.length; offset += bytesPerCode) {
      let key = ''
      for (let b = 0; b < bytesPerCode; b += 1) {
        key += (decoded.charCodeAt(offset + b) & 0xff).toString(16).toUpperCase().padStart(2, '0')
      }
      const value = cmap.entries.get(key)
      if (value !== undefined) {
        mapped += value
        hits += 1
      }
    }
    return hits > 0 && hits * 2 >= total ? mapped : decoded
  }

  const readLiteral = (): string => {
    i += 1
    let depth = 1
    let buf = ''
    while (i < content.length && depth > 0) {
      const ch = content[i]
      if (ch === '\\' && i + 1 < content.length) {
        buf += ch + (content[i + 1] ?? '')
        i += 2
        continue
      }
      if (ch === '(') {
        depth += 1
      } else if (ch === ')') {
        depth -= 1
        if (depth === 0) {
          i += 1
          break
        }
      }
      buf += ch ?? ''
      i += 1
    }
    return decodeLiteralWithCmap(decodePdfLiteralString(buf))
  }

  const readHex = (): string => {
    i += 1
    const start = i
    while (i < content.length && content[i] !== '>') {
      i += 1
    }
    const hex = content.slice(start, i)
    if (i < content.length) {
      i += 1
    }
    const cmap = fontCmaps.get(activeFont) ?? fallbackCmap
    return decodeHexToken(hex, cmap)
  }

  while (i < content.length) {
    const ch = content[i]
    if (ch === '/') {
      const match = /^\/([A-Za-z0-9_+-]+)\s+[\d.-]+\s+Tf\b/.exec(content.slice(i))
      if (match?.[1] !== undefined) {
        activeFont = match[1]
        i += match[0].length
        continue
      }
      i += 1
      continue
    }
    if (ch === '(') {
      const text = readLiteral()
      const after = content.slice(i, i + 16)
      if (/^\s*(?:Tj|'|")/.test(after)) {
        chunks.push(text)
      }
      continue
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const text = readHex()
      const after = content.slice(i, i + 16)
      if (/^\s*(?:Tj|'|")/.test(after)) {
        chunks.push(text)
      }
      continue
    }
    if (ch === '[') {
      i += 1
      let arrayText = ''
      while (i < content.length && content[i] !== ']') {
        const inner = content[i]
        if (inner === '(') {
          arrayText += readLiteral()
        } else if (inner === '<' && content[i + 1] !== '<') {
          arrayText += readHex()
        } else {
          i += 1
        }
      }
      if (i < content.length) {
        i += 1
      }
      if (/^\s*TJ\b/.test(content.slice(i, i + 16))) {
        chunks.push(arrayText)
      }
      continue
    }
    if (ch === 'E' && content[i + 1] === 'T' && /\s/.test(content[i + 2] ?? ' ')) {
      chunks.push('\n')
      i += 2
      continue
    }
    i += 1
  }

  return chunks
    .join(' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * Verifies a PDF buffer has a valid `%PDF-` header and extracts readable text from deflated content streams,
 * supporting both literal strings and subsetted TrueType fonts mapped through `ToUnicode` CMap tables.
 */
export function extractPdfText(pdf: Buffer): PdfVerification {
  const validHeader = pdf.subarray(0, 5).toString('latin1') === '%PDF-'
  if (!validHeader) {
    return { validHeader: false, byteLength: pdf.byteLength, text: '' }
  }

  const objects = parsePdfObjects(pdf)

  const cmapsByObj = new Map<number, ToUnicodeMap>()
  for (const obj of objects.values()) {
    if (obj.stream !== null && (obj.stream.includes('beginbfchar') || obj.stream.includes('beginbfrange'))) {
      cmapsByObj.set(obj.id, parseToUnicodeCmap(obj.stream))
    }
  }

  const cmapsByFontObj = new Map<number, ToUnicodeMap>()
  for (const obj of objects.values()) {
    const match = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(obj.header)
    if (match?.[1] !== undefined) {
      const cmap = cmapsByObj.get(Number.parseInt(match[1], 10))
      if (cmap !== undefined) {
        cmapsByFontObj.set(obj.id, cmap)
      }
    }
  }

  const fontCmaps = new Map<string, ToUnicodeMap>()
  for (const obj of objects.values()) {
    for (const ref of obj.header.matchAll(/\/([A-Za-z0-9_+-]+)\s+(\d+)\s+\d+\s+R/g)) {
      const name = ref[1]
      const targetId = Number.parseInt(ref[2] ?? '0', 10)
      const cmap = cmapsByFontObj.get(targetId)
      if (name !== undefined && cmap !== undefined) {
        fontCmaps.set(name, cmap)
      }
    }
  }

  const fallbackCmap = cmapsByObj.size === 1 ? [...cmapsByObj.values()][0] : undefined

  const textParts: string[] = []
  for (const obj of objects.values()) {
    if (obj.stream === null) {
      continue
    }
    if (obj.stream.includes('begincmap') || obj.stream.includes('beginbfchar') || obj.stream.includes('beginbfrange')) {
      continue
    }
    if (!obj.stream.includes('Tj') && !obj.stream.includes('TJ')) {
      continue
    }
    const extracted = extractTextFromContentStream(obj.stream, fontCmaps, fallbackCmap)
    if (extracted.length > 0) {
      textParts.push(extracted)
    }
  }

  return {
    validHeader: true,
    byteLength: pdf.byteLength,
    text: textParts.join('\n').trim(),
  }
}
