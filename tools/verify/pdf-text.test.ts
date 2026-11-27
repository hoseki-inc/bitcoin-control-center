import { deflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractPdfText, normalizePdfText, pdfTextIncludes } from './pdf-text'

function buildStreamObj(id: number, body: Buffer, compress: boolean): Buffer {
  const payload = compress ? deflateSync(body) : body
  const filter = compress ? '/Filter /FlateDecode ' : ''
  return Buffer.concat([
    Buffer.from(`${id} 0 obj\n<< ${filter}/Length ${payload.length} >>\nstream\n`, 'latin1'),
    payload,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
}

describe('extractPdfText', () => {
  it('rejects non-PDF buffers', () => {
    const result = extractPdfText(Buffer.from('not a pdf', 'utf8'))
    expect(result.validHeader).toBe(false)
    expect(result.text).toBe('')
  })

  it('extracts literal Tj and TJ text from deflated streams', () => {
    const content = Buffer.from('BT /F1 12 Tf (Verify Seed) Tj [(Verify ) -20 (Savings)] TJ ET', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'latin1'),
      buildStreamObj(1, content, true),
      Buffer.from('%%EOF\n', 'latin1'),
    ])
    const result = extractPdfText(pdf)
    expect(result.validHeader).toBe(true)
    expect(result.text).toContain('Verify Seed')
    expect(result.text).toContain('Verify Savings')
  })

  it('decodes hex glyph streams through ToUnicode CMap bfchar and bfrange tables', () => {
    const cmap = Buffer.from(
      [
        '/CIDInit /ProcSet findresource begin',
        'begincmap',
        '2 beginbfchar',
        '<0001> <0056>',
        '<0002> <0065>',
        'endbfchar',
        '1 beginbfrange',
        '<0003> <0004> [<0072> <0069>]',
        'endbfrange',
        '1 beginbfrange',
        '<0005> <0006> <0066>',
        'endbfrange',
        'endcmap',
      ].join('\n'),
      'latin1',
    )
    const content = Buffer.from('BT /F1 12 Tf <00010002000300040005> Tj ET', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'latin1'),
      Buffer.from('1 0 obj\n<< /Resources << /Font << /F1 2 0 R >> >> >>\nendobj\n', 'latin1'),
      Buffer.from('2 0 obj\n<< /Type /Font /ToUnicode 3 0 R >>\nendobj\n', 'latin1'),
      buildStreamObj(3, cmap, true),
      buildStreamObj(4, content, true),
      Buffer.from('%%EOF\n', 'latin1'),
    ])
    const result = extractPdfText(pdf)
    expect(result.validHeader).toBe(true)
    expect(result.text).toContain('Verif')
  })

  it('decodes multi-line beginbfrange arrays and CMap-mapped literal strings', () => {
    const cmap = Buffer.from(
      [
        '/CIDInit /ProcSet findresource begin',
        'begincmap',
        '1 beginbfrange',
        '<66> <6A> [',
        '<0053>',
        '<0065>',
        '<0065>',
        '<0064>',
        '<0021>',
        ']',
        'endbfrange',
        'endcmap',
      ].join('\n'),
      'latin1',
    )
    const content = Buffer.from('BT /F1 12 Tf (fghij) Tj ET', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'latin1'),
      Buffer.from('1 0 obj\n<< /Resources << /Font << /F1 2 0 R >> >> >>\nendobj\n', 'latin1'),
      Buffer.from('2 0 obj\n<< /Type /Font /ToUnicode 3 0 R >>\nendobj\n', 'latin1'),
      buildStreamObj(3, cmap, true),
      buildStreamObj(4, content, true),
      Buffer.from('%%EOF\n', 'latin1'),
    ])
    const result = extractPdfText(pdf)
    expect(result.validHeader).toBe(true)
    expect(result.text).toContain('Seed!')
  })

  it('keeps later glyphs in place after a ligature entry in a bfrange array', () => {
    // pdfkit writes fi as <0066 0069>; skipping it would shift every later glyph by one (balance read kalance).
    const cmap = Buffer.from(
      ['begincmap', '1 beginbfrange', '<0000> <0003> [<0073> <0066 0069> <002e> <0062>]', 'endbfrange', 'endcmap'].join(
        '\n',
      ),
      'latin1',
    )
    const content = Buffer.from('BT /F1 12 Tf <0000000100030002> Tj ET', 'latin1')
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n', 'latin1'),
      Buffer.from('1 0 obj\n<< /Resources << /Font << /F1 2 0 R >> >> >>\nendobj\n', 'latin1'),
      Buffer.from('2 0 obj\n<< /Type /Font /ToUnicode 3 0 R >>\nendobj\n', 'latin1'),
      buildStreamObj(3, cmap, true),
      buildStreamObj(4, content, true),
      Buffer.from('%%EOF\n', 'latin1'),
    ])
    expect(extractPdfText(pdf).text).toBe('sfib.')
  })
})

describe('pdfTextIncludes', () => {
  it('matches a phrase the extractor split across lines', () => {
    const text = 'PROVIDED BY USER\nVerify Owner\n12\nVerify Lane\nTestville, TS 00000'
    expect(text).not.toContain('12 Verify Lane')
    expect(pdfTextIncludes(text, '12 Verify Lane')).toBe(true)
    expect(pdfTextIncludes(text, '13 Verify Lane')).toBe(false)
  })

  it('collapses whitespace in the phrase too', () => {
    expect(normalizePdfText('  0.64999000\n BTC \t')).toBe('0.64999000 BTC')
    expect(pdfTextIncludes('0.64999000\nBTC', '0.64999000  BTC')).toBe(true)
  })
})
