import { renderStatementDocument } from '@hoseki/packages/pdf'
import type { PdfStatement } from '@hoseki/packages/schemas'
import { type ReactElement, useEffect, useState } from 'react'

interface RenderedStatement {
  data: PdfStatement
  attempt: number
  document: ReactElement | null
  error: string | null
}

interface StatementPreview {
  document: ReactElement | null
  error: string | null
  isRendering: boolean
  retry: () => void
}

/** A completed render belongs only to the input that started it. */
export function useRenderedStatement(data: PdfStatement | undefined, enabled = true): StatementPreview {
  const [rendered, setRendered] = useState<RenderedStatement | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!enabled || !data) {
      return
    }
    let current = true
    void renderStatementDocument({ statement: data, watermarkText: 'Statement Preview' })
      .then((document) => {
        if (current) {
          setRendered({ data, attempt, document, error: null })
        }
      })
      .catch(() => {
        if (current) {
          setRendered({ data, attempt, document: null, error: 'Unable to render this statement. Please retry.' })
        }
      })
    return () => {
      current = false
    }
  }, [data, enabled, attempt])
  const result = enabled && data && rendered?.data === data && rendered.attempt === attempt ? rendered : null
  return {
    document: result?.document ?? null,
    error: result?.error ?? null,
    isRendering: Boolean(enabled && data && !result),
    retry: () => {
      setAttempt((value) => value + 1)
    },
  }
}
