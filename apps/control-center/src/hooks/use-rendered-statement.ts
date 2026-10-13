import { renderStatementPdf } from '@hoseki/packages/pdf'
import type { PdfStatement } from '@hoseki/packages/schemas'
import { useEffect, useState } from 'react'

interface RenderedStatement {
  data: PdfStatement
  attempt: number
  url: string | null
  error: string | null
}

interface StatementView {
  /** The statement's built PDF, as an object URL. */
  url: string | null
  error: string | null
  isRendering: boolean
  retry: () => void
}

/** A completed render belongs only to the input that started it. */
export function useRenderedStatement(data: PdfStatement | undefined, enabled = true): StatementView {
  const [rendered, setRendered] = useState<RenderedStatement | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !data) {
      return
    }
    let current = true
    let url: string | null = null
    void renderStatementPdf({ statement: data, watermarkText: '' })
      .then((file) => {
        if (current) {
          url = URL.createObjectURL(file)
          setRendered({ data, attempt, url, error: null })
        }
      })
      .catch(() => {
        if (current) {
          setRendered({ data, attempt, url: null, error: 'Failed to render statement' })
        }
      })
    return () => {
      current = false
      if (url !== null) {
        URL.revokeObjectURL(url)
      }
    }
  }, [data, enabled, attempt])
  const result = enabled && data && rendered?.data === data && rendered.attempt === attempt ? rendered : null
  return {
    url: result?.url ?? null,
    error: result?.error ?? null,
    isRendering: Boolean(enabled && data && !result),
    retry: () => {
      setAttempt((value) => value + 1)
    },
  }
}
