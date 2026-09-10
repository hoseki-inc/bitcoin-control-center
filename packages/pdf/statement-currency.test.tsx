import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pdfRenderer, { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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

describe('statement PDF currencies', () => {
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
