import { createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PdfStatementSchema } from '@hoseki/packages/schemas'
import type { PdfStatement } from '@hoseki/packages/schemas'
import type { FastifyInstance } from 'fastify'
import type { AppContext } from '../../context'
import { StatementMapper } from './mapper'
import { cleanupPdf, generatePdf } from './pdf_generator'

/**
 * Register statement HTTP routes (non-tRPC) on the Fastify instance.
 * These routes handle PDF download which requires streaming a file response.
 */
export async function registerStatementRoutes(fastify: FastifyInstance, appCtx: AppContext): Promise<void> {
  fastify.post<{
    Body: { statement_id: string; format?: 'custom' | 'monthly'; account_holder_id?: string }
  }>('/statements/download', async (req, reply) => {
    const { statement_id, format = 'custom' } = req.body ?? {}

    if (!statement_id) {
      return reply.status(400).send({ code: 'invalid_input', message: 'statement_id is required' })
    }

    const loaded = appCtx.statementService.loadCompleted(statement_id)
    if (!loaded) {
      return reply.status(404).send({ code: 'not_found', message: 'Completed statement not found' })
    }

    const openingDate = new Date(loaded.row.opening_date)
    const closingDate = new Date(loaded.row.closing_date)
    const createdAt = new Date(loaded.row.created_at)

    appCtx.logger.info(
      {
        rawOpeningDate: loaded.row.opening_date,
        rawClosingDate: loaded.row.closing_date,
        rawCreatedAt: loaded.row.created_at,
        parsedOpening: openingDate.toISOString(),
        parsedClosing: closingDate.toISOString(),
        parsedCreated: createdAt.toISOString(),
        timezone: loaded.row.timezone,
        format,
      },
      'PDF download: preparing statement data',
    )

    // Build PdfStatement from stored data
    const mapper = new StatementMapper()
    const pdfResult = mapper.toPdfStatement(
      {
        id: loaded.row.id,
        createdAt,
        status: 'completed',
        counter: loaded.row.counter,
        timezone: loaded.row.timezone,
        openingDate,
        closingDate,
        user: { email: null, name: loaded.row.user_name, address: loaded.row.user_address },
        transactionMap: loaded.transactionMap,
        dailyRates: loaded.dailyRates,
      },
      format,
    )

    if (pdfResult.isErr()) {
      appCtx.logger.error({ err: pdfResult.unwrapErr() }, 'Failed to build PdfStatement')
      return reply.status(500).send({ code: 'generation_failed', message: pdfResult.unwrapErr().message })
    }

    // Validate the PdfStatement through Zod to catch any invalid dates/types
    // before passing to the PDF renderer (which gives opaque errors).
    let pdfStatement: PdfStatement
    try {
      pdfStatement = PdfStatementSchema.parse(pdfResult.unwrap())
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PdfStatement validation failed'
      appCtx.logger.error({ err }, 'PdfStatement validation failed — likely an invalid date or type')
      return reply.status(500).send({ code: 'validation_failed', message })
    }

    // Render PDF to a temp file
    const outputDir = join(tmpdir(), 'sentinel-statements')
    try {
      const genResult = await generatePdf(pdfStatement, outputDir)
      if (genResult.isErr()) {
        appCtx.logger.error({ err: genResult.unwrapErr() }, 'Failed to generate PDF')
        return reply.status(500).send({ code: 'generation_failed', message: 'PDF generation failed' })
      }

      const { filePath, fileName } = genResult.unwrap()
      const stream = createReadStream(filePath)

      // Clean up temp file after response is sent
      reply.raw.on('finish', () => {
        cleanupPdf(filePath)
      })

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename=${fileName}`)
        .send(stream)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF generation failed'
      appCtx.logger.error({ err, stack: err instanceof Error ? err.stack : undefined }, 'PDF generation threw')
      return reply.status(500).send({ code: 'generation_failed', message })
    }
  })
}
