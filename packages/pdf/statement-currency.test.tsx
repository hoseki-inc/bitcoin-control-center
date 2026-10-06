import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pdfRenderer, { renderToBuffer } from '@react-pdf/renderer'
import Decimal from 'decimal.js'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { assert, describe, expect, it } from 'vitest'
import { parseUnknown } from '../result/lib/parse'
import { AmountSchema, PdfStatementSchema } from '../schemas/pdf-statement'
import { StatementQuoteCurrencySchema } from '../schemas/statement-quote'
import { getStatementDocumentTemplates } from './get-statement-templates'
import { sampleCustomStatement, sampleMonthlyStatement } from './preview/presets'

const fonts = resolve(import.meta.dirname, '../../apps/control-center/public/fonts/geist')
const templates = getStatementDocumentTemplates(pdfRenderer, fonts)
// Inspect displayed content independently of the PDF's compressed serialization.
const TextPrimitive: React.FC<{ children?: React.ReactNode }> = ({ children }) => <span>{children}</span>
const textTemplates = getStatementDocumentTemplates(
  {
    Font: pdfRenderer.Font,
    StyleSheet: pdfRenderer.StyleSheet,
    Document: TextPrimitive,
    Page: TextPrimitive,
    Text: TextPrimitive,
    View: TextPrimitive,
    Svg: TextPrimitive,
    Rect: TextPrimitive,
    Path: TextPrimitive,
    Image: TextPrimitive,
    Link: TextPrimitive,
    G: TextPrimitive,
    Defs: TextPrimitive,
    ClipPath: TextPrimitive,
    LinearGradient: TextPrimitive,
    Stop: TextPrimitive,
  },
  fonts,
)

const linkTemplates = getStatementDocumentTemplates(
  {
    Font: pdfRenderer.Font,
    StyleSheet: pdfRenderer.StyleSheet,
    Document: TextPrimitive,
    Page: TextPrimitive,
    Text: TextPrimitive,
    View: TextPrimitive,
    Svg: TextPrimitive,
    Rect: TextPrimitive,
    Path: TextPrimitive,
    Image: TextPrimitive,
    Link: ({ src, children }: { src: string; children?: React.ReactNode }) => <a href={src}>{children}</a>,
    G: TextPrimitive,
    Defs: TextPrimitive,
    ClipPath: TextPrimitive,
    LinearGradient: TextPrimitive,
    Stop: TextPrimitive,
  },
  fonts,
)

// Records each text's font size so tests can check how amounts fit their columns.
const SizedText: React.FC<{ style?: { fontSize?: number }; children?: React.ReactNode }> = ({ style, children }) => (
  <span data-font-size={style?.fontSize}>{children}</span>
)
const sizedTemplates = getStatementDocumentTemplates(
  {
    Font: pdfRenderer.Font,
    StyleSheet: pdfRenderer.StyleSheet,
    Document: TextPrimitive,
    Page: TextPrimitive,
    Text: SizedText,
    View: TextPrimitive,
    Svg: TextPrimitive,
    Rect: TextPrimitive,
    Path: TextPrimitive,
    Image: TextPrimitive,
    Link: TextPrimitive,
    G: TextPrimitive,
    Defs: TextPrimitive,
    ClipPath: TextPrimitive,
    LinearGradient: TextPrimitive,
    Stop: TextPrimitive,
  },
  fonts,
)

