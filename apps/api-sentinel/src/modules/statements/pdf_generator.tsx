import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { type DocumentInput, getStatementDocumentTemplates } from '@hoseki/packages/pdf/get-statement-templates'
import type { PdfStatement } from '@hoseki/packages/schemas'
import { Ok, asyncFn } from '@patina/core'
import type { Result } from '@patina/core'
import type ReactPDF from '@react-pdf/renderer'
import QRCode from 'qrcode'
import type React from 'react'
import { loadEnv } from '../../env'

/**
 * Dynamic import of @react-pdf/renderer for ESM compatibility.
 * Same pattern as api-armadillo's pdf_template.tsx.
 */
async function getStatementDocumentTemplatesAsync(): Promise<ReturnType<typeof getStatementDocumentTemplates>> {
  const pdfRenderer = (await import('@react-pdf/renderer')) as typeof ReactPDF
  const geistDirPath = `${loadEnv().APP_DIR}/assets/fonts/geist`
  return getStatementDocumentTemplates(pdfRenderer, geistDirPath)
}

async function renderStatementDocument(documentInput: DocumentInput): Promise<React.ReactElement> {
  const { CustomStatementDocument, MonthlyStatementDocument } = await getStatementDocumentTemplatesAsync()
  const qrCode = await QRCode.toDataURL('https://www.hoseki.app')

  switch (documentInput.statement.format) {
    case 'custom':
      return <CustomStatementDocument input={documentInput} qrCode={qrCode} />
    case 'monthly':
      return <MonthlyStatementDocument input={documentInput} qrCode={qrCode} />
  }
}

export interface StatementFile {
  filePath: string
  fileName: string
}

/**
 * Render a PdfStatement to a PDF file on disk.
 * Returns the file path and suggested filename.
 */
export const generatePdf = asyncFn(
  async (pdfStatement: PdfStatement, outputDir: string): Promise<Result<StatementFile, Error>> => {
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true })
    }

    const fileName = `statement-${pdfStatement.id}.pdf`
    const filePath = join(outputDir, fileName)

    const documentInput: DocumentInput = {
      watermarkText: '',
      statement: pdfStatement,
    }

    const reactPDF = await import('@react-pdf/renderer')
    const document = await renderStatementDocument(documentInput)
    await reactPDF.renderToFile(document, filePath)

    return Ok({ filePath, fileName })
  },
)

/**
 * Clean up a generated PDF file.
 */
export function cleanupPdf(filePath: string): void {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  } catch {
    // Swallow cleanup errors
  }
}
