import pdfRenderer from '@react-pdf/renderer'
import QRCode from 'qrcode'
import type { PdfStatement } from '../schemas/pdf-statement'
import {
  type DocumentInput,
  type EnvelopeDocumentInput,
  getStatementDocumentTemplates,
} from './get-statement-templates'

export async function renderStatementDocument(documentInput: DocumentInput): Promise<JSX.Element> {
  // NOTE: The fonts are in the public dir at this location:
  const geistDirPath = '/fonts/geist'
  const { CustomStatementDocument, MonthlyStatementDocument } = getStatementDocumentTemplates(pdfRenderer, geistDirPath)
  const qrCode = await QRCode.toDataURL('https://www.hoseki.app')

  switch (documentInput.statement.format) {
    case 'custom':
      return <CustomStatementDocument input={documentInput} qrCode={qrCode} />
    case 'monthly':
      return <MonthlyStatementDocument input={documentInput} qrCode={qrCode} />
  }
}

export async function renderEnvelopeDocument(
  statements: PdfStatement[],
  watermarkText: string = '',
): Promise<JSX.Element> {
  // NOTE: The fonts are in the public dir at this location:
  const geistDirPath = '/fonts/geist'
  const { EnvelopeDocument } = getStatementDocumentTemplates(pdfRenderer, geistDirPath)
  const qrCode = await QRCode.toDataURL('https://www.hoseki.app')

  const envelopeInput: EnvelopeDocumentInput = {
    watermarkText,
    statements,
  }

  return <EnvelopeDocument input={envelopeInput} qrCode={qrCode} />
}