describe('statement PDF currencies', () => {
  it('shrinks only currency values too long for their column', () => {
    const [entry, ...rest] = sampleCustomStatement.summary.entries
    assert(entry)
    const statement = {
      ...sampleCustomStatement,
      quoteCurrency: 'CAD' as const,
      summary: {
        ...sampleCustomStatement.summary,
        entries: [
          {
            ...entry,
            moneyIn: { ...entry.moneyIn, sats: 100_000_000_000n, quoteValue: new Decimal('1234567.89') },
            closingBalance: { ...entry.closingBalance, quoteValue: new Decimal('100.00') },
          },
          ...rest,
        ],
      },
    }
    const markup = renderToStaticMarkup(
      <sizedTemplates.CustomStatementDocument input={{ statement, watermarkText: 'Statement' }} qrCode="" />,
    )
    const sizes = new Map(
      [...markup.matchAll(/data-font-size="([^"]+)">([^<]+)</g)].map(([, fontSize, text]) => [
        // Intl puts a non-breaking space between the currency code and the amount.
        text?.replaceAll('\u00a0', ' '),
        Number(fontSize),
      ]),
    )
    const size = (text: string): number | undefined => sizes.get(text)
    expect(size('CAD 1,234,567.89')).toBeLessThan(10)
    expect(size('CAD 100.00')).toBe(10)
    expect(size('1000.00000000 BTC')).toBeLessThan(10)
    expect(size('0.00000000 BTC')).toBe(10)
  })

  it('never embeds a self-hosted mempool address', () => {
    const statement = {
      ...sampleCustomStatement,
      quoteProviderUrls: ['http://192.168.1.50:3006/api', 'http://example2345.onion:8999', 'https://mempool.space'],
    }
    const markup = renderToStaticMarkup(
      <linkTemplates.CustomStatementDocument input={{ statement, watermarkText: 'Statement' }} qrCode="" />,
    )
    expect(markup).not.toContain('192.168.1.50')
    expect(markup).not.toContain('.onion')
    expect(markup).toContain('href="https://mempool.space"')
    expect(markup).toContain('configured mempool')
    expect(markup).not.toContain('configured mempool and configured mempool')
  })

  it('reads old USD amounts and defaults old statements to USD', () => {
    const { quoteValue, ...amount } = sampleCustomStatement.summary.closingBalance
    const legacy = parseUnknown(AmountSchema, { ...amount, usdValue: quoteValue })
    expect(legacy.isOk()).toBe(true)
    expect(legacy.unwrap().quoteValue.equals(quoteValue)).toBe(true)
    const { quoteCurrency: _, ...statement } = sampleCustomStatement
    const parsed = parseUnknown(PdfStatementSchema, statement)
    expect(parsed.unwrap().quoteCurrency).toBe('USD')
  })

  for (const quoteCurrency of StatementQuoteCurrencySchema.options) {
    for (const format of ['custom', 'monthly'] as const) {
      it(`renders ${format} in ${quoteCurrency} with saved source attribution`, async () => {
        const fixture = format === 'custom' ? sampleCustomStatement : sampleMonthlyStatement
        const statement = {
          ...fixture,
          quoteCurrency,
          quoteProviderUrls: ['https://mempool.example', 'https://mempool.space'],
        }
        const input = { statement, watermarkText: 'Statement Preview' }
        const Component = format === 'custom' ? templates.CustomStatementDocument : templates.MonthlyStatementDocument
        const TextComponent =
          format === 'custom' ? textTemplates.CustomStatementDocument : textTemplates.MonthlyStatementDocument
        const markup = renderToStaticMarkup(<TextComponent input={input} qrCode="" />)
        expect(markup).toContain(`APPROX. ${quoteCurrency} VALUE:`)
        expect(markup).toContain(`${quoteCurrency} values are approximate`)
        expect(markup).toContain('before or after the valuation day')
        expect(markup).not.toContain('up to seven days earlier')
        expect(markup).toContain('configured mempool')
        expect(markup).toContain('mempool.space')
        expect(markup).not.toContain('Bitcoin-to-USD exchange rate from')
        if (quoteCurrency !== 'USD') {
          expect(markup).not.toContain('USD')
        }
        const buffer = await renderToBuffer(<Component input={input} qrCode="" />)
        expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
        expect(buffer.length).toBeGreaterThan(10000)
        const directory = process.env['CURRENCY_PDF_QA_DIRECTORY']
        if (directory !== undefined && directory !== '') {
          mkdirSync(directory, { recursive: true })
          writeFileSync(resolve(directory, `${format}-${quoteCurrency}.pdf`), buffer)
        }
      }, 30000)
    }
  }
})
