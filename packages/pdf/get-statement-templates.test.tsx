import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pdfRenderer, { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import React from 'react'
import { describe, expect, it } from 'vitest'
import { getStatementDocumentTemplates } from './get-statement-templates'
import { sampleCustomStatement, sampleMonthlyStatement } from './preview/presets'

describe('statement PDF runtime', () => {
  it('keeps the tested renderer version aligned with both packaged runtimes', () => {
    const rendererVersion = (relativePath: string): string => {
      const manifest = JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8'))
      return manifest.dependencies['@react-pdf/renderer']
    }

    const expected = rendererVersion('../../package.json')
    expect(rendererVersion('../../desktop/package.json')).toBe(expected)
    expect(rendererVersion('../../start9/runtime/package.json')).toBe(expected)
  })

  it.each(['custom', 'monthly', 'envelope'] as const)(
    'renders the %s statement with local fonts and the real renderer',
    async (variant) => {
      const fonts = fileURLToPath(new URL('./preview/public/fonts/geist', import.meta.url))
      const { CustomStatementDocument, MonthlyStatementDocument, EnvelopeDocument } = getStatementDocumentTemplates(
        pdfRenderer,
        fonts,
      )
      const qrCode = await QRCode.toDataURL('https://example.com/statement-test')
      const watermarkText = 'TEST STATEMENT'
      const documents = {
        custom: <CustomStatementDocument input={{ statement: sampleCustomStatement, watermarkText }} qrCode={qrCode} />,
        monthly: (
          <MonthlyStatementDocument input={{ statement: sampleMonthlyStatement, watermarkText }} qrCode={qrCode} />
        ),
        envelope: (
          <EnvelopeDocument
            input={{ statements: [sampleCustomStatement, sampleMonthlyStatement], watermarkText }}
            qrCode={qrCode}
          />
        ),
      }

      const buffer = await renderToBuffer(documents[variant])
      expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
      expect(buffer.length).toBeGreaterThan(10_000)
      expect(buffer.toString('latin1')).toMatch(/\/Type \/Page\b/)
    },
    15_000,
  )
})
